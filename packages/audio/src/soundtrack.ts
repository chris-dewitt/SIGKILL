import {
  audible, cue, mixFor, SILENT_SHIP,
  type Cue, type CueName, type LayerName, type ShipState,
} from './score.js';

/**
 * The ship, sounding.
 *
 * Every sample is synthesised: oscillators, filtered noise, and envelopes.
 * There is not one audio file, which is not a flourish -- it is the same
 * constraint the rest of this engine runs under. Nothing is fetched, so
 * nothing can be tracked, nothing has to be licensed, and thirteen games ship
 * a soundtrack for zero kilobytes.
 *
 * The mixer is a thin layer over `score.ts`, which holds every decision. This
 * file only knows how to make a number audible.
 */

const RAMP = 1.4;

export interface SoundtrackOptions {
  /** Master gain, 0..1. */
  volume?: number;
  /** Start muted. The player's saved preference, if they have one. */
  muted?: boolean;
}

export class Soundtrack {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private layers = new Map<LayerName, { gain: GainNode; stop: () => void }>();
  private noise: AudioBuffer | undefined;
  private state: ShipState = SILENT_SHIP;
  private volume: number;
  private off: boolean;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: SoundtrackOptions = {}) {
    this.volume = opts.volume ?? 0.6;
    this.off = opts.muted ?? false;
  }

  get muted(): boolean {
    return this.off;
  }

  /** Has the browser actually let us make sound yet? */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /**
   * Begin, or resume after the browser suspended us.
   *
   * Must be called from inside a user gesture: every browser refuses to start
   * an AudioContext otherwise, and rightly -- a page that makes noise before
   * you touch it is a page you close. The host calls this on the first
   * keypress or tap and it is a no-op every time after.
   */
  async resume(): Promise<void> {
    if (this.off) return;
    if (this.ctx === undefined) this.build();
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
    this.apply();
  }

  setMuted(muted: boolean): void {
    this.off = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
    if (muted) this.stopSweep();
    else this.startSweep();
  }

  setVolume(volume: number): void {
    this.volume = Math.min(Math.max(volume, 0), 1);
    if (this.master && this.ctx && !this.off) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  /**
   * Tell the mixer what the ship is doing.
   *
   * Ramped rather than switched, over more than a second: starting the
   * scrubber should feel like a room filling, and sealing a compartment should
   * feel like a sound going away, not like a mute button.
   */
  setState(state: ShipState): void {
    this.state = state;
    this.apply();
  }

  /** Play a one-shot. Silently does nothing before the first gesture. */
  play(name: CueName): void {
    if (this.off || this.ctx === undefined || this.master === undefined) return;
    this.schedule(cue(name), this.ctx.currentTime);
  }

  /** Release everything. The host calls this if it tears the terminal down. */
  close(): void {
    this.stopSweep();
    for (const layer of this.layers.values()) layer.stop();
    this.layers.clear();
    void this.ctx?.close();
    this.ctx = undefined;
    this.master = undefined;
  }

  // ------------------------------------------------------------------ guts

  private build(): void {
    const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.off ? 0 : this.volume;
    this.master.connect(ctx.destination);

    this.noise = pinkNoise(ctx);
    this.startSweep();
  }

  /** Move every layer toward the mix the current state calls for. */
  private apply(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const mix = mixFor(this.state);
    if (!audible(mix) && this.layers.size === 0) return;

    for (const [name, target] of Object.entries(mix) as Array<[LayerName, { gain: number; frequency?: number }]>) {
      const existing = this.layers.get(name);
      if (target.gain <= 0) {
        // Fade out and then release, rather than stopping on the spot: a leak
        // that cuts dead reads as a bug, and a leak that fades reads as a
        // hatch closing.
        if (existing) {
          existing.gain.gain.setTargetAtTime(0, ctx.currentTime, RAMP / 3);
          const stop = existing.stop;
          this.layers.delete(name);
          setTimeout(stop, RAMP * 1000 * 2);
        }
        continue;
      }

      if (existing) {
        existing.gain.gain.setTargetAtTime(target.gain, ctx.currentTime, RAMP / 3);
        continue;
      }
      const started = this.startLayer(name, target.frequency ?? 110);
      if (started) {
        started.gain.gain.setValueAtTime(0, ctx.currentTime);
        started.gain.gain.setTargetAtTime(target.gain, ctx.currentTime, RAMP / 3);
        this.layers.set(name, started);
      }
    }
  }

  private startLayer(name: LayerName, frequency: number): { gain: GainNode; stop: () => void } | undefined {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return undefined;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);

    if (name === 'leak' || name === 'air') {
      // Both are moving air; they differ in where the energy sits. The leak is
      // a thin hiss through a gap, the scrubber is a broad wash through a duct.
      const source = ctx.createBufferSource();
      source.buffer = this.noise ?? null;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      if (name === 'leak') {
        filter.type = 'bandpass';
        filter.frequency.value = 3200;
        filter.Q.value = 1.6;
      } else {
        filter.type = 'lowpass';
        filter.frequency.value = 700;
      }
      source.connect(filter).connect(gain);
      source.start();
      return { gain, stop: () => { try { source.stop(); } catch { /* already stopped */ } } };
    }

    // Two oscillators a hair apart: the beating between them is what stops a
    // held tone sounding like a test signal.
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.type = name === 'reactor' ? 'sawtooth' : 'sine';
    b.type = 'sine';
    a.frequency.value = frequency;
    b.frequency.value = frequency * 1.006;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = name === 'reactor' ? 220 : 1800;

    a.connect(filter);
    b.connect(filter);
    filter.connect(gain);
    a.start();
    b.start();
    return {
      gain,
      stop: () => {
        try { a.stop(); b.stop(); } catch { /* already stopped */ }
      },
    };
  }

  /** The hull monitor's periodic blip, while it is running. */
  private startSweep(): void {
    this.stopSweep();
    this.sweepTimer = setInterval(() => {
      if (this.off || !this.state.monitor || this.ctx === undefined) return;
      this.schedule(
        { partials: [1], frequency: 1320, attack: 0.002, release: 0.06, gain: 0.02 },
        this.ctx.currentTime,
      );
    }, 6000);
  }

  private stopSweep(): void {
    if (this.sweepTimer !== undefined) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  /** Synthesise one cue at a time, following any note chained after it. */
  private schedule(c: Cue, at: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(c.gain, at + c.attack);
    // Exponential rather than linear: a linear fade sounds like it stops, an
    // exponential one sounds like it ends.
    gain.gain.exponentialRampToValueAtTime(0.0001, at + c.attack + c.release);
    gain.connect(master);

    const ends = at + c.attack + c.release;

    if (c.noise === true) {
      const source = ctx.createBufferSource();
      source.buffer = this.noise ?? null;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = c.frequency;
      source.connect(filter).connect(gain);
      source.start(at);
      source.stop(ends);
    } else {
      for (const partial of c.partials) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const f = c.frequency * partial;
        osc.frequency.setValueAtTime(f, at);
        if (c.bend !== undefined) {
          osc.frequency.exponentialRampToValueAtTime(f * Math.pow(2, c.bend / 12), ends);
        }
        // Higher partials quieter, or the chord is a siren.
        const voice = ctx.createGain();
        voice.gain.value = 1 / (partial * 1.6);
        osc.connect(voice).connect(gain);
        osc.start(at);
        osc.stop(ends);
      }
    }

    if (c.then !== undefined) this.schedule(c.then, ends * 0.82 + at * 0.18);
  }
}

/**
 * A second of pink-ish noise, generated once and looped.
 *
 * Pink rather than white because white noise is all treble and sounds like a
 * broken speaker; pink has the spectral tilt that reads as air, machinery and
 * rooms. Generated with a fixed sequence so it is the same every run.
 */
function pinkNoise(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  // A small LCG, so the noise is identical on every machine and every run --
  // the same reason the hull telemetry is not built from Math.random.
  let seed = 0x9e37 >>> 0;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000 - 0.5;
  };

  // Voss-McCartney, abbreviated: a few octave-spaced random walks summed.
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = random();
    b0 = 0.99765 * b0 + white * 0.0990460;
    b1 = 0.96300 * b1 + white * 0.2965164;
    b2 = 0.57000 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.32;
  }
  return buffer;
}
