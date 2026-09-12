import { loadPyodide } from 'pyodide';
import type { PythonRequest, PythonResult, PythonRuntime } from '@sigkill/machine';
import { clearMachineFiles, runRequest, type PyodideLike } from './bridge.js';

/**
 * Pyodide loaded directly, without a Worker.
 *
 * This exists so the Python integration can be tested for real in CI rather
 * than mocked. It is **not** the browser path: in the game, Python runs in a
 * Worker so that player-authored code has no DOM to reach for. Do not wire
 * this into the app.
 */
export class NodePythonRuntime implements PythonRuntime {
  private pyodide: PyodideLike | undefined;
  private booting: Promise<void> | undefined;
  private lastRoots: string[] = [];

  get version(): string {
    return this.pyodide?.version ?? 'unknown';
  }

  async ready(): Promise<void> {
    this.booting ??= (async () => {
      this.pyodide = (await loadPyodide()) as unknown as PyodideLike;
    })();
    await this.booting;
  }

  async run(request: PythonRequest): Promise<PythonResult> {
    await this.ready();
    const pyodide = this.pyodide;
    if (!pyodide) throw new Error('interpreter not initialised');

    // Start from the machine's current disk rather than the previous run's
    // leftovers, so a file deleted in the shell is really gone.
    clearMachineFiles(pyodide, this.lastRoots);
    this.lastRoots = request.roots;

    return runRequest(pyodide, request);
  }
}
