import { ROOT_USER, type Vfs } from '@sigkill/machine';
import {
  SAFE_COLS, caption, centre, dial, frame, grid, sparkline, stack, type Art,
} from '@sigkill/ascii';

/**
 * What the ship can draw of itself.
 *
 * One rule, and it is the same rule the files follow: **art earns its place by
 * carrying information the prose cannot.** A picture of a ship is decoration.
 * A picture of *this* ship, with the compartment the player has not sealed
 * drawn in a broken wall, is the fix made visible -- and when they seal it the
 * drawing changes. That is worth a hundred lines of ORACLE telling them.
 *
 * Everything here is built to `SAFE_COLS` (34) so it survives a portrait
 * phone. The renderer clips art rather than reflowing it, so a wider drawing
 * degrades to a missing right edge instead of confetti -- but the information
 * belongs inside 34 columns, not merely most of it.
 */

/**
 * The axis every pressure sparkline shares.
 *
 * Nominal is 101.3 kPa and the breach bottoms out near 95. Auto-scaling each
 * compartment to its own range instead makes all nine fill the full height --
 * so eight compartments of harmless sensor jitter read as violent static and
 * the one that is actually losing air reads as the calmest row on the panel.
 * A shared axis is the difference between a chart and a lie.
 */
const HULL_SCALE = { low: 95, high: 102 } as const;

/** The physical layout of deck C: three rows of three, bow at the top. */
const DECK_PLAN: ReadonlyArray<readonly string[]> = [
  ['c1', 'c2', 'c3'],
  ['c4', 'c5', 'c6'],
  ['c7', 'c8', 'c9'],
];

export interface Compartment {
  id: string;
  name: string;
  sealed: boolean;
}

/** Read one compartment's configuration. Missing or unreadable reads as open. */
export function readCompartment(vfs: Vfs, id: string): Compartment {
  let conf = '';
  try {
    conf = vfs.readText(`/etc/hull/${id}.conf`, ROOT_USER);
  } catch {
    return { id, name: 'no telemetry', sealed: false };
  }
  return {
    id,
    name: /^\s*NAME\s*=\s*(.+)$/m.exec(conf)?.[1]?.trim() ?? 'unnamed',
    sealed: /^\s*SEALED\s*=\s*yes\s*$/im.test(conf),
  };
}

/**
 * One compartment as a cell.
 *
 * A sealed compartment is a heavy wall around a solid fill; an open one is a
 * dashed wall around nothing. The difference is legible at a glance and needs
 * no key, which is the only reason to draw a map instead of listing nine
 * filenames.
 */
function cell(c: Compartment): string[] {
  const body = c.sealed ? '▓▓▓▓' : '    ';
  return frame([`${c.id.toUpperCase()} ${body}`], {
    style: c.sealed ? 'heavy' : 'broken',
    padding: 0,
  });
}

/**
 * The deck plan, drawn from the configuration files as they are right now.
 *
 * This is the payoff: seal C7 and the wall goes solid. The player's own edit
 * changes the picture, so the abstraction (a line in a config file) and the
 * thing it means (a hole in a spaceship) land in the same place.
 */
export function deckMap(vfs: Vfs): string[] {
  const rows = DECK_PLAN.map((row) => row.map((id) => cell(readCompartment(vfs, id))));
  const open = DECK_PLAN.flat()
    .map((id) => readCompartment(vfs, id))
    .filter((c) => !c.sealed);

  const legend =
    open.length === 0
      ? ['▓ sealed      all nine holding']
      : [
          '▓ sealed   ╎ open to vacuum',
          ...open.map((c) => `  ${c.id.toUpperCase()}: ${c.name}`),
        ];

  return frame(stack([['  bow  ↑'], grid(rows, 1), legend], 1), {
    title: 'DECK C',
    style: 'double',
    cols: SAFE_COLS,
  });
}

/**
 * Pressure, per compartment, from the telemetry the hull monitor writes.
 *
 * A sparkline answers the question a log is actually asked -- *is this
 * changing* -- in one row per compartment, where `grep` answers it in sixty.
 * It does not replace the grep lesson; it is the reward for having done it,
 * and it only exists once the monitor the player repaired is running.
 */
export function pressurePanel(vfs: Vfs, opts: { rows?: number } = {}): string[] {
  const samples = readTelemetry(vfs);
  if (samples.size === 0) return frame(['no telemetry on record'], { title: 'PRESSURE', cols: SAFE_COLS });

  const ids = [...samples.keys()].sort();
  const body = ids.map((id) => {
    const series = samples.get(id) ?? [];
    const latest = series.at(-1) ?? 0;
    // A drop of more than a kilopascal off nominal is the thing worth seeing.
    const flag = latest < 100 ? ' !' : '  ';
    return `${id.padEnd(3)}${sparkline(series, 12, HULL_SCALE)} ${latest.toFixed(1)}${flag}`;
  });

  return frame(stack([body, [`${opts.rows ?? samples.size} compartments, 10 days`]], 1), {
    title: 'PRESSURE',
    cols: SAFE_COLS,
  });
}

/** Parse `TIMESTAMP Cn 101.3kPa STATUS` into a series per compartment. */
function readTelemetry(vfs: Vfs): Map<string, number[]> {
  const series = new Map<string, number[]>();
  let text: string;
  try {
    text = vfs.readText('/var/log/hull.log', ROOT_USER);
  } catch {
    return series;
  }
  for (const line of text.split('\n')) {
    const m = /^\S+\s+(C\d+)\s+(-?\d+(?:\.\d+)?)kPa/.exec(line);
    if (!m) continue;
    const list = series.get(m[1]!) ?? [];
    list.push(Number(m[2]));
    series.set(m[1]!, list);
  }
  return series;
}

/**
 * The reserve gauge for the status line.
 *
 * The cold open prints `O2 reserve ... 9h 14m` as a hardcoded string, which is
 * the kind of number the epilogue is *about* ORACLE having recited off a
 * clipboard. A bar drawn from a value is at least honest about being a value.
 */
export function reserveGauge(percent: number, cols = 14): string {
  return dial({ label: 'O2 reserve', value: percent, max: 100, cells: cols, readout: `${percent}%` });
}

/** A section break, for the act endings. */
export function rule(label: string, cols = SAFE_COLS): string {
  return caption(label, cols);
}

/** Centre a block in the safe width, for a title card. */
export function middle(art: Art): string[] {
  return centre(art, SAFE_COLS);
}
