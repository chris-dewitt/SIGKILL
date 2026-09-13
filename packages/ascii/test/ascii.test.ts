import { describe, expect, it } from 'vitest';
import {
  SAFE_COLS, GLYPHS, width, pad, clip, stack, beside, grid, centre, indent,
  frame, caption, meter, sparkline, dial,
} from '../src/index.js';

/**
 * The whole package exists to stop hand-drawn art coming out crooked, so the
 * tests are mostly about rectangularity and about surviving a narrow screen.
 */
describe('layout', () => {
  it('measures the widest row', () => {
    expect(width(['ab', 'abcd', ''])).toBe(4);
  });

  it('pads ragged rows to a rectangle', () => {
    expect(pad(['ab', 'abcd'])).toEqual(['ab  ', 'abcd']);
  });

  it('leaves a row alone that is already wider than the target', () => {
    expect(pad(['abcdef'], 3)).toEqual(['abcdef']);
  });

  it('puts blocks side by side and keeps the right block aligned', () => {
    const out = beside(['ab', 'abcd'], ['X', 'Y'], 1);
    expect(out).toEqual(['ab   X', 'abcd Y']);
  });

  it('pads the shorter block when two blocks differ in height', () => {
    const out = beside(['ab'], ['X', 'Y'], 1);
    expect(out).toEqual(['ab X', '   Y']);
  });

  it('lays out a grid with every cell the same width', () => {
    const out = grid([[['a'], ['bb']], [['ccc'], ['d']]], 1);
    // Every cell padded to 3, the widest in the whole grid.
    expect(out[0]).toBe('a   bb');
    expect(out).toContain('ccc d');
  });

  it('centres without adding trailing spaces', () => {
    expect(centre(['ab'], 6)).toEqual(['  ab']);
  });

  it('does not indent a blank row into whitespace', () => {
    expect(indent(['x', ''], 2)).toEqual(['  x', '']);
  });

  it('clips to a width', () => {
    expect(clip(['abcdef'], 3)).toEqual(['abc']);
  });

  it('stacks with a gap', () => {
    expect(stack([['a'], ['b']], 1)).toEqual(['a', '', 'b']);
  });
});

describe('frame', () => {
  it('closes the box: every row is the same length', () => {
    const out = frame(['short', 'a much longer row']);
    const lengths = new Set(out.map((r) => r.length));
    expect(lengths.size, out.join('\n')).toBe(1);
  });

  it('puts the walls in the corners', () => {
    const out = frame(['x'], { style: 'light' });
    expect(out[0]?.[0]).toBe('┌');
    expect(out[0]?.at(-1)).toBe('┐');
    expect(out.at(-1)?.[0]).toBe('└');
    expect(out.at(-1)?.at(-1)).toBe('┘');
  });

  it('insets a title into the top wall without bursting the box', () => {
    const out = frame(['contents here'], { title: 'C7' });
    expect(out[0]).toContain(' C7 ');
    expect(out[0]?.length).toBe(out[1]?.length);
  });

  it('drops a title that does not fit rather than widening the box', () => {
    const out = frame(['x'], { title: 'A VERY LONG TITLE INDEED' });
    expect(out[0]).not.toContain('LONG');
    expect(out[0]?.length).toBe(out[1]?.length);
  });

  it('honours an explicit width', () => {
    const out = frame(['x'], { cols: 20 });
    expect(out.every((r) => r.length === 20)).toBe(true);
  });

  it('draws a broken wall differently from a heavy one, so a map needs no legend', () => {
    const held = frame(['x'], { style: 'heavy' }).join('');
    const open = frame(['x'], { style: 'broken' }).join('');
    expect(held).not.toBe(open);
    expect(open).toContain('╌');
  });

  it('fits inside the safe width when told to', () => {
    const out = frame(['a'.repeat(100)], { cols: SAFE_COLS });
    expect(out.every((r) => r.length === SAFE_COLS)).toBe(true);
  });
});

