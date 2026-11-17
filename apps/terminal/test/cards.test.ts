import { describe, expect, it } from 'vitest';
import { changeRows, gaugeChanges, ornament, titleRows } from '../src/cards.js';
import { LIBRARY } from '../src/library.js';

describe('the title card', () => {
  it('fits every game in the series on a portrait phone, in block capitals where it can', () => {
    for (const { adventure } of LIBRARY) {
      const rows = titleRows(adventure.title, adventure.teaches, 34);
      for (const row of rows) expect(row.length, `${adventure.title}: ${row}`).toBeLessThanOrEqual(34);
      // Five rows of block capitals, or a three-row frame for a name too long for them.
      const art = rows.filter((row) => row.trim().length > 0 && row.trim() !== adventure.teaches);
      expect(art.length, adventure.title).toBeGreaterThanOrEqual(3);
    }
  });

  it('drops "The" and still says what the game teaches', () => {
    const rows = titleRows('The Archive', 'SQL and data', 34);
    expect(rows.join('\n')).not.toMatch(/THE/);
    expect(rows.some((row) => row.trim() === 'SQL and data')).toBe(true);
  });

  it('spells out a name too long for block capitals, readably, in a frame', () => {
    const rows = titleRows('The Containment', 'Models', 34);
    expect(rows.join('\n')).toContain('C O N T A I N M E N T');
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(34);
  });

  it('frames a name too long for capitals rather than clipping it', () => {
    const rows = titleRows('The Extraordinarily Long', 'x', 20);
    expect(rows.join('\n')).toContain('E X T R A');
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(60);
  });
});

describe('the completion card', () => {
  const before = [
    { label: 'DEWITT', value: 'cargo', tone: 'warn' as const },
    { label: 'CREW', value: 'unproven', tone: 'warn' as const },
  ];

  it('finds only the gauges that moved', () => {
    const after = [before[0]!, { label: 'CREW', value: '4 aboard', tone: 'good' as const }];
    expect(gaugeChanges(before, after)).toEqual([{ label: 'CREW', from: 'unproven', to: '4 aboard' }]);
    expect(gaugeChanges(before, before)).toEqual([]);
    // A gauge that was not on screen before has no "before" to report.
    expect(gaugeChanges([], after)).toEqual([]);
  });

  it('says what changed, framed, and fits a phone', () => {
    const rows = changeRows([{ label: 'CREW', from: 'unproven', to: '4 aboard' }], 34);
    expect(rows.join('\n')).toContain('CREW  unproven → 4 aboard');
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(34);
  });

  it('keeps the news when the whole change will not fit', () => {
    const rows = changeRows([{ label: 'SEQUENCE', from: 'scattered everywhere', to: 'tagged' }], 24);
    expect(rows.join('\n')).toContain('SEQUENCE  tagged');
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(24);
  });

  it('marks a completion that moved no gauge, quietly, inside the screen', () => {
    for (const cols of [20, 34, 80]) {
      const rows = ornament(cols);
      expect(rows.join('')).toContain('◆');
      for (const row of rows) expect(row.length).toBeLessThanOrEqual(cols);
    }
  });
});
