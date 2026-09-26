/**
 * Git's object model, from scratch, with no dependencies.
 *
 * The decision this file rests on was made by a probe before any of it was
 * written: **the object ids are real.** A blob, a tree and a commit built here
 * hash to exactly what `git hash-object` produces for the same content, which
 * was checked against git 2.50 before the package existed.
 *
 * That is worth more than it sounds. It means the test suite has an external
 * authority instead of only itself: build a history in TypeScript, build the
 * same history with the real thing, and assert the shas are identical. A model
 * that merely *resembles* git drifts, and the drift is invisible until a player
 * who knows git notices the ids are decorative.
 *
 * SHA-1 is here because git uses it for object naming and for no other reason.
 * It is not being used as a security primitive, and nothing in this package
 * treats an object id as a secret or a signature.
 */

/** A forty-character lowercase hex object id. */
export type ObjectId = string;

export type ObjectType = 'blob' | 'tree' | 'commit';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const bytes = (text: string): Uint8Array => encoder.encode(text);
export const text = (data: Uint8Array): string => decoder.decode(data);

/**
 * SHA-1, as forty lowercase hex characters.
 *
 * Written out rather than taken from a library because `packages/machine` and
 * everything beside it depend on nothing, and because a hash is sixty lines. The
 * padding is the part that is easy to get wrong and hard to notice -- a wrong
 * pad still produces a plausible-looking hash -- so the tests check a multi-block
 * input against real git as well as a short one.
 */
export function sha1(data: Uint8Array): string {
  const length = data.length;
  const padded = new Uint8Array(((length + 8) >> 6) * 64 + 64);
  padded.set(data);
  padded[length] = 0x80;

  const view = new DataView(padded.buffer);
  const bits = length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(padded.length - 4, bits >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);
  const rol = (n: number, s: number): number => ((n << s) | (n >>> (32 - s))) >>> 0;

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(chunk + i * 4);
    for (let i = 16; i < 80; i++) {
      w[i] = rol((w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0), 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (rol(a, 5) + (f >>> 0) + e + k + (w[i] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = t;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((n) => n.toString(16).padStart(8, '0')).join('');
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * An object's serialised form: `<type> <byteLength>\0<content>`.
 *
 * The header is what makes a blob and a tree of the same bytes different
 * objects, and it is why an id can be trusted to mean one thing.
 */
export function serialise(type: ObjectType, content: Uint8Array): Uint8Array {
  return concat([bytes(`${type} ${content.length}\0`), content]);
}

/** Split a stored object back into its type and content. */
export function deserialise(stored: Uint8Array): { type: ObjectType; content: Uint8Array } {
  const nul = stored.indexOf(0);
  if (nul < 0) throw new Error('git: object has no header');
  const header = text(stored.subarray(0, nul));
  const [type, size] = header.split(' ');
  if (type !== 'blob' && type !== 'tree' && type !== 'commit') {
    throw new Error(`git: unknown object type ${type}`);
  }
  const content = stored.subarray(nul + 1);
  if (Number(size) !== content.length) {
    throw new Error(`git: object says ${size} bytes and holds ${content.length}`);
  }
  return { type, content };
}

export const objectId = (type: ObjectType, content: Uint8Array): ObjectId =>
  sha1(serialise(type, content));

// ---------------------------------------------------------------------- trees

/** `100644` for a file, `100755` for an executable, `40000` for a directory. */
export type Mode = '100644' | '100755' | '40000';

export interface TreeEntry {
  readonly mode: Mode;
  readonly name: string;
  readonly id: ObjectId;
}

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const bytesToHex = (data: Uint8Array): string =>
  [...data].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * A tree, encoded the way git encodes one.
 *
 * Entries sorted by name, each `<mode> <name>\0` followed by twenty **raw** id
 * bytes rather than hex. The raw bytes are the detail that is easy to miss and
 * impossible to spot afterwards, because a tree with hex ids in it still hashes
 * to a perfectly convincing forty characters that no real git will ever agree
 * with.
 */
export function encodeTree(entries: readonly TreeEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return concat(sorted.flatMap((e) => [bytes(`${e.mode} ${e.name}\0`), hexToBytes(e.id)]));
}

export function decodeTree(content: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let at = 0;
  while (at < content.length) {
    const space = content.indexOf(0x20, at);
    const nul = content.indexOf(0, space);
    const mode = text(content.subarray(at, space)) as Mode;
    const name = text(content.subarray(space + 1, nul));
    const id = bytesToHex(content.subarray(nul + 1, nul + 21));
    entries.push({ mode, name, id });
    at = nul + 21;
  }
  return entries;
}

// -------------------------------------------------------------------- commits

export interface Signature {
  readonly name: string;
  readonly email: string;
  /** Seconds since the Unix epoch. The adventure's calendar fits: git stores it
   * as a decimal string, so the year 2398 costs nothing -- unlike Python, whose
   * `PyTime_t` cannot represent it at all. */
  readonly when: number;
  /** `+0000` and nothing else, so a history cannot drift with a timezone. */
  readonly tz: string;
}

export interface CommitData {
  readonly tree: ObjectId;
  readonly parents: readonly ObjectId[];
  readonly author: Signature;
  readonly committer: Signature;
  readonly message: string;
}

const signature = (s: Signature): string => `${s.name} <${s.email}> ${s.when} ${s.tz}`;

export function encodeCommit(commit: CommitData): Uint8Array {
  const lines = [
    `tree ${commit.tree}`,
    ...commit.parents.map((p) => `parent ${p}`),
    `author ${signature(commit.author)}`,
    `committer ${signature(commit.committer)}`,
    '',
    commit.message,
    '',
  ];
  return bytes(lines.join('\n'));
}

const parseSignature = (rest: string): Signature => {
  const match = /^(.*) <([^>]*)> (\d+) ([+-]\d{4})$/.exec(rest);
  if (!match) throw new Error(`git: cannot read signature "${rest}"`);
  return { name: match[1]!, email: match[2]!, when: Number(match[3]), tz: match[4]! };
};

export function decodeCommit(content: Uint8Array): CommitData {
  const whole = text(content);
  const split = whole.indexOf('\n\n');
  const header = whole.slice(0, split === -1 ? whole.length : split);
  const message = split === -1 ? '' : whole.slice(split + 2).replace(/\n$/, '');

  let tree = '';
  const parents: ObjectId[] = [];
  let author: Signature | undefined;
  let committer: Signature | undefined;

  for (const line of header.split('\n')) {
    const at = line.indexOf(' ');
    const key = line.slice(0, at);
    const rest = line.slice(at + 1);
    if (key === 'tree') tree = rest;
    else if (key === 'parent') parents.push(rest);
    else if (key === 'author') author = parseSignature(rest);
    else if (key === 'committer') committer = parseSignature(rest);
  }

  if (!tree || !author || !committer) throw new Error('git: commit is missing a required field');
  return { tree, parents, author, committer, message };
}

/** The whole point of the probe, as a one-liner the tests lean on. */
export const commitId = (commit: CommitData): ObjectId =>
  objectId('commit', encodeCommit(commit));
export const treeId = (entries: readonly TreeEntry[]): ObjectId =>
  objectId('tree', encodeTree(entries));
export const blobId = (content: string | Uint8Array): ObjectId =>
  objectId('blob', typeof content === 'string' ? bytes(content) : content);
