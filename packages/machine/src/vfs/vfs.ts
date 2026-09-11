import { FsError } from '../errors.js';
import * as p from './path.js';
import type { Inode, NodeKind, StatResult, User, VfsSnapshot } from './types.js';

const MAX_SYMLINK_DEPTH = 32;

const enc = new TextEncoder();
const dec = new TextDecoder();

export const ROOT_USER: User = { uid: 0, gid: 0, name: 'root' };

export interface VfsOptions {
  /** Virtual clock. Defaults to a fixed epoch so tests are deterministic. */
  now?: () => number;
}

/**
 * An in-memory POSIX-shaped filesystem.
 *
 * Two properties are load-bearing for the whole project and must not be
 * traded away for convenience:
 *
 *   1. Deterministic. No Date.now(), no Math.random(), no host I/O. The same
 *      sequence of operations always produces the same filesystem, which is
 *      what lets every puzzle be replayed headlessly in CI.
 *   2. Serialisable. snapshot()/restore() round-trip exactly, because a save
 *      game *is* a VFS snapshot and nothing else.
 */
export class Vfs {
  private inodes = new Map<number, Inode>();
  private nextIno = 1;
  private rootIno: number;
  private readonly now: () => number;

  constructor(opts: VfsOptions = {}) {
    this.now = opts.now ?? (() => 0);
    this.rootIno = this.alloc('dir', 0o755, ROOT_USER).ino;
  }

  // ---------------------------------------------------------------- internals

  private alloc(kind: NodeKind, mode: number, user: User): Inode {
    const node: Inode = {
      ino: this.nextIno++,
      kind,
      mode,
      uid: user.uid,
      gid: user.gid,
      mtime: this.now(),
    };
    if (kind === 'dir') node.entries = new Map();
    if (kind === 'file') node.content = new Uint8Array(0);
    this.inodes.set(node.ino, node);
    return node;
  }

  private get(ino: number): Inode {
    const n = this.inodes.get(ino);
    if (!n) throw new FsError('ENOENT');
    return n;
  }

  /** Permission check. uid 0 is root and bypasses, exactly like the real thing. */
  private can(node: Inode, user: User, bit: 'r' | 'w' | 'x'): boolean {
    if (user.uid === 0) return true;
    const shift = node.uid === user.uid ? 6 : this.inGroup(node.gid, user) ? 3 : 0;
    const bits = (node.mode >> shift) & 0o7;
    const mask = bit === 'r' ? 0b100 : bit === 'w' ? 0b010 : 0b001;
    return (bits & mask) !== 0;
  }

  private inGroup(gid: number, user: User): boolean {
    if (user.gid === gid) return true;
    return user.groups?.includes(gid) ?? false;
  }

  private require(node: Inode, user: User, bit: 'r' | 'w' | 'x', path: string): void {
    if (!this.can(node, user, bit)) throw new FsError('EACCES', path);
  }

  /**
   * Walk `path` to an inode.
   *
   * @param followFinal follow a trailing symlink (false for lstat, rm, ln -s)
   */
  private walk(
    path: string,
    user: User,
    followFinal: boolean,
    depth = 0,
  ): { ino: number; node: Inode; resolved: string } {
    if (depth > MAX_SYMLINK_DEPTH) throw new FsError('ELOOP', path);

    const abs = p.normalize(path);
    const parts = p.split(abs);

    let ino = this.rootIno;
    let node = this.get(ino);
    let walked = '';

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      const isFinal = i === parts.length - 1;

      if (node.kind === 'symlink') {
        // An intermediate symlink always gets followed.
        const target = p.resolve(p.dirname(walked), node.target ?? '');
        const via = this.walk(target, user, true, depth + 1);
        ino = via.ino;
        node = via.node;
        walked = via.resolved;
      }

      if (node.kind !== 'dir') throw new FsError('ENOTDIR', walked || '/');
      this.require(node, user, 'x', walked || '/');

      const childIno = node.entries!.get(name);
      if (childIno === undefined) throw new FsError('ENOENT', p.join(walked, name));

      ino = childIno;
      node = this.get(ino);
      walked = p.join(walked === '' ? '/' : walked, name);

      if (isFinal && node.kind === 'symlink' && followFinal) {
        const target = p.resolve(p.dirname(walked), node.target ?? '');
        const via = this.walk(target, user, true, depth + 1);
        ino = via.ino;
        node = via.node;
        walked = via.resolved;
      }
    }

