import type { BeatLine } from '@sigkill/quest';

/** How many beat lines sit on one page before the player taps. */
export const BEAT_PAGE = 7;

/**
 * Cut a beat into pages a phone can hold.
 *
 * Art stays with the page it started on — splitting a face across a tap
 * is how a character becomes two halves of a box.
 */
export function paginateBeats(lines: readonly BeatLine[], pageSize = BEAT_PAGE): BeatLine[][] {
  const pages: BeatLine[][] = [];
  let current: BeatLine[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    pages.push(current);
    current = [];
  };

  for (const line of lines) {
    if (typeof line !== 'string') {
      if (current.length >= pageSize) flush();
      current.push(line);
      continue;
    }
    if (current.length >= pageSize) flush();
    current.push(line);
  }
  flush();
  return pages.filter((page) => page.some((line) => (typeof line === 'string' ? line.trim().length > 0 : true)));
}

export function beatText(line: BeatLine): string {
  return typeof line === 'string' ? line : line.art;
}

export function pageIsArt(page: readonly BeatLine[]): boolean {
  return page.some((line) => typeof line !== 'string');
}
