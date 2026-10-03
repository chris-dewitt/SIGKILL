export { Machine } from './machine.js';
export type { MachineOptions, MachineSnapshot } from './machine.js';

export { Vfs, ROOT_USER } from './vfs/vfs.js';
export type { Inode, NodeKind, StatResult, User, VfsSnapshot } from './vfs/types.js';
export * as path from './vfs/path.js';

export { FsError, isFsError } from './errors.js';
export type { Errno } from './errors.js';

export { ShellContext, run } from './shell/exec.js';
export type {
  CommandFn, CommandSpec, ExecIO, OutputSegment, RunResult, ScreenProgram, Track,
} from './shell/exec.js';
export { parse } from './shell/parser.js';
export { lex } from './shell/lexer.js';
export { ShellSyntaxError } from './shell/types.js';

export { ALL_COMMANDS, commandRegistry } from './coreutils/index.js';

export { pythonCommands, collectFiles, applyResult, machineRoots } from './lang/python.js';
export type { PythonRuntime, PythonRequest, PythonResult, FileEntry } from './lang/python.js';
export { sqlCommands, SQL_SEED, encodeBase64, decodeBase64 } from './lang/sql.js';
export type { SqlRuntime, SqlRequest, SqlResult, SqlRow } from './lang/sql.js';

export { Network, subnetOf } from './net/network.js';
export { OPEN, ruleSpec, verdict } from './net/firewall.js';
export type { Action, Firewall, Rule } from './net/firewall.js';
export type { NetHost, HostOptions, HttpResponse, NetworkOptions, Session } from './net/network.js';
export { HOSTS_FILE, isAddress, lookup, parseHosts, readHosts, reach } from './net/resolver.js';
export type { HostsEntry, Reach, Resolution, Via } from './net/resolver.js';
export { snapshotFleet, restoreFleet } from './net/fleet.js';
export type { Fleet, FleetSnapshot, HostSnapshot, WireHost } from './net/fleet.js';

export { ProcessTable } from './proc/table.js';
export type { SignalWatcher, SpawnOptions } from './proc/table.js';
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
export { SIGKILL, SIGTERM } from './proc/types.js';
export type {
  Process,
  ProcessState,
  ProcSnapshot,
  SignalOutcome,
  Precondition,
  ServiceState,
  ServiceStatus,
  Unit,
} from './proc/types.js';
