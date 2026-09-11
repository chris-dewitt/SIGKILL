import type { CommandSpec } from '../shell/exec.js';
import { fsCommands } from './fs.js';
import { jobCommands } from './jobs.js';
import { netCommands } from './net.js';
import { procCommands } from './proc.js';
import { sysCommands } from './sys.js';
import { textCommands } from './text.js';

export const ALL_COMMANDS: CommandSpec[] = [
  ...fsCommands,
  ...textCommands,
  ...procCommands,
  ...jobCommands,
  ...netCommands,
  ...sysCommands,
];

/** Build a name -> command map, optionally with adventure-specific extras. */
export function commandRegistry(extra: CommandSpec[] = []): Map<string, CommandSpec> {
  const map = new Map<string, CommandSpec>();
  for (const spec of [...ALL_COMMANDS, ...extra]) map.set(spec.name, spec);
  return map;
}

export * from './helpers.js';
