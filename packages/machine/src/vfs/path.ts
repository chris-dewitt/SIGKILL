/**
 * Pure POSIX path arithmetic. No filesystem access, no symlink awareness —
 * symlink resolution lives in the VFS because it needs to read inodes.
 */

export function isAbsolute(p: string): boolean {
  return p.startsWith('/');
}

/** Split into non-empty components, ignoring repeated slashes. */
export function split(p: string): string[] {
  return p.split('/').filter((s) => s.length > 0);
}

/** Lexically normalise `.` and `..` without touching the filesystem. */
export function normalize(p: string): string {
  const absolute = isAbsolute(p);
  const out: string[] = [];

  for (const part of split(p)) {
    if (part === '.') continue;
    if (part === '..') {
      const last = out[out.length - 1];
      if (out.length > 0 && last !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(part);
  }

  const joined = out.join('/');
  if (absolute) return '/' + joined;
  return joined.length > 0 ? joined : '.';
}

export function join(...parts: string[]): string {
  const joined = parts.filter((p) => p.length > 0).join('/');
  return normalize(joined.length > 0 ? joined : '.');
}

/** Resolve `p` against `cwd` when relative. */
export function resolve(cwd: string, p: string): string {
  if (p.length === 0) return normalize(cwd);
  return isAbsolute(p) ? normalize(p) : join(cwd, p);
}

export function dirname(p: string): string {
  const n = normalize(p);
  if (n === '/') return '/';
  const idx = n.lastIndexOf('/');
  if (idx < 0) return '.';
  if (idx === 0) return '/';
  return n.slice(0, idx);
}

export function basename(p: string): string {
  const n = normalize(p);
  if (n === '/') return '/';
  const idx = n.lastIndexOf('/');
  return idx < 0 ? n : n.slice(idx + 1);
}
