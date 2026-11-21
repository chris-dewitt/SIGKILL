import type { CommandSpec, ShellContext } from '../shell/exec.js';

/**
 * What comes next, for the commands people type most on a phone.
 *
 * Kept together rather than on each spec, so the grammar of the commonly
 * typed commands can be read in one place and tested in one file. A command
 * with nothing here gets the host's default -- the files in front of you --
 * which is right for cat, grep, less and most of the rest.
 */

type Complete = NonNullable<CommandSpec['complete']>;

/** Entries of the current directory, optionally only directories. */
function here(ctx: ShellContext, only?: 'dirs'): string[] {
  let names: string[];
  try {
    names = ctx.vfs.readdir(ctx.cwd, ctx.user);
  } catch {
    return [];
  }
  return names
    .filter((n) => !n.startsWith('.'))
    .filter((n) => {
      if (only !== 'dirs') return true;
      try {
        return ctx.vfs.stat(ctx.resolve(n), ctx.user).kind === 'dir';
      } catch {
        return false;
      }
    })
    .sort();
}

const hosts = (ctx: ShellContext): string[] =>
  (ctx.network?.list() ?? []).map((h) => h.hostname).filter((h) => h !== ctx.hostname);

const units = (ctx: ShellContext): string[] => ctx.services.list().map((u) => u.name).sort();

const SYSTEMCTL_VERBS = ['status', 'start', 'stop', 'restart', 'enable', 'disable', '--failed'];

export const COMPLETIONS: Record<string, Complete> = {
  cd: (ctx, args) => (args.length <= 1 ? [...here(ctx, 'dirs'), '..', '~'] : []),

  systemctl: (ctx, args) => {
    const words = args.filter((a) => !a.startsWith('--') || a === args[args.length - 1]);
    if (words.length <= 1) return SYSTEMCTL_VERBS;
    return words.length === 2 ? units(ctx) : [];
  },

  journalctl: (ctx, args) => {
    const prev = args[args.length - 2];
    if (prev === '-u' || prev === '--unit') return units(ctx);
    if (prev === '-n') return ['10', '20', '50'];
    return ['-u', '-n', '-r'];
  },

  ssh: (ctx, args) => (args.length <= 1 ? hosts(ctx) : []),
  ping: (ctx, args) => (args.length <= 1 ? hosts(ctx) : []),
  nc: (ctx, args) => {
    if (args.length <= 1) return ['-zv'];
    if (args.length === 2) return hosts(ctx);
    return args.length === 3 ? ['22', '80', '443'] : [];
  },
  scp: (ctx) => [...here(ctx), ...hosts(ctx).map((h) => `${h}:`)],
  curl: (ctx, args) => {
    const urls = hosts(ctx).map((h) => `http://${h}/`);
    return args.length <= 1 ? ['-s', ...urls] : urls;
  },

  python3: (ctx, args) => (args.length <= 1 ? [...here(ctx).filter((n) => n.endsWith('.py')), '-c'] : []),

  man: (ctx, args) => (args.length <= 1 ? [...ctx.commands.keys()].sort() : []),

  /*
   * sudo completes as whatever it is running: `sudo systemctl ` offers the
   * same verbs as `systemctl `.
   */
  sudo: (ctx, args) => {
    if (args.length <= 1) return [...ctx.commands.keys()].sort();
    const inner = ctx.commands.get(args[0]!);
    return inner?.complete?.(ctx, args.slice(1)) ?? here(ctx);
  },
};

/** Attach the completions above to the specs they name. */
export function withCompletions(specs: readonly CommandSpec[]): CommandSpec[] {
  return specs.map((spec) => (COMPLETIONS[spec.name] && !spec.complete ? { ...spec, complete: COMPLETIONS[spec.name] } : spec));
}
