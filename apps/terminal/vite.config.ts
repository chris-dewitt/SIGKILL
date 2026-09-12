import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the same build works from a web host and from a
  // Capacitor file:// container without rebuilding.
  base: './',
  server: { host: '0.0.0.0', port: 5173 },
  // Pyodide's worker uses dynamic imports, which Vite's default IIFE worker
  // format cannot code-split.
  worker: { format: 'es' },
  // Pyodide is served from public/pyodide as a plain asset, not bundled.
  optimizeDeps: { exclude: ['pyodide'] },
  build: { target: 'es2022', outDir: 'dist' },
});
