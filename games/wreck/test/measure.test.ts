/**
 * How much act there is, measured.
 *
 * Not a test -- a reading tool, like `transcript.test.ts`. Run it with:
 *
 *     pnpm --filter @sigkill/wreck exec vitest run measure  *       --disable-console-intercept
 *
 * The plan asks for "at least 2.5 hours for a curious first-time run". This
 * counts the half of that a machine can count: how many words there are to
 * read and how many objectives there are to finish. It is here to answer
 * "did that edit make the act shorter" and nothing else.
 *
 * It is **not** a playtest and it is not a substitute for one. It cannot see
 * thinking, typing, being wrong, or reading the same error twice -- which in
 * a puzzle game is most of the time -- and it cannot see whether any of it is
 * enjoyable. Reading time is a floor, and a low one.
 */
import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { bootWreck, coldOpen, epilogue } from '../src/world.js';
import { WRECK_OBJECTIVES } from '../src/objectives.js';
import type { BeatLine } from '@sigkill/quest';

const text = (l: readonly BeatLine[]): string =>
  l.map((x) => (typeof x === 'string' ? x : x.art)).join('\n');
const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

describe('measure', () => {
  it('counts what there is to read and do', async () => {
    const w = bootWreck();

    // Everything the ship will say, unprompted.
    let beatWords = words(text(coldOpen(w.machine))) + words(text(epilogue(w.machine)));
    for (const o of WRECK_OBJECTIVES) beatWords += words(text(o.onComplete ?? []));

    // Every hint rung, both tracks. Read only if asked for.
    let hintWords = 0;
    let rungs = 0;
    for (const o of WRECK_OBJECTIVES) {
      for (const s of o.steps) {
        for (const r of s.rungs) { hintWords += words(r.lines.join('\n')); rungs++; }
      }
    }

    // Every readable file the player can find.
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const child of w.machine.vfs.readdir(dir, ROOT_USER)) {
        const path = dir === '/' ? `/${child}` : `${dir}/${child}`;
        try {
          const st = w.machine.vfs.lstat(path, ROOT_USER);
          if (st.kind === 'dir') out.push(...walk(path));
          else if (st.kind === 'file') out.push(path);
        } catch { /* unreadable is a state */ }
      }
      return out;
    };
    const files = walk('/');
    let proseWords = 0;
    let proseFiles = 0;
    let biggest = { path: '', lines: 0 };
    for (const f of files) {
      try {
        const body = w.machine.vfs.readText(f, ROOT_USER);
        const n = body.split('\n').length;
        if (n > biggest.lines) biggest = { path: f, lines: n };
        // Skip the generated telemetry: it is searched, never read.
        if (f === '/var/log/hull.log') continue;
        if (body.length > 0 && /[a-z]/.test(body)) { proseWords += words(body); proseFiles++; }
      } catch { /* ignore */ }
    }

    const required = WRECK_OBJECTIVES.filter((o) => !o.optional).length;
    const optional = WRECK_OBJECTIVES.length - required;

    console.log(`
  objectives         ${required} required + ${optional} optional
  hint rungs         ${rungs} (${hintWords} words, read only if asked)
  spoken beats       ${beatWords} words
  readable files     ${proseFiles} (${proseWords} words)
  largest file       ${biggest.path} at ${biggest.lines} lines
  ---
  reading only       ~${Math.round((beatWords + proseWords) / 200)} min at 200 wpm
  + every hint       ~${Math.round((beatWords + proseWords + hintWords) / 200)} min
`);
    expect(required).toBeGreaterThan(0);
  });
});
