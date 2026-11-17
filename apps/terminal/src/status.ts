import type { Line, LineKind, Span } from '@sigkill/crt';

/** A portrait phone at 13.5px. `packages/ascii` calls the same number SAFE_COLS. */
const NARROW = 34;

/**
 * The rows pinned to the top of the tube.
 *
 * They were a checklist: the next step, and a count of steps, above the
 * scrollback for the whole act. Chris played the seven and said they read
 * like a tutorial (2026-10-20), and the checklist was the loudest reason --
 * a game that tells you the next step forever is a course with a story
 * attached.
 *
 * So the top of the screen shows the world instead. Where you are, what
 * condition the place is in, and a rule that lights from the left as it is
 * put right. What to do next is the player's to work out from what is wrong,
 * and `objectives` is one tap away for anybody who wants the board.
 *
 * Pure on purpose: it takes values and gives back lines, so what it says in
 * each state is a unit test rather than something you have to boot a ship to
 * find out.
 */

/** One gauge: a label, what it reads, and how that reads. */
export interface Gauge {
  readonly label: string;
  readonly value: string;
  readonly tone: 'good' | 'warn' | 'bad' | 'quiet';
}

export interface ShipStatus {
  /** O2_TARGET as the controller currently reads it, or null if unreadable. */
  target?: number | null;
  /** Is the scrubber actually running? A good target it refused is not air. */
  scrubber?: boolean;
  sealed?: number;
  /** Present only for an adventure with a hull. */
  compartments?: number;
  /** Compartments shut and losing pressure anyway. */
  venting?: number;
  /**
   * Where this is happening.
   *
   * The top row is the only thing on screen that survives a scroll, and on a
   * phone that matters: six of the seven games open on a terminal belonging
   * to somebody else, and which one you are sitting at is the thing a
   * returning player has forgotten.
   */
  place?: string;
  /** The place's condition, from the adventure. NAV-7's come from the ship. */
  conditions?: readonly Gauge[];
  /** The spine, done and total. Drawn as light in the rule, never as numbers. */
  done: number;
  goals: number;
}

/**
 * NAV-7's two gauges, from the ship.
 *
 * Kept exactly as strict as the old readout: a breathable target the
 * scrubber has refused is not air, it is a file; and nine of nine shut while
 * one empties anyway is true and not the whole truth.
 */
function shipGauges(s: ShipStatus): Gauge[] {
  if (s.compartments === undefined) return [];
  const air: Gauge = s.scrubber === true && s.target !== null && s.target !== undefined
    ? { label: 'AIR', value: String(s.target), tone: 'good' }
    : { label: 'AIR', value: '--', tone: 'bad' };
  const hull = `${s.sealed}/${s.compartments}`;
  const venting = (s.venting ?? 0) > 0;
  return [
    air,
    {
      label: 'HULL',
      value: venting ? `${hull} VENTING` : hull,
      tone: !venting && s.sealed === s.compartments ? 'good' : 'warn',
    },
  ];
}

/** Every gauge on the row, ship first. What the completion card compares. */
export function gaugesOf(s: ShipStatus): Gauge[] {
  return [...shipGauges(s), ...(s.conditions ?? [])];
}

const TONE: Record<Gauge['tone'], LineKind> = { good: 'good', warn: 'warn', bad: 'err', quiet: 'muted' };

/** Builds one line by appending coloured chunks, so offsets are never counted by hand. */
class Row {
  private text = '';
  private readonly spans: Span[] = [];

  add(text: string, kind?: LineKind): this {
    if (kind !== undefined && text.length > 0) {
      this.spans.push({ start: this.text.length, end: this.text.length + text.length, kind });
    }
    this.text += text;
    return this;
  }

  line(kind: LineKind, cols: number): Line {
    const text = this.text.length > cols ? `${this.text.slice(0, Math.max(0, cols - 1))}…` : this.text;
    const spans = this.spans
      .map((span) => ({ ...span, end: Math.min(span.end, text.length) }))
      .filter((span) => span.end > span.start);
    return { text, kind, nowrap: true, ...(spans.length > 0 ? { spans } : {}) };
  }
}

/**
 * The place, its condition, and how far it has been put right.
 *
 * Three rows. The rule is what makes it a panel instead of the first lines
 * of output, and it carries the progress as light: heavy where the act has
 * been put right, thin where it has not, and no numbers anywhere -- a count
 * is a checklist by another name.
 */
export function statusRows(s: ShipStatus, cols = NARROW): Line[] {
  const rows: Line[] = [];
  if (s.place !== undefined) rows.push(new Row().add(s.place, 'muted').line('muted', cols));

  const gauges = gaugesOf(s);
  if (gauges.length > 0) {
    const row = new Row();
    for (const [i, gauge] of gauges.entries()) {
      if (i > 0) row.add('  ');
      row.add(`${gauge.label} `, 'muted').add(gauge.value, TONE[gauge.tone]);
    }
    rows.push(row.line('muted', cols));
  }

  rows.push(rule(s, cols));
  return rows;
}

/** The line under it, lit from the left as the act is put right. */
function rule(s: ShipStatus, cols: number): Line {
  const share = s.goals <= 0 ? 0 : Math.min(1, Math.max(0, s.done / s.goals));
  const lit = Math.round(share * cols);
  const row = new Row();
  row.add('━'.repeat(lit), 'good');
  row.add('─'.repeat(cols - lit), 'muted');
  return row.line('muted', cols);
}