describe('caption', () => {
  it('is exactly the width asked for', () => {
    expect(caption('ACT I COMPLETE', 30)).toHaveLength(30);
  });

  it('works with no label at all', () => {
    expect(caption('', 10)).toBe('─'.repeat(10));
  });

  it('does not go negative when the label is longer than the rule', () => {
    expect(caption('a very long label', 4).length).toBeGreaterThan(0);
  });
});

describe('meter', () => {
  it('is exactly the requested number of cells', () => {
    for (const value of [0, 1, 37, 99, 100]) {
      expect(meter(value, 100, 14), `value ${value}`).toHaveLength(14);
    }
  });

  it('is empty at zero and solid at full', () => {
    expect(meter(0, 100, 4)).toBe('░░░░');
    expect(meter(100, 100, 4)).toBe('████');
  });

  it('distinguishes values a whole-cell bar could not', () => {
    // The reason partial blocks exist: at 14 cells these must differ.
    expect(meter(61, 100, 14)).not.toBe(meter(65, 100, 14));
  });

  it('clamps rather than overflowing on a value past the maximum', () => {
    expect(meter(500, 100, 5)).toBe('█████');
  });

  it('does not divide by zero on a zero maximum', () => {
    expect(meter(5, 0, 4)).toBe('░░░░');
  });

  it('returns nothing for zero cells', () => {
    expect(meter(50, 100, 0)).toBe('');
  });
});

describe('sparkline', () => {
  it('is one character per cell', () => {
    expect(sparkline([1, 2, 3, 4], 4)).toHaveLength(4);
  });

  it('draws a rise as a rise', () => {
    const line = sparkline([1, 2, 3, 4, 5], 5);
    expect(line[0]).toBe('▁');
    expect(line.at(-1)).toBe('█');
  });

  it('draws a fall as a fall', () => {
    const line = sparkline([5, 4, 3, 2, 1], 5);
    expect(line[0]).toBe('█');
    expect(line.at(-1)).toBe('▁');
  });

  it('scales to the range present, not to zero', () => {
    // Pressure only ever moves between 96 and 101. Against a zero axis this
    // is a flat line and the log stops being readable.
    const line = sparkline([96, 98, 101], 3);
    expect(new Set(line).size).toBeGreaterThan(1);
  });

  it('draws a genuinely flat series flat instead of dividing by zero', () => {
    expect(sparkline([7, 7, 7], 3)).toBe('▁▁▁');
  });

  it('downsamples a long series to the cells available', () => {
    const many = Array.from({ length: 540 }, (_, i) => i);
    expect(sparkline(many, 20)).toHaveLength(20);
  });

  it('is empty for no values', () => {
    expect(sparkline([], 5)).toBe('');
  });

  /*
   * The bug a shared axis exists to prevent, caught by looking at the render
   * rather than at a test: nine hull compartments, eight of them healthy with
   * a fraction of a kilopascal of sensor jitter, one genuinely losing air.
   * Auto-scaled per row, the eight healthy ones fill the full height and look
   * like an emergency while the failing one looks like the tidiest row on the
   * panel. The reader draws the opposite of the correct conclusion.
   */
  describe('a shared axis', () => {
    const jitter = [101.3, 101.5, 101.2, 101.4, 101.3, 101.5];
    const failing = [99.1, 98.4, 97.6, 96.9, 96.4, 96.1];
    const scale = { low: 95, high: 102 };

    /** How many of the eight levels a row actually occupies. */
    const spread = (line: string): number => {
      const levels = [...line].map((ch) => GLYPHS.rising.indexOf(ch as never));
      return Math.max(...levels) - Math.min(...levels) + 1;
    };

    it('draws harmless jitter as a near-flat line', () => {
      // 0.3 kPa on a 7 kPa axis crosses at most one glyph boundary.
      expect(spread(sparkline(jitter, 6, scale))).toBeLessThanOrEqual(2);
    });

    it('draws that same jitter as full-height static when each row scales to itself', () => {
      // The wrong behaviour, asserted so nobody removes the range argument
      // thinking it is redundant.
      expect(spread(sparkline(jitter, 6))).toBe(GLYPHS.rising.length);
    });

    it('gives the failing row far more vertical range than the healthy one', () => {
      expect(spread(sparkline(failing, 6, scale)))
        .toBeGreaterThan(spread(sparkline(jitter, 6, scale)));
    });

    it('puts a healthy row above a failing row, which is the whole point', () => {
      const healthy = sparkline(jitter, 6, scale);
      const broken = sparkline(failing, 6, scale);
      const height = (ch: string): number => GLYPHS.rising.indexOf(ch as never);
      expect(height(healthy[0]!)).toBeGreaterThan(height(broken[0]!));
    });

    it('still shows the failing row falling', () => {
      const broken = sparkline(failing, 6, scale);
      const height = (ch: string): number => GLYPHS.rising.indexOf(ch as never);
      expect(height(broken[0]!)).toBeGreaterThan(height(broken.at(-1)!));
    });

    it('clamps a value outside the range instead of overflowing the glyph set', () => {
      expect(sparkline([50, 500], 2, scale)).toBe('▁█');
    });

    it('does not divide by zero on an inverted or empty range', () => {
      expect(sparkline([1, 2], 2, { low: 5, high: 5 })).toBe('▁▁');
      expect(sparkline([1, 2], 2, { low: 9, high: 1 })).toBe('▁▁');
    });
  });
});

