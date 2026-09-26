/**
 * The app's entry point for the SQL worker.
 *
 * Vite needs a worker module it owns to bundle; the implementation lives in
 * @sigkill/sql so it can also be driven directly from Node in tests.
 */
import '@sigkill/sql/worker';
