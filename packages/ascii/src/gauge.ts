import { GLYPHS } from './glyphs.js';

/**
 * A horizontal bar, to eighth-of-a-cell resolution.
 *
 *     ████████▌░░░░░░  61%
 *
 * The partial block at the head is what makes a fourteen-cell bar able to show
 * the difference between 61% and 65%. Without it a gauge on a phone has about
 * five distinguishable states and stops being information.
 */
export function meter(value: number, max: number, cells: number, empty = '░'): string {
  if (cells <= 0) return '';
  const ratio = max === 0 ? 0 : clamp(value / max, 0, 1);
  const eighths = Math.round(ratio * cells * 8);
  const full = Math.floor(eighths / 8);
  const remainder = eighths % 8;

  let bar = GLYPHS.half.full.repeat(Math.min(full, cells));
  if (remainder > 0 && full < cells) bar += GLYPHS.filling[remainder - 1];
  return bar + empty.repeat(Math.max(0, cells - bar.length));
}

/** An explicit vertical scale for a sparkline. */
export interface Range {
  low: number;
  high: number;
}

/**
 * A one-row sparkline.
 *
 *     ▇▇▆▆▅▅▄▄▃▃▂▂▁▁
 *
 * By default it scales to the range actually present, because the question a
 * log usually asks is "is this changing" and a series that only moves between
 * 96 and 101 is a flat line against an axis at zero.
 *
 * Pass an explicit `range` when several sparklines sit in a column and are
 * meant to be compared. This is not a nicety -- auto-scaling each row
 * independently makes every row fill its full height, so nine compartments of
 * harmless ±0.2 kPa sensor jitter render as violent static while the one that
 * is genuinely losing pressure renders as a calm, tidy slope. The reader draws
 * exactly the wrong conclusion, confidently. A shared axis fixes it.
 *
 * A genuinely flat series draws flat rather than dividing by a zero range.
 */
export function sparkline(
  values: readonly number[],
  cells = values.length,
  range?: Range,
): string {
  if (values.length === 0 || cells <= 0) return '';
  const sampled = resample(values, cells);
  const low = range?.low ?? Math.min(...sampled);
  const high = range?.high ?? Math.max(...sampled);
  const span = high - low;
  const top = GLYPHS.rising.length - 1;

  return sampled
    .map((v) => {
      if (span <= 0) return GLYPHS.rising[0];
      const step = Math.round(((v - low) / span) * top);
      return GLYPHS.rising[clamp(step, 0, top)];
    })
    .join('');
}

/**
 * A labelled readout: name, bar, value.
 *
 *     C7  ████████▌░░░░░  96.1
 *
 * One function rather than three calls at every site, because the alignment is
 * the hard part and it should be got right once.
 */
export function dial(opts: {
  label: string;
  value: number;
  max: number;
  cells: number;
  /** Width reserved for the label, so a column of dials lines up. */
  labelWidth?: number;
  /** Rendered to the right of the bar. Defaults to the value, one decimal. */
  readout?: string;
  empty?: string;
}): string {
  const labelWidth = opts.labelWidth ?? opts.label.length;
  const readout = opts.readout ?? opts.value.toFixed(1);
  const bar = meter(opts.value, opts.max, opts.cells, opts.empty);
  return `${opts.label.padEnd(labelWidth)} ${bar} ${readout}`;
}

/** Pick `cells` evenly spaced samples. Averages within each bucket, so a long series does not lose its spikes to whichever sample happened to land. */
function resample(values: readonly number[], cells: number): number[] {
  if (values.length <= cells) return [...values];
  const out: number[] = [];
  for (let i = 0; i < cells; i++) {
    const start = Math.floor((i * values.length) / cells);
    const end = Math.max(start + 1, Math.floor(((i + 1) * values.length) / cells));
    let sum = 0;
    for (let j = start; j < end; j++) sum += values[j] ?? 0;
    out.push(sum / (end - start));
  }
  return out;
}

function clamp(n: number, low: number, high: number): number {
  return Math.min(Math.max(n, low), high);
}
