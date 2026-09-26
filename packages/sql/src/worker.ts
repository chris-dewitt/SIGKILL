/// <reference lib="webworker" />
import type { SqlRequest, SqlResult } from '@sigkill/machine';
import { installClock, runRequest, type SqlModules } from './bridge.js';

/**
 * The SQL worker.
 *
 * SQLite runs here and nowhere else, for the same reason Python does: a
 * Worker has no DOM, no document and no window, so player-authored statements
 * have nothing to reach for even before the sandbox is considered.
 *
 * It is also what makes the clock patch defensible. Replacing `Date.now` on
 * the host would be an unacceptable thing to do to somebody else's page; in a
 * scope this file owns entirely it is ordinary, and it is the only way
 * `CURRENT_TIMESTAMP` can be the ship's.
 */

export type WorkerIn =
  | { id: number; type: 'init'; wasmURL: string }
  | { id: number; type: 'run'; request: SqlRequest };

export type WorkerOut =
  | { id: number; type: 'ready'; version: string }
  | { id: number; type: 'result'; result: SqlResult }
  | { id: number; type: 'error'; message: string };

let modules: SqlModules | undefined;
/** What the engine believes the time is. Set for the duration of each run. */
let now = 0;

const post = (message: WorkerOut): void => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
};

async function boot(wasmURL: string): Promise<SqlModules> {
  /*
   * The clock goes in before the factory runs.
   *
   * Emscripten resolves SQLite's time calls against `Date.now` during
   * instantiation, so patching afterwards is too late. This is the line every
   * SQL puzzle's determinism rests on.
   */
  const restore = installClock(() => now);
  try {
    const response = await fetch(wasmURL);
    const wasmBinary = await response.arrayBuffer();

    const factory = (await import('wa-sqlite/dist/wa-sqlite.mjs')).default;
    const SQLite = await import('wa-sqlite');
    const { MemoryVFS } = await import('wa-sqlite/src/examples/MemoryVFS.js');

    const module = await factory({ wasmBinary });
    const sqlite3 = SQLite.Factory(module);
    const vfs = new MemoryVFS();
    // wa-sqlite's own types disagree with the MemoryVFS it ships: the
    // example's xRead takes a {size,value} pair and the declared interface
    // takes a Uint8Array. The example is the one that works.
    sqlite3.vfs_register(vfs as never, false);

    let version = 'unknown';
    const probe = await sqlite3.open_v2(':memory:');
    await sqlite3.exec(probe, 'SELECT sqlite_version();', (row: unknown[]) => {
      version = String(row[0]);
    });
    await sqlite3.close(probe);

    return {
      sqlite3: sqlite3 as unknown as SqlModules['sqlite3'],
      vfs: vfs as unknown as SqlModules['vfs'],
      vfsName: (vfs as { name: string }).name,
      version: `SQLite ${version}`,
      openFlags: SQLite.SQLITE_OPEN_READWRITE | SQLite.SQLITE_OPEN_CREATE,
      utf8: SQLite.SQLITE_UTF8,
    };
  } finally {
    restore();
  }
}

self.onmessage = async (event: MessageEvent<WorkerIn>): Promise<void> => {
  const message = event.data;

  try {
    if (message.type === 'init') {
      modules ??= await boot(message.wasmURL);
      post({ id: message.id, type: 'ready', version: modules.version });
      return;
    }

    if (message.type === 'run') {
      if (!modules) throw new Error('SQL engine not initialised');

      // Re-installed per run: CURRENT_TIMESTAMP is evaluated when the
      // statement runs, not when the engine was built.
      now = message.request.now;
      const restore = installClock(() => now);
      try {
        post({ id: message.id, type: 'result', result: await runRequest(modules, message.request) });
      } finally {
        restore();
      }
    }
  } catch (e) {
    post({ id: message.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
