import { describe, expect, it } from 'vitest';
import { Machine, ROOT_USER } from '@sigkill/machine';
import { Questbook } from '../src/book.js';
import { questCommands } from '../src/commands.js';
import type { Objective, World } from '../src/types.js';

/** A two-step objective over a filesystem, which is all a World needs to be. */
const OBJECTIVES: readonly Objective[] = [
  {
    id: 'door',
    title: 'Open the door',
    done: (w) => w.vfs.exists('/open', ROOT_USER),
    steps: [
      {
        id: 'find-key',
        label: 'find the key',
        pending: (w) => !w.vfs.exists('/key', ROOT_USER),
        rungs: [
          { tier: 'nudge', lines: ['something is missing'] },
          { tier: 'direction', track: 'cadet', lines: ['a file is a thing you can create'] },
          { tier: 'direction', lines: ['you need a key'] },
          { tier: 'command', lines: ['    touch /key'], command: 'touch /key' },
        ],
      },
      {
        id: 'use-key',
        pending: (w) => !w.vfs.exists('/open', ROOT_USER),
        rungs: [
          { tier: 'nudge', lines: ['you are holding it'] },
          { tier: 'command', lines: ['    touch /open'], command: 'touch /open' },
        ],
      },
    ],
  },
  {
    id: 'leave',
    title: 'Walk out',
    requires: ['door'],
    done: (w) => w.vfs.exists('/gone', ROOT_USER),
    steps: [
      {
        id: 'go',
        pending: () => true,
        rungs: [{ tier: 'command', lines: ['    touch /gone'], command: 'touch /gone' }],
      },
    ],
  },
];

const world = (): World => new Machine({ user: ROOT_USER });
const tiers = (book: Questbook, w: World, times: number): string[] =>
  Array.from({ length: times }, () => {
    const outcome = book.hint(w);
    return outcome.kind === 'hint' ? outcome.tier : outcome.kind;
  });

describe('asking for a hint', () => {
  it('starts with a nudge, not the answer', () => {
    const book = new Questbook(OBJECTIVES);
    const outcome = book.hint(world());
    expect(outcome.kind === 'hint' && outcome.tier).toBe('nudge');
  });

  it('escalates one rung at a time and stops at the command', () => {
    const book = new Questbook(OBJECTIVES);
    const w = world();
    expect(tiers(book, w, 4)).toEqual(['nudge', 'direction', 'command', 'command']);
  });

  it('says when it has nothing further, and keeps repeating rather than refusing', () => {
    const book = new Questbook(OBJECTIVES);
    const w = world();
    book.hint(w);
    book.hint(w);
    const last = book.hint(w);
    const again = book.hint(w);
    expect(last.kind === 'hint' && last.last).toBe(true);
    expect(again.kind === 'hint' && again.repeated).toBe(true);
    expect(again.kind === 'hint' && again.lines).toEqual(last.kind === 'hint' ? last.lines : []);
  });

  it('gives the cadet an extra rung the operator never sees', () => {
    const cadet = new Questbook(OBJECTIVES, { track: 'cadet' });
    expect(tiers(cadet, world(), 4)).toEqual(['nudge', 'direction', 'direction', 'command']);
  });

  // The behaviour that separates a hint from a walkthrough: progress is met
  // with a fresh nudge, not with the answer to the next thing.
  it('drops back to a nudge when the player makes progress', async () => {
    const book = new Questbook(OBJECTIVES);
    const m = new Machine({ user: ROOT_USER });
    expect(tiers(book, m, 3)).toEqual(['nudge', 'direction', 'command']);

    await m.exec('touch /key');
    const next = book.hint(m);
    expect(next.kind === 'hint' && next.step.id).toBe('use-key');
    expect(next.kind === 'hint' && next.tier).toBe('nudge');
  });

  it('moves on once an objective is finished', async () => {
    const book = new Questbook(OBJECTIVES);
    const m = new Machine({ user: ROOT_USER });
    await m.exec('touch /key && touch /open');
    const outcome = book.hint(m);
    expect(outcome.kind === 'hint' && outcome.objective.id).toBe('leave');
  });

  it('has nothing to say when everything is done', async () => {
    const book = new Questbook(OBJECTIVES);
    const m = new Machine({ user: ROOT_USER });
    await m.exec('touch /key && touch /open && touch /gone');
    expect(book.hint(m).kind).toBe('all-done');
  });

  it('refuses a locked objective by name instead of leaking its ladder', () => {
    const book = new Questbook(OBJECTIVES);
    const outcome = book.hint(world(), 'leave');
    expect(outcome.kind).toBe('locked');
    expect(outcome.kind === 'locked' && outcome.blockedBy).toEqual(['door']);
  });

  it('says so for an objective that does not exist', () => {
    expect(new Questbook(OBJECTIVES).hint(world(), 'nope').kind).toBe('unknown');
  });
});

