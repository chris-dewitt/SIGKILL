/**
 * Guard the Android manifest decisions that cap sync or a Capacitor upgrade
 * could silently undo.
 *
 * Comments are stripped first: the manifest documents the removed INTERNET
 * permission by quoting it, and a naive grep matches its own explanation.
 */
import { readFile } from 'node:fs/promises';

const path = 'android/app/src/main/AndroidManifest.xml';
const xml = await readFile(path, 'utf8');
const live = xml.replace(/<!--[\s\S]*?-->/g, '');

const failures = [];

if (!/android:windowSoftInputMode="adjustResize"/.test(live)) {
  failures.push(
    'windowSoftInputMode="adjustResize" is missing.\n' +
      '    Without it the soft keyboard covers the prompt instead of pushing it up,\n' +
      '    and a terminal you cannot see while typing into is not a terminal.',
  );
}

const permissions = [...live.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map(
  (m) => m[1],
);
// VIBRATE is expected once keystroke haptics land; nothing else is.
const allowed = new Set(['android.permission.VIBRATE']);
const unexpected = permissions.filter((p) => !allowed.has(p));
if (unexpected.length > 0) {
  failures.push(
    `unexpected permissions: ${unexpected.join(', ')}\n` +
      '    SIGKILL ships entirely offline. INTERNET in particular is removed on\n' +
      '    purpose so the app provably cannot reach the network. See docs/ANDROID.md.',
  );
}

if (!/android:allowBackup="false"/.test(live)) {
  failures.push(
    'allowBackup is not false.\n' +
      '    App storage would be swept into cloud backups, which matters the moment\n' +
      '    the app can hold a secret.',
  );
}

if (failures.length > 0) {
  console.error(`\n${path} has regressed:\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}

console.log(`${path}: adjustResize set, no network permission, backups off`);
