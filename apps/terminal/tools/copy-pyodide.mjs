/**
 * Copy Pyodide's runtime assets into public/ so the game serves them itself.
 *
 * The app ships offline and its content security policy forbids remote script,
 * so a CDN is not an option. Run before dev and before build.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const source = dirname(require.resolve('pyodide'));
const target = join(process.cwd(), 'public', 'pyodide');

// Only the runtime is needed. The packages directory is tens of megabytes of
// optional wheels the game does not use.
const SKIP = new Set(['node_modules', 'test', 'tests']);

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

let copied = 0;
let bytes = 0;
for (const entry of await readdir(source)) {
  if (SKIP.has(entry)) continue;
  const from = join(source, entry);
  const info = await stat(from);
  if (info.isDirectory()) continue;
  await cp(from, join(target, entry));
  copied++;
  bytes += info.size;
}

console.log(`pyodide: copied ${copied} files (${(bytes / 1e6).toFixed(1)} MB) to public/pyodide`);
