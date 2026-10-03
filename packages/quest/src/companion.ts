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
  const memory = '/var/lib/sigkill/companion.json';
  let seen = new Set<string>();
  try {
    const saved: unknown = JSON.parse(machine.vfs.readText(memory, ROOT_USER));
    if (Array.isArray(saved)) seen = new Set(saved.filter((x): x is string => typeof x === 'string'));
  } catch { /* A new run, or a save from before conversations existed. */ }
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
      const lines = options.topics[topic];
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
      if (suppress || prior.length || !changed || quietTurns < 3 || !next.id || seen.has(next.id)) return prior;
      const aside = options.asides?.[next.id];
      if (!aside) return prior;
      seen.add(next.id);
      quietTurns = 0;
      machine.vfs.mkdirp('/var/lib/sigkill', ROOT_USER);
      machine.vfs.writeText(memory, JSON.stringify([...seen]), ROOT_USER);
      return speak([aside]);
    },
  };
}
