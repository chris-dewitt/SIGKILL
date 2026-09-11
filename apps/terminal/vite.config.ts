import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the same build works from a web host and from a
  // Capacitor file:// container without rebuilding.
  base: './',
  server: { host: '0.0.0.0', port: 5173 },
  build: { target: 'es2022', outDir: 'dist' },
});
