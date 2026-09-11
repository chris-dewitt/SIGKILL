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

  let code = 0;
  try {
    py.runPython(`
import sys, os
sys.argv = ${JSON.stringify(request.argv)}
os.environ.clear()
os.environ.update(${JSON.stringify(request.env)})
`);
    py.runPython(request.code);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Pyodide wraps the Python traceback in the JS error message. The
    // traceback is the teaching material, so it is passed through verbatim.
    stderr += message.endsWith('\n') ? message : message + '\n';
    code = 1;
    const exitMatch = /SystemExit:\s*(\d+)/.exec(message);
    if (exitMatch) code = Number(exitMatch[1]);
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
