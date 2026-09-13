/**
 * What the ship sounds like, as a function of what state it is in.
 *
 * Deliberately pure and free of Web Audio: this is the part with decisions in
 * it, so it is the part worth testing, and a test should not need an
 * AudioContext to ask "does sealing the hull stop the hiss".
 *
 * The whole design rule is that **the soundscape is the ship's condition**.
 * Nothing here is a backing track. Every layer is something that is or is not
 * happening on the other side of the bulkhead, so a player who fixes something
 * hears the fix -- the same reason `deck` draws from the config files rather
 * than from a picture of them.
 */

/** What the adventure tells the mixer about the world. */
export interface ShipState {
  /** The atmosphere scrubber is running. */
  scrubber: boolean;
  /** The hull monitor is running. */
  monitor: boolean;
  /** At least one compartment is open to vacuum. */
  breached: boolean;
  /** Oxygen reserve, 0..1. Drives how strained the room tone is. */
  reserve: number;
}

export const SILENT_SHIP: ShipState = {
  scrubber: false,
  monitor: false,
  breached: false,
  reserve: 0.09,
};

/** A continuously sounding layer, and how loud it should be right now. */
export interface Layer {
  /** 0..1, before the master gain. */
  gain: number;
  /** Hz, for the layers that are tuned. Ignored by the noise beds. */
  frequency?: number;
}

export type LayerName =
  /** The reactor. The one thing that never stopped, and the floor of the mix. */
  | 'reactor'
  /** Air moving through the scrubber. Absent until the player fixes it. */
  | 'air'
  /** Atmosphere leaving through an open compartment. */
  | 'leak'
  /** The hull monitor's sweep, once per cycle. */
  | 'sweep';

/**
 * The mix for a given state.
 *
 * Every value here is a target, not a jump: the host ramps to it over a second
 * or so, which is what makes starting the scrubber *feel* like a room filling
 * rather than a switch flipping.
 */
export function mixFor(state: ShipState): Record<LayerName, Layer> {
  // A thinner reserve makes the reactor hum sit higher and louder -- the
  // sound of a system working harder than it should have to.
  const strain = 1 - clamp(state.reserve, 0, 1);

  return {
    reactor: { gain: 0.10 + strain * 0.05, frequency: 54 + strain * 8 },
    air: { gain: state.scrubber ? 0.085 : 0, frequency: 220 },
    // The loudest thing in a broken ship, and it has to stay that way even at
    // the thinnest reserve, when the reactor is straining hardest. It is the
    // sound of the problem; it should win until the problem is gone.
    leak: { gain: state.breached ? 0.18 : 0 },
    sweep: { gain: state.monitor ? 0.05 : 0, frequency: 660 },
  };
}

/** Is anything at all sounding? Used to skip work when the mix is silent. */
export function audible(mix: Record<LayerName, Layer>): boolean {
  return Object.values(mix).some((layer) => layer.gain > 0);
}

/**
 * One-shot sounds, named by what happened rather than by what they sound like.
 *
 * Same rule as the palette: a name is a meaning. `resolve` is "a thing the
 * player was working on is now done", and it can be re-synthesised without
 * touching a call site.
 */
export type CueName =
  | 'key'
  | 'submit'
  | 'error'
  | 'resolve'
  | 'act'
  | 'alarm'
  | 'reveal';

export interface Cue {
  /** Partials, as multiples of the base frequency. */
  readonly partials: readonly number[];
  readonly frequency: number;
  /** Seconds. */
  readonly attack: number;
  readonly release: number;
  readonly gain: number;
  /** Semitone slide over the life of the note. Negative falls. */
  readonly bend?: number;
  /** Noise rather than tone: a click, a buzz. */
  readonly noise?: boolean;
  /** A second note, this many seconds later. How a chime becomes a phrase. */
  readonly then?: Cue;
}

const CUES: Record<CueName, Cue> = {
  /** A keypress. Barely there — it is heard a thousand times a session. */
  key: { partials: [1], frequency: 2400, attack: 0.001, release: 0.02, gain: 0.035, noise: true },
  /** Committing a line. Lower and rounder than a keypress, so Enter feels like Enter. */
  submit: { partials: [1, 2], frequency: 320, attack: 0.002, release: 0.08, gain: 0.06 },
  /** Something was refused. Short, flat, not a klaxon. */
  error: { partials: [1, 1.5], frequency: 110, attack: 0.004, release: 0.16, gain: 0.10, bend: -2 },
  /** An objective closed. The only genuinely pleasant sound in the game. */
  resolve: {
    partials: [1, 2, 3],
    frequency: 523.25,
    attack: 0.01,
    release: 0.5,
    gain: 0.08,
    then: { partials: [1, 2, 3], frequency: 783.99, attack: 0.01, release: 0.9, gain: 0.07 },
  },
  /** An act closed. The same shape, further up, and allowed to ring. */
  act: {
    partials: [1, 2, 3, 4],
    frequency: 392,
    attack: 0.02,
    release: 1.2,
    gain: 0.09,
    then: {
      partials: [1, 2, 3, 4],
      frequency: 587.33,
      attack: 0.02,
      release: 2.2,
      gain: 0.08,
    },
  },
  /** The hull alarm. The one sound allowed to be unpleasant. */
  alarm: { partials: [1, 1.02], frequency: 440, attack: 0.005, release: 0.35, gain: 0.11, bend: -12 },
  /** A drawing arriving on screen. A soft tick, so art has a moment. */
  reveal: { partials: [1, 3], frequency: 880, attack: 0.002, release: 0.1, gain: 0.045 },
};

export function cue(name: CueName): Cue {
  return CUES[name];
}

export const CUE_NAMES = Object.keys(CUES) as CueName[];

/** How long a cue occupies the mixer, including anything that follows it. */
export function cueDuration(c: Cue): number {
  const own = c.attack + c.release;
  return c.then === undefined ? own : own + cueDuration(c.then);
}

function clamp(n: number, low: number, high: number): number {
  return Math.min(Math.max(n, low), high);
}
