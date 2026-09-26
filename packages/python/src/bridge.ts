import type { FileEntry, PythonRequest, PythonResult } from '@sigkill/machine';

/**
 * The Pyodide side of the interpreter, independent of where it runs.
 *
 * This module deliberately knows nothing about Workers. It is the part that
 * talks to Pyodide, so it can be driven from a Worker in the browser and
 * directly from Node in tests — which is what makes the Python integration
 * testable at all.
 */

// Pyodide's own types are heavy and only partially useful here; this is the
// surface actually used.
interface PyodideFS {
  mkdirTree(path: string): void;
  writeFile(path: string, data: Uint8Array, opts?: { encoding?: string }): void;
  readFile(path: string, opts: { encoding: 'binary' }): Uint8Array;
  unlink(path: string): void;
  rmdir(path: string): void;
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  isFile(mode: number): boolean;
  analyzePath(path: string): { exists: boolean };
  chdir(path: string): void;
}

export interface PyodideLike {
  FS: PyodideFS;
  runPython(code: string): unknown;
  setStdout(opts: { batched: (s: string) => void }): void;
  setStderr(opts: { batched: (s: string) => void }): void;
  setStdin(opts: { stdin: () => string | null }): void;
  globals: { set(name: string, value: unknown): void };
  version: string;
}

const encode = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const decode = (b64: string): Uint8Array => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

/** Walk a Pyodide directory tree, returning absolute directory paths. */
function walkDirs(fs: PyodideFS, dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = fs.readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === '.' || name === '..') continue;
    const full = dir === '/' ? `/${name}` : `${dir}/${name}`;
    let mode: number;
    try {
      mode = fs.stat(full).mode;
    } catch {
      continue;
    }
    if (fs.isDir(mode)) {
      out.push(full);
      walkDirs(fs, full, out);
    }
  }
  return out;
}

/** Walk a Pyodide directory tree, returning absolute file paths. */
function walk(fs: PyodideFS, dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = fs.readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === '.' || name === '..') continue;
    const full = dir === '/' ? `/${name}` : `${dir}/${name}`;
    let mode: number;
    try {
      mode = fs.stat(full).mode;
    } catch {
      continue;
    }
    if (fs.isDir(mode)) walk(fs, full, out);
    else if (fs.isFile(mode)) out.push(full);
  }
  return out;
}

/**
 * Read a `SystemExit` out of a Pyodide error message, if that is what it is.
 *
 * `sys.exit()` is the ordinary way a python program finishes, and python
 * prints nothing for it -- an integer becomes the exit status, anything else
 * is printed to stderr and the status is 1. Returns `undefined` for a real
 * exception, which is the caller's signal to show the traceback.
 */
export function systemExit(message: string): { code: number; message?: string } | undefined {
  const match = /(?:^|\n)SystemExit(?::[ \t]*(.*))?[ \t]*$/.exec(message.replace(/\s+$/, ''));
  if (!match) return undefined;

  const value = (match[1] ?? '').trim();
  // `sys.exit()` and `sys.exit(None)` both mean success.
  if (value === '' || value === 'None') return { code: 0 };
  if (/^\d+$/.test(value)) return { code: Number(value) };
  // A non-integer argument is a message, and the status is 1.
  return { code: 1, message: value };
}


/**
 * Take the interpreter's own frames out of a traceback.
 *
 * Pyodide's `eval_code` and `exec` sit between the shell and the player's
 * script, so every error opened with three frames of `_pyodide/_base.py` and
 * a line of somebody else's source. They are never the player's problem, they
 * push the real frame off a phone screen, and in a game about reading errors
 * they teach that errors are noise.
 *
 * Everything from the first frame naming a real file onward is kept exactly
 * as Python wrote it, because that part *is* the lesson.
 */
/**
 * Frame names that are this bridge talking to itself.
 *
 * `<exec>` is the shim that compiles the player's script under its real name,
 * `<runpy>` the two lines behind `python3 -m`, and `<frozen runpy>` the
 * stdlib launcher they go through. None is a file anybody can open, so none
 * belongs in a traceback a player is asked to read.
 *
 * Dropping `<frozen runpy>` is a deliberate departure: CPython does print
 * those frames. It prints three of them, above the one line that matters, and
 * on a phone that is the whole screen. The frames describe how the program
 * was started, which the player already knows because they typed it.
 */
const OUR_PLUMBING = new Set(['<exec>', '<runpy>', '<frozen runpy>']);

