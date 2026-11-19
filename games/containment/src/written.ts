import { ROOT_USER } from '@sigkill/machine';
import type { World } from '@sigkill/quest';
import { HOME } from './act1/annexe.js';

/**
 * What the player has written: the only thing a goal in this act reads.
 *
 * Shared by both parts, because the rule is the same in both: a finding is a
 * file of his own, under home, wherever he chose to put it.
 */

/** Files the annexe seeded into the player's home. Not their work. */
export const SEEDED = new Set([`${HOME}/README`, `${HOME}/KERR`]);

/** Everything the player has written, anywhere under home, lowercased. */
export function written(w: World): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = w.vfs.readdir(dir, ROOT_USER);
    } catch {
      return;
    }
    for (const name of names) {
      const path = `${dir}/${name}`.replace(/\/+/g, '/');
      let kind: string;
      try {
        kind = w.vfs.lstat(path, ROOT_USER).kind;
      } catch {
        continue;
      }
      if (kind === 'dir') walk(path);
      else if (kind === 'file' && !SEEDED.has(path)) {
        try {
          parts.push(w.vfs.readText(path, ROOT_USER));
        } catch {
          // Unreadable. Not a finding.
        }
      }
    }
  };
  walk(HOME);
  return parts.join('\n').toLowerCase();
}

/** Each file the player has written under home, lowercased, by path. */
export function writtenFiles(w: World): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = w.vfs.readdir(dir, ROOT_USER);
    } catch {
      return;
    }
    for (const name of names) {
      const path = `${dir}/${name}`.replace(/\/+/g, '/');
      try {
        const kind = w.vfs.lstat(path, ROOT_USER).kind;
        if (kind === 'dir') walk(path);
        else if (kind === 'file' && !SEEDED.has(path)) out.push(w.vfs.readText(path, ROOT_USER).toLowerCase());
      } catch {
        continue;
      }
    }
  };
  walk(HOME);
  return out;
}

