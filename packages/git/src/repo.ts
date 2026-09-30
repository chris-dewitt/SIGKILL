import { FsError, ROOT_USER, type User, type Vfs } from '@sigkill/machine';
import {
  blobId,
  bytes,
  concat,
  decodeCommit,
  decodeTree,
  deserialise,
  encodeCommit,
  encodeTree,
  objectId,
  serialise,
  text,
  type CommitData,
  type Mode,
  type ObjectId,
  type ObjectType,
  type Signature,
  type TreeEntry,
} from './objects.js';

/**
 * A repository, stored as files in the Machine's own filesystem.
 *
 * Not an in-memory model with a `git` command bolted to the front. The objects
 * and the refs are real files under `.git`, which means `ls .git/objects`,
 * `cat .git/HEAD` and `find .git -type f` all work -- and the single most
 * valuable thing a git course can teach is that **git is just files**. A model
 * that hid them would be teaching the mystery instead of dispelling it.
 *
 * It also comes free through save and restore: the repository is part of the
 * filesystem snapshot, so a run in progress carries its history with it.
 *
 * ## Two deliberate deviations from real git
 *
 * **Loose objects are stored uncompressed.** Real git zlib-deflates them, and
 * we depend on nothing, so we do not. The object *ids* are still real -- the id
 * hashes the uncompressed content, which is what `git hash-object` does -- so
 * everything a player learns about ids, trees and history transfers exactly. And
 * `cat .git/objects/5b/2f4f...` printing `blob 15\0SANDBOX=strict` is a better
 * first lesson than an unreadable blob of deflate.
 *
 * **The index is a text file.** Real git's index is a binary format with a
 * checksum; ours is one `mode id path` per line. Nothing in the curriculum turns
 * on its encoding, and a staging area a player can `cat` is a staging area they
 * can believe in.
 *
 * Both are documented in the manual pages, because a lie a player can discover
 * is worse than a limitation they were told about.
 */

export interface RepoOptions {
  /** The working tree. `.git` is created inside it. */
  readonly root: string;
  readonly vfs: Vfs;
  /** Whose files these are, for permissions. */
  readonly user: User;
  /** Virtual clock, in seconds since the Unix epoch. Never `Date.now`. */
  readonly now: () => number;
  /** Who is committing. */
  readonly identity: () => { name: string; email: string };
}

/** One staged path. */
export interface IndexEntry {
  readonly mode: Mode;
  readonly id: ObjectId;
  readonly path: string;
}

