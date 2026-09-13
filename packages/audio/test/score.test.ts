import { describe, expect, it } from 'vitest';
import {
  mixFor, audible, cue, cueDuration, CUE_NAMES, SILENT_SHIP, type ShipState,
} from '../src/index.js';

const ship = (over: Partial<ShipState> = {}): ShipState => ({ ...SILENT_SHIP, ...over });

/**
 * The design rule, asserted: **the soundscape is the ship's condition.**
 * Nothing here is a backing track, so every one of these is really a question
 * about the world — does fixing this thing change what you hear.
 */
describe('the mix follows the ship', () => {
  it('starts with the reactor and nothing else', () => {
    const mix = mixFor(ship());
    expect(mix.reactor.gain).toBeGreaterThan(0);
    expect(mix.air.gain).toBe(0);
    expect(mix.sweep.gain).toBe(0);
  });

  it('adds moving air when the scrubber runs', () => {
    expect(mixFor(ship({ scrubber: true })).air.gain).toBeGreaterThan(0);
  });

  it('takes the air away again if it stops', () => {
    expect(mixFor(ship({ scrubber: false })).air.gain).toBe(0);
  });

  it('hisses while a compartment is open', () => {
    expect(mixFor(ship({ breached: true })).leak.gain).toBeGreaterThan(0);
  });

  it('stops hissing the moment it is sealed', () => {
    // The whole point: the player hears the fix, not a notification about it.
    expect(mixFor(ship({ breached: false })).leak.gain).toBe(0);
  });

  it('makes the leak the loudest thing in a broken ship', () => {
    const mix = mixFor(ship({ breached: true, scrubber: true, monitor: true }));
    const others = [mix.reactor.gain, mix.air.gain, mix.sweep.gain];
    for (const gain of others) expect(mix.leak.gain).toBeGreaterThan(gain);
  });

  it('sweeps only while the monitor is running', () => {
    expect(mixFor(ship({ monitor: false })).sweep.gain).toBe(0);
    expect(mixFor(ship({ monitor: true })).sweep.gain).toBeGreaterThan(0);
  });

  it('strains the reactor as the reserve thins', () => {
    const thin = mixFor(ship({ reserve: 0.05 }));
    const full = mixFor(ship({ reserve: 1 }));
    expect(thin.reactor.gain).toBeGreaterThan(full.reactor.gain);
    expect(thin.reactor.frequency ?? 0).toBeGreaterThan(full.reactor.frequency ?? 0);
  });

  it('clamps a reserve outside 0..1 rather than producing nonsense', () => {
    for (const reserve of [-3, 0, 1, 9]) {
      const mix = mixFor(ship({ reserve }));
      expect(mix.reactor.gain).toBeGreaterThan(0);
      expect(mix.reactor.gain).toBeLessThan(1);
      expect(Number.isFinite(mix.reactor.frequency ?? NaN)).toBe(true);
    }
  });

  it('never asks for a gain outside the mixer', () => {
    for (const s of [
      ship(), ship({ scrubber: true }), ship({ breached: true, monitor: true }),
      ship({ scrubber: true, monitor: true, breached: false, reserve: 1 }),
    ]) {
      for (const [name, layer] of Object.entries(mixFor(s))) {
        expect(layer.gain, name).toBeGreaterThanOrEqual(0);
        expect(layer.gain, name).toBeLessThanOrEqual(1);
      }
    }
  });

  it('knows when it is silent', () => {
    expect(audible(mixFor(ship()))).toBe(true);
    expect(audible({
      reactor: { gain: 0 }, air: { gain: 0 }, leak: { gain: 0 }, sweep: { gain: 0 },
    })).toBe(false);
  });

  /*
   * The act, as a sequence of states. What matters is that each fix *changes*
   * the room — a repair the player cannot hear is a repair the audio is not
   * doing its job for.
   */
  it('sounds different at every step of the act', () => {
    const act: ShipState[] = [
      ship({ breached: true }),
      ship({ breached: true, scrubber: true }),
      ship({ breached: true, scrubber: true, monitor: true }),
      ship({ breached: false, scrubber: true, monitor: true, reserve: 0.4 }),
    ];
    const heard = act.map((s) => JSON.stringify(mixFor(s)));
    expect(new Set(heard).size, 'every step should sound different').toBe(act.length);
  });
});

describe('cues', () => {
  it('has every cue it names', () => {
    for (const name of CUE_NAMES) expect(cue(name)).toBeDefined();
  });

  it('gives every cue a real envelope', () => {
    for (const name of CUE_NAMES) {
      const c = cue(name);
      expect(c.attack, name).toBeGreaterThan(0);
      expect(c.release, name).toBeGreaterThan(0);
      expect(c.gain, name).toBeGreaterThan(0);
      expect(c.gain, name).toBeLessThanOrEqual(0.2);
      expect(c.frequency, name).toBeGreaterThan(20);
      expect(c.partials.length, name).toBeGreaterThan(0);
    }
  });

  it('keeps the keypress quieter than anything else', () => {
    // It is heard a thousand times a session. Everything else is an event.
    const key = cue('key').gain;
    for (const name of CUE_NAMES.filter((n) => n !== 'key')) {
      expect(cue(name).gain, name).toBeGreaterThan(key);
    }
  });

  it('makes finishing an act ring longer than finishing an objective', () => {
    expect(cueDuration(cue('act'))).toBeGreaterThan(cueDuration(cue('resolve')));
  });

  it('makes the good news a phrase and the bad news a single note', () => {
    expect(cue('resolve').then).toBeDefined();
    expect(cue('act').then).toBeDefined();
    expect(cue('error').then).toBeUndefined();
  });

  it('keeps every cue short enough not to overlap the next command', () => {
    for (const name of CUE_NAMES) {
      expect(cueDuration(cue(name)), name).toBeLessThan(6);
    }
  });

  it('bends the alarm down, which is what makes it read as bad', () => {
    expect(cue('alarm').bend ?? 0).toBeLessThan(0);
    expect(cue('error').bend ?? 0).toBeLessThan(0);
    expect(cue('resolve').bend ?? 0).toBe(0);
  });
});
