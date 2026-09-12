import { isFsError } from '../errors.js';
import type { Network, Session } from '../net/network.js';
import type { JobTable, Job } from '../proc/jobs.js';
import type { ProcessTable } from '../proc/table.js';
import type { ServiceManager } from '../proc/services.js';
import * as p from '../vfs/path.js';
import type { User } from '../vfs/types.js';
import type { Vfs } from '../vfs/vfs.js';
import { expandWord, expandWords, type ExpandContext } from './expand.js';
import { parse } from './parser.js';
import type { AndOr, Pipeline, Redirect, Script, Simple } from './types.js';
import { ShellSyntaxError } from './types.js';

/** Deep enough for anything honest, shallow enough to stop a runaway. */
const MAX_SUBSTITUTION_DEPTH = 16;

export interface ExecIO {
  stdin: string;
  out(text: string): void;
  err(text: string): void;
}

/**
 * A command is a pure-ish function of (context, argv, io) -> exit code.
 *
 * Commands may be async. Most are not and should not bother, but the engines
 * that matter — Python, SQL, git, a remote host — cannot be synchronous, and
 * one async command forces the whole pipeline to be awaitable.
 */
export type CommandFn = (
  ctx: ShellContext,
  argv: string[],
  io: ExecIO,
) => number | Promise<number>;

export type Track = 'cadet' | 'operator';

/**
 * A command that takes over the whole screen until it exits.
 *
 * An editor, a pager, anything full-screen. The Machine knows only that such
 * a thing exists, what it does with a keystroke and what it draws -- it holds
 * no editor of its own, because it holds no dependencies of any kind. The
 * adventure supplies the program (see `@sigkill/editor`) and the host drives
 * it, exactly as `clearRequested` leaves the meaning of clearing to the host.
 */
export interface ScreenProgram {
  readonly name: string;
  /** Absolute path the program is editing, already resolved by the shell. */
  readonly path: string;
  key(k: { key: string; ctrl?: boolean }): void;
  frame(): Array<{ text: string; kind: 'out' | 'err' | 'echo' | 'system'; cursor?: number }>;
  resize(rows: number, cols: number): void;
  /** Non-null once it is finished. */
  readonly exit: { write: boolean; text: string; message?: string } | null;
  /** Keys worth offering as on-screen buttons right now. */
  readonly chips: readonly string[];
  /**
   * Tell the program something, while it still owns the screen.
   *
   * A failed write is the case that matters: printing it to the scrollback
   * would hide it behind the program's own frame until the player quit.
   */
  notify?(message: string): void;
  /**
   * Text from a save that did not exit.
   *
   * The host clears this after applying it, so `:w` reaches the disk when it
   * is typed rather than whenever the program happens to close.
   */
  pendingWrite?: string | undefined;
}

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
  procs: ProcessTable;
  services: ServiceManager;
  jobs: JobTable;
  /** Reads the virtual clock. Commands must never reach for wall time. */
  clock: () => number;
  /** Advances the virtual clock. `sleep` is the only ordinary caller. */
  advance: (ms: number) => Promise<void>;
  cwd?: string;
  home?: string;
  env?: Record<string, string>;
  commands?: Map<string, CommandSpec>;
  hostname?: string;
  track?: Track;
  /** Absent on a machine with no interface, which is a real situation. */
  network?: Network;
  /** Shared across every machine the player hops through. */
  session?: Session;
}

