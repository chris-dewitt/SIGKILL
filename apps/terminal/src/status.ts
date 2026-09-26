import type { Line, LineKind, Span } from '@sigkill/crt';

/** A portrait phone at 13.5px. `packages/ascii` calls the same number SAFE_COLS. */
const NARROW = 34;

/**
 * The two rows pinned to the top of the tube.
 *
 * Act I is a long scroll, and everything a player needs to hold in their head
 * -- is there air, is the hull shut, what am I doing -- was only ever visible
 * by scrolling back or typing `objectives`. A readout that is simply always
 * there is the difference between a game you are playing and a log you are
 * reading.
 *
 * Pure on purpose: it takes numbers and gives back lines, so what it says in
 * each state is a unit test rather than something you have to boot a ship to
 * find out.
 */

/*
 * The readout, for three games instead of one.
 *
 * The air-and-hull row is NAV-7's and nothing else's -- an archive terminal on
 * a planet has no compartments and a tug's galley has no scrubber. So the
 * ship fields became optional and an adventure without them says where it is
 * instead. What stays on every screen is the part that is true everywhere:
 * what you are doing, and how far through you are.
 */
export interface ShipStatus {
  /** O2_TARGET as the controller currently reads it, or null if unreadable. */
  target?: number | null;
  /** Is the scrubber actually running? A good target it refused is not air. */
  scrubber?: boolean;
  sealed?: number;
  /** Present only for an adventure with a hull. Its absence hides the row. */
  compartments?: number;
  /** Compartments shut and losing pressure anyway. */
  venting?: number;
  /**
   * Where this is happening, for an adventure with no ship to read.
   *
   * Not decoration. The top row is the only thing on screen that survives a
   * scroll, and on a phone that matters: two of the three games open on a
   * terminal belonging to somebody else, and which one you are sitting at is
   * the thing a returning player has forgotten.
   */
  place?: string;
  done: number;
  goals: number;
  /** What the player is doing right now, in the questbook's words. */
  step: string | undefined;
}

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
 * Air, hull, what you are doing, and how far through you are.
 *
 * Three rows, and the third is the one that makes it a panel instead of the
 * first two lines of output -- without a rule under it the readout and the
 * ship's own words run together and neither reads. The progress lives in the
 * rule rather than on a row of its own, which is how three rows cost two.
 */
export function statusRows(s: ShipStatus, cols = NARROW): Line[] {
  const air = new Row();
  if (s.compartments === undefined) {
    air.add(s.place ?? '', 'muted');
  } else {
    air.add('AIR ', 'muted');
    // A breathable target the controller has refused is not air, it is a file.
    if (s.scrubber === true && s.target !== null && s.target !== undefined) {
      air.add(String(s.target).padEnd(3), 'good');
    } else {
      air.add('--'.padEnd(3), 'err');
    }

    air.add(' HULL ', 'muted');
    const hull = `${s.sealed}/${s.compartments}`;
    // Shut and emptying anyway is its own state, and the worst one to be quiet
    // about: the count reads nine of nine while the compartment goes down.
    if ((s.venting ?? 0) > 0) air.add(`${hull} VENTING`, 'warn');
    else air.add(hull, s.sealed === s.compartments ? 'good' : 'warn');
  }

  const now = new Row();
  if (s.step === undefined) now.add('▸ ', 'good').add('act one complete', 'good');
  else now.add('▸ ', 'warn').add(s.step, 'system');

  return [air.line('muted', cols), now.line('system', cols), rule(s, cols)];
}

/** The line under it, with the act's progress sitting in the gap. */
function rule(s: ShipStatus, cols: number): Line {
  const count = ` ${s.done}/${s.goals} `;
  const left = Math.max(1, cols - count.length - 3);
  const row = new Row();
  row.add('─'.repeat(left), 'muted');
  row.add(count, s.done === s.goals ? 'good' : 'value');
  row.add('─'.repeat(Math.max(0, cols - left - count.length)), 'muted');
  return row.line('muted', cols);
}
