import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { SqlRequest, SqlResult, SqlRuntime } from '@sigkill/machine';
import { installClock, runRequest, type SqlModules } from './bridge.js';

/**
 * wa-sqlite loaded directly, without a Worker.
 *
 * This exists so the SQL integration can be tested for real in CI rather than
 * mocked. It is **not** the browser path: in the game, SQL runs in a Worker so
 * that player-authored statements have no DOM to reach for. Do not wire this
 * into the app -- the same rule `NodePythonRuntime` carries, for the same
 * reason.
 */
export class NodeSqlRuntime implements SqlRuntime {
  private modules: SqlModules | undefined;
  private booting: Promise<void> | undefined;
  /** What the engine should believe the time is. Set per request. */
  private now = 0;

  get version(): string {
    return this.modules?.version ?? 'unknown';
  }

  async ready(): Promise<void> {
    this.booting ??= (async () => {
      const require = createRequire(import.meta.url);

      /*
       * The clock goes in before the factory runs, not after.
       *
       * Emscripten resolves SQLite's time calls against `Date.now` while the
       * module is being instantiated, so patching afterwards is too late.
       * This is the single line the determinism of every SQL puzzle rests on,
       * and there is a test that fails without it.
       */
      const restore = installClock(() => this.now);
      try {
        const wasmBinary = readFileSync(require.resolve('wa-sqlite/dist/wa-sqlite.wasm'));
        const factory = (await import('wa-sqlite/dist/wa-sqlite.mjs')).default;
        const SQLite = await import('wa-sqlite');
        const { MemoryVFS } = await import('wa-sqlite/src/examples/MemoryVFS.js');

        const module = await factory({ wasmBinary });
        const sqlite3 = SQLite.Factory(module);
        const vfs = new MemoryVFS();
        // wa-sqlite's own types disagree with the MemoryVFS it ships: the
        // example's xRead takes a {size,value} pair and the declared
        // interface takes a Uint8Array. The example is the one that works.
        sqlite3.vfs_register(vfs as never, false);

        // The version is a query, not a constant -- wa-sqlite does not
        // export one, and asking the engine is more honest anyway.
        let version = 'unknown';
        const probe = await sqlite3.open_v2(':memory:');
        await sqlite3.exec(probe, 'SELECT sqlite_version();', (row) => {
          version = String(row[0]);
        });
        await sqlite3.close(probe);

        this.modules = {
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
    })();
    await this.booting;
  }

  async run(request: SqlRequest): Promise<SqlResult> {
    /*
     * The clock is set before boot, not after.
     *
     * The engine captures a reference instant while it is being instantiated
     * and counts from there, so a module built at time zero and then asked
     * about the ship's calendar answers a second or so short. Setting it
     * first makes both agree.
     */
    this.now = request.now;
    await this.ready();
    const modules = this.modules;
    if (!modules) throw new Error('SQL engine not initialised');

    // The clock is re-installed for the duration of the statements, because
    // `CURRENT_TIMESTAMP` is evaluated when the statement runs, not when the
    // engine was built.
    this.now = request.now;
    const restore = installClock(() => this.now);
    try {
      return await runRequest(modules, request);
    } finally {
      restore();
    }
  }
}
