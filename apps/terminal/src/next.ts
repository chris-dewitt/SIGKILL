import type { ShellContext } from '@sigkill/machine';

/**
 * The next word, worked out from the line as typed.
 *
 * On a phone the chip bar is the input method, so it has to know more than
 * the files in front of you. Each command can say what follows it
 * (`CommandSpec.complete`), and this is the host half of that contract: find
 * the command the cursor is inside, hand it the words so far, and keep the
 * ones that fit what is half-typed.
 *
 * Pure apart from reading the shell: a line in, words out. No DOM, so it is
 * tested without a browser.
 */

export interface Next {
  /** What could go where the cursor is, best first. */
  readonly words: readonly string[];
  /** The half-typed word those replace. Empty after a space. */
  readonly partial: string;
}

/** Where the last command on the line starts: after an unquoted `|`, `;` or `&&`. */
export function lastSegment(line: string): string {
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '|' || ch === ';') start = i + 1;
    else if (ch === '&' && line[i + 1] === '&') start = i + 2;
  }
  return line.slice(start);
}

const REDIRECTS = new Set(['>', '>>', '<', '2>']);

/** Directory entries matching a half-typed path, directories marked with a slash. */
export function pathWords(shell: ShellContext, partial: string): string[] {
  const slash = partial.lastIndexOf('/');
  const dir = slash < 0 ? '.' : partial.slice(0, slash + 1);
  const stem = slash < 0 ? partial : partial.slice(slash + 1);
  let entries: string[];
  try {
    entries = shell.vfs.readdir(shell.resolve(dir), shell.user);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.startsWith(stem) && (stem.startsWith('.') || !e.startsWith('.')))
    .sort()
    .map((e) => {
      const full = dir === '.' ? e : dir + e;
      try {
        return shell.vfs.stat(shell.resolve(full), shell.user).kind === 'dir' ? `${full}/` : full;
      } catch {
        return full;
      }
    });
}

export function nextWords(shell: ShellContext, line: string): Next {
  const segment = lastSegment(line);
  const trailing = segment.length === 0 || /\s$/.test(segment);
  const tokens = segment.split(/\s+/).filter((t) => t.length > 0);
  const partial = trailing ? '' : (tokens[tokens.length - 1] ?? '');
  const before = trailing ? tokens : tokens.slice(0, -1);

  // The command itself.
  if (before.length === 0) {
    const names = [...shell.commands.keys()].filter((n) => n.startsWith(partial) && n !== partial).sort();
    return { words: names, partial };
  }

  // A redirect takes a path whatever the command is.
  if (REDIRECTS.has(before[before.length - 1]!)) return { words: pathWords(shell, partial), partial };

  const spec = shell.commands.get(before[0]!);
  if (spec?.complete) {
    const args = [...before.slice(1), partial];
    let offered: readonly string[];
    try {
      offered = spec.complete(shell, args);
    } catch {
      // A completer that throws costs a suggestion, never the line.
      offered = [];
    }
    const lower = partial.toLowerCase();
    const words = [...new Set(offered)].filter((w) => w.toLowerCase().startsWith(lower) && w !== partial);
    // A completer with nothing to say about a path-shaped word defers to the disk.
    if (words.length > 0 || !partial.includes('/')) return { words, partial };
  }

  return { words: pathWords(shell, partial), partial };
}

/**
 * The line with `word` in place of the half-typed one.
 *
 * A space follows, so the next chip is already the next word -- except after a
 * directory, where the next thing is more path.
 */
export function insertWord(line: string, partial: string, word: string): string {
  const head = line.slice(0, line.length - partial.length);
  const gap = head.length === 0 || /\s$/.test(head) ? '' : ' ';
  return `${head}${gap}${word}${word.endsWith('/') ? '' : ' '}`;
}
