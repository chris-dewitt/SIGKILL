import type { CrtOptions } from './crt.js';

/**
 * Named tubes, so the look is a choice and not a commit.
 *
 * Same reasoning as the palettes: this is judged by looking at it, moving, on
 * a real screen -- a still cannot show flicker and a description cannot show
 * anything. So they are all here and switchable while the game runs.
 *
 * They are ordered by how broken the hardware is, because that ordering is
 * the point: the ship is dying, and the screen is part of the ship.
 */

/** The shader off entirely. For anybody the motion bothers, and for tests. */
const OFF: CrtOptions = {
  curvature: 0,
  scanline: 0,
  bloom: 0,
  vignette: 0,
  mask: 0,
  flicker: 0,
  grain: 0,
  aberration: 0,
  jitter: 0,
  roll: 0,
  persistenceHalfLife: 1,
};

/** A good tube on a good day. Legible first, atmospheric second. */
const CLEAN: CrtOptions = {
  curvature: 9,
  scanline: 0.14,
  bloom: 0.45,
  vignette: 0.4,
  mask: 0.18,
  flicker: 0,
  grain: 0.03,
  aberration: 0.3,
  jitter: 0,
  roll: 0,
  persistenceHalfLife: 40,
};

/**
 * What a terminal actually looked like. The default.
 *
 * Everything on, nothing broken: a visible grille, real scanlines, phosphor
 * glow, a hint of misconvergence at the edges of white text.
 */
const CLASSIC: CrtOptions = {
  curvature: 6,
  scanline: 0.26,
  bloom: 0.6,
  vignette: 0.55,
  mask: 0.32,
  flicker: 0.25,
  grain: 0.06,
  aberration: 0.6,
  jitter: 0,
  roll: 0.25,
  persistenceHalfLife: 55,
};

/** Eleven years unattended. The picture is still readable and is not well. */
const WORN: CrtOptions = {
  curvature: 4.5,
  scanline: 0.32,
  bloom: 0.7,
  vignette: 0.7,
  mask: 0.4,
  flicker: 0.5,
  grain: 0.14,
  aberration: 1.0,
  jitter: 0.25,
  roll: 0.5,
  persistenceHalfLife: 70,
};

/**
 * Failing. Kept just the right side of unreadable on purpose.
 *
 * This is a place the game can go for a moment -- a power dip, the reactor
 * stumbling -- rather than somewhere to live. Anything past this stops being
 * atmosphere and starts being an accessibility problem.
 */
const FAILING: CrtOptions = {
  curvature: 3.5,
  scanline: 0.38,
  bloom: 0.85,
  vignette: 0.8,
  mask: 0.45,
  flicker: 0.9,
  grain: 0.24,
  aberration: 1.6,
  jitter: 0.7,
  roll: 0.8,
  persistenceHalfLife: 95,
};

export const TUBES = {
  off: OFF,
  clean: CLEAN,
  classic: CLASSIC,
  worn: WORN,
  failing: FAILING,
} as const;

export type TubeName = keyof typeof TUBES;

export const TUBE_NAMES = Object.keys(TUBES) as TubeName[];

export const DEFAULT_TUBE: TubeName = 'classic';

export function tubeByName(name: string | null | undefined): CrtOptions {
  const key = (name ?? '').toLowerCase() as TubeName;
  return TUBES[key] ?? TUBES[DEFAULT_TUBE];
}

/**
 * Bend a tube toward the failing end by how badly the ship is doing.
 *
 * The screen is part of the ship. A player who has not fixed anything is
 * looking at a picture that cannot hold still; every repair steadies it, and
 * by the end of the act the same tube is merely old rather than dying. It is
 * the visual half of what the soundtrack does -- the condition of the world,
 * told without a sentence.
 *
 * Only ever adds instability, never takes the chosen look away: somebody who
 * picked `clean` because flicker bothers them keeps a still picture at every
 * state, which matters more than the effect does.
 */
export function degrade(base: CrtOptions, health: number): CrtOptions {
  const hurt = Math.min(Math.max(1 - health, 0), 1);
  if (hurt <= 0) return base;

  // Scaled by what the preset already asks for, so `clean` (flicker 0, jitter
  // 0) stays perfectly still however broken the ship is.
  const lift = (value: number | undefined, by: number): number =>
    (value ?? 0) + (value ?? 0) * hurt * by;

  return {
    ...base,
    flicker: lift(base.flicker, 1.2),
    jitter: lift(base.jitter, 1.6),
    grain: lift(base.grain, 0.8),
    roll: lift(base.roll, 0.9),
  };
}
