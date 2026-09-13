import { describe, expect, it } from 'vitest';
import { PALETTES, PALETTE_NAMES, DEFAULT_PALETTE, paletteByName } from '../src/palettes.js';
import { LINE_KINDS } from '../src/buffer.js';

/**
 * A palette is judged by looking at it, so these do not test taste. They test
 * the things that would make a scheme quietly broken rather than ugly.
 */
describe('every palette', () => {
  it('covers every line kind, so nothing falls back to a wrong colour', () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      for (const kind of LINE_KINDS) {
        expect(palette[kind], `${name}.${kind}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
      expect(palette.background, `${name}.background`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('keeps the ground dark, or nothing on it is readable', () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      expect(luminance(palette.background), `${name}`).toBeLessThan(0.08);
    }
  });

  it('separates every foreground from the ground', () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      const ground = luminance(palette.background);
      for (const kind of LINE_KINDS) {
        // `muted` is allowed to be quiet, but never invisible.
        const floor = kind === 'muted' ? 0.06 : 0.18;
        expect(luminance(palette[kind]) - ground, `${name}.${kind}`).toBeGreaterThan(floor);
      }
    }
  });

  it('makes a command stand out from ordinary output', () => {
    /*
     * A stuck player is hunting for the thing they can type, so it has to be
     * findable at a glance.
     *
     * This used to demand it be the *brightest* thing, which stopped being the
     * right question once body text went white on Chris's note that white
     * separates from a green ground better than light green does. Against
     * white prose, hue does the work brightness used to. So: clearly brighter,
     * or clearly a different colour -- and never dim either way.
     */
    for (const [name, palette] of Object.entries(PALETTES)) {
      const brighter = luminance(palette.command) >= luminance(palette.out) - 0.05;
      const different = gap(hue(palette.command), hue(palette.out)) > 25;
      expect(brighter || different, `${name}: command does not stand out from out`).toBe(true);
      expect(luminance(palette.command), `${name}.command is dim`).toBeGreaterThan(0.4);
    }
  });

  it('keeps body text bright, because prose is most of what gets read', () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      expect(luminance(palette.system), `${name}.system`).toBeGreaterThan(0.8);
    }
  });

  it('tints the ground rather than leaving it flat black', () => {
    // Chris, on seeing both: the green ground beats black.
    for (const [name, palette] of Object.entries(PALETTES)) {
      const [r, g, b] = rgb(palette.background);
      expect(r + g + b, `${name}.background is pure black`).toBeGreaterThan(0);
    }
  });

  it('has no pink or magenta anywhere', () => {
    // Asked for by name. A hue where red and blue are both high and green is
    // not is what reads as pink.
    for (const [name, palette] of Object.entries(PALETTES)) {
      for (const kind of LINE_KINDS) {
        const [r, g, b] = rgb(palette[kind]);
        const pink = r > 180 && b > 140 && g < r - 60 && g < b + 40;
        expect(pink, `${name}.${kind} is ${palette[kind]}`).toBe(false);
      }
    }
  });

  it('resolves a name, and falls back rather than throwing', () => {
    expect(paletteByName('warm')).toBe(PALETTES.warm);
    expect(paletteByName('WARM')).toBe(PALETTES.warm);
    expect(paletteByName('nonsense')).toBe(PALETTES[DEFAULT_PALETTE]);
    expect(paletteByName(null)).toBe(PALETTES[DEFAULT_PALETTE]);
    expect(paletteByName(undefined)).toBe(PALETTES[DEFAULT_PALETTE]);
  });

  it('lists every scheme it can resolve', () => {
    for (const name of PALETTE_NAMES) expect(paletteByName(name)).toBe(PALETTES[name]);
    expect(PALETTE_NAMES).toContain(DEFAULT_PALETTE);
  });

  it('gives good, warn and err three distinguishable hues', () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      const hues = [palette.good, palette.warn, palette.err].map(hue);
      expect(gap(hues[0]!, hues[1]!), `${name} good/warn`).toBeGreaterThan(20);
      expect(gap(hues[1]!, hues[2]!), `${name} warn/err`).toBeGreaterThan(20);
    }
  });
});

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Relative luminance, 0..1. Rough but consistent, which is all this needs. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Hue in degrees, 0..360. */
function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

/** Shortest distance between two hues on the circle. */
function gap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
