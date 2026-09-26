import type { CommandSpec, ShellContext } from '../shell/exec.js';
import { FsError } from '../errors.js';
import { emit } from '../coreutils/helpers.js';

/**
 * SQLite, supplied from outside.
 *
 * Same arrangement as `PythonRuntime` and for the same reasons: the Machine
 * has no dependencies and wa-sqlite is a wasm binary. The interface is the
 * seam, and it is deliberately narrower than Python's -- SQL does not need
 * the whole filesystem, only one file.
 *
 * The two things that make this safe to have at all are `now` and `seed`.
 * SQLite reads the system clock for `CURRENT_TIMESTAMP` and real entropy for
 * `random()`, and both would destroy replay for every puzzle downstream. They
 * are parameters here so the Machine's virtual clock and a seeded generator
 * are the only sources either one can have. A runtime that ignores them is
 * broken however well it queries.
 */

export interface SqlRequest {
  /** One or more statements, separated by semicolons. */
  sql: string;
  /**
   * The database file as it currently is, base64. Empty creates a new one.
   *
   * Passed by value rather than by path because the runtime lives in a Worker
   * and must never see the Machine's filesystem. The command owns the disk.
   */
  database: string;
  /** Ship time in milliseconds since the Unix epoch. */
  now: number;
  /** Seed for `random()`. The same seed must give the same sequence. */
  seed: number;
}

export interface SqlRow {
  readonly values: readonly (string | null)[];
}

export interface SqlResult {
  /** Column names of the last statement that produced any. */
  columns: string[];
  rows: SqlRow[];
  /** SQLite's own message. The error text is the teaching material. */
  error?: string;
  /** The database after the statements ran, base64. */
  database: string;
}

export interface SqlRuntime {
  /** Human-readable version, for the banner. */
  readonly version: string;
  /** Load the engine if it is not loaded yet. */
  ready(): Promise<void>;
  run(request: SqlRequest): Promise<SqlResult>;
}

/**
 * The seed every adventure's database starts from.
 *
 * A constant rather than the clock: two players who type the same things must
 * see the same `random()`, and a save that reloads must carry on the same
 * sequence. Shared with `hullTelemetry` in spirit -- one source of fake
 * randomness for the whole project.
 */
export const SQL_SEED = 0x5e41;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without Buffer, because this package depends on nothing. */
export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let at = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]!);
    const b = B64.indexOf(clean[i + 1]!);
    const c = B64.indexOf(clean[i + 2]!);
    const d = B64.indexOf(clean[i + 3]!);
    out[at++] = (a << 2) | (b >> 4);
    if (c >= 0) out[at++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[at++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, at);
}

/** Read a database file, or nothing if it is not there yet. */
function loadDatabase(ctx: ShellContext, path: string): string | { error: string } {
  try {
    return encodeBase64(ctx.vfs.read(path, ctx.user));
  } catch (e) {
    if (e instanceof FsError && e.code === 'ENOENT') return '';
    return { error: e instanceof FsError ? e.reason : String(e) };
  }
}

/**
 * Dot-commands, rewritten as the SQL they stand for.
 *
 * `.tables` really is a query against `sqlite_master` on a real machine too,
 * so this is a translation rather than a simulation -- and a player who later
 * types the query by hand gets the same answer, which is the point.
 */
function expandDot(line: string): string | undefined {
  const [word = '', ...rest] = line.trim().split(/\s+/);
  switch (word) {
    case '.tables':
      return "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;";
    case '.schema':
      return rest[0] === undefined
        ? 'SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name;'
        : `SELECT sql FROM sqlite_master WHERE name='${rest[0].replace(/'/g, "''")}';`;
    case '.databases':
      return "SELECT 'main' AS name;";
    default:
      return undefined;
  }
}

