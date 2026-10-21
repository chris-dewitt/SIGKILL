import { ROOT_USER, type CommandSpec } from '@sigkill/machine';
import type { AdventureSession } from './adventure.js';
import type { BeatLine } from './types.js';

export interface CompanionOptions {
  speaker: string;
  topics: Readonly<Record<string, readonly string[]>>;
  /** Brief reactions to progress within an objective, never unsolicited solutions. */
  asides?: Readonly<Record<string, string>>;
}

/** Authored conversations and state-driven, once-per-objective interjections. */
export function withCompanion<T extends AdventureSession>(session: T, options: CompanionOptions): T & AdventureSession {
  const { machine, questbook } = session;
  const said = (id: string): string => `aside:${id}`;
  /*
   * Saves from before the memory moved into the questbook kept it as a file
   * in the player's own filesystem. Read it once, carry it over, and take the
   * file away -- it was bookkeeping that a curious player could find and edit.
   */
  const legacy = '/var/lib/sigkill/companion.json';
  try {
    const saved: unknown = JSON.parse(machine.vfs.readText(legacy, ROOT_USER));
    if (Array.isArray(saved)) {
      for (const id of saved) if (typeof id === 'string') questbook.remember(said(id));
    }
    machine.vfs.unlink(legacy, ROOT_USER);
    try { machine.vfs.rmdir('/var/lib/sigkill', ROOT_USER); } catch { /* Not empty, or not ours. */ }
  } catch { /* No legacy memory, which is every run since. */ }
  const progress = () => {
    const objective = questbook.current(machine);
    return { id: objective?.id, step: objective && questbook.step(machine, objective)?.id };
  };
  let previous = progress();
  let talked = false;
  let quietTurns = 0;
  const speak = (lines: readonly string[]) => lines.map(line => `${options.speaker}: ${line}`);
  const talk: CommandSpec = {
    name: 'talk', summary: `talk with ${options.speaker.toLowerCase()}`,
    manual: 'talk [work | topic]\n\nAsk about the current task or a listed topic. Authored local dialogue; no network. Use hint for progressively more specific help.',
    plain: 'Talk without leaving the terminal. talk lists topics. talk work asks about the current task. hint gives more help.',
    run: (_ctx, argv, io) => {
      talked = true;
      const topic = argv.slice(1).join(' ').toLowerCase().trim();
      if (!topic || topic === 'help') {
        io.out(speak([`Here. Ask about work, ${Object.keys(options.topics).join(', ')}.`]).join('\n') + '\n');
        return 0;
      }
      if (topic === 'work') {
        const objective = questbook.current(machine);
        const step = objective && questbook.step(machine, objective);
        io.out(speak([step?.label ?? objective?.title ?? 'The required work is done. We can stay a while.']).join('\n') + '\n');
        return 0;
      }
      const lines = Object.hasOwn(options.topics, topic) ? options.topics[topic] : undefined;
      io.out(speak(lines ?? [`I do not have an answer for that. Try talk for the topics.`]).join('\n') + '\n');
      return 0;
    },
  };
  machine.shell.commands.set('talk', talk);
  if (options.speaker === 'LUNA' && !machine.shell.commands.has('luna')) {
    machine.shell.commands.set('luna', { ...talk, name: 'luna' });
  }
  return {
    ...session,
    afterCommand: (): BeatLine[] => {
      const prior = session.afterCommand?.() ?? [];
      // A companion on the bastion cannot observe the remote terminal.
      if (machine.session.stack.length > 0) return prior;
      const next = progress();
      const changed = next.id === previous.id && next.step !== previous.step;
      previous = next;
      quietTurns++;
      const suppress = talked;
      talked = false;
      if (suppress || prior.length || !changed || quietTurns < 3 || !next.id || questbook.remembers(said(next.id))) return prior;
      const aside = options.asides?.[next.id];
      if (!aside) return prior;
      questbook.remember(said(next.id));
      quietTurns = 0;
      return speak([aside]);
    },
  };
}
