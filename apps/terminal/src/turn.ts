import type { BeatLine } from '@sigkill/quest';

/** How many beat lines sit on one page before the player taps. */
export const BEAT_PAGE = 7;

/**
 * Cut a beat into pages a phone can hold.
 *
 * Prose packs to `pageSize`. A run of art rows is one indivisible block and
 * gets a page of its own, however tall it is -- splitting a face across a tap
 * turns a character into two halves of a box, and a drawing with its top
 * missing is worse than a drawing you have to scroll.
 */
export function paginateBeats(lines: readonly BeatLine[], pageSize = BEAT_PAGE): BeatLine[][] {
  const pages: BeatLine[][] = [];
  let current: BeatLine[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    pages.push(current);
    current = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (typeof line === 'string') {
      if (current.length >= pageSize) flush();
      current.push(line);
      i++;
      continue;
    }

    // The whole run of art rows, taken together and never cut.
    let end = i;
    while (end < lines.length && typeof lines[end] !== 'string') end++;
    flush();
    pages.push(lines.slice(i, end));
    i = end;
  }

  flush();
  return pages.filter((page) =>
    page.some((line) => (typeof line === 'string' ? line.trim().length > 0 : true)),
  );
}

export function beatText(line: BeatLine): string {
  return typeof line === 'string' ? line : line.art;
}

export function pageIsArt(page: readonly BeatLine[]): boolean {
  return page.some((line) => typeof line !== 'string');
}