export class ShellContext {
  readonly vfs: Vfs;
  readonly procs: ProcessTable;
  readonly services: ServiceManager;
  readonly jobs: JobTable;
  readonly clock: () => number;
  readonly advance: (ms: number) => Promise<void>;
  user: User;
  cwd: string;
  home: string;
  env: Record<string, string>;
  status = 0;
  readonly commands: Map<string, CommandSpec>;
  readonly hostname: string;
  readonly network: Network | undefined;
  readonly session: Session | undefined;
  /** Which interface the player chose. Cadet and Operator share one Machine. */
  track: Track;
  /** Set by the `exit` builtin so the session can close the terminal. */
  exited: number | null = null;
  /** Raised by `clear`. The renderer decides what clearing means; we do not. */
  clearRequested = false;
  /**
   * Raised by a full-screen command such as `vi`.
   *
   * The command returns immediately; the host then drives the program until it
   * exits. A Machine with no screen (a test, a cron job) simply never drives
   * it, which is why `vi` in a script is a no-op rather than a hang.
   */
  screenRequest: ScreenProgram | undefined;
  /** Nesting depth of command substitution, so `x=$(x)` cannot run away. */
  private substDepth = 0;
  /**
   * The job currently being run in the background, if any.
   *
   * `sleep` reads this: in the foreground it advances the clock, in the
   * background it books a completion time instead.
   */
  backgroundJob: Job | null = null;

  constructor(opts: ShellContextOptions) {
    this.vfs = opts.vfs;
    this.procs = opts.procs;
    this.services = opts.services;
    this.jobs = opts.jobs;
    this.clock = opts.clock;
    this.advance = opts.advance;
    this.user = opts.user;
    this.home = opts.home ?? `/home/${opts.user.name}`;
    this.cwd = opts.cwd ?? this.home;
    this.hostname = opts.hostname ?? 'localhost';
    this.network = opts.network;
    this.session = opts.session;
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
      run: (source) => this.runSubstitution(source),
    };
  }

  /**
   * Run a command substitution and return its stdout.
   *
   * Substitutions run in the current shell's environment but their stdout is
   * captured rather than printed. stderr still goes to the terminal, which is
   * what makes a failing substitution visible instead of silently empty.
   */
  private async runSubstitution(source: string): Promise<string> {
    if (this.substDepth >= MAX_SUBSTITUTION_DEPTH) {
      throw new Error('command substitution nested too deeply');
    }
    this.substDepth++;
    try {
      const result = await run(this, source);
      this.substitutionStderr += result.stderr;
      return result.stdout;
    } finally {
      this.substDepth--;
    }
  }

  /** stderr produced inside substitutions, drained by the executor. */
  substitutionStderr = '';

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
export async function run(ctx: ShellContext, input: string): Promise<RunResult> {
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

  let code: number;
  try {
    code = await runScript(ctx, script, io);
  } catch (e) {
    // Expansion happens before a command runs, so a failure there (a runaway
    // substitution, say) would otherwise escape. run() reports; it never throws.
    err += `sh: ${e instanceof Error ? e.message : String(e)}\n`;
    code = 1;
    ctx.status = code;
  }

  // Substitutions capture their own stdout but their stderr belongs on screen.
  if (ctx.substitutionStderr.length > 0) {
    err += ctx.substitutionStderr;
    ctx.substitutionStderr = '';
  }

  return { stdout: out, stderr: err, code };
}

export async function runScript(ctx: ShellContext, script: Script, io: ExecIO): Promise<number> {
  let code = ctx.status;
  for (const statement of script.statements) {
    if (ctx.exited !== null) break;
    code = statement.background
      ? await runBackground(ctx, statement, io)
      : await runAndOr(ctx, statement, io);
  }
  return code;
}

/**
 * Run an and-or list in the background.
 *
 * It executes immediately -- everything here is deterministic and instant --
 * but its output is captured onto the job rather than printed, and a
 * backgrounded `sleep` books a future completion instead of advancing time.
 * The shell prints `[id] pid` and returns success, as it should.
 */
