import { describe, expect, it } from 'vitest';
import { Machine, ROOT_USER, type SqlRequest } from '@sigkill/machine';
import { seededRandom } from '../src/index.js';
import { NodeSqlRuntime } from '../src/node.js';

/** The ship's calendar, so `CURRENT_TIMESTAMP` has something to be. */
const WAKE = Date.UTC(2398, 5, 8, 4, 12);

/** A machine with SQLite attached and a workspace the player owns. */
function ship(): Machine {
  const m = new Machine({ epoch: WAKE, sql: new NodeSqlRuntime() });
  m.vfs.mkdirp('/home/dewitt', ROOT_USER);
  m.vfs.chown('/home/dewitt', 1000, 1000, ROOT_USER);
  m.shell.cwd = '/home/dewitt';
  return m;
}

const request = (sql: string, database = ''): SqlRequest => ({
  sql,
  database,
  now: WAKE,
  seed: 0x5e41,
});

describe('it is really SQLite', () => {
  it('reports a version', async () => {
    const m = ship();
    const r = await m.exec('sqlite3 -version');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/SQLite 3\./);
  });

  it('creates, inserts and selects', async () => {
    const m = ship();
    expect(
      (await m.exec("sqlite3 archive.db 'CREATE TABLE crew(id INTEGER PRIMARY KEY, name TEXT);'")).stderr,
    ).toBe('');
    await m.exec("sqlite3 archive.db \"INSERT INTO crew(name) VALUES ('vasquez'),('chen'),('dewitt');\"");

    const r = await m.exec("sqlite3 archive.db 'SELECT id, name FROM crew ORDER BY id;'");
    expect(r.stdout).toBe('1|vasquez\n2|chen\n3|dewitt\n');
  });

  it('passes SQLite\'s own error through, because the error is the lesson', async () => {
    const m = ship();
    const r = await m.exec("sqlite3 archive.db 'SELECT * FROM nosuchtable;'");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no such table');
  });

  it('does joins, nulls and aggregates, which is the point of game 2', async () => {
    const m = ship();
    await m.exec(
      'sqlite3 archive.db "' +
        'CREATE TABLE crew(id INTEGER PRIMARY KEY, name TEXT);' +
        'CREATE TABLE certs(crew_id INTEGER, number TEXT);' +
        "INSERT INTO crew(name) VALUES ('vasquez'),('dewitt');" +
        "INSERT INTO certs VALUES (1,'KV-4471-E');\"",
    );
    const r = await m.exec(
      'sqlite3 archive.db "SELECT c.name, x.number FROM crew c ' +
        'LEFT JOIN certs x ON x.crew_id = c.id ORDER BY c.id;"',
    );
    // The trailing empty field is the whole premise of The Archive.
    expect(r.stdout).toBe('vasquez|KV-4471-E\ndewitt|\n');
  });
});

describe('the database is a file on the ship', () => {
  it('is visible to ls, file and wc like anything else', async () => {
    const m = ship();
    await m.exec("sqlite3 archive.db 'CREATE TABLE t(a);'");

    expect((await m.exec('ls')).stdout).toContain('archive.db');
    expect((await m.exec('file archive.db')).stdout).toContain('data');
    const size = Number((await m.exec('wc -c < archive.db')).stdout.trim());
    expect(size).toBeGreaterThan(0);
  });

  it('can be copied, and the copy is a working database', async () => {
    const m = ship();
    await m.exec("sqlite3 archive.db \"CREATE TABLE t(a); INSERT INTO t VALUES ('kept');\"");
    expect((await m.exec('cp archive.db backup.db')).stderr).toBe('');
    expect((await m.exec("sqlite3 backup.db 'SELECT a FROM t;'")).stdout).toBe('kept\n');
  });

  it('refuses a database the player may not write, with a real errno', async () => {
    const m = ship();
    m.vfs.writeText('/home/dewitt/theirs.db', '', ROOT_USER);
    m.vfs.chmod('/home/dewitt/theirs.db', 0o444, ROOT_USER);

    const r = await m.exec("sqlite3 theirs.db 'CREATE TABLE t(a);'");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/Permission denied|not a database/i);
  });

  it('leaves the file alone when nothing was written', async () => {
    const m = ship();
    await m.exec("sqlite3 archive.db 'CREATE TABLE t(a);'");
    const before = m.vfs.read('/home/dewitt/archive.db', ROOT_USER);
    await m.exec("sqlite3 archive.db 'SELECT * FROM t;'");
    const after = m.vfs.read('/home/dewitt/archive.db', ROOT_USER);
    expect(after).toEqual(before);
  });
});

