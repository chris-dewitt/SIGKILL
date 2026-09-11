import * as p from '../vfs/path.js';
import { ROOT_USER, type Vfs } from '../vfs/vfs.js';
import type { Unit } from './types.js';

/** Directories searched for unit files, in systemd's order of precedence. */
export const UNIT_DIRS = ['/etc/systemd/system', '/lib/systemd/system'];

/** Symlinks here are what `systemctl enable` actually creates. */
export const WANTS_DIR = '/etc/systemd/system/multi-user.target.wants';

/**
 * Parse a systemd-style INI file into sections.
 *
 * Deliberately forgiving in the same places systemd is: blank lines, `#` and
 * `;` comments, and whitespace around `=` are all ignored.
 */
export function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section = '';

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1);
      out[section] ??= {};
      continue;
    }

    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[section] ??= {};
    out[section]![line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }

  return out;
}

/** Strip a `.service` suffix so `systemctl start x` and `x.service` agree. */
export function unitName(name: string): string {
  return name.endsWith('.service') ? name.slice(0, -'.service'.length) : name;
}

/** Find and parse a unit by name, or return undefined if no file exists. */
export function loadUnit(vfs: Vfs, name: string): Unit | undefined {
  const base = unitName(name);
  const file = `${base}.service`;

  for (const dir of UNIT_DIRS) {
    const path = p.join(dir, file);
    if (!vfs.exists(path, ROOT_USER)) continue;

    const ini = parseIni(vfs.readText(path, ROOT_USER));
    return {
      name: base,
      description: ini['Unit']?.['Description'] ?? base,
      execStart: ini['Service']?.['ExecStart'] ?? '',
      restart: ini['Service']?.['Restart'] ?? 'no',
      wantedBy: ini['Install']?.['WantedBy'] ?? '',
      path,
    };
  }

  return undefined;
}

/** Every unit the machine can see, deduplicated by name across unit dirs. */
export function listUnits(vfs: Vfs): Unit[] {
  const seen = new Set<string>();
  const units: Unit[] = [];

  for (const dir of UNIT_DIRS) {
    let entries: string[];
    try {
      entries = vfs.readdir(dir, ROOT_USER);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.service')) continue;
      const base = unitName(entry);
      if (seen.has(base)) continue;
      const unit = loadUnit(vfs, base);
      if (!unit) continue;
      seen.add(base);
      units.push(unit);
    }
  }

  return units.sort((a, b) => a.name.localeCompare(b.name));
}
