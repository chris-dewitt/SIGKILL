import type { CommandSpec } from '../shell/exec.js';
import { ROOT_USER, type Vfs } from '../vfs/vfs.js';
import * as p from '../vfs/path.js';
import { parseArgs, usage } from '../coreutils/helpers.js';

/** One file handed to or returned from the interpreter. */
export interface FileEntry {
  path: string;
  /** Base64, so binary survives the worker boundary intact. */
  data: string;
  mode: number;
}

export interface PythonRequest {
  /** Source to execute. */
  code: string;
  /** sys.argv, including argv[0]. */
  argv: string[];
  stdin: string;
  cwd: string;
  env: Record<string, string>;
  /** The machine's filesystem, as the interpreter should see it. */
  files: FileEntry[];
  /**
   * Directories, carried separately.
   *
   * An empty directory has no files to imply it, so without this an empty
   * `work/logs` simply would not exist on the far side.
   */
  dirs: string[];
  /** Top-level directories the machine owns, for change detection. */
  roots: string[];
}

export interface PythonResult {
  stdout: string;
  stderr: string;
  code: number;
  /** Files created or modified by the interpreter. */
  written: FileEntry[];
  /** Absolute paths the interpreter removed. */
  deleted: string[];
  /** Directories the interpreter created, including empty ones. */
  createdDirs: string[];
}

/**
 * A real Python interpreter, supplied from outside.
 *
 * The Machine deliberately does not depend on one. Pyodide is ten megabytes
 * and browser-shaped; this package is eighteen kilobytes and runs in Node.
 * Binding them through an interface keeps the test suite fast, keeps the
 * engine honest about what it does and does not contain, and leaves room for
 * a different interpreter later without touching the shell.
 */
export interface PythonRuntime {
  /** Human-readable version, for the banner. */
  readonly version: string;
  /** Load the interpreter if it is not loaded yet. */
  ready(): Promise<void>;
  run(request: PythonRequest): Promise<PythonResult>;
}

/**
 * Directories the interpreter owns and the machine must not overwrite.
 *
 * Pyodide keeps its standard library and device nodes here. Pushing the
 * machine's filesystem over them would break Python before it started.
 */
const INTERPRETER_OWNED = ['/lib', '/proc', '/dev', '/bin'];

export function machineRoots(vfs: Vfs): string[] {
  return vfs
    .readdir('/', ROOT_USER)
    .map((name) => `/${name}`)
    .filter((root) => !INTERPRETER_OWNED.includes(root));
}

const encodeBase64 = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const decodeBase64 = (b64: string): Uint8Array => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

/** Flatten the machine's filesystem into something the interpreter can accept. */
export function collectTree(vfs: Vfs, roots: string[]): { files: FileEntry[]; dirs: string[] } {
  const files: FileEntry[] = [];
  const dirs: string[] = [];

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = vfs.readdir(dir, ROOT_USER);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = p.join(dir, name);
      let stat;
      try {
        stat = vfs.lstat(full, ROOT_USER);
      } catch {
        continue;
      }
      // Symlinks are not followed across the boundary: the interpreter gets a
      // plain tree, which avoids re-creating loop handling on the far side.
      if (stat.kind === 'dir') {
        dirs.push(full);
        walk(full);
      } else if (stat.kind === 'file') {
        files.push({ path: full, data: encodeBase64(vfs.read(full, ROOT_USER)), mode: stat.mode });
      }
    }
  };

  for (const root of roots) {
    dirs.push(root);
    walk(root);
  }
  return { files, dirs };
}

/** Files only. Kept for callers that do not care about empty directories. */
export function collectFiles(vfs: Vfs, roots: string[]): FileEntry[] {
  return collectTree(vfs, roots).files;
}

