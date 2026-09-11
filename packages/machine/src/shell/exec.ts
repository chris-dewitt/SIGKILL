import { isFsError } from '../errors.js';
import * as p from '../vfs/path.js';
import type { User } from '../vfs/types.js';
import type { Vfs } from '../vfs/vfs.js';
import { expandWord, expandWords, type ExpandContext } from './expand.js';
import { parse } from './parser.js';
import type { AndOr, Pipeline, Redirect, Script, Simple } from './types.js';
import { ShellSyntaxError } from './types.js';

export interface ExecIO {
  stdin: string;
  out(text: string): void;
  err(text: string): void;
}

/** A command is a pure-ish function of (context, argv, io) -> exit code. */
export type CommandFn = (ctx: ShellContext, argv: string[], io: ExecIO) => number;

export type Track = 'cadet' | 'operator';

export interface CommandSpec {
  name: string;
  /** One-line summary, shown by `help`. */
  summary: string;
  /** Terse manual, in the register real man pages use. Shown to Operators. */
  manual?: string;
  /** Plain-language manual. Shown to Cadets, who have not met man(1) before. */
  plain?: string;
  run: CommandFn;
}

export interface ShellContextOptions {
  vfs: Vfs;
  user: User;
  cwd?: string;
  home?: string;
  env?: Record<string, string>;
  commands?: Map<string, CommandSpec>;
  hostname?: string;
  track?: Track;
}

export class ShellContext {
  readonly vfs: Vfs;
  user: User;
  cwd: string;
  home: string;
  env: Record<string, string>;
  status = 0;
  readonly commands: Map<string, CommandSpec>;
  readonly hostname: string;
  /** Which interface the player chose. Cadet and Operator share one Machine. */
  track: Track;
  /** Set by the `exit` builtin so the session can close the terminal. */
  exited: number | null = null;
  /** Raised by `clear`. The renderer decides what clearing means; we do not. */
  clearRequested = false;

  constructor(opts: ShellContextOptions) {
    this.vfs = opts.vfs;
    this.user = opts.user;
    this.home = opts.home ?? `/home/${opts.user.name}`;
    this.cwd = opts.cwd ?? this.home;
    this.hostname = opts.hostname ?? 'localhost';
    this.track = opts.track ?? 'operator';
    this.commands = opts.commands ?? new Map();
    this.env = {
      HOME: this.home,
      PWD: this.cwd,
      USER: opts.user.name,
      SHELL: '/bin/sh',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOSTNAME: this.hostname,
      ...opts.env,
    };
  }

  expandContext(): ExpandContext {
    return {
      env: this.env,
      cwd: this.cwd,
      home: this.home,
      vfs: this.vfs,
      user: this.user,
      status: this.status,
    };
  }

