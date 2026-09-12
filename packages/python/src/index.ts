import type { PythonRequest, PythonResult, PythonRuntime } from '@sigkill/machine';
import type { WorkerIn, WorkerOut } from './worker.js';

/** Distributes over the union, unlike a bare Omit, so both arms survive. */
type WorkerMessage = WorkerIn extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never;

export { runRequest, clearMachineFiles } from './bridge.js';
export type { PyodideLike } from './bridge.js';

export interface WorkerRuntimeOptions {
  /**
   * Where Pyodide's wasm and standard library are served from.
   *
   * Must be a local path: the game ships offline, and a CDN would also be
   * blocked by the content security policy. The build copies these assets in.
   */
  indexURL?: string;
  /** Factory for the worker, so the bundler can be told about it explicitly. */
  createWorker?: () => Worker;
}

const DEFAULT_INDEX_URL = './pyodide/';

/**
 * A Python interpreter running in a Web Worker.
 *
 * Loading is lazy: the first `python3` pays for it and a bash-only puzzle
 * never does. Ten megabytes is not something to spend on a player who is
 * still learning `ls`.
 */
export class WorkerPythonRuntime implements PythonRuntime {
  private worker: Worker | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  private booting: Promise<void> | undefined;
  private loadedVersion = 'unknown';

  constructor(private readonly opts: WorkerRuntimeOptions = {}) {}

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
      const error = new Error(event.message || 'python worker failed');
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
    };

    this.worker = worker;

    const ready = await this.send<Extract<WorkerOut, { type: 'ready' }>>({
      type: 'init',
      indexURL: this.opts.indexURL ?? DEFAULT_INDEX_URL,
    });
    this.loadedVersion = ready.version;
  }

  async run(request: PythonRequest): Promise<PythonResult> {
    await this.ready();
    const message = await this.send<Extract<WorkerOut, { type: 'result' }>>({ type: 'run', request });
    return message.result;
  }

  private send<T extends WorkerOut>(message: WorkerMessage): Promise<T> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('python worker is not running'));
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
