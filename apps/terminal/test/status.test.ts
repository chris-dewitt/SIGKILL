import { describe, expect, it } from 'vitest';
import { statusRows, type ShipStatus } from '../src/status.js';

const AT_START: ShipStatus = {
  target: 16,
  scrubber: false,
  sealed: 8,
  compartments: 9,
  venting: 0,
  done: 0,
  goals: 5,
  step: 'put O2_TARGET back inside the breathable range',
};

const text = (s: ShipStatus, cols = 34): string[] => statusRows(s, cols).map((line) => line.text);
const kindAt = (s: ShipStatus, needle: string): string | undefined => {
  const [air] = statusRows(s, 34);
  const at = air!.text.indexOf(needle);
  return air!.spans?.find((span) => span.start <= at && span.end > at)?.kind;
};

describe('the status bar', () => {
  it('will not claim there is air just because the number is right', () => {
    // A breathable target the scrubber has refused is not air. It is a file.
    expect(text({ ...AT_START, target: 21, scrubber: false })[0]).toContain('AIR --');
    expect(text({ ...AT_START, target: 21, scrubber: true })[0]).toContain('AIR 21');
  });

  it('counts the compartments, and colours the count by whether they hold', () => {
    expect(text(AT_START)[0]).toContain('HULL 8/9');
    expect(kindAt(AT_START, '8/9')).toBe('warn');
    expect(kindAt({ ...AT_START, sealed: 9 }, '9/9')).toBe('good');
  });

  it('flags a compartment that is shut and emptying anyway', () => {
    const venting = { ...AT_START, sealed: 9, venting: 1 };
    // Nine of nine is true and not the whole truth, so it is not green.
    expect(text(venting)[0]).toContain('HULL 9/9 VENTING');
    expect(kindAt(venting, '9/9 VENTING')).toBe('warn');
  });

  it('says what the player is doing right now', () => {
    expect(text(AT_START)[1]).toBe('▸ put O2_TARGET back inside the b…');
  });

  it('carries the act progress in the rule under it', () => {
    const [, , under] = text(AT_START);
    expect(under).toContain(' 0/5 ');
    expect(under).toMatch(/^─+ \d\/\d ─*$/);
    expect(under).toHaveLength(34);
  });

  it('says so when the act is finished, and only then', () => {
    expect(text({ ...AT_START, done: 5, step: undefined })[1]).toBe('▸ act one complete');
  });

  it('never runs wider than the screen it is given', () => {
    for (const cols of [20, 28, 34, 60]) {
      for (const line of text({ ...AT_START, step: 'a'.repeat(200) }, cols)) {
        expect(line.length, `${cols} cols: ${line}`).toBeLessThanOrEqual(cols);
      }
    }
  });

  it('never wraps: a readout that reflows is a readout that moves', () => {
    for (const line of statusRows(AT_START, 20)) expect(line.nowrap).toBe(true);
  });
});
