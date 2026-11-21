import { describe, expect, it } from 'vitest';
import { Machine, ROOT_USER, sqlCommands } from '@sigkill/machine';
import { insertWord, lastSegment, nextWords } from '../src/next.js';

/**
 * The chip bar's next words, tested as text.
 *
 * "We need to not type multilingual code" -- Chris, on a phone. A query is
 * built here a tap at a time, so each tap is an assertion.
 */

function boot(): Machine {
  const m = new Machine({ hostname: 'ferryman', commands: sqlCommands(() => undefined) });
  m.vfs.mkdirp('/home/dewitt/notes', ROOT_USER);
  m.vfs.writeText('/home/dewitt/claims.db', 'SQLite format 3\0CREATE TABLE crew (id INTEGER, name TEXT, status TEXT)\0', ROOT_USER);
  m.vfs.writeText('/home/dewitt/README', 'hi\n', ROOT_USER);
  const who = m.shell.user;
  m.vfs.chown('/home/dewitt', who.uid, who.gid, ROOT_USER);
  m.shell.cwd = '/home/dewitt';
  return m;
}

/** Tap the first chip that equals `word`, the way a thumb would. */
function tap(m: Machine, line: string, word: string): string {
  const { words, partial } = nextWords(m.shell, line);
  expect(words, `${JSON.stringify(line)} should offer ${word}`).toContain(word);
  return insertWord(line, partial, word);
}

describe('building a line by tapping', () => {
  it('writes a whole query without typing a letter of SQL', () => {
    const m = boot();
    let line = tap(m, '', 'sqlite3');
    for (const word of ['claims.db', '"SELECT', 'name', 'FROM', 'crew', 'WHERE', 'status', '=']) line = tap(m, line, word);
    expect(line).toBe('sqlite3 claims.db "SELECT name FROM crew WHERE status = ');
  });

  it('filters by what is half typed, ignoring case', () => {
    const m = boot();
    const { words, partial } = nextWords(m.shell, 'sqlite3 claims.db "SELECT * fr');
    expect(partial).toBe('fr');
    expect(words).toEqual(['FROM']);
    expect(insertWord('sqlite3 claims.db "SELECT * fr', partial, 'FROM')).toBe('sqlite3 claims.db "SELECT * FROM ');
  });

  it('completes the command after a pipe, not the one before it', () => {
    const m = boot();
    expect(lastSegment('cat README | sqlite3 claims')).toBe(' sqlite3 claims');
    expect(lastSegment('echo "a|b" | wc')).toBe(' wc');
    expect(nextWords(m.shell, 'cat README | sqlite3 cl').words).toEqual(['claims.db']);
  });

  it('offers paths after a redirect, and for commands with nothing to say', () => {
    const m = boot();
    expect(nextWords(m.shell, 'echo hi > ').words).toEqual(['README', 'claims.db', 'notes/']);
    expect(nextWords(m.shell, 'cat no').words).toEqual(['notes/']);
  });

  it('keeps going inside a directory without adding a space', () => {
    expect(insertWord('cat no', 'no', 'notes/')).toBe('cat notes/');
    expect(insertWord('ls', '', 'x')).toBe('ls x ');
  });

  it('survives a completer that throws', () => {
    const m = boot();
    m.shell.commands.set('boom', { name: 'boom', summary: '', run: () => 0, complete: () => { throw new Error('no'); } });
    expect(nextWords(m.shell, 'boom ').words).toEqual([]);
  });
});
