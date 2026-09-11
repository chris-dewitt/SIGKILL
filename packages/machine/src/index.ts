export { Machine } from './machine.js';
export type { MachineOptions, MachineSnapshot } from './machine.js';

export { Vfs, ROOT_USER } from './vfs/vfs.js';
export type { Inode, NodeKind, StatResult, User, VfsSnapshot } from './vfs/types.js';
export * as path from './vfs/path.js';

export { FsError, isFsError } from './errors.js';
export type { Errno } from './errors.js';

export { ShellContext, run } from './shell/exec.js';
export type { CommandFn, CommandSpec, ExecIO, RunResult, Track } from './shell/exec.js';
export { parse } from './shell/parser.js';
export { lex } from './shell/lexer.js';
export { ShellSyntaxError } from './shell/types.js';

export { ALL_COMMANDS, commandRegistry } from './coreutils/index.js';

export { ProcessTable } from './proc/table.js';
export { JobTable } from './proc/jobs.js';
export type { Job, JobState } from './proc/jobs.js';
export {
  CRONTAB,
  parseCrontab,
  matchField,
  matches,
  fieldsAt,
  dueBetween,
  MAX_CATCHUP_MINUTES,
} from './proc/cron.js';
export type { CronEntry, CronFields } from './proc/cron.js';
export { ServiceManager } from './proc/services.js';
export { parseIni, loadUnit, listUnits, UNIT_DIRS, WANTS_DIR } from './proc/units.js';
export type {
  Process,
  ProcessState,
  ProcSnapshot,
  Precondition,
  ServiceState,
  ServiceStatus,
  Unit,
} from './proc/types.js';