export function sqlCommands(getRuntime: () => SqlRuntime | undefined): CommandSpec[] {
  const run: CommandSpec['run'] = async (ctx, argv, io) => {
    const runtime = getRuntime();

    /*
     * sqlite3 uses single-dash long options -- `-header`, `-csv`, `-version`
     * -- which `parseArgs` would cluster into `-h -e -a -d -e -r`. So they
     * are matched whole, against argv, before anything else touches it.
     */
    const switches = new Set(argv.slice(1).filter((a) => a.startsWith('-')));
    const has = (name: string): boolean => switches.has(`-${name}`) || switches.has(`--${name}`);
    const operands = argv.slice(1).filter((a) => !a.startsWith('-'));

    if (has('version')) {
      if (!runtime) {
        io.err('sqlite3: no SQL engine is installed on this machine\n');
        return 127;
      }
      // Booted first: the version is something the engine reports, not a
      // constant, so before `ready()` there is nothing to print.
      await runtime.ready();
      io.out(`${runtime.version}\n`);
      return 0;
    }

    if (!runtime) {
      io.err('sqlite3: no SQL engine is installed on this machine\n');
      return 127;
    }

    const file = operands[0];
    if (file === undefined) {
      io.err(
        'sqlite3: this machine has no interactive shell.\n' +
          'Give it a database and a statement:\n' +
          "  sqlite3 archive.db 'SELECT * FROM crew;'\n",
      );
      return 1;
    }

    // Statements from the command line, or from a pipe. Both are how people
    // actually drive sqlite3 in a script.
    const inline = operands.slice(1).join(' ').trim();
    const sql = inline.length > 0 ? inline : io.stdin;
    if (sql.trim().length === 0) {
      // A database and nothing to do with it is somebody reaching for the
      // interactive shell, which this machine does not have.
      io.err(
        'sqlite3: this machine has no interactive shell.\n' +
          'Give it a statement, or pipe one in:\n' +
          "  sqlite3 archive.db 'SELECT * FROM crew;'\n" +
          '  cat setup.sql | sqlite3 archive.db\n',
      );
      return 1;
    }

    const path = ctx.resolve(file);
    const loaded = loadDatabase(ctx, path);
    if (typeof loaded !== 'string') {
      io.err(`sqlite3: ${file}: ${loaded.error}\n`);
      return 1;
    }

    try {
      await runtime.ready();
    } catch (e) {
      io.err(
        'sqlite3: the SQL engine could not be loaded on this build.\n' +
          'The shell is unaffected; every other command still works.\n' +
          `  (${e instanceof Error ? e.message : String(e)})\n`,
      );
      return 127;
    }

    // Dot-commands are per line; everything else goes through as written.
    const statements = sql
      .split('\n')
      .map((line) => expandDot(line) ?? line)
      .join('\n');

    const result = await runtime.run({
      sql: statements,
      database: loaded,
      now: ctx.epoch + ctx.clock(),
      seed: SQL_SEED,
    });

    if (result.error !== undefined) {
      // SQLite's own words. A rewritten error is a worse teacher than a real
      // one, and this is a game about reading errors.
      io.err(`Error: ${result.error}\n`);
      return 1;
    }

    const separator = has('csv') ? ',' : '|';
    if (has('header') && result.columns.length > 0) {
      emit(io, [result.columns.join(separator)]);
    }
    emit(io, result.rows.map((row) => row.values.map((v) => v ?? '').join(separator)));

    /*
     * Write the database back as the player.
     *
     * The permission check is the VFS's, which means `sqlite3` on a database
     * the player cannot write refuses with a real errno rather than silently
     * losing the transaction. Only written when it changed -- a pure SELECT
     * should not touch the mtime.
     */
    if (result.database !== loaded) {
      try {
        ctx.vfs.write(path, decodeBase64(result.database), ctx.user, 0o644);
      } catch (e) {
        io.err(`sqlite3: ${file}: ${e instanceof FsError ? e.reason : String(e)}\n`);
        return 1;
      }
    }
    return 0;
  };

  const manual =
    'sqlite3 [OPTIONS] FILE [SQL]\n' +
    '\n' +
    'Run SQL against a database file. The file is an ordinary file on this\n' +
    'machine: ls, cp, wc and file all see it, and it goes in your save.\n' +
    '\n' +
    '  -header   print column names above the rows\n' +
    '  -csv      separate with commas instead of |\n' +
    '  -version  print the SQLite version\n' +
    '\n' +
    "  sqlite3 archive.db 'SELECT name FROM crew;'\n" +
    '  sqlite3 archive.db < setup.sql\n' +
    '  sqlite3 archive.db .tables\n' +
    '\n' +
    'Dot-commands: .tables, .schema [TABLE], .databases. Each is a real query\n' +
    'against sqlite_master, so typing that query yourself gives the same\n' +
    'answer.\n' +
    '\n' +
    'There is no interactive shell aboard. Pass the statement, or pipe it.';

  const plain =
    'Asks questions of a database file.\n' +
    '\n' +
    "    sqlite3 archive.db 'SELECT * FROM crew;'\n" +
    '\n' +
    'A database is a file full of tables, and a table is rows and columns --\n' +
    'like a spreadsheet the machine can search properly.\n' +
    '\n' +
    'Start by asking what is in there:\n' +
    '\n' +
    '    sqlite3 archive.db .tables      the list of tables\n' +
    '    sqlite3 archive.db .schema crew what that table looks like\n' +
    '\n' +
    'The file is a normal file. You can cp it before you change anything,\n' +
    'which is the cheapest insurance there is.';

  return [{ name: 'sqlite3', summary: 'run SQL against a database file', manual, plain, run }];
}
