import { describe, expect, it } from 'vitest';
import { TUBES, TUBE_NAMES, DEFAULT_TUBE, tubeByName, degrade } from '../src/tubes.js';

/** Every knob that is a 0..1 amount. Curvature and half-life are not. */
const AMOUNTS = ['scanline', 'bloom', 'vignette', 'mask', 'flicker', 'grain', 'jitter', 'roll'] as const;

/**
 * A tube is judged by looking at it, so these do not test taste either. They
 * test the things that would make a preset unusable rather than ugly.
 */
describe('every tube', () => {
  it('keeps every amount inside a sane range', () => {
    for (const [name, tube] of Object.entries(TUBES)) {
      for (const key of AMOUNTS) {
        const value = tube[key] ?? 0;
        expect(value, `${name}.${key}`).toBeGreaterThanOrEqual(0);
        expect(value, `${name}.${key}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('never curves so hard the corners eat the text', () => {
    for (const [name, tube] of Object.entries(TUBES)) {
      // Lower is more curved; 0 is off.
      const curve = tube.curvature ?? 0;
      if (curve > 0) expect(curve, `${name}.curvature`).toBeGreaterThan(3);
    }
  });

  it('leaves `off` genuinely off', () => {
    for (const key of AMOUNTS) expect(TUBES.off[key] ?? 0, key).toBe(0);
    expect(TUBES.off.curvature).toBe(0);
  });

  it('holds still on the two calm presets, for anybody the motion bothers', () => {
    for (const name of ['off', 'clean'] as const) {
      expect(TUBES[name].flicker ?? 0, name).toBe(0);
      expect(TUBES[name].jitter ?? 0, name).toBe(0);
      expect(TUBES[name].roll ?? 0, name).toBe(0);
    }
  });

  it('gets steadily more broken down the list', () => {
    // The ordering is the point: it is how the ship's condition is told.
    const order = ['clean', 'classic', 'worn', 'failing'] as const;
    for (let i = 1; i < order.length; i++) {
      const before = TUBES[order[i - 1]!];
      const after = TUBES[order[i]!];
      const instability = (t: typeof before): number =>
        (t.flicker ?? 0) + (t.jitter ?? 0) + (t.grain ?? 0) + (t.roll ?? 0);
      expect(instability(after), `${order[i]} vs ${order[i - 1]}`)
        .toBeGreaterThan(instability(before));
    }
  });

  it('never lets even the worst preset go unreadable', () => {
    // Past this it stops being atmosphere and becomes an accessibility problem.
    expect(TUBES.failing.grain ?? 0).toBeLessThan(0.3);
    expect(TUBES.failing.jitter ?? 0).toBeLessThan(0.8);
    expect(TUBES.failing.scanline ?? 0).toBeLessThan(0.5);
  });

  it('resolves a name and falls back rather than throwing', () => {
    expect(tubeByName('worn')).toBe(TUBES.worn);
    expect(tubeByName('WORN')).toBe(TUBES.worn);
    expect(tubeByName('nonsense')).toBe(TUBES[DEFAULT_TUBE]);
    expect(tubeByName(null)).toBe(TUBES[DEFAULT_TUBE]);
    for (const name of TUBE_NAMES) expect(tubeByName(name)).toBe(TUBES[name]);
  });
});

/**
 * The screen is part of the ship, so its condition shows. This is the visual
 * half of what the soundtrack does.
 */
describe('degradation follows the ship', () => {
  it('leaves a healthy ship exactly as chosen', () => {
    expect(degrade(TUBES.classic, 1)).toEqual(TUBES.classic);
  });

  it('shakes a broken one harder', () => {
    const sick = degrade(TUBES.classic, 0);
    expect(sick.flicker ?? 0).toBeGreaterThan(TUBES.classic.flicker ?? 0);
    expect(sick.jitter ?? 0).toBeGreaterThanOrEqual(TUBES.classic.jitter ?? 0);
    expect(sick.grain ?? 0).toBeGreaterThan(TUBES.classic.grain ?? 0);
  });

  it('steadies as the act is put right', () => {
    const amounts = [0, 0.25, 0.5, 0.75, 1].map((h) => degrade(TUBES.worn, h).flicker ?? 0);
    for (let i = 1; i < amounts.length; i++) {
      expect(amounts[i]!, `health ${i}`).toBeLessThanOrEqual(amounts[i - 1]!);
    }
  });

  it('never adds motion to a preset that chose to have none', () => {
    // Somebody who picked `clean` because flicker bothers them keeps a still
    // picture however badly the ship is doing. That matters more than the
    // effect does.
    const sick = degrade(TUBES.clean, 0);
    expect(sick.flicker ?? 0).toBe(0);
    expect(sick.jitter ?? 0).toBe(0);
    expect(sick.roll ?? 0).toBe(0);
  });

  it('leaves `off` off at every health', () => {
    for (const health of [0, 0.5, 1]) {
      const tube = degrade(TUBES.off, health);
      for (const key of AMOUNTS) expect(tube[key] ?? 0, `${key} at ${health}`).toBe(0);
    }
  });

  it('clamps a health outside 0..1 rather than producing nonsense', () => {
    for (const health of [-5, 2, Number.NaN]) {
      const tube = degrade(TUBES.classic, Number.isNaN(health) ? 0 : health);
      for (const key of AMOUNTS) {
        expect(Number.isFinite(tube[key] ?? 0), `${key} at ${health}`).toBe(true);
      }
    }
  });

  it('does not touch anything but the unstable knobs', () => {
    const sick = degrade(TUBES.classic, 0);
    expect(sick.scanline).toBe(TUBES.classic.scanline);
    expect(sick.mask).toBe(TUBES.classic.mask);
    expect(sick.curvature).toBe(TUBES.classic.curvature);
    expect(sick.persistenceHalfLife).toBe(TUBES.classic.persistenceHalfLife);
  });
});
