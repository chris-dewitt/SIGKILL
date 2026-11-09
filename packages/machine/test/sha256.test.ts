import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ROOT_USER } from '../src/vfs/vfs.js';
import { sha256 } from '../src/coreutils/sha256.js';

const enc = new TextEncoder();

/**
 * The digest, against the published vectors, and the command over it.
 *
 * The vectors are FIPS 180-4's own, plus the empty input and one that crosses
 * a block boundary -- the padding is where a hand-written SHA goes wrong, and
 * a 56-byte message is the length that needs a second block for the length.
 */
describe('sha256', () => {
  it('matches the published test vectors', () => {
    expect(sha256(enc.encode(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256(enc.encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('handles a message much longer than a block', () => {
    expect(sha256(enc.encode('a'.repeat(1000)))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });
});

describe('sha256sum', () => {
  function boot(): Machine {
    const m = new Machine();
    m.vfs.mkdirp('/home/dewitt', ROOT_USER);
    m.vfs.chown('/home/dewitt', 1000, 1000, ROOT_USER);
    m.vfs.writeText('/home/dewitt/a', 'abc', ROOT_USER);
    m.vfs.writeText('/home/dewitt/b', 'abc', ROOT_USER);
    m.vfs.writeText('/home/dewitt/secret', 'abc', ROOT_USER);
    m.vfs.chmod('/home/dewitt/secret', 0o600, ROOT_USER);
    m.shell.cwd = '/home/dewitt';
    return m;
  }

  it('prints the digest and the name, in the format real sha256sum uses', async () => {
    const r = await boot().exec('sha256sum a b');
    expect(r.stdout).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  a\n' +
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  b\n',
    );
  });

  it('reads standard input', async () => {
    const r = await boot().exec('cat a | sha256sum');
    expect(r.stdout).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  -\n');
  });

  it('fails with a real errno, and carries on with the rest', async () => {
    const r = await boot().exec('sha256sum missing secret /home a');
    expect(r.stderr).toContain('sha256sum: missing: No such file or directory');
    expect(r.stderr).toContain('sha256sum: secret: Permission denied');
    expect(r.stderr).toContain('sha256sum: /home: Is a directory');
    expect(r.stdout).toContain('  a\n');
    expect(r.code).toBe(1);
  });
});