describe('the board', () => {
  it('marks done, open and blocked', async () => {
    const book = new Questbook(OBJECTIVES);
    const m = new Machine({ user: ROOT_USER });

    let rows = book.status(m);
    expect(rows.map((r) => [r.id, r.done, r.blockedBy.length > 0])).toEqual([
      ['door', false, false],
      ['leave', false, true],
    ]);

    await m.exec('touch /key && touch /open');
    rows = book.status(m);
    expect(rows.map((r) => [r.id, r.done, r.blockedBy.length > 0])).toEqual([
      ['door', true, false],
      ['leave', false, false],
    ]);
  });

  it('hides a secret objective until it is unlocked', async () => {
    const secret: Objective = {
      id: 'secret',
      title: 'The thing you were not told about',
      requires: ['door'],
      secret: true,
      done: () => false,
      steps: [{ id: 'a', pending: () => true, rungs: [{ tier: 'command', lines: ['x'], command: 'true' }] }],
    };
    const book = new Questbook([...OBJECTIVES, secret]);
    const m = new Machine({ user: ROOT_USER });
    expect(book.status(m).map((r) => r.id)).not.toContain('secret');

    await m.exec('touch /key && touch /open');
    expect(book.status(m).map((r) => r.id)).toContain('secret');
  });

  it('counts hints so a run that never asked can be recognised', () => {
    const book = new Questbook(OBJECTIVES);
    const w = world();
    expect(book.hintsTaken).toBe(0);
    book.hint(w);
    book.hint(w);
    expect(book.hintsTaken).toBe(2);
    expect(book.status(w).find((r) => r.id === 'door')?.hintsTaken).toBe(2);
  });
});

describe('hint state is save data like any other', () => {
  it('restores exactly where it was', () => {
    const book = new Questbook(OBJECTIVES);
    const w = world();
    book.hint(w);
    book.hint(w);

    const restored = new Questbook(OBJECTIVES);
    restored.restore(book.snapshot());
    expect(restored.hintsTaken).toBe(2);

    // Picks up at the third rung rather than starting the ladder over.
    const outcome = restored.hint(w);
    expect(outcome.kind === 'hint' && outcome.tier).toBe('command');
    expect(restored.hintsTaken).toBe(3);
  });

  it('is deterministic: the same asks give the same hints', () => {
    const a = new Questbook(OBJECTIVES);
    const b = new Questbook(OBJECTIVES);
    expect(tiers(a, world(), 5)).toEqual(tiers(b, world(), 5));
  });
});

describe('the commands', () => {
  const boot = (track: 'cadet' | 'operator' = 'operator'): { m: Machine; book: Questbook } => {
    const book = new Questbook(OBJECTIVES, { track });
    const m = new Machine({ user: ROOT_USER, track, commands: questCommands(book, { speaker: 'ORACLE' }) });
    return { m, book };
  };

  /*
   * The board shows titles rather than ids, because an id is a name for the
   * content and a title is a name for what the player is doing. Ids survive
   * only where they are the thing you would type -- `hint <id>`, and the
   * blocker line.
   */
  it('prints the board in the player\'s words, not the content\'s', async () => {
    const { m } = boot();
    const r = await m.exec('objectives');
    expect(r.stdout).toContain('Open the door');
    expect(r.stdout).toContain('Walk out');
    expect(r.stdout).toContain('[ ] Open the door');
    expect(r.stdout).toContain('[-] Walk out');
    expect(r.stdout).toContain('No hints taken.');
  });

  it('names what is blocking a locked objective, by its title', async () => {
    const { m } = boot();
    const board = (await m.exec('objectives')).stdout;
    expect(board).toContain('locked until: Open the door');
    // `door` is what the content calls it; the player never had to read that.
    expect(board).not.toContain('locked until: door');
  });

  it('marks which objective the player is actually on', async () => {
    const { m } = boot();
    const r = await m.exec('objectives');
    expect(r.stdout).toContain('> [ ] Open the door');
    expect(r.stdout).not.toContain('> [-] Walk out');
  });

  it('says what is in front of them right now, not just where they are going', async () => {
    const { m } = boot();
    expect((await m.exec('objectives')).stdout).toContain('now: find the key');
  });

  it('counts progress', async () => {
    const { m } = boot();
    expect((await m.exec('objectives')).stdout).toContain('0 of 2 done');
    await m.exec('touch /key');
    await m.exec('touch /open');
    expect((await m.exec('objectives')).stdout).toContain('1 of 2 done');
  });

  it('moves the marker along as objectives close', async () => {
    const { m } = boot();
    await m.exec('touch /key');
    await m.exec('touch /open');
    const r = await m.exec('objectives');
    expect(r.stdout).toContain('[x] Open the door');
    expect(r.stdout).toContain('> [ ] Walk out');
  });

  it('offers the way out of being stuck, every time it is asked', async () => {
    const { m } = boot();
    expect((await m.exec('objectives')).stdout).toContain('hint');
  });

  it('stops offering hints once there is nothing left', async () => {
    const { m } = boot();
    for (const c of ['touch /key', 'touch /open', 'touch /gone']) await m.exec(c);
    const r = await m.exec('objectives');
    expect(r.stdout).toContain('Everything on the board is done.');
  });

  it('speaks the hint in the adventure voice', async () => {
    const { m } = boot();
    const r = await m.exec('hint');
    expect(r.stdout).toBe('ORACLE: something is missing\n');
    expect(r.code).toBe(0);
  });

  it('follows the track the machine was booted with', async () => {
    const { m } = boot('cadet');
    await m.exec('hint');
    const r = await m.exec('hint');
    expect(r.stdout).toContain('a file is a thing you can create');
  });

  it('errors on an unknown objective rather than staying silent', async () => {
    const { m } = boot();
    const r = await m.exec('hint nope');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no objective called 'nope'");
  });

  // Content that hints at a state no step claims would otherwise print
  // nothing at all, which reads to a player as a broken command.
  it('names a content bug instead of going quiet', async () => {
    const broken: Objective = {
      id: 'broken',
      title: 'Impossible',
      done: () => false,
      steps: [{ id: 'never', pending: () => false, rungs: [{ tier: 'command', lines: ['x'], command: 'true' }] }],
    };
    const book = new Questbook([broken]);
    const m = new Machine({ user: ROOT_USER, commands: questCommands(book) });
    const r = await m.exec('hint');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('content bug');
  });
});


