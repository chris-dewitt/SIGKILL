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
    expect(pages[0]?.slice(0, 6)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(pageIsArt(pages[pages.length - 1] ?? [])).toBe(true);
  });

  it('drops a page that is only blank lines', () => {
    expect(paginateBeats(['', '  ', ''], 7)).toEqual([]);
  });
});
