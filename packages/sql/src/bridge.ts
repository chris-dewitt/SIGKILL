import {
  decodeBase64,
  encodeBase64,
  type SqlRequest,
  type SqlResult,
  type SqlRow,
} from '@sigkill/machine';

/**
 * The part of the SQL engine that has decisions in it.
 *
 * Shared by the Worker runtime and the Node one, exactly as
 * `packages/python/src/bridge.ts` is, so the thing the game runs and the thing
 * CI runs are the same code with a different host around them.
 *
 * Everything here exists to keep two promises:
 *
 * 1. **The database is a file.** Bytes come in, bytes go out, and the Machine
 *    owns the disk. This runtime never sees the filesystem.
 * 2. **Nothing reads the real world.** SQLite wants the system clock for
 *    `CURRENT_TIMESTAMP` and real entropy for `random()`. Both are replaced
 *    before a single statement runs. A save that replays differently is not a
 *    save, and this is the only place that could break it.
 */

/** The database filename inside SQLite's own memory VFS. Never on disk. */
const DB_NAME = 'machine.db';

/** Minimal shapes of the wa-sqlite pieces used here. */
export interface SqliteApi {
  open_v2(filename: string, flags?: number, vfs?: string): Promise<number>;
  close(db: number): Promise<void>;
  exec(db: number, sql: string, callback?: (row: unknown[], columns: string[]) => void): Promise<number>;
  create_function(
    db: number,
    name: string,
    argc: number,
    textRep: number,
    appData: number,
    func: (ctx: number, values?: number[]) => void,
  ): number;
  result_int(context: number, value: number): void;
  vfs_register(vfs: unknown, makeDefault?: boolean): number;
}

export interface MemoryFile {
  name: string;
  size: number;
  data: ArrayBuffer;
}

export interface MemoryVfsLike {
  mapNameToFile: Map<string, MemoryFile>;
}

export interface SqlModules {
  sqlite3: SqliteApi;
  vfs: MemoryVfsLike;
  vfsName: string;
  version: string;
  /** SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, from the wa-sqlite constants. */
  openFlags: number;
  /** SQLITE_UTF8, for registering a function. */
  utf8: number;
}

/**
 * The ship's clock, installed before the wasm engine is built.
 *
 * Emscripten compiles SQLite's time calls down to `Date.now`, so replacing it
 * is enough to make `CURRENT_TIMESTAMP`, `datetime('now')` and
 * `julianday('now')` all report the adventure's calendar. Verified in the
 * spike; see `docs/GAME2_BEATS.md` section 8a.
 *
 * It must be installed *before* the factory runs, which is why this is a
 * separate exported function rather than something `runRequest` does. The
 * Worker owns its global scope entirely, which is what makes this ordinary
 * rather than a hack.
 *
 * **One artifact, deliberately not corrected.** SQLite converts times through
 * a double, and at a handful of instants that conversion lands a millisecond
 * short -- `2398-06-08 04:12:00` comes back as `04:11:59.999`, while
 * `04:12:01` and `05:12:00` are exact. That is real SQLite arithmetic in real
 * SQLite's C, it is the same every run, and a real `sqlite3` on a real
 * machine does it too. Nudging the clock to hide it would make this engine
 * disagree with the one the player will meet outside the game, which is the
 * one thing this project does not do. Determinism is what matters here, and
 * determinism is intact.
 */
export function installClock(at: () => number): () => void {
  const real = Date.now;
  Date.now = () => at();
  return () => {
    Date.now = real;
  };
}

/**
 * A seeded generator standing in for `random()`.
 *
 * The same linear congruential generator the hull telemetry uses, so the
 * whole project has one source of fake randomness. SQLite lets a host
 * function shadow a built-in of the same name, which is how this gets to be
 * simple.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    // Signed, because that is what SQLite's random() returns.
    return state | 0;
  };
}

/** Put the database's bytes into the engine's memory VFS before opening it. */
function loadInto(vfs: MemoryVfsLike, database: string): void {
  vfs.mapNameToFile.delete(DB_NAME);
  if (database.length === 0) return;
  const bytes = decodeBase64(database);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  vfs.mapNameToFile.set(DB_NAME, { name: DB_NAME, size: bytes.byteLength, data: buffer });
}

/** Read the database back out, to be written to the Machine's filesystem. */
function readBack(vfs: MemoryVfsLike, fallback: string): string {
  const file = vfs.mapNameToFile.get(DB_NAME);
  if (!file) return fallback;
  const data = file.data instanceof ArrayBuffer ? new Uint8Array(file.data) : file.data;
  return encodeBase64(new Uint8Array(data).subarray(0, file.size));
}

/**
 * Run one request.
 *
 * Every statement in the request runs against one connection, so a
 * transaction spanning several of them behaves the way it would on a real
 * machine. The rows returned are the rows of the *last* statement that
 * produced any, which is what `sqlite3 db 'A; B'` does.
 */
export async function runRequest(modules: SqlModules, request: SqlRequest): Promise<SqlResult> {
  const { sqlite3, vfs } = modules;
  loadInto(vfs, request.database);

  let db: number | undefined;
  const rows: SqlRow[] = [];
  let columns: string[] = [];

  try {
    db = await sqlite3.open_v2(DB_NAME, modules.openFlags, modules.vfsName);

    // Shadow the built-in. Without this, `random()` is real entropy and the
    // whole save/replay guarantee is gone -- there is a test that fails if
    // this line is removed.
    const next = seededRandom(request.seed);
    sqlite3.create_function(db, 'random', 0, modules.utf8, 0, (context) => {
      sqlite3.result_int(context, next());
    });

    await sqlite3.exec(db, request.sql, (row, names) => {
      // A statement that returns no rows leaves the previous statement's
      // column names alone, which is what makes `A; SELECT ...` print
      // headers for the select.
      if (names.length > 0) columns = [...names];
      rows.push({
        values: row.map((v) =>
          v === null || v === undefined ? null : typeof v === 'string' ? v : String(v),
        ),
      });
    });
  } catch (e) {
    // Close before reading back: SQLite writes the last page on close, and a
    // failed statement can still have committed earlier ones.
    if (db !== undefined) await sqlite3.close(db).catch(() => undefined);
    return {
      columns,
      rows,
      error: e instanceof Error ? e.message : String(e),
      database: readBack(vfs, request.database),
    };
  }

  await sqlite3.close(db);
  return { columns, rows, database: readBack(vfs, request.database) };
}