const join = (...parts: string[]): string =>
  parts.join('/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';

export class Repository {
  readonly root: string;
  readonly gitDir: string;
  private readonly vfs: Vfs;
  private readonly user: User;
  private readonly now: () => number;
  private readonly identity: () => { name: string; email: string };

  constructor(opts: RepoOptions) {
    this.root = opts.root;
    this.gitDir = join(opts.root, '.git');
    this.vfs = opts.vfs;
    this.user = opts.user;
    this.now = opts.now;
    this.identity = opts.identity;
  }

  // ------------------------------------------------------------------ plumbing

  get exists(): boolean {
    return this.vfs.exists(join(this.gitDir, 'HEAD'), ROOT_USER);
  }

  /** Where an object lives: `.git/objects/ab/cdef...`, as real git lays it out. */
  private objectPath(id: ObjectId): string {
    return join(this.gitDir, 'objects', id.slice(0, 2), id.slice(2));
  }

  init(): void {
    for (const dir of ['objects', 'refs/heads', 'refs/tags']) {
      this.vfs.mkdirp(join(this.gitDir, dir), this.user);
    }
    if (!this.exists) {
      this.vfs.writeText(join(this.gitDir, 'HEAD'), 'ref: refs/heads/main\n', this.user);
    }
  }

  has(id: ObjectId): boolean {
    return this.vfs.exists(this.objectPath(id), ROOT_USER);
  }

  /** Store an object and return its id. Writing the same content twice is free. */
  write(type: ObjectType, content: Uint8Array): ObjectId {
    const id = objectId(type, content);
    const path = this.objectPath(id);
    if (!this.vfs.exists(path, ROOT_USER)) {
      this.vfs.mkdirp(join(this.gitDir, 'objects', id.slice(0, 2)), this.user);
      this.vfs.write(path, serialise(type, content), this.user, 0o444);
    }
    return id;
  }

  read(id: ObjectId): { type: ObjectType; content: Uint8Array } {
    try {
      return deserialise(this.vfs.read(this.objectPath(id), ROOT_USER));
    } catch (e) {
      if (e instanceof FsError) throw new Error(`git: object ${id} is not in this repository`);
      throw e;
    }
  }

  readBlob(id: ObjectId): string {
    const object = this.read(id);
    if (object.type !== 'blob') throw new Error(`git: ${id} is a ${object.type}, not a blob`);
    return text(object.content);
  }

  readTree(id: ObjectId): TreeEntry[] {
    const object = this.read(id);
    if (object.type !== 'tree') throw new Error(`git: ${id} is a ${object.type}, not a tree`);
    return decodeTree(object.content);
  }

  readCommit(id: ObjectId): CommitData {
    const object = this.read(id);
    if (object.type !== 'commit') throw new Error(`git: ${id} is a ${object.type}, not a commit`);
    return decodeCommit(object.content);
  }

  // ---------------------------------------------------------------------- refs

  /** `refs/heads/main`, or undefined when HEAD is detached. */
  headRef(): string | undefined {
    const head = this.vfs.readText(join(this.gitDir, 'HEAD'), ROOT_USER).trim();
    return head.startsWith('ref: ') ? head.slice(5) : undefined;
  }

  readRef(ref: string): ObjectId | undefined {
    const path = join(this.gitDir, ref);
    if (!this.vfs.exists(path, ROOT_USER)) return undefined;
    const id = this.vfs.readText(path, ROOT_USER).trim();
    return id.length === 40 ? id : undefined;
  }

  writeRef(ref: string, id: ObjectId): void {
    const path = join(this.gitDir, ref);
    this.vfs.mkdirp(path.slice(0, path.lastIndexOf('/')), this.user);
    this.vfs.writeText(path, `${id}\n`, this.user);
  }

  /** What HEAD points at, following one symbolic level, or undefined if unborn. */
  head(): ObjectId | undefined {
    const ref = this.headRef();
    if (ref === undefined) {
      const detached = this.vfs.readText(join(this.gitDir, 'HEAD'), ROOT_USER).trim();
      return detached.length === 40 ? detached : undefined;
    }
    return this.readRef(ref);
  }

  /**
   * Every branch, including the ones with a slash in the name.
   *
   * Recursive because `refs/heads` is a directory tree rather than a flat
   * list: `chen/guard` lives at `refs/heads/chen/guard`, and a single
   * `readdir` reports the directory `chen` instead of the branch. Storage was
   * always right and `resolve` always handled the slashed name -- only the
   * listing was wrong, which is the sort of bug nobody meets until a branch
   * is named after a person.
   */
  branches(): string[] {
    return this.refNames('refs/heads');
  }

  /** Ref names under a directory, relative to it, depth first. */
  private refNames(under: string): string[] {
    const out: string[] = [];
    const walk = (relative: string): void => {
      const dir = join(this.gitDir, under, relative);
      let names: string[];
      try {
        names = this.vfs.readdir(dir, ROOT_USER);
      } catch {
        return;
      }
      for (const name of names) {
        const path = relative === '' ? name : `${relative}/${name}`;
        if (this.vfs.lstat(join(dir, name), ROOT_USER).kind === 'dir') walk(path);
        else out.push(path);
      }
    };
    walk('');
    return out.sort();
  }

  currentBranch(): string | undefined {
    const ref = this.headRef();
    return ref?.startsWith('refs/heads/') === true ? ref.slice('refs/heads/'.length) : undefined;
  }

  /** Tags, nested ones included, for the same reason branches are. */
  tags(): string[] {
    return this.refNames('refs/tags');
  }

  /**
   * Turn what somebody typed into an object id.
   *
   * Accepts a full id, a unique abbreviation of at least four characters, a
   * branch, a tag, `HEAD`, `X~n` / `X^n`, and `<rev>:<path>`. Abbreviations
   * matter more than they look: every real git workflow is built on pasting the
   * first seven characters of a sha out of a log, and a game that demanded forty
   * would not feel like git.
   *
   * `<rev>:<path>` resolves to the *blob*, which is what makes `git show
   * HEAD:file` print a file as it was. It is handled here rather than in the
   * `show` subcommand so that everything taking a revision understands it, and
   * before the suffixes so that `<merge>^2:v43/reader.py` -- one side of a
   * merge, one file -- resolves the way it reads.
   */
  resolve(revision: string): ObjectId | undefined {
    let rev = revision.trim();
    if (rev.length === 0) return undefined;

    const colon = rev.indexOf(':');
    if (colon > 0) {
      const base = this.resolve(rev.slice(0, colon));
      if (base === undefined) return undefined;
      return this.treeFiles(base).get(rev.slice(colon + 1))?.id;
    }

    // Suffixes, applied after the base is resolved.
    const steps: Array<{ kind: '~' | '^'; n: number }> = [];
    const suffix = /(~|\^)(\d*)$/;
    let match = suffix.exec(rev);
    while (match) {
      steps.unshift({ kind: match[1] as '~' | '^', n: match[2] === '' ? 1 : Number(match[2]) });
      rev = rev.slice(0, match.index);
      match = suffix.exec(rev);
    }

    let id = this.resolveBase(rev);
    for (const step of steps) {
      if (id === undefined) return undefined;
      const commit = this.readCommit(id);
      if (step.kind === '~') {
        for (let i = 0; i < step.n && id !== undefined; i++) {
          id = this.readCommit(id).parents[0];
        }
      } else {
        id = commit.parents[step.n - 1];
      }
    }
    return id;
  }

  private resolveBase(rev: string): ObjectId | undefined {
    if (rev === 'HEAD') return this.head();
    for (const ref of [`refs/heads/${rev}`, `refs/tags/${rev}`, rev]) {
      const found = this.readRef(ref);
      if (found !== undefined) return found;
    }
    if (/^[0-9a-f]{40}$/.test(rev)) return this.has(rev) ? rev : undefined;
    if (/^[0-9a-f]{4,39}$/.test(rev)) {
      const matches = this.objectIds().filter((id) => id.startsWith(rev));
      return matches.length === 1 ? matches[0] : undefined;
    }
    return undefined;
  }

  /** Every object in the store. Used for abbreviations and `fsck`-ish work. */
  objectIds(): ObjectId[] {
    const out: ObjectId[] = [];
    const dir = join(this.gitDir, 'objects');
    let prefixes: string[];
    try {
      prefixes = this.vfs.readdir(dir, ROOT_USER);
    } catch {
      return out;
    }
    for (const prefix of prefixes) {
      if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
      try {
        for (const rest of this.vfs.readdir(join(dir, prefix), ROOT_USER)) out.push(prefix + rest);
      } catch {
        // Unreadable shard. Nothing to add.
      }
    }
    return out.sort();
  }

  // --------------------------------------------------------------------- index

  readIndex(): IndexEntry[] {
    const path = join(this.gitDir, 'index');
    if (!this.vfs.exists(path, ROOT_USER)) return [];
    const entries: IndexEntry[] = [];
    for (const line of this.vfs.readText(path, ROOT_USER).split('\n')) {
      if (line.trim().length === 0) continue;
      const [mode, id, ...rest] = line.split(' ');
      entries.push({ mode: mode as Mode, id: id!, path: rest.join(' ') });
    }
    return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  writeIndex(entries: readonly IndexEntry[]): void {
    const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const body = sorted.map((e) => `${e.mode} ${e.id} ${e.path}`).join('\n');
    this.vfs.writeText(join(this.gitDir, 'index'), body === '' ? '' : `${body}\n`, this.user);
  }

  /** Stage one file from the working tree. Returns the blob id. */
  stage(relative: string): ObjectId {
    const full = join(this.root, relative);
    const stat = this.vfs.lstat(full, this.user);
    if (stat.kind !== 'file') throw new Error(`git: ${relative} is not a regular file`);
    const id = this.write('blob', this.vfs.read(full, this.user));
    const mode: Mode = (stat.mode & 0o111) !== 0 ? '100755' : '100644';
    const rest = this.readIndex().filter((e) => e.path !== relative);
    this.writeIndex([...rest, { mode, id, path: relative }]);
    return id;
  }

  /** Every file under a working-tree directory, as repository-relative paths. */
  walkWorkTree(relative = ''): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      let names: string[];
      try {
        names = this.vfs.readdir(join(this.root, dir), this.user);
      } catch {
        return;
      }
      for (const name of names.sort()) {
        if (dir === '' && name === '.git') continue;
        const rel = dir === '' ? name : `${dir}/${name}`;
        let stat;
        try {
          stat = this.vfs.lstat(join(this.root, rel), this.user);
        } catch {
          continue;
        }
        if (stat.kind === 'dir') walk(rel);
        else if (stat.kind === 'file') out.push(rel);
      }
    };
    walk(relative);
    return out;
  }

  // -------------------------------------------------------------------- commit

  /**
   * Build tree objects from the index, deepest first.
   *
   * The index is flat and a tree is nested, so this is the one place the two
   * shapes have to be reconciled -- and it is where a wrong answer shows up as a
   * root tree id that no real git agrees with, which the tests check.
   */
  writeTreeFromIndex(): ObjectId {
    const entries = this.readIndex();

    const build = (prefix: string): ObjectId => {
      const here: TreeEntry[] = [];
      const subdirs = new Set<string>();

      for (const entry of entries) {
        if (prefix !== '' && !entry.path.startsWith(`${prefix}/`)) continue;
        const rest = prefix === '' ? entry.path : entry.path.slice(prefix.length + 1);
        const slash = rest.indexOf('/');
        if (slash === -1) here.push({ mode: entry.mode, name: rest, id: entry.id });
        else subdirs.add(rest.slice(0, slash));
      }

      for (const name of [...subdirs].sort()) {
        here.push({
          mode: '40000',
          name,
          id: build(prefix === '' ? name : `${prefix}/${name}`),
        });
      }

      return this.write('tree', encodeTree(here));
    };

    return build('');
  }

  private signature(): Signature {
    const who = this.identity();
    return { name: who.name, email: who.email, when: this.now(), tz: '+0000' };
  }

  commit(message: string, opts: { parents?: readonly ObjectId[] } = {}): ObjectId {
    const parent = this.head();
    const parents = opts.parents ?? (parent === undefined ? [] : [parent]);
    const who = this.signature();
    const id = this.write(
      'commit',
      encodeCommit({
        tree: this.writeTreeFromIndex(),
        parents,
        author: who,
        committer: who,
        message,
      }),
    );

    const ref = this.headRef();
    if (ref === undefined) this.vfs.writeText(join(this.gitDir, 'HEAD'), `${id}\n`, this.user);
    else this.writeRef(ref, id);
    this.log_(`${parent ?? '0'.repeat(40)} ${id} commit: ${message.split('\n')[0]}`);
    return id;
  }

  /**
   * The reflog: every move HEAD has made, in order.
   *
   * Kept because it is the only way a player finds a commit nothing points at
   * any more, and because objective seven of the act turns on exactly that.
   */
  private log_(line: string): void {
    const path = join(this.gitDir, 'logs/HEAD');
    this.vfs.mkdirp(join(this.gitDir, 'logs'), this.user);
    const before = this.vfs.exists(path, ROOT_USER) ? this.vfs.readText(path, ROOT_USER) : '';
    this.vfs.writeText(path, `${before}${line}\n`, this.user);
  }

  reflog(): string[] {
    const path = join(this.gitDir, 'logs/HEAD');
    if (!this.vfs.exists(path, ROOT_USER)) return [];
    return this.vfs.readText(path, ROOT_USER).split('\n').filter((l) => l.trim().length > 0);
  }

  /** Append to the reflog from outside, for a seeded history. */
  noteMove(from: ObjectId | undefined, to: ObjectId, what: string): void {
    this.log_(`${from ?? '0'.repeat(40)} ${to} ${what}`);
  }

  // ------------------------------------------------------------------ contents

  /** Flatten a tree into `path -> blob id`. */
  treeFiles(treeOrCommit: ObjectId): Map<string, { id: ObjectId; mode: Mode }> {
    const out = new Map<string, { id: ObjectId; mode: Mode }>();
    const object = this.read(treeOrCommit);
    const tree = object.type === 'commit' ? decodeCommit(object.content).tree : treeOrCommit;

    const walk = (id: ObjectId, prefix: string): void => {
      for (const entry of this.readTree(id)) {
        const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (entry.mode === '40000') walk(entry.id, path);
        else out.set(path, { id: entry.id, mode: entry.mode });
      }
    };
    walk(tree, '');
    return out;
  }

  /** One path at one revision, or undefined if it was not there. */
  fileAt(revision: ObjectId, path: string): string | undefined {
    const found = this.treeFiles(revision).get(path);
    return found === undefined ? undefined : this.readBlob(found.id);
  }

  /** Write a commit's tree into the working directory. */
  checkout(id: ObjectId): void {
    const wanted = this.treeFiles(id);
    for (const path of this.walkWorkTree()) {
      if (!wanted.has(path)) {
        try {
          this.vfs.rm(join(this.root, path), this.user);
        } catch {
          // Not ours to remove. Leave it and let `status` say so.
        }
      }
    }
    for (const [path, entry] of wanted) {
      const full = join(this.root, path);
      this.vfs.mkdirp(full.slice(0, full.lastIndexOf('/')), this.user);
      this.vfs.write(full, this.read(entry.id).content, this.user, entry.mode === '100755' ? 0o755 : 0o644);
    }
    this.writeIndex([...wanted].map(([path, e]) => ({ mode: e.mode, id: e.id, path })));
  }

  // -------------------------------------------------------------------- status

  status(): { staged: string[]; changed: string[]; untracked: string[] } {
    const index = new Map(this.readIndex().map((e) => [e.path, e]));
    const head = this.head();
    const committed = head === undefined ? new Map() : this.treeFiles(head);

    const staged: string[] = [];
    for (const [path, entry] of index) {
      if (committed.get(path)?.id !== entry.id) staged.push(path);
    }
    for (const path of committed.keys()) if (!index.has(path)) staged.push(path);

    const changed: string[] = [];
    const untracked: string[] = [];
    for (const path of this.walkWorkTree()) {
      const staged_ = index.get(path);
      const id = blobId(this.vfs.read(join(this.root, path), this.user));
      if (staged_ === undefined) untracked.push(path);
      else if (staged_.id !== id) changed.push(path);
    }

    return { staged: staged.sort(), changed: changed.sort(), untracked: untracked.sort() };
  }
}

/** Seeded histories need to hand the blob helper around. */
export { blobId, bytes, concat };