    return { ino, node, resolved: walked === '' ? '/' : walked };
  }

  /** Resolve the parent directory of `path`, for create/unlink operations. */
  private parentOf(path: string, user: User): { dir: Inode; name: string; dirPath: string } {
    const abs = p.normalize(path);
    if (abs === '/') throw new FsError('EPERM', '/');
    const dirPath = p.dirname(abs);
    const name = p.basename(abs);
    const { node } = this.walk(dirPath, user, true);
    if (node.kind !== 'dir') throw new FsError('ENOTDIR', dirPath);
    return { dir: node, name, dirPath };
  }

  private touch(node: Inode): void {
    node.mtime = this.now();
  }

  // -------------------------------------------------------------------- query

  exists(path: string, user: User = ROOT_USER): boolean {
    try {
      this.walk(path, user, true);
      return true;
    } catch {
      return false;
    }
  }

  stat(path: string, user: User = ROOT_USER): StatResult {
    const { node } = this.walk(path, user, true);
    return this.toStat(node);
  }

  /** Like stat, but does not follow a trailing symlink. */
  lstat(path: string, user: User = ROOT_USER): StatResult {
    const { node } = this.walk(path, user, false);
    return this.toStat(node);
  }

  private toStat(node: Inode): StatResult {
    return {
      kind: node.kind,
      mode: node.mode,
      uid: node.uid,
      gid: node.gid,
      mtime: node.mtime,
      ino: node.ino,
      size:
        node.kind === 'file'
          ? (node.content?.length ?? 0)
          : node.kind === 'dir'
            ? (node.entries?.size ?? 0)
            : (node.target?.length ?? 0),
    };
  }

  /** Canonical absolute path with all symlinks resolved. */
  realpath(path: string, user: User = ROOT_USER): string {
    return this.walk(path, user, true).resolved;
  }

  readlink(path: string, user: User = ROOT_USER): string {
    const { node } = this.walk(path, user, false);
    if (node.kind !== 'symlink') throw new FsError('EINVAL', path);
    return node.target ?? '';
  }

  // --------------------------------------------------------------------- read

  read(path: string, user: User = ROOT_USER): Uint8Array {
    const { node, resolved } = this.walk(path, user, true);
    if (node.kind === 'dir') throw new FsError('EISDIR', path);
    this.require(node, user, 'r', resolved);
    return node.content ?? new Uint8Array(0);
  }

  readText(path: string, user: User = ROOT_USER): string {
    return dec.decode(this.read(path, user));
  }

  readdir(path: string, user: User = ROOT_USER): string[] {
    const { node, resolved } = this.walk(path, user, true);
    if (node.kind !== 'dir') throw new FsError('ENOTDIR', path);
    this.require(node, user, 'r', resolved);
    return [...node.entries!.keys()].sort();
  }

  // -------------------------------------------------------------------- write

  write(path: string, data: Uint8Array | string, user: User = ROOT_USER, mode = 0o644): void {
    // Copy on write: the file must not alias a buffer the caller still holds.
    const bytes = new Uint8Array(typeof data === 'string' ? enc.encode(data) : data);
    const { dir, name, dirPath } = this.parentOf(path, user);

    const existingIno = dir.entries!.get(name);
    if (existingIno !== undefined) {
      const node = this.get(existingIno);
      if (node.kind === 'dir') throw new FsError('EISDIR', path);
      this.require(node, user, 'w', path);
      node.content = bytes;
      this.touch(node);
      return;
    }

    this.require(dir, user, 'w', dirPath);
    const node = this.alloc('file', mode, user);
    node.content = bytes;
    dir.entries!.set(name, node.ino);
    this.touch(dir);
  }

  writeText(path: string, text: string, user: User = ROOT_USER, mode = 0o644): void {
    this.write(path, enc.encode(text), user, mode);
  }

  append(path: string, data: Uint8Array | string, user: User = ROOT_USER): void {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    let existing: Uint8Array = new Uint8Array(0);
    if (this.exists(path, user)) existing = this.read(path, user);
    const merged = new Uint8Array(existing.length + bytes.length);
    merged.set(existing, 0);
    merged.set(bytes, existing.length);
    this.write(path, merged, user);
  }

  mkdir(path: string, user: User = ROOT_USER, mode = 0o755): void {
    const { dir, name, dirPath } = this.parentOf(path, user);
    if (dir.entries!.has(name)) throw new FsError('EEXIST', path);
    this.require(dir, user, 'w', dirPath);
    const node = this.alloc('dir', mode, user);
    dir.entries!.set(name, node.ino);
    this.touch(dir);
  }

  mkdirp(path: string, user: User = ROOT_USER, mode = 0o755): void {
    const parts = p.split(p.normalize(path));
    let cur = '';
    for (const part of parts) {
      cur = cur + '/' + part;
      if (!this.exists(cur, user)) this.mkdir(cur, user, mode);
    }
  }

  symlink(target: string, linkPath: string, user: User = ROOT_USER): void {
    const { dir, name, dirPath } = this.parentOf(linkPath, user);
    if (dir.entries!.has(name)) throw new FsError('EEXIST', linkPath);
    this.require(dir, user, 'w', dirPath);
    const node = this.alloc('symlink', 0o777, user);
    node.target = target;
    dir.entries!.set(name, node.ino);
    this.touch(dir);
  }

  unlink(path: string, user: User = ROOT_USER): void {
    const { dir, name, dirPath } = this.parentOf(path, user);
    const ino = dir.entries!.get(name);
    if (ino === undefined) throw new FsError('ENOENT', path);
    const node = this.get(ino);
    if (node.kind === 'dir') throw new FsError('EISDIR', path);
    this.require(dir, user, 'w', dirPath);
    dir.entries!.delete(name);
    this.inodes.delete(ino);
    this.touch(dir);
  }

  rmdir(path: string, user: User = ROOT_USER): void {
    const { dir, name, dirPath } = this.parentOf(path, user);
    const ino = dir.entries!.get(name);
    if (ino === undefined) throw new FsError('ENOENT', path);
    const node = this.get(ino);
    if (node.kind !== 'dir') throw new FsError('ENOTDIR', path);
    if (node.entries!.size > 0) throw new FsError('ENOTEMPTY', path);
    this.require(dir, user, 'w', dirPath);
    dir.entries!.delete(name);
    this.inodes.delete(ino);
    this.touch(dir);
  }

  /** Recursive delete. The caller is responsible for meaning it. */
  rm(path: string, user: User = ROOT_USER): void {
    const { node } = this.walk(path, user, false);
    if (node.kind === 'dir') {
      for (const child of [...node.entries!.keys()]) {
        this.rm(p.join(path, child), user);
      }
      this.rmdir(path, user);
    } else {
      this.unlink(path, user);
    }
  }

  rename(from: string, to: string, user: User = ROOT_USER): void {
    const src = this.parentOf(from, user);
    const ino = src.dir.entries!.get(src.name);
    if (ino === undefined) throw new FsError('ENOENT', from);
    const dst = this.parentOf(to, user);
    this.require(src.dir, user, 'w', src.dirPath);
    this.require(dst.dir, user, 'w', dst.dirPath);
    src.dir.entries!.delete(src.name);
    dst.dir.entries!.set(dst.name, ino);
    this.touch(src.dir);
    this.touch(dst.dir);
  }

  chmod(path: string, mode: number, user: User = ROOT_USER): void {
    const { node, resolved } = this.walk(path, user, true);
    if (user.uid !== 0 && node.uid !== user.uid) throw new FsError('EPERM', resolved);
    node.mode = mode & 0o7777;
    this.touch(node);
  }

  chown(path: string, uid: number, gid: number, user: User = ROOT_USER): void {
    if (user.uid !== 0) throw new FsError('EPERM', path);
    const { node } = this.walk(path, user, true);
    node.uid = uid;
    node.gid = gid;
    this.touch(node);
  }

  /** Permission probe used by the shell to decide if a file is executable. */
  access(path: string, bit: 'r' | 'w' | 'x', user: User = ROOT_USER): boolean {
    try {
      const { node } = this.walk(path, user, true);
      return this.can(node, user, bit);
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- snapshots

  snapshot(): VfsSnapshot {
    return {
      version: 1,
      nextIno: this.nextIno,
      root: this.rootIno,
      inodes: [...this.inodes.values()].map((n) => {
        const out: VfsSnapshot['inodes'][number] = {
          ino: n.ino,
          kind: n.kind,
          mode: n.mode,
          uid: n.uid,
          gid: n.gid,
          mtime: n.mtime,
        };
        if (n.kind === 'file') out.content = toBase64(n.content ?? new Uint8Array(0));
        if (n.kind === 'dir') out.entries = [...(n.entries ?? new Map())];
        if (n.kind === 'symlink') out.target = n.target ?? '';
        return out;
      }),
    };
  }

  static restore(snap: VfsSnapshot, opts: VfsOptions = {}): Vfs {
    const vfs = new Vfs(opts);
    vfs.inodes = new Map();
    vfs.nextIno = snap.nextIno;
    vfs.rootIno = snap.root;
    for (const s of snap.inodes) {
      const node: Inode = {
        ino: s.ino,
        kind: s.kind,
        mode: s.mode,
        uid: s.uid,
        gid: s.gid,
        mtime: s.mtime,
      };
      if (s.kind === 'file') node.content = fromBase64(s.content ?? '');
      if (s.kind === 'dir') node.entries = new Map(s.entries ?? []);
      if (s.kind === 'symlink') node.target = s.target ?? '';
      vfs.inodes.set(node.ino, node);
    }
    return vfs;
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
