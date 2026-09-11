export type NodeKind = 'file' | 'dir' | 'symlink';

export interface Inode {
  ino: number;
  kind: NodeKind;
  /** Permission bits only, e.g. 0o644. Kind is tracked separately. */
  mode: number;
  uid: number;
  gid: number;
  /** Virtual-clock milliseconds, never Date.now(). Determinism depends on it. */
  mtime: number;
  /** file */
  content?: Uint8Array;
  /** dir: name -> ino */
  entries?: Map<string, number>;
  /** symlink */
  target?: string;
}

export interface User {
  uid: number;
  gid: number;
  name: string;
  /** uid 0 bypasses permission checks, as root does. */
  groups?: number[];
}

export interface StatResult {
  kind: NodeKind;
  mode: number;
  uid: number;
  gid: number;
  mtime: number;
  size: number;
  ino: number;
}

/** Serialised form — this is what a save file is. */
export interface VfsSnapshot {
  version: 1;
  nextIno: number;
  root: number;
  inodes: Array<{
    ino: number;
    kind: NodeKind;
    mode: number;
    uid: number;
    gid: number;
    mtime: number;
    /** base64 for files */
    content?: string;
    entries?: Array<[string, number]>;
    target?: string;
  }>;
}
