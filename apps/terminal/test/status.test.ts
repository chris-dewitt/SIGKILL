import { describe, expect, it } from 'vitest';
import { gaugesOf, statusRows, type ShipStatus } from '../src/status.js';

const AT_START: ShipStatus = {
  place: 'NAV-7 — DECK C',
  target: 16,
  scrubber: false,
  sealed: 8,
  compartments: 9,
  venting: 0,
  done: 0,
  goals: 5,
};

const text = (s: ShipStatus, cols = 34): string[] => statusRows(s, cols).map((line) => line.text);
const kindAt = (s: ShipStatus, needle: string): string | undefined => {
  const row = statusRows(s, 34).find((line) => line.text.includes(needle))!;
  const at = row.text.indexOf(needle);
  return row.spans?.find((span) => span.start <= at && span.end > at)?.kind;
};

describe('the status bar', () => {
  it('says where you are, first', () => {
    expect(text(AT_START)[0]).toBe('NAV-7 — DECK C');
  });

  it('will not claim there is air just because the number is right', () => {
    // A breathable target the scrubber has refused is not air. It is a file.
    expect(text({ ...AT_START, target: 21, scrubber: false })[1]).toContain('AIR --');
    expect(kindAt({ ...AT_START, target: 21, scrubber: false }, '--')).toBe('err');
    expect(text({ ...AT_START, target: 21, scrubber: true })[1]).toContain('AIR 21');
  });

  it('counts the compartments, and colours the count by whether they hold', () => {
    expect(text(AT_START)[1]).toContain('HULL 8/9');
    expect(kindAt(AT_START, '8/9')).toBe('warn');
    expect(kindAt({ ...AT_START, sealed: 9 }, '9/9')).toBe('good');
  });

  it('flags a compartment that is shut and emptying anyway', () => {
    const venting = { ...AT_START, sealed: 9, venting: 1 };
    // Nine of nine is true and not the whole truth, so it is not green.
    expect(text(venting)[1]).toContain('HULL 9/9 VENTING');
    expect(kindAt(venting, '9/9 VENTING')).toBe('warn');
  });

  it("shows an adventure's own conditions, coloured by tone", () => {
    const archive: ShipStatus = {
      place: "FERRYMAN'S REST — ARCHIVE",
      conditions: [
        { label: 'DEWITT', value: 'cargo', tone: 'warn' },
        { label: 'CREW', value: '4 aboard', tone: 'good' },
      ],
      done: 2,
      goals: 7,
    };
    expect(text(archive)[1]).toBe('DEWITT cargo  CREW 4 aboard');
    expect(kindAt(archive, 'cargo')).toBe('warn');
    expect(kindAt(archive, '4 aboard')).toBe('good');
    expect(kindAt(archive, 'DEWITT')).toBe('muted');
  });

  it('is not a checklist: no next step, no count, nothing to tick', () => {
    const all = text(AT_START).join('\n');
    expect(all).not.toMatch(/▸/);
    expect(all).not.toMatch(/\d+\/5/);
  });

  it('lights the rule from the left as the act is put right', () => {
    const lit = (s: ShipStatus): number => (text(s).at(-1)!.match(/━/g) ?? []).length;
    expect(lit(AT_START)).toBe(0);
    expect(lit({ ...AT_START, done: 2 })).toBeGreaterThan(0);
    expect(lit({ ...AT_START, done: 2 })).toBeLessThan(lit({ ...AT_START, done: 4 }));
    expect(lit({ ...AT_START, done: 5 })).toBe(34);
    expect(text({ ...AT_START, done: 2 }).at(-1)).toMatch(/^━+─+$/);
    expect(text(AT_START).at(-1)).toHaveLength(34);
  });

  it('collects every gauge, ship first, for the completion card to compare', () => {
    const labels = gaugesOf({ ...AT_START, conditions: [{ label: 'X', value: 'y', tone: 'quiet' }] }).map((g) => g.label);
    expect(labels).toEqual(['AIR', 'HULL', 'X']);
  });

  it('never runs wider than the screen it is given', () => {
    for (const cols of [20, 28, 34, 60]) {
      for (const line of text({ ...AT_START, place: 'P'.repeat(200) }, cols)) {
        expect(line.length, `${cols} cols: ${line}`).toBeLessThanOrEqual(cols);
      }
    }
  });

  it('never wraps: a readout that reflows is a readout that moves', () => {
    for (const line of statusRows(AT_START, 20)) expect(line.nowrap).toBe(true);
  });
});
