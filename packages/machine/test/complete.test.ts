import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ROOT_USER } from '../src/vfs/vfs.js';
import { schemaOf, sqlNext } from '../src/lang/sqlcomplete.js';
import { sqlCommands } from '../src/lang/sql.js';

/**
 * Completion: what could come next, for a player tapping instead of typing.
 *
 * Chris on the phone: "we need to not type multilingual code". The chips
 * build a command a word at a time, and these tests are the words.
 */

const SCHEMA = schemaOf([
  'CREATE TABLE vessels (\n  id INTEGER PRIMARY KEY,\n  callsign TEXT NOT NULL\n);',
  'CREATE TABLE crew (\n  id INTEGER PRIMARY KEY,\n  vessel_id INTEGER NOT NULL,\n  name TEXT NOT NULL,\n  status TEXT\n);',
].join('\n'));

describe('reading a schema out of the file', () => {
  it('finds every table and its columns, skipping constraints', () => {
    expect([...SCHEMA.tables.keys()]).toEqual(['vessels', 'crew']);
    expect(SCHEMA.tables.get('crew')).toEqual(['id', 'vessel_id', 'name', 'status']);
    expect(schemaOf('CREATE TABLE t (a INT, b TEXT, PRIMARY KEY (a));').tables.get('t')).toEqual(['a', 'b']);
  });
});

describe('the next word in a query', () => {
  const next = (s: string): string[] => sqlNext(SCHEMA, s);

  it('walks a whole SELECT, one tap at a time', () => {
    expect(next('"')).toEqual(['SELECT']);
    expect(next('"SELECT')).toEqual(expect.arrayContaining(['*', 'count(*)', 'name', 'callsign']));
    expect(next('"SELECT name')).toEqual(['FROM', ',']);
    expect(next('"SELECT name FROM')).toEqual(['vessels', 'crew']);
    expect(next('"SELECT name FROM crew')).toEqual(expect.arrayContaining(['WHERE', 'ORDER BY', ';"']));
    expect(next('"SELECT name FROM crew WHERE')).toEqual(['id', 'vessel_id', 'name', 'status']);
    expect(next('"SELECT name FROM crew WHERE status')).toEqual(expect.arrayContaining(['=', 'LIKE', 'IS NULL']));
    expect(next("\"SELECT name FROM crew WHERE status = 'missing'")).toEqual(expect.arrayContaining(['AND', ';"']));
  });

  it('knows a join wants ON, and offers aliased columns once there are aliases', () => {
    expect(next('"SELECT * FROM crew c JOIN vessels v')).toEqual(['ON']);
    expect(next('"SELECT * FROM crew c JOIN vessels v ON')).toEqual(expect.arrayContaining(['c.vessel_id', 'v.id']));
  });

  it('offers GROUP BY, ORDER BY and LIMIT where they belong', () => {
    expect(next('"SELECT status, count(*) FROM crew GROUP BY')).toEqual(expect.arrayContaining(['status']));
    expect(next('"SELECT name FROM crew ORDER BY name')).toEqual(['DESC', 'LIMIT', ';"']);
    expect(next('"SELECT name FROM crew ORDER BY name DESC')).toEqual(['LIMIT', ';"']);
    expect(next('"SELECT name FROM crew LIMIT')).toEqual(['1', '5', '10']);
  });
});

describe('sqlite3 completes its own line', () => {
  const machine = (): Machine => {
    const m = new Machine({ hostname: 'archive' });
    m.vfs.mkdirp('/home/dewitt', ROOT_USER);
    m.vfs.mkdirp('/srv/archive', ROOT_USER);
    m.vfs.writeText('/srv/archive/claims.db', 'SQLite format 3\0...CREATE TABLE crew (id INTEGER, name TEXT)...', ROOT_USER);
    m.vfs.writeText('/home/dewitt/mine.db', '', ROOT_USER);
    m.shell.cwd = '/home/dewitt';
    return m;
  };
  const complete = sqlCommands(() => undefined)[0]!.complete!;

  it('offers the databases first, the ones here before the ones elsewhere', () => {
    expect(complete(machine().shell, [''])).toEqual(['mine.db', '/srv/archive/claims.db']);
  });

  it('then the start of a statement, then the tables from the file itself', () => {
    const m = machine();
    expect(complete(m.shell, ['/srv/archive/claims.db', ''])).toEqual(['"SELECT', '.tables', '.schema']);
    expect(complete(m.shell, ['/srv/archive/claims.db', '"SELECT', '*', 'FROM', ''])).toEqual(['crew']);
    expect(complete(m.shell, ['/srv/archive/claims.db', '.schema', ''])).toEqual(['crew']);
  });

  it('offers nothing once the statement is closed', () => {
    expect(complete(machine().shell, ['/srv/archive/claims.db', '"SELECT', '*', 'FROM', 'crew;"', ''])).toEqual([]);
  });
});

describe('the everyday commands complete themselves', () => {
  const m = (): Machine => {
    const machine = new Machine({ hostname: 'nav7' });
    machine.vfs.mkdirp('/home/dewitt/logs', ROOT_USER);
    machine.vfs.writeText('/home/dewitt/fix.py', 'print(1)\n', ROOT_USER);
    machine.vfs.writeText('/home/dewitt/README', 'hi\n', ROOT_USER);
    machine.vfs.mkdirp('/etc/systemd/system', ROOT_USER);
    machine.vfs.writeText('/etc/systemd/system/scrubber.service', '[Service]\nExecStart=/usr/bin/scrubber\n', ROOT_USER);
    machine.shell.cwd = '/home/dewitt';
    return machine;
  };
  const c = (machine: Machine, name: string, args: string[]) => machine.shell.commands.get(name)!.complete!(machine.shell, args);

  it('systemctl offers its verbs, then its units', () => {
    const machine = m();
    expect(c(machine, 'systemctl', [''])).toContain('start');
    expect(c(machine, 'systemctl', ['start', ''])).toContain('scrubber');
  });

  it('sudo completes as the command it runs', () => {
    const machine = m();
    expect(c(machine, 'sudo', ['systemctl', 'start', ''])).toContain('scrubber');
    expect(c(machine, 'sudo', [''])).toContain('systemctl');
  });

  it('cd offers directories only; python3 offers scripts', () => {
    const machine = m();
    expect(c(machine, 'cd', [''])).toEqual(['logs', '..', '~']);
    expect(c(machine, 'python3', [''])).toEqual(['fix.py', '-c']);
  });

  it('journalctl offers units after -u', () => {
    expect(c(m(), 'journalctl', ['-u', ''])).toContain('scrubber');
  });
});
