import { describe, expect, it } from 'vitest';
import { asArt } from '@sigkill/quest';
import { paginateBeats, pageIsArt } from '../src/turn.js';

describe('paginateBeats', () => {
  it('keeps a short beat on one page', () => {
    const pages = paginateBeats(['one', 'two', 'three'], 7);
    expect(pages).toEqual([['one', 'two', 'three']]);
  });

  it('splits a long beat so a phone can hold each page', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line ${i}`);
    const pages = paginateBeats(lines, 7);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toHaveLength(7);
    expect(pages[2]).toHaveLength(1);
  });

  it('does not start a new page in the middle of a drawing', () => {
    const face = asArt(['  ▲▲  ', '  ▄▄  ']);
    const lines = ['a', 'b', 'c', 'd', 'e', 'f', ...face];
    const pages = paginateBeats(lines, 7);

    expect(pages[0]).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    // Both rows on one page. Landing the sixth prose line and the first row
    // of the face together would cut the face in half on the next tap.
    expect(pages[1]).toEqual(face);
    expect(pageIsArt(pages[1] ?? [])).toBe(true);
  });

  it('keeps a drawing taller than a page whole rather than cutting it', () => {
    const face = asArt(Array.from({ length: 10 }, (_, i) => `row ${i}`));
    const pages = paginateBeats(['before', ...face, 'after'], 7);
    expect(pages).toEqual([['before'], face, ['after']]);
  });

  it('drops a page that is only blank lines', () => {
    expect(paginateBeats(['', '  ', ''], 7)).toEqual([]);
  });
});
