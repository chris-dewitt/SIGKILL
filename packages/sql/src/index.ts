import type { SqlRequest, SqlResult, SqlRuntime } from '@sigkill/machine';
import type { WorkerIn, WorkerOut } from './worker.js';

/** Distributes over the union, unlike a bare Omit, so both arms survive. */
type WorkerMessage = WorkerIn extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never;

export { installClock, seededRandom, runRequest } from './bridge.js';
export type { SqlModules, MemoryVfsLike, SqliteApi } from './bridge.js';
/*
 * `NodeSqlRuntime` is deliberately NOT exported here.
 *
 * It is reachable only as `@sigkill/sql/node`, the same way
 * `NodePythonRuntime` is. Exporting it from the index would put a runtime
 * that loads wasm off the local filesystem within reach of the app bundle --
 * and would drag `node:fs` into a browser typecheck, which is how this was
 * noticed.
 */

export interface WorkerSqlOptions {
  /**
   * Where the wasm binary is served from.
   *
   * Local, always: the game ships offline and the content security policy
   * blocks remote script anyway. The build copies it in beside Pyodide's.
   */
  wasmURL?: string;
  /** Factory for the worker, so the bundler can be told about it explicitly. */
  createWorker?: () => Worker;
}

const DEFAULT_WASM_URL = './sqlite/wa-sqlite.wasm';

/**
 * SQLite running in a Web Worker.
 *
 * Loading is lazy, like Pyodide's: the first `sqlite3` pays for it and a
 * bash-only puzzle never does. The binary is far smaller than Pyodide's --
 * hundreds of kilobytes rather than twelve megabytes -- but the principle is
 * the same, and so is the reason it is a Worker at all.
 */
export class WorkerSqlRuntime implements SqlRuntime {
  private worker: Worker | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  private booting: Promise<void> | undefined;
  private loadedVersion = 'unknown';

  constructor(private readonly opts: WorkerSqlOptions = {}) {}

  get version(): string {
    return this.loadedVersion;
  }

  async ready(): Promise<void> {
    this.booting ??= this.boot();
    await this.booting;
  }

  private async boot(): Promise<void> {
    const worker = this.opts.createWorker
      ? this.opts.createWorker()
      : new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

    worker.onmessage = (event: MessageEvent<WorkerOut>): void => {
      const message = event.data;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.type === 'error') waiter.reject(new Error(message.message));
      else waiter.resolve(message as never);
    };

    worker.onerror = (event: ErrorEvent): void => {
      const error = new Error(event.message || 'sql worker failed');
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
    };

    this.worker = worker;

    const ready = await this.send<Extract<WorkerOut, { type: 'ready' }>>({
      type: 'init',
      wasmURL: this.opts.wasmURL ?? DEFAULT_WASM_URL,
    });
    this.loadedVersion = ready.version;
  }

  async run(request: SqlRequest): Promise<SqlResult> {
    await this.ready();
    const message = await this.send<Extract<WorkerOut, { type: 'result' }>>({ type: 'run', request });
    return message.result;
  }

  private send<T extends WorkerOut>(message: WorkerMessage): Promise<T> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('sql worker is not running'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject });
      worker.postMessage({ ...message, id } as WorkerIn);
    });
  }

  /** Release the worker. The next call boots a fresh one. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.booting = undefined;
    this.pending.clear();
  }
}
