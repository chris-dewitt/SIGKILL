import type { Palette } from './renderer.js';

/**
 * The named palettes, so the choice is a choice and not a commit.
 *
 * A palette is the one part of this renderer nobody can argue about from the
 * code -- it has to be looked at, on a real screen, by the person whose game
 * it is. So they are all here, switchable at runtime, rather than one being
 * hard-coded because whoever typed it liked it.
 *
 * Every one keeps the same *meanings* (`command` is always "something you
 * could type"), so switching changes nothing but the hues.
 */

/**
 * Two-phosphor: the only two colours a CRT was ever actually sold in.
 *
 * Green for the machine, amber for anything with a person behind it. No blue
 * at all, which is the most historically honest option here and the one that
 * most looks like a thing that existed.
 *
 * The default, and tuned to what Chris said on seeing it run: the ground is
 * green rather than black, and body text is white rather than light green --
 * white separates from a green ground far better than another green does, and
 * the prose is most of what gets read.
 */
const GREEN_AMBER: Palette = {
  background: '#061109',
  out: '#f0fff7',
  system: '#ffffff',
  speaker: '#ffa33d',
  command: '#ffc233',
  path: '#7dffb0',
  value: '#ffe9a3',
  flag: '#e0a458',
  heading: '#ff7a1a',
  good: '#3dff6e',
  warn: '#ffb01f',
  err: '#ff5f56',
  echo: '#ffffff',
  muted: '#4a7a60',
};

/**
 * Warm: green, orange, amber, red, white, and nothing else.
 *
 * Commands are pure white because white is the brightest thing a screen has,
 * and the most actionable thing on it should be the loudest. Everything else
 * steps down through amber and orange.
 */
const WARM: Palette = {
  background: '#061109',
  out: '#eafff2',
  system: '#ffffff',
  speaker: '#ff9f1c',
  command: '#ffd76a',
  path: '#8dffc0',
  value: '#ffe9a3',
  flag: '#e8a33d',
  heading: '#ff8c42',
  good: '#3dff6e',
  warn: '#ffb01f',
  err: '#ff5f56',
  echo: '#ffffff',
  muted: '#4a7a60',
};

/**
 * Ember: amber-dominant, the way an amber monochrome terminal looked, with
 * green kept only for "this is healthy" and red only for "this is not".
 */
const EMBER: Palette = {
  background: '#0a0704',
  out: '#ffb648',
  system: '#ffe8c2',
  speaker: '#ff7b29',
  command: '#ffffff',
  path: '#ffd89b',
  value: '#fff3a8',
  flag: '#d98b3a',
  heading: '#ff6b1a',
  good: '#5fe08a',
  warn: '#ffd166',
  err: '#ff5f56',
  echo: '#ffffff',
  muted: '#7a5c3a',
};

/**
 * Signal: the widest separation available, for maximum legibility.
 *
 * Keeps a cold hue for commands, because a colour no other kind uses is the
 * fastest thing on a screen to find, and commands are what a stuck player is
 * hunting for. No pink anywhere.
 */
const SIGNAL: Palette = {
  background: '#061109',
  out: '#eafff2',
  system: '#ffffff',
  speaker: '#ff9f1c',
  command: '#3ff0ff',
  path: '#8fd3ff',
  value: '#ffe9a3',
  flag: '#e8a33d',
  heading: '#ff8c42',
  good: '#3dff6e',
  warn: '#ffb01f',
  err: '#ff5f56',
  echo: '#ffffff',
  muted: '#4a7a60',
};

export const PALETTES = {
  'green-amber': GREEN_AMBER,
  warm: WARM,
  ember: EMBER,
  signal: SIGNAL,
} as const;

export type PaletteName = keyof typeof PALETTES;

export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[];

/** The one a fresh player gets. Changed by whoever owns the game, not by code. */
export const DEFAULT_PALETTE: PaletteName = 'green-amber';

/** Resolve a name from a URL or a saved preference, falling back to the default. */
export function paletteByName(name: string | null | undefined): Palette {
  const key = (name ?? '').toLowerCase() as PaletteName;
  return PALETTES[key] ?? PALETTES[DEFAULT_PALETTE];
}
