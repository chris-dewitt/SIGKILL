import type { CapacitorConfig } from '@capacitor/cli';

/**
 * SIGKILL — Android wrapper.
 *
 * The game is entirely offline. There is no server, no account, no telemetry
 * and no remote asset: Pyodide and every byte of content ship inside the
 * package. That is why `server` is absent here and why the Android manifest
 * does not request INTERNET — see android/app/src/main/AndroidManifest.xml.
 */
const config: CapacitorConfig = {
  appId: 'org.chrisdewitt.sigkill',
  appName: 'SIGKILL',
  webDir: 'dist',

  android: {
    // The terminal is a text surface; a light theme flashes white on launch.
    backgroundColor: '#050806',
    // Player code runs in Pyodide's wasm sandbox inside a Worker, never as
    // injected JS. Debugging the WebView is a build-time choice, not a
    // shipped one.
    webContentsDebuggingEnabled: false,
    // There is nothing to load over http, so refuse it outright.
    allowMixedContent: false,
  },

  plugins: {
    // No splash plugin: the CRT boot sequence is the splash, and it is the
    // first thing the game wants the player looking at.
  },
};

export default config;