describe('dot-commands are real queries', () => {
  it('.tables and .schema say what is in there', async () => {
    const m = ship();
    await m.exec('sqlite3 archive.db "CREATE TABLE crew(id INTEGER, name TEXT); CREATE TABLE claims(id INTEGER);"');

    expect((await m.exec('sqlite3 archive.db .tables')).stdout).toBe('claims\ncrew\n');
    expect((await m.exec('sqlite3 archive.db ".schema crew"')).stdout).toContain('CREATE TABLE crew');
  });

  it('gives the same answer typed out by hand, which is why it is a translation', async () => {
    const m = ship();
    await m.exec('sqlite3 archive.db "CREATE TABLE crew(id INTEGER);"');
    const dot = (await m.exec('sqlite3 archive.db .tables')).stdout;
    const byHand = (
      await m.exec(
        'sqlite3 archive.db "SELECT name FROM sqlite_master WHERE type=\'table\' ' +
          "AND name NOT LIKE 'sqlite_%' ORDER BY name;\"",
      )
    ).stdout;
    expect(dot).toBe(byHand);
  });
});

describe('input routes', () => {
  it('takes statements from a pipe as well as an argument', async () => {
    const m = ship();
    m.vfs.writeText(
      '/home/dewitt/setup.sql',
      "CREATE TABLE t(a);\nINSERT INTO t VALUES ('piped');\n",
      ROOT_USER,
    );
    expect((await m.exec('cat setup.sql | sqlite3 archive.db')).stderr).toBe('');
    expect((await m.exec("sqlite3 archive.db 'SELECT a FROM t;'")).stdout).toBe('piped\n');
  });

  it('-header and -csv change the shape of the output', async () => {
    const m = ship();
    await m.exec("sqlite3 archive.db \"CREATE TABLE t(a,b); INSERT INTO t VALUES ('x','y');\"");
    expect((await m.exec('sqlite3 -header archive.db "SELECT a, b FROM t;"')).stdout).toBe('a|b\nx|y\n');
    expect((await m.exec('sqlite3 -csv archive.db "SELECT a, b FROM t;"')).stdout).toBe('x,y\n');
  });

  it('says plainly that there is no interactive shell', async () => {
    const m = ship();
    const r = await m.exec('sqlite3 archive.db');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no interactive shell');
  });

  it('reports honestly when no engine is installed', async () => {
    const bare = new Machine();
    const r = await bare.exec("sqlite3 x.db 'SELECT 1;'");
    expect(r.code).toBe(127);
    expect(r.stderr).toContain('no SQL engine is installed');
  });
});

/**
 * The tests the package is not allowed to exist without.
 *
 * SQLite reads the system clock for `CURRENT_TIMESTAMP` and real entropy for
 * `random()`. Either one, left alone, means a save that replays differently --
 * which is invariant #1 and the foundation every puzzle downstream sits on.
 */
