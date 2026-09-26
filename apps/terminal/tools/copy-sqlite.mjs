/**
 * Copy wa-sqlite's wasm binary into public/ so the game serves it itself.
 *
 * Same reasoning as the Pyodide copy beside it: the app ships offline and its
 * content security policy forbids remote script, so a CDN is not an option.
 * This one is much smaller -- hundreds of kilobytes rather than twelve
 * megabytes -- but it is still a fetch, and every fetch is ours.
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const source = require.resolve('wa-sqlite/dist/wa-sqlite.wasm');
const target = join(process.cwd(), 'public', 'sqlite');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, join(target, 'wa-sqlite.wasm'));

const { size } = await stat(source);
console.log(`wa-sqlite: copied wa-sqlite.wasm (${(size / 1e6).toFixed(1)} MB) to public/sqlite`);