/** Apply whatever the interpreter changed back onto the machine. */
export function applyResult(vfs: Vfs, result: PythonResult, asUser = ROOT_USER): void {
  // Directories first, and shallowest first, so a nested mkdir has its parent.
  for (const dir of [...result.createdDirs].sort((a, b) => a.length - b.length)) {
    if (!vfs.exists(dir, ROOT_USER)) vfs.mkdirp(dir, ROOT_USER);
  }
  for (const file of result.written) {
    const dir = p.dirname(file.path);
    if (!vfs.exists(dir, ROOT_USER)) vfs.mkdirp(dir, ROOT_USER);
    vfs.write(file.path, decodeBase64(file.data), asUser, file.mode);
  }
  for (const path of result.deleted) {
    if (vfs.exists(path, ROOT_USER)) {
      try {
        vfs.rm(path, asUser);
      } catch {
        // A delete the player was not permitted is simply not applied.
      }
    }
  }
}

export function pythonCommands(getRuntime: () => PythonRuntime | undefined): CommandSpec[] {
  const runPython: CommandSpec['run'] = async (ctx, argv, io) => {
    const runtime = getRuntime();
    if (!runtime) {
      io.err(`${argv[0]}: no Python interpreter is installed on this machine\n`);
      return 127;
    }

    const { flags, values, operands } = parseArgs(argv, { valued: ['-c'] });

    let code: string;
    let scriptArgv: string[];

    const inline = values.get('-c');
    if (inline !== undefined) {
      code = inline;
      scriptArgv = ['-c', ...operands];
    } else if (operands.length > 0) {
      const script = ctx.resolve(operands[0]!);
      try {
        code = ctx.vfs.readText(script, ctx.user);
      } catch {
        io.err(`${argv[0]}: can't open file '${operands[0]}': [Errno 2] No such file or directory\n`);
        return 2;
      }
      scriptArgv = operands;
    } else if (io.stdin.length > 0) {
      // Piped source, which is how `cat script.py | python3` works.
      code = io.stdin;
      scriptArgv = ['-'];
    } else {
      if (flags.has('-V') || flags.has('--version')) {
        io.out(`Python ${runtime.version}\n`);
        return 0;
      }
      io.err(
        `${argv[0]}: this machine has no interactive interpreter.\n` +
          `Run a script, or use ${argv[0]} -c 'code'.\n`,
      );
      return 1;
    }

    if (flags.has('-V') || flags.has('--version')) {
      io.out(`Python ${runtime.version}\n`);
      return 0;
    }

    try {
      await runtime.ready();
    } catch (e) {
      // The interpreter is a 12 MB download that some hosts cannot serve.
      // Say so plainly rather than surfacing a module-resolution error.
      io.err(
        `${argv[0]}: the Python interpreter could not be loaded on this build.\n` +
          `The shell is unaffected; every other command still works.\n` +
          `  (${e instanceof Error ? e.message : String(e)})\n`,
      );
      return 127;
    }

    const roots = machineRoots(ctx.vfs);
    const tree = collectTree(ctx.vfs, roots);
    const result = await runtime.run({
      code,
      argv: scriptArgv,
      stdin: io.stdin,
      cwd: ctx.cwd,
      env: { ...ctx.env },
      files: tree.files,
      dirs: tree.dirs,
      roots,
    });

    // This is the moment the whole engine exists for: what Python wrote is
    // now in the same filesystem that grep and cat read from.
    applyResult(ctx.vfs, result, ctx.user);

    io.out(result.stdout);
    io.err(result.stderr);
    return result.code;
  };

  const manual =
    'Run a Python script.\n' +
    "  python3 script.py      run a file\n" +
    "  python3 -c 'code'      run a fragment\n" +
    '  python3 -V             print the version\n' +
    'The interpreter shares this machine\'s filesystem: a file written from\n' +
    'Python is visible to every other command immediately.';

  const plain =
    'Runs Python. Two ways:\n' +
    "  python3 -c 'print(1 + 1)'     run one line\n" +
    '  python3 fix.py                run a file you wrote\n' +
    'Anything Python writes to a file, the shell can read straight after --\n' +
    'they are looking at the same disk.';

  return [
    { name: 'python3', summary: 'run the Python interpreter', manual, plain, run: runPython },
    { name: 'python', summary: 'run the Python interpreter', manual, plain, run: runPython },
  ];
}

export { usage };