/**
 * The board shows titles, so titles have to be typeable.
 *
 * Found by Codex: printing only titles left `hint <id>` addressable by a name
 * the player had never been shown, while the unknown-name error pointed them
 * back at the very board that no longer contained it. What is on screen is
 * what you can type, or it is not an address.
 */
describe('asking about a particular objective', () => {
  const boot = (): { m: Machine; book: Questbook } => {
    const book = new Questbook(OBJECTIVES);
    const m = new Machine({ user: ROOT_USER, commands: questCommands(book, { speaker: 'ORACLE' }) });
    return { m, book };
  };

  it('takes the title exactly as the board prints it', async () => {
    const { m } = boot();
    const r = await m.exec('hint Open the door');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ORACLE:');
  });

  it('takes enough of the start of a title to be unambiguous', async () => {
    const { m } = boot();
    expect((await m.exec('hint Open the')).code).toBe(0);
  });

  it('is not case sensitive', async () => {
    const { m } = boot();
    expect((await m.exec('hint open THE DOOR')).code).toBe(0);
  });

  it('still takes the id, for anything that already used one', async () => {
    const { m } = boot();
    expect((await m.exec('hint door')).code).toBe(0);
  });

  it('still respects locks when asked by title', async () => {
    const { m } = boot();
    const r = await m.exec('hint Walk out');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('waiting on');
  });

  it('names what is addressable when the name is wrong', async () => {
    const { m } = boot();
    const r = await m.exec('hint nonsense');
    expect(r.stderr).toContain('hint Open the door');
    expect(r.stderr).toContain('Or just:  hint');
  });

  it('falls back to the current objective for an empty argument', async () => {
    const { m } = boot();
    expect((await m.exec('hint    ')).code).toBe(0);
  });

  it('does not match a title fragment from the middle', async () => {
    // A prefix is a shorthand somebody can predict; a substring match would
    // pick a different objective than the one they meant.
    const { m } = boot();
    expect((await m.exec('hint the door')).code).toBe(1);
  });
});

describe('beats play in the order the story needs them', () => {
  /** A one-step objective satisfied by a file existing. */
  const objective = (id: string, path: string, requires?: string[]): Objective => ({
    id,
    title: id,
    ...(requires ? { requires } : {}),
    done: (w) => w.vfs.exists(path, ROOT_USER),
    steps: [
      {
        id: 'do-it',
        label: `create ${path}`,
        pending: (w) => !w.vfs.exists(path, ROOT_USER),
        rungs: [{ tier: 'command', lines: [`    touch ${path}`], command: `touch ${path}` }],
      },
    ],
  });

  it('holds a finished objective back while it is still blocked, then plays it', () => {
    const book = new Questbook([objective('first', '/a'), objective('second', '/b', ['first'])]);
    const w = world();

    // Solution-agnostic goals mean this is legal: the player satisfied the
    // second objective before the first was even offered to them.
    w.vfs.writeText('/b', '', ROOT_USER);
    expect(book.drainCompleted(w).map((o) => o.id)).toEqual([]);

    w.vfs.writeText('/a', '', ROOT_USER);
    expect(book.drainCompleted(w).map((o) => o.id)).toEqual(['first', 'second']);
    // And exactly once, however it got there.
    expect(book.drainCompleted(w)).toEqual([]);
  });
});