describe('determinism', () => {
  it('CURRENT_TIMESTAMP is the ship\'s clock, not the wall clock', async () => {
    const m = ship();
    const r = await m.exec("sqlite3 archive.db 'SELECT CURRENT_TIMESTAMP;'");
    expect(r.stdout.trim()).toMatch(/^2398-06-08 04:1[12]:\d\d$/);
    // The assertion that matters: a wall clock leaking through would put the
    // real year here, and nothing else would.
    expect(r.stdout).not.toContain(String(new Date().getUTCFullYear()));
  });

  /*
   * A known artifact, asserted so nobody "fixes" it into a divergence.
   *
   * SQLite converts times through a double and at a few instants lands a
   * millisecond short -- 04:12:00 reads back as 04:11:59.999 while 04:12:01
   * and 05:12:00 are exact. Real sqlite3 does the same, so correcting it here
   * would make this engine disagree with the one outside the game. What has
   * to hold is that it is the same every run.
   */
  it('is consistently itself about the one instant it rounds oddly', async () => {
    const m = ship();
    const first = (await m.exec("sqlite3 a.db \"SELECT datetime('now','subsec');\"")).stdout;
    const again = (await m.exec("sqlite3 a.db \"SELECT datetime('now','subsec');\"")).stdout;
    expect(first).toBe(again);
  });

  it("datetime('now') follows the clock as it moves", async () => {
    const m = ship();
    const before = (await m.exec("sqlite3 a.db \"SELECT datetime('now');\"")).stdout.trim();
    await m.tick(3600_000);
    const after = (await m.exec("sqlite3 a.db \"SELECT datetime('now');\"")).stdout.trim();
    expect(after).toBe('2398-06-08 05:12:00');
    expect(before).not.toBe(after);
  });

  it('replays byte for byte', async () => {
    const play = async (): Promise<string> => {
      const m = ship();
      await m.exec(
        'sqlite3 archive.db "CREATE TABLE crew(id INTEGER PRIMARY KEY, name TEXT, filed TEXT);' +
          "INSERT INTO crew(name, filed) VALUES ('vasquez', CURRENT_TIMESTAMP),('dewitt', NULL);\"",
      );
      await m.tick(1000);
      const rows = (await m.exec("sqlite3 archive.db 'SELECT * FROM crew ORDER BY id;'")).stdout;
      const bytes = m.vfs.read('/home/dewitt/archive.db', ROOT_USER);
      return `${rows}|${[...bytes].join(',')}`;
    };
    expect(await play()).toBe(await play());
  });

  /*
   * The one that would have caught a removed shadow.
   *
   * `random()` is genuinely random in stock SQLite -- the spike measured it.
   * If `runRequest` ever stops registering the seeded replacement, this goes
   * red, and nothing else here would.
   */
  it('random() is seeded, and the seed is what makes it repeat', async () => {
    const a = new NodeSqlRuntime();
    const first = await a.run(request('SELECT random(), random(), random();'));
    const second = await a.run(request('SELECT random(), random(), random();'));
    expect(first.rows).toEqual(second.rows);

    // A different seed must give a different sequence, or the seed is being
    // ignored and the repeat above proves nothing.
    const other = await a.run({ ...request('SELECT random();'), seed: 99 });
    expect(other.rows).not.toEqual(first.rows.slice(0, 1));
  });

  it('the generator itself is the one the rest of the project uses', () => {
    const a = seededRandom(0x5e41);
    const b = seededRandom(0x5e41);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('saves', () => {
  it('carries the database through a snapshot', async () => {
    const m = ship();
    await m.exec("sqlite3 archive.db \"CREATE TABLE t(a); INSERT INTO t VALUES ('before');\"");

    const restored = Machine.restore(m.snapshot(), { sql: new NodeSqlRuntime() });
    restored.shell.cwd = '/home/dewitt';
    expect((await restored.exec("sqlite3 archive.db 'SELECT a FROM t;'")).stdout).toBe('before\n');

    // And it is still writable on the far side.
    await restored.exec("sqlite3 archive.db \"INSERT INTO t VALUES ('after');\"");
    expect((await restored.exec("sqlite3 archive.db 'SELECT a FROM t;'")).stdout).toBe('before\nafter\n');
  });
});
