/// <reference lib="webworker" />
import { loadPyodide } from 'pyodide';
import type { PythonRequest } from '@sigkill/machine';
import { clearMachineFiles, runRequest, type PyodideLike } from './bridge.js';

/**
 * The interpreter worker.
 *
 * Python runs here and nowhere else. A Worker has no DOM, no document and no
 * window, so player-authored code has nothing to reach for even before the
 * sandbox is considered. That is the whole reason the executor became async.
 */

export type WorkerIn =
  | { id: number; type: 'init'; indexURL: string }
  | { id: number; type: 'run'; request: PythonRequest };

export type WorkerOut =
  | { id: number; type: 'ready'; version: string }
  | { id: number; type: 'result'; result: Awaited<ReturnType<typeof runRequest>> }
  | { id: number; type: 'error'; message: string };

let pyodide: PyodideLike | undefined;
let lastRoots: string[] = [];

const post = (message: WorkerOut): void => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
};

self.onmessage = async (event: MessageEvent<WorkerIn>): Promise<void> => {
  const message = event.data;

  try {
    if (message.type === 'init') {
      pyodide ??= (await loadPyodide({ indexURL: message.indexURL })) as unknown as PyodideLike;
      post({ id: message.id, type: 'ready', version: pyodide.version });
      return;
    }

    if (message.type === 'run') {
      if (!pyodide) throw new Error('interpreter not initialised');

      // Each run starts from the machine's current disk, not from whatever
      // the previous run left behind. Without this, a file the player deleted
      // in the shell would still be visible to Python.
      clearMachineFiles(pyodide, lastRoots);
      lastRoots = message.request.roots;

      const result = await runRequest(pyodide, message.request);
      post({ id: message.id, type: 'result', result });
    }
  } catch (e) {
    post({ id: message.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
