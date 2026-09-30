import { describe, expect, it } from 'vitest';
import {
  buildDataset,
  metrics,
  CREWED_FOUND,
  CREWED_IN_TEST,
  LEAKED,
  TEST_ROWS,
} from '../src/act1/dataset.js';

/**
 * The act's arithmetic, asserted.
 *
 * Every objective from four to nine is the player computing one of these in
 * Python. If a number here is not what the beats claim, the objective built on
 * it is unsatisfiable and the failure would show up as a puzzle that cannot be
 * solved rather than as a test that goes red.
 */
describe('the numbers the act turns on', () => {
  const d = buildDataset();
  const m = metrics(d);

  it('is the size the vendor said', () => {
    expect(d.test).toHaveLength(TEST_ROWS);
    expect(d.test.filter((r) => r.truth === 'crewed')).toHaveLength(CREWED_IN_TEST);
  });

  it('scores 99.2%, which is the number in three filings', () => {
    expect(m.accuracy * 100).toBeCloseTo(99.2, 6);
  });

  it('has a base rate of 98.8%, which is what "always abandoned" would score', () => {
    expect(m.baseRate * 100).toBeCloseTo(98.8, 6);
  });

  it('beats the base rate by four tenths of a point, and that is the whole act', () => {
    expect((m.accuracy - m.baseRate) * 100).toBeCloseTo(0.4, 6);
  });

  it('leaks exactly 41 records across the split', () => {
    expect(m.leaked).toBe(LEAKED);
  });

  it('finds two of six crewed vessels, and both are leaked', () => {
    expect(m.crewedFound).toBe(CREWED_FOUND);
    expect(m.crewedRecall).toBeCloseTo(2 / 6, 6);

    const trainIds = new Set(d.train.map((r) => r.id));
    const foundIds = d.scored
      .filter((s) => s.truth === 'crewed' && s.predicted === 'crewed')
      .map((s) => s.id);
    expect(foundIds).toHaveLength(2);
    for (const id of foundIds) {
      expect(trainIds.has(id), `${id} should be a memorised row`).toBe(true);
    }
  });

  it('finds none at all once the leaked rows are removed', () => {
    const trainIds = new Set(d.train.map((r) => r.id));
    const clean = d.scored.filter((s) => !trainIds.has(s.id));
    const crewed = clean.filter((s) => s.truth === 'crewed');
    expect(crewed.length).toBeGreaterThan(0);
    expect(crewed.filter((s) => s.predicted === 'crewed')).toHaveLength(0);
  });

  it('is more confident on its errors than it has any right to be', () => {
    expect(m.meanConfidenceWhenWrong).toBeGreaterThan(0.96);
    expect(m.meanConfidenceWhenWrong).toBeLessThan(0.99);
  });

  it('collapses to about 61% once the classes are balanced', () => {
    expect(m.balancedAccuracy * 100).toBeGreaterThan(55);
    expect(m.balancedAccuracy * 100).toBeLessThan(70);
  });

  it("has NAV-7's own row say nothing about the four people aboard", () => {
    expect(d.nav7.truth).toBe('crewed');
    expect(d.nav7.grant).toBe('PRIV-7');
    expect(Object.keys(d.nav7)).not.toContain('crew');
  });

  it('is the same dataset on every boot, to the last digit of confidence', () => {
    expect(JSON.stringify(buildDataset())).toBe(JSON.stringify(buildDataset()));
  });
});