export function trimTraceback(message: string): string {
  const lines = message.split('\n');
  const header = lines.findIndex((line) => line.startsWith('Traceback'));
  if (header < 0) return message;

  const kept: string[] = [lines[header]!];
  let skipping = false;

  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const frame = /^\s+File "([^"]+)"/.exec(line);
    if (frame) {
      // `_pyodide` and the bundled stdlib zip are the interpreter's own
      // scaffolding. A frame from anywhere else belongs to the player.
      skipping =
        /_pyodide|python\d*\.zip/.test(frame[1] ?? '') || OUR_PLUMBING.has(frame[1] ?? '');
      if (skipping) continue;
    } else if (skipping && /^\s/.test(line)) {
      // The source line and caret that belong to a skipped frame.
      continue;
    } else if (skipping) {
      skipping = false;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Run one request against a loaded Pyodide.
 *
 * The filesystem is pushed in whole, the code runs, and the tree is diffed
 * back out. Bulk copying beats a per-syscall bridge here: the machine's disk
 * is a few dozen small files, and one copy in and one diff out is far simpler
 * to reason about — and to keep deterministic — than intercepting every
 * `open()` across a Worker boundary.
 */
export async function runRequest(py: PyodideLike, request: PythonRequest): Promise<PythonResult> {
  const { FS } = py;

  // --- push the machine's filesystem in -----------------------------------
  for (const file of request.files) {
    FS.mkdirTree(dirname(file.path));
    FS.writeFile(file.path, decode(file.data));
  }
  // Directories are pushed explicitly: an empty one has no file to imply it.
  for (const dir of request.dirs) FS.mkdirTree(dir);
  for (const root of request.roots) FS.mkdirTree(root);

  const before = new Map<string, string>();
  const dirsBefore = new Set<string>();
  for (const root of request.roots) {
    for (const path of walk(FS, root)) {
      before.set(path, encode(FS.readFile(path, { encoding: 'binary' })));
    }
    for (const dir of walkDirs(FS, root)) dirsBefore.add(dir);
  }

  try {
    FS.chdir(request.cwd);
  } catch {
    FS.mkdirTree(request.cwd);
    FS.chdir(request.cwd);
  }

  // --- run ----------------------------------------------------------------
  let stdout = '';
  let stderr = '';
  py.setStdout({ batched: (s) => { stdout += s + '\n'; } });
  py.setStderr({ batched: (s) => { stderr += s + '\n'; } });

  let stdinRemaining = request.stdin;
  py.setStdin({
    stdin: () => {
      if (stdinRemaining.length === 0) return null;
      const chunk = stdinRemaining;
      stdinRemaining = '';
      return chunk;
    },
  });

  /*
   * The virtual clock, for as long as the script runs.
   *
   * Pyodide resolves `time.time()` against the host's `Date.now`, so without
   * this a script that stamps its output with the time cannot be replayed --
   * the same leak SQLite had, and the same fix.
   *
   * Restored in a `finally`. Leaving the host's `Date.now` replaced would be
   * a far worse bug than the one being closed: every later test in the
   * process would silently agree about what time it is.
   */
  /** What the traceback should call this code. */
  const file = request.filename ?? '<stdin>';

  const realNow = Date.now;
  if (request.now !== undefined) {
    const at = request.now;
    Date.now = () => at;
  }

  let code = 0;
  try {
    /*
     * A fresh argv and environment, and working standard streams.
     *
     * The streams need saying out loud. `python3 -m json.tool` closes
     * `sys.stdout` when it is done with it -- that is what the stdlib does,
     * not a bug we introduced -- and one interpreter serves every command in
     * the session. So a player who pretty-prints a JSON file, entirely
     * reasonably, would find that every `print` from then on went nowhere at
     * all, with no error to explain it. The worst class of bug: silent, and
     * blamed on the player's own script.
     *
     * Reopening over the same descriptors keeps Pyodide's capture intact,
     * since the capture is installed on the descriptor and not on the object.
     *
     * The module purge is the same hazard wearing a much worse hat. Python
     * caches every import in `sys.modules`, and one interpreter serving the
     * whole session means the cache outlives the command. So:
     *
     *     python3 -c 'import calc; print(calc.answer())'   -> 1
     *     (player finds the bug, edits calc.py, saves)
     *     python3 -c 'import calc; print(calc.answer())'   -> 1
     *
     * The fix silently does nothing. In an adventure whose entire subject is
     * edit-and-re-run, that is not a rough edge, it is the game failing to be
     * a game -- and it would be indistinguishable from the player being wrong.
     * A real python starts a fresh process each time, so anything imported
     * from the machine's own filesystem is dropped here to match. The stdlib
     * is left alone: reloading that every command would be slow and pointless.
     *
     * Bytecode caches go off for a related reason. A `.pyc` records the
     * source timestamp, so writing them would put a clock reading inside the
     * player's filesystem -- and replay is invariant #1.
     */
    py.runPython(`
import sys, os, io
sys.argv = ${JSON.stringify(request.argv)}
os.environ.clear()
os.environ.update(${JSON.stringify(request.env)})
__sk_roots = ${JSON.stringify(request.roots)}
sys.dont_write_bytecode = True
for __sk_mod in list(sys.modules):
    __sk_where = getattr(sys.modules.get(__sk_mod), "__file__", None) or ""
    if __sk_where.startswith(tuple(__sk_roots)) and "/lib/python" not in __sk_where:
        del sys.modules[__sk_mod]
for __sk_name, __sk_fd, __sk_mode in (('stdout', 1, 'w'), ('stderr', 2, 'w'), ('stdin', 0, 'r')):
    __sk_stream = getattr(sys, __sk_name, None)
    if __sk_stream is None or getattr(__sk_stream, 'closed', False):
        setattr(sys, __sk_name, io.TextIOWrapper(
            io.FileIO(__sk_fd, __sk_mode, closefd=False), line_buffering=True))
`);
    /*
     * Run the script as a real `__main__` module, under its own filename.
     *
     * Two things are going on here, and both are about the traceback and the
     * standard library believing what they are told.
     *
     * `runPython` names every frame `<exec>`, which is the interpreter
     * describing its own plumbing. Compiling with the real path means an
     * error points at the file the player is editing and the line they are
     * looking at -- in an adventure that teaches debugging, that is the
     * entire lesson.
     *
     * And `exec` into a bare dict is not the same thing as *being* `__main__`,
     * however convincing `__name__` looks from inside it.
     * `sys.modules['__main__']` would still be the interpreter's own module,
     * so anything in the standard library that reaches for the main module
     * finds the wrong one: `unittest.main()` collects zero tests out of it and
     * reports NO TESTS RAN, which is a lie about the player's code and
     * precisely the lie this game cannot afford to tell. A real `ModuleType`,
     * registered and then put back, costs six lines and makes
     * `if __name__ == '__main__'` mean what it says.
     */
    py.runPython(
      [
        'import builtins, sys, types',
        `__sk_code = compile(${JSON.stringify(request.code)}, ${JSON.stringify(file)}, 'exec')`,
        "__sk_main = types.ModuleType('__main__')",
        '__sk_main.__builtins__ = builtins',
        `__sk_main.__file__ = ${JSON.stringify(file)}`,
        "__sk_prev = sys.modules.get('__main__')",
        "sys.modules['__main__'] = __sk_main",
        'try:',
        '    exec(__sk_code, __sk_main.__dict__)',
        'finally:',
        '    if __sk_prev is None:',
        "        del sys.modules['__main__']",
        '    else:',
        "        sys.modules['__main__'] = __sk_prev",
      ].join('\n'),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const exit = systemExit(message);
    if (exit) {
      /*
       * `sys.exit()` is not an error, and python prints no traceback for one.
       *
       * This matters more than it looks: `unittest.main()` always finishes by
       * raising `SystemExit`, so without this every test run in an adventure
       * about testing would end in a traceback the player did nothing to
       * cause. A status is not a stack trace.
       */
      code = exit.code;
      if (exit.message) stderr += exit.message + '\n';
    } else {
      // Pyodide wraps the Python traceback in the JS error message. The
      // traceback is the teaching material, so it is passed through -- with
      // the interpreter's own frames taken out first. See `trimTraceback`.
      const trimmed = trimTraceback(message);
      stderr += trimmed.endsWith('\n') ? trimmed : trimmed + '\n';
      code = 1;
    }
  } finally {
    Date.now = realNow;
  }

  // --- diff the filesystem back out ---------------------------------------
  const written: FileEntry[] = [];
  const seen = new Set<string>();

  for (const root of request.roots) {
    for (const path of walk(FS, root)) {
      seen.add(path);
      const data = encode(FS.readFile(path, { encoding: 'binary' }));
      if (before.get(path) === data) continue;
      let mode = 0o644;
      try {
        mode = FS.stat(path).mode & 0o7777;
      } catch { /* keep the default */ }
      written.push({ path, data, mode });
    }
  }

  const deleted = [...before.keys()].filter((path) => !seen.has(path));

  const createdDirs: string[] = [];
  for (const root of request.roots) {
    for (const dir of walkDirs(FS, root)) {
      if (!dirsBefore.has(dir)) createdDirs.push(dir);
    }
  }

  return { stdout, stderr, code, written, deleted, createdDirs };
}

/**
 * Remove the machine's tree so the next run starts from its current disk.
 *
 * Directories go too, deepest first. Leaving them behind would mean a
 * directory the player removed in the shell was still visible to Python.
 */
export function clearMachineFiles(py: PyodideLike, roots: string[]): void {
  for (const root of roots) {
    for (const path of walk(py.FS, root)) {
      try {
        py.FS.unlink(path);
      } catch { /* nothing we can do, and nothing that matters */ }
    }
    const dirs = walkDirs(py.FS, root).sort((a, b) => b.length - a.length);
    for (const dir of dirs) {
      try {
        py.FS.rmdir(dir);
      } catch { /* non-empty or interpreter-owned; leave it */ }
    }
  }
}
