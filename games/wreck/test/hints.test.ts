/**
 * Every rung of every ladder, printed and asserted.
 *
 * The assertions are cheap; the value is that `pnpm --filter @sigkill/wreck
 * exec vitest run hints` prints the whole hint system in order, which is the
 * only way to notice that two rungs say the same thing or that the third one
 * gives away the fourth.
 */
import { describe, expect, it } from 'vitest';
import { bootWreck } from '../src/world.js';
import { WRECK_OBJECTIVES } from '../src/objectives.js';

describe('the ladders', () => {
  for (const track of ['operator', 'cadet'] as const) {
    it(`reads in order on the ${track} track`, async () => {
      const { machine, questbook } = bootWreck({ track });
      const lines: string[] = [];

      // Walk the act, asking for every rung of each step before taking it.
      for (const objective of WRECK_OBJECTIVES) {
        lines.push('', `=== ${objective.id}: ${objective.title} ===`);
        for (const step of objective.steps) {
          const ladder = questbook.ladder(step);
          lines.push('', `--- ${step.id} (${ladder.length} rungs) ---`);
          for (const rung of ladder) {
            lines.push(`[${rung.tier}]`, ...rung.lines.map((l) => `    ${l}`));
            // A rung that says nothing is a rung that strands somebody.
            expect(rung.lines.join('').trim().length, `${step.id}/${rung.tier}`).toBeGreaterThan(20);
          }
          // Clear the step so the next one is the pending one.
          const command = ladder.find((r) => r.tier === 'command')?.command;
          const r = await machine.exec(command!);
          expect(r.stderr, `${step.id}: ${command} -> ${r.stderr}`).toBe('');
          expect(step.pending(machine), `${command} did not clear ${step.id}`).toBe(false);
        }
      }

      expect(questbook.complete(machine), 'the ladders should finish the act').toBe(true);
      process.stdout.write(lines.join('\n') + '\n');
    });
  }

  it('never repeats a whole rung between two steps', () => {
    const seen = new Map<string, string>();
    for (const objective of WRECK_OBJECTIVES) {
      for (const step of objective.steps) {
        for (const rung of step.rungs) {
          const text = rung.lines.join('\n').trim();
          const where = `${objective.id}/${step.id}/${rung.tier}`;
          expect(seen.get(text), `${where} repeats ${seen.get(text)}`).toBeUndefined();
          seen.set(text, where);
        }
      }
    }
  });

  it('keeps the command out of the rungs above it', () => {
    // A nudge that contains the answer is not a nudge, and the escalation
    // stops meaning anything.
    for (const objective of WRECK_OBJECTIVES) {
      for (const step of objective.steps) {
        const answer = step.rungs.find((r) => r.tier === 'command')?.command ?? '';
        // The verb alone is fine; the whole line is the giveaway.
        const whole = answer.replace(/^sudo /, '');
        if (whole.length < 12) continue;
        for (const rung of step.rungs.filter((r) => r.tier === 'nudge')) {
          expect(rung.lines.join('\n'), `${objective.id}/${step.id} nudge`).not.toContain(whole);
        }
      }
    }
  });
});
