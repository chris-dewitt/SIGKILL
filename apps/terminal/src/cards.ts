import { blockWidth, blockWord, frame } from '@sigkill/ascii';
import type { Gauge } from './status.js';

/**
 * The moments: a title when an act opens, and a card when a piece of it closes.
 *
 * Pure, like `status.ts`, so what each one draws is a unit test. Every row is
 * art -- the host writes it through `writeArt`, which clips rather than
 * re-wraps, so nothing here may assume it gets more than the columns it is
 * handed.
 */

/** Two spaces of air either side, so a block word never touches the glass. */
const MARGIN = 2;

/**
 * The game's name, as big as the screen allows, and what it teaches under it.
 *
 * Block capitals when the word fits, otherwise spelled out in a frame.
 * CONTAINMENT is eleven letters and a portrait phone is thirty-four columns;
 * squeezing the tracking to zero was tried and the letters ran into one
 * another, and a title nobody can read is worse than a smaller one.
 */
export function titleRows(title: string, teaches: string, cols: number): string[] {
  const word = title.replace(/^the\s+/i, '').toUpperCase();
  const room = cols - MARGIN * 2;
  let art: string[];
  if (blockWidth(word, 1) <= room) art = blockWord(word, 1);
  else art = frame([[...word].join(' ')], { style: 'double' });
  const wide = Math.max(...art.map((row) => row.length));
  const indent = ' '.repeat(Math.max(0, Math.floor((cols - wide) / 2)));
  const caption = teaches.length > cols ? `${teaches.slice(0, cols - 1)}…` : teaches;
  const captionIndent = ' '.repeat(Math.max(0, Math.floor((cols - caption.length) / 2)));
  return ['', ...art.map((row) => `${indent}${row}`.trimEnd()), '', `${captionIndent}${caption}`, ''];
}

export interface Change {
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/** Gauges that read differently now than they did before, by label. */
export function gaugeChanges(before: readonly Gauge[], after: readonly Gauge[]): Change[] {
  const was = new Map(before.map((gauge) => [gauge.label, gauge.value]));
  return after
    .filter((gauge) => was.has(gauge.label) && was.get(gauge.label) !== gauge.value)
    .map((gauge) => ({ label: gauge.label, from: was.get(gauge.label)!, to: gauge.value }));
}

/**
 * What the player just changed about the place, framed.
 *
 * `CREW  unproven → 4 aboard`. If that will not fit the screen the old value
 * goes first: what it reads now is the news.
 */
export function changeRows(changes: readonly Change[], cols: number): string[] {
  const label = Math.max(...changes.map((change) => change.label.length));
  const inner = cols - 4;
  const rows = changes.map((change) => {
    const head = change.label.padEnd(label);
    const full = `${head}  ${change.from} → ${change.to}`;
    return full.length <= inner ? full : `${head}  ${change.to}`.slice(0, inner);
  });
  return ['', ...frame(rows, { style: 'double' }), ''];
}

/** A completion that changed no gauge still gets its moment, quietly. */
export function ornament(cols: number): string[] {
  const side = Math.max(2, Math.floor((Math.min(cols, 30) - 3) / 2));
  const row = `${'━'.repeat(side)} ◆ ${'━'.repeat(side)}`;
  const indent = ' '.repeat(Math.max(0, Math.floor((cols - row.length) / 2)));
  return ['', `${indent}${row}`, ''];
}