describe('dial', () => {
  it('aligns a column of readouts', () => {
    const rows = [
      dial({ label: 'C1', value: 101.3, max: 110, cells: 10, labelWidth: 3 }),
      dial({ label: 'C10', value: 96.1, max: 110, cells: 10, labelWidth: 3 }),
    ];
    // The bar starts in the same column on both rows, which is the point.
    expect(rows[0]?.indexOf('█')).toBe(rows[1]?.indexOf('█'));
  });

  it('takes a custom readout', () => {
    expect(dial({ label: 'x', value: 1, max: 2, cells: 4, readout: 'OPEN' })).toContain('OPEN');
  });
});

describe('the glyph vocabulary', () => {
  it('shades run from empty to solid', () => {
    expect(GLYPHS.shades[0]).toBe(' ');
    expect(GLYPHS.shades.at(-1)).toBe('█');
  });

  it('every glyph is one character wide, or the grid stops being a grid', () => {
    const every = [
      ...Object.values(GLYPHS.light), ...Object.values(GLYPHS.double),
      ...Object.values(GLYPHS.heavy), ...Object.values(GLYPHS.broken),
      ...GLYPHS.shades, ...GLYPHS.rising, ...GLYPHS.filling,
      ...Object.values(GLYPHS.half),
    ];
    for (const glyph of every) {
      expect([...glyph], `'${glyph}'`).toHaveLength(1);
    }
  });

  it('stays inside the codepoint ranges the atlas pre-rasterises', () => {
    // Outside these the renderer falls back to fillText -- correct, but a
    // shaping pass per cell per frame, which is the thing the atlas exists
    // to avoid.
    const every = [
      ...Object.values(GLYPHS.light), ...Object.values(GLYPHS.double),
      ...Object.values(GLYPHS.heavy), ...Object.values(GLYPHS.broken),
      ...GLYPHS.shades, ...GLYPHS.rising, ...GLYPHS.filling,
      ...Object.values(GLYPHS.half),
    ];
    for (const glyph of every) {
      const point = glyph.codePointAt(0) ?? 0;
      const known =
        (point >= 0x20 && point <= 0x7e) ||
        (point >= 0x2500 && point <= 0x257f) ||
        (point >= 0x2580 && point <= 0x259f);
      expect(known, `U+${point.toString(16)} '${glyph}' is not in the atlas`).toBe(true);
    }
  });
});
