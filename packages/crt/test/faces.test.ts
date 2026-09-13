import { describe, expect, it } from 'vitest';
import { LINE_KINDS } from '../src/buffer.js';
import { LINE_FACES, faceFont } from '../src/faces.js';

describe('line faces', () => {
  it('gives every LineKind a face, so a new kind cannot ship unstyled', () => {
    for (const kind of LINE_KINDS) {
      expect(LINE_FACES[kind], kind).toBeDefined();
    }
  });

  it('makes the echoed command and the speaker heavier than body text', () => {
    expect(LINE_FACES.echo.weight).toBeGreaterThan(LINE_FACES.out.weight);
    expect(LINE_FACES.speaker.weight).toBeGreaterThan(LINE_FACES.system.weight);
  });

  it('puts errors and flags in italic, and leaves body text upright', () => {
    expect(LINE_FACES.err.italic).toBe(true);
    expect(LINE_FACES.flag.italic).toBe(true);
    expect(LINE_FACES.out.italic).toBe(false);
  });

  it('prefixes the base font with style and weight', () => {
    expect(faceFont('13.5px "IBM Plex Mono", monospace', 'echo')).toBe(
      'normal 700 13.5px "IBM Plex Mono", monospace',
    );
    expect(faceFont('13.5px "IBM Plex Mono", monospace', 'err')).toBe(
      'italic 400 13.5px "IBM Plex Mono", monospace',
    );
  });
});
