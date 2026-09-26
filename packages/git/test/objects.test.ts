import { describe, expect, it } from 'vitest';
import {
  blobId,
  commitId,
  decodeCommit,
  decodeTree,
  deserialise,
  encodeCommit,
  encodeTree,
  serialise,
  sha1,
  treeId,
  bytes,
  type TreeEntry,
} from '../src/objects.js';

/**
 * The object model, against real git.
 *
 * Every expected value in this file came out of `git hash-object` or
 * `git rev-parse` on git 2.50, not out of this implementation. That direction
 * matters: a test whose expectation was produced by the code under test is a
 * mirror, not a witness -- which is the lesson game three spends an act on and
 * would be embarrassing to ignore here.
 *
 * To regenerate any of them:
 *
 *     git init -q probe && cd probe && git config core.autocrlf false
 *     printf 'SANDBOX=strict\n' > sandbox.conf
 *     git hash-object sandbox.conf
 */

describe('sha1', () => {
  it('agrees with the published digests', () => {
    expect(sha1(new Uint8Array(0))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1(bytes('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  /*
   * A multi-block input, because the padding is the part that is easy to get
   * wrong and impossible to notice: a broken pad still returns forty plausible
   * characters, and only a message longer than one 64-byte block exercises it.
   */
  it('handles an input longer than one block', () => {
    // `git hash-object` on 1400 bytes of 'commit ' repeated 200 times.
    expect(blobId('commit '.repeat(200))).toBe('25dce22c6ed5d448298e2ec0cb67612d662ea3a7');
  });
});

describe('blobs', () => {
  it('hashes exactly what git hashes', () => {
    expect(blobId('O2_TARGET=21\nSCRUBBER_DUTY=0.9\n')).toBe(
      '524ce618499f27ff6b249b87c80079d680244c24',
    );
    expect(blobId('hello')).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
    // The empty blob, which every git repository has and every learner meets.
    expect(blobId('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });

  it('round-trips through the stored form', () => {
    const stored = serialise('blob', bytes('SANDBOX=strict\n'));
    const back = deserialise(stored);
    expect(back.type).toBe('blob');
    expect(new TextDecoder().decode(back.content)).toBe('SANDBOX=strict\n');
  });

  it('refuses an object whose header disagrees with its content', () => {
    const lying = bytes('blob 99\0short');
    expect(() => deserialise(lying)).toThrow(/99 bytes and holds 5/);
  });
});

/*
 * The reference repository, built by real git:
 *
 *   sandbox.conf   "SANDBOX=strict\n"
 *   luna/core.py   "def answer():\n    return 42\n"
 *   one commit, V. Vasquez <vasquez@nav7>, @13519887120 +0000
 *                                          which git reads as 2398-06-06 04:12:00
 *   message "sandbox: start strict"
 */
const SANDBOX_BLOB = '5b2f4fb7190c6ffa4b0561de93d0067451733bf2';
const CORE_BLOB = 'eca386f51bbe9df459d3def8a91f74e99caeab92';
const LUNA_TREE = '6380a2c80f3bfb5aa99109023d043da8e1476d25';
const ROOT_TREE = 'af0fde9fe74c9be27d81b2b3b87588c99f5bb996';
const COMMIT = '038e427615095d9c496de8e1d6c006740fc004c2';

describe('trees', () => {
  it('hashes exactly what git hashes, subdirectory and all', () => {
    expect(blobId('SANDBOX=strict\n')).toBe(SANDBOX_BLOB);
    expect(blobId('def answer():\n    return 42\n')).toBe(CORE_BLOB);

    const luna = treeId([{ mode: '100644', name: 'core.py', id: CORE_BLOB }]);
    expect(luna).toBe(LUNA_TREE);

    expect(
      treeId([
        { mode: '40000', name: 'luna', id: luna },
        { mode: '100644', name: 'sandbox.conf', id: SANDBOX_BLOB },
      ]),
    ).toBe(ROOT_TREE);
  });

  it('sorts entries itself, so the caller cannot change the id by reordering', () => {
    const a: TreeEntry[] = [
      { mode: '100644', name: 'sandbox.conf', id: SANDBOX_BLOB },
      { mode: '40000', name: 'luna', id: LUNA_TREE },
    ];
    const b = [...a].reverse();
    expect(treeId(a)).toBe(treeId(b));
    expect(treeId(a)).toBe(ROOT_TREE);
  });

  it('round-trips, keeping the twenty raw id bytes intact', () => {
    const entries: TreeEntry[] = [
      { mode: '40000', name: 'luna', id: LUNA_TREE },
      { mode: '100644', name: 'sandbox.conf', id: SANDBOX_BLOB },
    ];
    expect(decodeTree(encodeTree(entries))).toEqual(entries);
  });
});

describe('commits', () => {
  const vasquez = { name: 'V. Vasquez', email: 'vasquez@nav7', when: 13_519_887_120, tz: '+0000' };

  it('hashes exactly what git hashes', () => {
    expect(
      commitId({
        tree: ROOT_TREE,
        parents: [],
        author: vasquez,
        committer: vasquez,
        message: 'sandbox: start strict',
      }),
    ).toBe(COMMIT);
  });

  /*
   * The adventure's calendar, which is the reason this was checked at all.
   *
   * Game three found that Python cannot represent 2398 -- `PyTime_t` is int64
   * nanoseconds and overflows somewhere around 2262. Git stores a timestamp as a
   * decimal string, so it does not care, and the reference commit above proves it
   * by being dated 2398-06-06.
   */
  it('accepts a date four hundred years from now, which Python cannot', () => {
    // And real git agrees it is that date:
    //   git log --date=iso  ->  2398-06-06 04:12:00 +0000
    const when = Math.floor(Date.UTC(2398, 5, 6, 4, 12) / 1000);
    expect(when).toBe(13_519_887_120);
    const id = commitId({
      tree: ROOT_TREE,
      parents: [],
      author: { ...vasquez, when },
      committer: { ...vasquez, when },
      message: 'sandbox: start strict',
    });
    expect(id).toBe(COMMIT);
  });

  it('round-trips, parents and message included', () => {
    const data = {
      tree: ROOT_TREE,
      parents: [COMMIT, LUNA_TREE],
      author: vasquez,
      committer: { ...vasquez, name: 'L. Okonkwo', email: 'okonkwo@nav7' },
      message: 'merge: take ours, sort it out in the morning',
    };
    expect(decodeCommit(encodeCommit(data))).toEqual(data);
  });

  it('is deterministic, which is the property the whole engine rests on', () => {
    const make = () =>
      commitId({
        tree: ROOT_TREE,
        parents: [],
        author: vasquez,
        committer: vasquez,
        message: 'sandbox: start strict',
      });
    expect(make()).toBe(make());
  });

  /*
   * A different message is a different commit, and so is a different second.
   *
   * Stated as a test because the alternative -- an id that ignores part of what
   * it names -- is how a history stops being evidence.
   */
  it('changes when anything about it changes', () => {
    const base = {
      tree: ROOT_TREE,
      parents: [],
      author: vasquez,
      committer: vasquez,
      message: 'sandbox: start strict',
    };
    expect(commitId({ ...base, message: 'sandbox: start Strict' })).not.toBe(COMMIT);
    expect(commitId({ ...base, author: { ...vasquez, when: vasquez.when + 1 } })).not.toBe(COMMIT);
    expect(commitId({ ...base, parents: [COMMIT] })).not.toBe(COMMIT);
  });
});
