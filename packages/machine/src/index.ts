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