  /** Resolve a user-supplied path against the current directory. */
  resolve(path: string): string {
    return p.resolve(this.cwd, path);
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Parse and run a command line. Never throws for user error — it reports. */
export function run(ctx: ShellContext, input: string): RunResult {
  let out = '';
  let err = '';
  const io: ExecIO = {
    stdin: '',
    out: (t) => { out += t; },
    err: (t) => { err += t; },
  };

  let script: Script;
  try {
    script = parse(input);
  } catch (e) {
    const message = e instanceof ShellSyntaxError ? e.message : String(e);
    ctx.status = 2;
    return { stdout: '', stderr: `sh: syntax error: ${message}\n`, code: 2 };
  }

  const code = runScript(ctx, script, io);
  return { stdout: out, stderr: err, code };
}

export function runScript(ctx: ShellContext, script: Script, io: ExecIO): number {
  let code = ctx.status;
  for (const statement of script.statements) {
    if (ctx.exited !== null) break;
    code = runAndOr(ctx, statement, io);
  }
  return code;
}

function runAndOr(ctx: ShellContext, node: AndOr, io: ExecIO): number {
  let code = runPipeline(ctx, node.first, io);
  ctx.status = code;

  for (const link of node.rest) {
    if (ctx.exited !== null) break;
    const shouldRun = link.op === '&&' ? code === 0 : code !== 0;
    if (!shouldRun) continue;
    code = runPipeline(ctx, link.pipeline, io);
    ctx.status = code;
  }
  return code;
}

function runPipeline(ctx: ShellContext, node: Pipeline, io: ExecIO): number {
  let carried = io.stdin;
  let code = 0;

  for (const [index, command] of node.commands.entries()) {
    const isLast = index === node.commands.length - 1;
    let captured = '';

    const stageIo: ExecIO = {
      stdin: carried,
      out: isLast ? io.out : (t) => { captured += t; },
      // stderr always goes to the terminal, never down the pipe. As it should.
      err: io.err,
    };

    code = runSimple(ctx, command, stageIo);
    carried = captured;
    if (ctx.exited !== null) break;
  }

  return code;
}

function runSimple(ctx: ShellContext, node: Simple, io: ExecIO): number {
  if (node.type === 'subshell') {
    // A subshell gets a copy of the environment; changes do not escape.
    const inner = new ShellContext({
      vfs: ctx.vfs,
      user: ctx.user,
      cwd: ctx.cwd,
      home: ctx.home,
      env: { ...ctx.env },
      commands: ctx.commands,
      hostname: ctx.hostname,
      track: ctx.track,
    });
    inner.status = ctx.status;
    return withRedirects(ctx, node.redirects, io, (scoped) => runScript(inner, node.body, scoped));
  }

  const expand = ctx.expandContext();
  const argv = expandWords(node.words, expand);

  // `FOO=bar` with no command sets the variable for the rest of the session.
  if (argv.length === 0) {
    for (const assignment of node.assignments) {
      ctx.env[assignment.name] = expandWord(assignment.value, expand).join(' ');
    }
    return 0;
  }

  const name = argv[0]!;
  const spec = ctx.commands.get(name);
  if (!spec) {
    io.err(`sh: ${name}: command not found\n`);
    return 127;
  }

  // `FOO=bar cmd` applies only for the duration of that command.
  const saved: Array<[string, string | undefined]> = [];
  for (const assignment of node.assignments) {
    saved.push([assignment.name, ctx.env[assignment.name]]);
    ctx.env[assignment.name] = expandWord(assignment.value, expand).join(' ');
  }

  try {
    return withRedirects(ctx, node.redirects, io, (scoped) => {
      try {
        return spec.run(ctx, argv, scoped);
      } catch (e) {
        if (isFsError(e)) {
          scoped.err(`${name}: ${e.path ?? ''}: ${e.reason}\n`);
          return 1;
        }
        scoped.err(`${name}: ${e instanceof Error ? e.message : String(e)}\n`);
        return 1;
      }
    });
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete ctx.env[key];
      else ctx.env[key] = value;
    }
  }
}

/** Apply redirections around a command, writing captured output to the VFS. */
function withRedirects(
  ctx: ShellContext,
  redirects: Redirect[],
  io: ExecIO,
  body: (io: ExecIO) => number,
): number {
  if (redirects.length === 0) return body(io);

  const expand = ctx.expandContext();
  let stdin = io.stdin;
  let outSink: ((t: string) => void) | null = null;
  let errSink: ((t: string) => void) | null = null;
  const writes: Array<{ path: string; append: boolean; buffer: { text: string } }> = [];

  for (const redirect of redirects) {
    const targets = expandWord(redirect.target, expand);
    if (targets.length !== 1) {
      io.err(`sh: ambiguous redirect\n`);
      return 1;
    }
    const target = ctx.resolve(targets[0]!);

    if (redirect.op === '<') {
      try {
        stdin = ctx.vfs.readText(target, ctx.user);
      } catch (e) {
        io.err(`sh: ${targets[0]}: ${isFsError(e) ? e.reason : String(e)}\n`);
        return 1;
      }
      continue;
    }

    const buffer = { text: '' };
    const append = redirect.op === '>>' || redirect.op === '2>>';
    writes.push({ path: target, append, buffer });
    const sink = (t: string): void => { buffer.text += t; };
    if (redirect.op === '>' || redirect.op === '>>') outSink = sink;
    else errSink = sink;
  }

  const scoped: ExecIO = {
    stdin,
    out: outSink ?? io.out,
    err: errSink ?? io.err,
  };

  const code = body(scoped);

  for (const write of writes) {
    try {
      if (write.append) ctx.vfs.append(write.path, write.buffer.text, ctx.user);
      else ctx.vfs.writeText(write.path, write.buffer.text, ctx.user);
    } catch (e) {
      io.err(`sh: ${write.path}: ${isFsError(e) ? e.reason : String(e)}\n`);
      return 1;
    }
  }

  return code;
}
