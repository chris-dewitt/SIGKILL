/**
 * The app's entry point for the Python worker.
 *
 * Vite needs a worker module it owns to bundle; the implementation lives in
 * @sigkill/python so it can also be driven directly from Node in tests.
 */
import '@sigkill/python/worker';
