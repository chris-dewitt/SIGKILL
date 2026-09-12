import { describe, expect, it } from 'vitest';
import { validateObjectives } from '../src/validate.js';
import type { Objective, Rung } from '../src/types.js';

const nudge: Rung = { tier: 'nudge', lines: ['look around'] };
const answer: Rung = { tier: 'command', lines: ['    ls'], command: 'ls' };

const objective = (over: Partial<Objective> = {}): Objective => ({
  id: 'look',
  title: 'Look at the ship',
  done: () => false,
  steps: [{ id: 'only', pending: () => true, rungs: [nudge, answer] }],
  ...over,
});

describe('authored content is checked, not trusted', () => {
  it('passes a well-formed objective', () => {
    expect(validateObjectives([objective()])).toEqual([]);
  });

  it('catches a duplicate id', () => {
    const problems = validateObjectives([objective(), objective()]);
    expect(problems.join('\n')).toContain('duplicate id');
  });

  it('catches an objective with no steps, which could never be hinted', () => {
    expect(validateObjectives([objective({ steps: [] })]).join('\n')).toContain('no steps');
  });

  it('catches a step with no rungs', () => {
    const problems = validateObjectives([
      objective({ steps: [{ id: 'empty', pending: () => true, rungs: [] }] }),
    ]);
    expect(problems.join('\n')).toContain('no rungs');
  });

  it('catches a ladder that never reaches the command', () => {
    const problems = validateObjectives([
      objective({ steps: [{ id: 'coy', pending: () => true, rungs: [nudge] }] }),
    ]);
    expect(problems.join('\n')).toContain('stops before telling them the command');
  });

  it('catches a command rung with no checkable command', () => {
    const problems = validateObjectives([
      objective({
        steps: [{ id: 'prose', pending: () => true, rungs: [{ tier: 'command', lines: ['just do it'] }] }],
      }),
    ]);
    expect(problems.join('\n')).toContain('no `command`');
  });

  it('catches rungs that escalate backwards', () => {
    const problems = validateObjectives([
      objective({
        steps: [{ id: 'backwards', pending: () => true, rungs: [answer, nudge, answer] }],
      }),
    ]);
    expect(problems.join('\n')).toContain('goes backwards');
  });

  // The failure mode that strands exactly one kind of player, which is why it
  // is checked per track rather than over the rung list as a whole.
  it('catches a ladder that ends early for one track only', () => {
    const problems = validateObjectives([
      objective({
        steps: [
          {
            id: 'lopsided',
            pending: () => true,
            rungs: [nudge, { ...answer, track: 'operator' }],
          },
        ],
      }),
    ]);
    expect(problems.join('\n')).toContain('the cadet ladder stops before');
    expect(problems.join('\n')).not.toContain('the operator ladder stops before');
  });

  it('catches a requirement that does not exist', () => {
    const problems = validateObjectives([objective({ requires: ['ghost'] })]);
    expect(problems.join('\n')).toContain('which does not exist');
  });

  it('catches a requirement cycle before it locks the whole game', () => {
    const problems = validateObjectives([
      objective({ id: 'a', requires: ['b'] }),
      objective({ id: 'b', requires: ['a'] }),
    ]);
    expect(problems.join('\n')).toContain('requirement cycle');
  });
});