async function runBackground(ctx: ShellContext, node: AndOr, io: ExecIO): Promise<number> {
  const command = describe(node);
  const process = ctx.procs.spawn(command.split(/\s+/), { uid: ctx.user.uid });

  const job = ctx.jobs.add({
    pid: process.pid,
    command,
    state: 'running',
    exitCode: undefined,
    completesAt: ctx.clock(),
    stdout: '',
    stderr: '',
  });

  const previous = ctx.backgroundJob;
  ctx.backgroundJob = job;
  const captured: ExecIO = {
    stdin: '',
    out: (t) => { job.stdout += t; },
    err: (t) => { job.stderr += t; },
  };

  try {
    job.exitCode = await runAndOr(ctx, node, captured);
  } finally {
    ctx.backgroundJob = previous;
  }

  io.out(`[${job.id}] ${process.pid}\n`);
  return 0;
}

/** Reconstruct a readable command line for `jobs` to display. */
function describe(node: AndOr): string {
  const words = (pipeline: Pipeline): string =>
    pipeline.commands
      .map((c) => (c.type === 'command' ? c.words.map(flatten).join(' ') : '(...)'))
      .join(' | ');
  const head = words(node.first);
  const tail = node.rest.map((r) => ` ${r.op} ${words(r.pipeline)}`).join('');
  return head + tail;
}

function flatten(word: { parts: Array<{ kind: string; value: string }> }): string {
  return word.parts.map((p) => p.value).join('');
}

async function runAndOr(ctx: ShellContext, node: AndOr, io: ExecIO): Promise<number> {
  let code = await runPipeline(ctx, node.first, io);
  ctx.status = code;

  for (const link of node.rest) {
    if (ctx.exited !== null) break;
    const shouldRun = link.op === '&&' ? code === 0 : code !== 0;
    if (!shouldRun) continue;
    code = await runPipeline(ctx, link.pipeline, io);
    ctx.status = code;
  }
  return code;
}

async function runPipeline(ctx: ShellContext, node: Pipeline, io: ExecIO): Promise<number> {
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

    code = await runSimple(ctx, command, stageIo);
    carried = captured;
    if (ctx.exited !== null) break;
  }

  return code;
}

async function runSimple(ctx: ShellContext, node: Simple, io: ExecIO): Promise<number> {
  if (node.type === 'subshell') {
    // A subshell gets a copy of the environment; changes do not escape.
    const inner = new ShellContext({
      vfs: ctx.vfs,
      procs: ctx.procs,
      services: ctx.services,
      jobs: ctx.jobs,
      clock: ctx.clock,
      advance: ctx.advance,
      network: ctx.network,
      session: ctx.session,
      user: ctx.user,
      cwd: ctx.cwd,
      home: ctx.home,
      env: { ...ctx.env },
      commands: ctx.commands,
      hostname: ctx.hostname,
      track: ctx.track,
    });
    inner.status = ctx.status;
    return await withRedirects(ctx, node.redirects, io, (scoped) => runScript(inner, node.body, scoped));
  }

  const expand = ctx.expandContext();
  const argv = await expandWords(node.words, expand);

  // `FOO=bar` with no command sets the variable for the rest of the session.
  if (argv.length === 0) {
    for (const assignment of node.assignments) {
      ctx.env[assignment.name] = (await expandWord(assignment.value, expand)).join(' ');
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
    ctx.env[assignment.name] = (await expandWord(assignment.value, expand)).join(' ');
  }

  try {
    return await withRedirects(ctx, node.redirects, io, async (scoped) => {
      try {
        return await spec.run(ctx, argv, scoped);
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
async function withRedirects(
  ctx: ShellContext,
  redirects: Redirect[],
  io: ExecIO,
  body: (io: ExecIO) => number | Promise<number>,
): Promise<number> {
  if (redirects.length === 0) return await body(io);

  const expand = ctx.expandContext();
  let stdin = io.stdin;
  let outSink: ((t: string) => void) | null = null;
  let errSink: ((t: string) => void) | null = null;
  const writes: Array<{ path: string; append: boolean; buffer: { text: string } }> = [];

  for (const redirect of redirects) {
    const targets = await expandWord(redirect.target, expand);
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

  const code = await body(scoped);

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
