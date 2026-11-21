import { describe, expect, it } from 'vitest';
import {
  MIN_COLS,
  MIN_ROWS,
  atBottom,
  atlasColumns,
  atlasCodepoints,
  backingSize,
  drawnCell,
  gridFor,
  slotPosition,
  visibleRange,
} from '../src/metrics.js';

const cell = { width: 8, height: 18 };

describe('gridFor', () => {
  it('fits whole cells only', () => {
    // 399/8 = 49.875 — the partial column would clip mid-glyph.
    expect(gridFor({ width: 399, height: 800, dpr: 2 }, cell)).toEqual({ cols: 49, rows: 44 });
  });

  it('survives the keyboard animating the viewport to nothing', () => {
    // Android reports transient zero-height layouts while the keyboard moves.
    // A zero or negative grid would divide by zero downstream.
    expect(gridFor({ width: 0, height: 0, dpr: 3 }, cell)).toEqual({ cols: MIN_COLS, rows: MIN_ROWS });
  });

  it('survives a cell size that has not been measured yet', () => {
    expect(gridFor({ width: 400, height: 800, dpr: 2 }, { width: 0, height: 0 })).toEqual({
      cols: MIN_COLS,
      rows: MIN_ROWS,
    });
  });
});

describe('backingSize', () => {
  it('scales to device pixels', () => {
    expect(backingSize({ width: 400, height: 800, dpr: 2 })).toEqual({
      width: 800,
      height: 1600,
      scale: 2,
    });
  });

  it('caps the ratio so a high-DPR tablet does not allocate a huge surface', () => {
    const r = backingSize({ width: 1000, height: 1500, dpr: 4 });
    expect(r.scale).toBe(2);
    expect(r.width).toBe(2000);
  });

  it('never goes below 1x, and never produces a zero-sized surface', () => {
    expect(backingSize({ width: 400, height: 800, dpr: 0.5 }).scale).toBe(1);
    expect(backingSize({ width: 0, height: 0, dpr: 1 })).toEqual({ width: 1, height: 1, scale: 1 });
  });

  it('rounds a fractional ratio rather than leaving a fractional surface', () => {
    // 2.75 is a real Android value.
    const r = backingSize({ width: 411, height: 891, dpr: 2.75 });
    expect(Number.isInteger(r.width)).toBe(true);
    expect(Number.isInteger(r.height)).toBe(true);
  });
});

describe('visibleRange', () => {
  it('shows the newest rows when not scrolled', () => {
    expect(visibleRange(100, 10, 0)).toEqual({ start: 90, end: 100 });
  });

  it('scrolls back', () => {
    expect(visibleRange(100, 10, 5)).toEqual({ start: 85, end: 95 });
  });

  it('clamps at the top instead of producing a negative index', () => {
    expect(visibleRange(100, 10, 999)).toEqual({ start: 0, end: 10 });
  });

  it('pins to zero when the buffer is shorter than the viewport', () => {
    expect(visibleRange(3, 10, 0)).toEqual({ start: 0, end: 3 });
    expect(visibleRange(3, 10, 5)).toEqual({ start: 0, end: 3 });
  });

  it('handles an empty buffer', () => {
    expect(visibleRange(0, 10, 0)).toEqual({ start: 0, end: 0 });
  });

  it('ignores a negative scroll', () => {
    expect(visibleRange(100, 10, -5)).toEqual({ start: 90, end: 100 });
  });
});

describe('atBottom', () => {
  it('is true at rest and false once scrolled back', () => {
    // This is what decides whether new output auto-scrolls or waits.
    expect(atBottom(100, 10, 0)).toBe(true);
    expect(atBottom(100, 10, 1)).toBe(false);
  });

  it('is true when everything fits', () => {
    expect(atBottom(3, 10, 0)).toBe(true);
  });
});

describe('the atlas', () => {
  it('covers printable ASCII and box drawing', () => {
    const points = atlasCodepoints();
    expect(points).toContain(0x20); // space
    expect(points).toContain(0x7e); // ~
    expect(points).toContain(0x2500); // box drawing light horizontal
    expect(points).toContain(0x2588); // full block
    expect(new Set(points).size).toBe(points.length);
  });

  it('lays out slots left to right, top to bottom', () => {
    expect(slotPosition(0, 16)).toEqual({ col: 0, row: 0 });
    expect(slotPosition(15, 16)).toEqual({ col: 15, row: 0 });
    expect(slotPosition(16, 16)).toEqual({ col: 0, row: 1 });
  });

  it('picks a square-ish column count rather than a long ribbon', () => {
    expect(atlasColumns(256)).toBe(16);
    expect(atlasColumns(250)).toBe(16);
    expect(atlasColumns(1)).toBe(1);
    expect(atlasColumns(0)).toBe(1);
  });
});

describe('drawnCell: the grid is counted at the width it is drawn', () => {
  it('rounds a cell up to whole device pixels, the way the renderer blits it', () => {
    expect(drawnCell({ width: 8.127685546875, height: 16.4 }, 2)).toEqual({ width: 8.5, height: 16.5 });
    expect(drawnCell({ width: 8, height: 16 }, 2)).toEqual({ width: 8, height: 16 });
  });

  /*
   * The bug Chris saw on his phone: the chooser's blurbs cut mid-word at the
   * right edge. Counted with the measured width, 35 columns of 8.13px fit in
   * 286px; drawn at 8.5px each they take 297.5px -- past the safe edge.
   */
  it('never lets a full line of drawn cells run past the space it was counted for', () => {
    for (const [width, cw, scale] of [[286, 8.127685546875, 2], [320, 8.1, 2], [341, 8.127685546875, 2], [398, 8.6, 1.5], [360, 7.2, 3]] as const) {
      const cell = drawnCell({ width: cw, height: 16 }, Math.min(scale, 2));
      const { cols } = gridFor({ width, height: 600, dpr: scale }, cell);
      expect(cols * cell.width, `${width}px at ${cw}`).toBeLessThanOrEqual(width);
    }
  });
});
