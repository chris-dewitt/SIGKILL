import { describe, expect, it } from 'vitest';
import { unbend, wordAt } from '../src/hit.js';

/**
 * Tapping a word: the arithmetic from a fingertip back to the text.
 */

describe('tracing a tap back through the barrel', () => {
  it('leaves the centre and a flat screen alone', () => {
    expect(unbend(0.5, 0.5, 6)).toEqual({ u: 0.5, v: 0.5 });
    expect(unbend(0.1, 0.9, 0)).toEqual({ u: 0.1, v: 0.9 });
  });

  it('finds the content of a corner further out than the corner, as the shader draws it', () => {
    const corner = unbend(0.05, 0.05, 6);
    expect(corner.u).toBeLessThan(0.05);
    expect(corner.v).toBeLessThan(0.05);
    // Symmetric: the opposite corner moves just as far the other way.
    const opposite = unbend(0.95, 0.95, 6);
    expect(opposite.u).toBeCloseTo(1 - corner.u, 10);
  });

  it('bends nothing along the axes through the middle', () => {
    expect(unbend(0.2, 0.5, 6).u).toBeCloseTo(0.2, 10);
    expect(unbend(0.5, 0.8, 6).v).toBeCloseTo(0.8, 10);
  });
});

describe('the word under a finger', () => {
  const at = (text: string, word: string): string | undefined => wordAt(text, text.indexOf(word) + 1);

  it('keeps paths, units, addresses and ids whole', () => {
    expect(at('see /srv/triage/queue for the rest', '/srv')).toBe('/srv/triage/queue');
    expect(at('● nav-7.service - failed', 'nav')).toBe('nav-7.service');
    expect(at('ferryman 10.40.0.14 up', '10.')).toBe('10.40.0.14');
    expect(at('filing F-7701 account', 'F-7')).toBe('F-7701');
    expect(at('O2_TARGET=21', 'O2')).toBe('O2_TARGET=21');
  });

  it('drops what the sentence put around it', () => {
    expect(at('Read the manifest.', 'manifest')).toBe('manifest');
    expect(at('Missing: (the account)', 'account')).toBe('account');
    expect(at('"claims.db",', 'claims')).toBe('claims.db');
  });

  it('cuts one cell out of a table row', () => {
    expect(at('7712|vasquez|engineering', 'vasquez')).toBe('vasquez');
    expect(at('│ crew    │ 4 │', 'crew')).toBe('crew');
  });

  it('gives nothing for space, rules, punctuation or a prompt', () => {
    expect(wordAt('a  b', 1)).toBeUndefined();
    expect(at('──────', '──')).toBeUndefined();
    expect(at('dewitt@ferryman:~$ ls', 'dewitt')).toBeUndefined();
    expect(wordAt('ab', 5)).toBeUndefined();
  });
});
