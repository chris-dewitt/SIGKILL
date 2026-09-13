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

/** Same reasoning, for a script that runs a script that runs itself. */
const MAX_SCRIPT_DEPTH = 16;

/**
 * Shebang interpreters that mean "this is a shell script".
 *
 * Anything else is looked up in the command table, so `#!/usr/bin/env python3`
 * reaches the Python aboard rather than being told sh is the only language.
 */
const SHELL_INTERPRETERS = new Set(['sh', 'bash', 'dash', 'ash']);

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
  /**
   * Who launched it, captured at launch.
   *
   * `sudo` swaps `ctx.user` for the duration of one command and puts it back
   * in a finally block, so by the time the player types `:w` the shell is the
   * unprivileged user again. The host must write as *this* user or
   * `sudo vi /etc/hosts` opens writable and then throws the work away.
   */
  readonly user: { uid: number; gid: number; name: string };
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
  /**
   * Instant the virtual clock counts from, in ms since the Unix epoch.
   *
   * `date` needs it as much as cron does: the adventure has its own calendar,
   * and the answer must be the same on every machine that replays the same
   * commands.
   */
  epoch?: number;
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
  /** Positional parameters, `$0` first. A script's arguments live here. */
  params?: readonly string[];
  /** How many scripts deep this shell is. Guards runaway recursion. */
  scriptDepth?: number;
}

export class ShellContext {
  readonly vfs: Vfs;
  readonly procs: ProcessTable;
  readonly services: ServiceManager;
  readonly jobs: JobTable;
  readonly clock: () => number;
  /** Start of the adventure's calendar. See `ShellContextOptions.epoch`. */
  readonly epoch: number;
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
  /** `$0` onwards. An interactive shell has only `$0`; a script has its args. */
  params: readonly string[];
  /** Nesting depth of script execution. See MAX_SCRIPT_DEPTH. */
  readonly scriptDepth: number;
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
    this.epoch = opts.epoch ?? 0;
    this.advance = opts.advance;
    this.user = opts.user;
    this.home = opts.home ?? `/home/${opts.user.name}`;
    this.cwd = opts.cwd ?? this.home;
    this.hostname = opts.hostname ?? 'localhost';
    this.network = opts.network;
    this.session = opts.session;
    this.track = opts.track ?? 'operator';
    this.params = opts.params ?? ['sh'];
    this.scriptDepth = opts.scriptDepth ?? 0;
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
      params: this.params,
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
    try {
      return await withRedirects(ctx, node.redirects, io, (scoped) => runScript(inner, node.body, scoped));
    } finally {
      adoptScreenState(ctx, inner);
    }
  }

  const expand = ctx.expandContext();
  let argv = await expandWords(node.words, expand);

  // `FOO=bar` with no command sets the variable for the rest of the session.
  if (argv.length === 0) {
    for (const assignment of node.assignments) {
      ctx.env[assignment.name] = (await expandWord(assignment.value, expand)).join(' ');
    }
    return 0;
  }

  // `FOO=bar cmd` applies only for the duration of that command.
  const saved: Array<[string, string | undefined]> = [];
  for (const assignment of node.assignments) {
    saved.push([assignment.name, ctx.env[assignment.name]]);
    ctx.env[assignment.name] = (await expandWord(assignment.value, expand)).join(' ');
  }

  try {
    return await withRedirects(ctx, node.redirects, io, (scoped) => execArgv(ctx, argv, scoped));
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete ctx.env[key];
      else ctx.env[key] = value;
    }
  }
}

/**
 * Run one already-expanded command line: a builtin, or a program on disk.
 *
 * Exported because `sudo` needs exactly this and nothing else. Looking the
 * name up in the command table alone -- which is what sudo used to do -- means
 * `sudo ./seal.sh` reports "command not found" for a script sitting right
 * there, and the player has no way to tell that from a typo.
 *
 * Redirections and temporary assignments are the caller's business; this is
 * the dispatch step only.
 */
export async function execArgv(ctx: ShellContext, argv: string[], io: ExecIO): Promise<number> {
  const name = argv[0];
  if (name === undefined) return 0;

  const builtin = ctx.commands.get(name);
  if (builtin) return await invoke(ctx, builtin, argv, io);

  // Not a builtin. A real shell then goes looking on disk, and so does this
  // one: a readable file with the execute bit set is a program. This is what
  // makes `chmod +x` and `./thing` mean something aboard.
  const program = resolveProgram(ctx, name);
  if (program.kind === 'error') {
    io.err(`sh: ${name}: ${program.reason}\n`);
    return program.code;
  }
  if (program.kind === 'script') {
    return await runShellScript(ctx, program.path, program.source, argv, io);
  }
  // A shebang naming an interpreter that exists aboard: hand it the script.
  return await invoke(ctx, program.spec, [program.interpreter, program.path, ...argv.slice(1)], io);
}

/** Call a command and turn anything it throws into the error it should print. */
async function invoke(
  ctx: ShellContext,
  spec: CommandSpec,
  argv: string[],
  io: ExecIO,
): Promise<number> {
  const name = argv[0] ?? spec.name;
  try {
    return await spec.run(ctx, argv, io);
  } catch (e) {
    if (isFsError(e)) {
      io.err(`${name}: ${e.path ?? ''}: ${e.reason}\n`);
      return 1;
    }
    io.err(`${name}: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

/**
 * A name that is not a builtin, looked up the way a shell looks it up.
 */
type Program =
  | { kind: 'script'; path: string; source: string }
  /** A shebang whose interpreter is a command aboard, e.g. `python3`. */
  | { kind: 'interpreted'; path: string; interpreter: string; spec: CommandSpec }
  | { kind: 'error'; reason: string; code: number };

/**
 * Find the program a bare word names.
 *
 * A name containing a slash is a path and nothing else -- `./seal.sh` never
 * searches PATH, which is exactly why people type the `./`. A bare name is
 * searched along PATH, and a hit there that is not executable does not stop
 * the search, because a stray unreadable file early on PATH is not the
 * player's mistake. It is remembered, though: reporting "permission denied"
 * beats "command not found" when a mode bit is the only thing wrong.
 */
function resolveProgram(ctx: ShellContext, name: string): Program {
  const candidates = name.includes('/')
    ? [ctx.resolve(name)]
    : (ctx.env['PATH'] ?? '').split(':').filter((d) => d.length > 0).map((dir) => p.join(dir, name));

  let denied: string | undefined;

  for (const path of candidates) {
    let kind: string;
    try {
      kind = ctx.vfs.stat(path, ctx.user).kind;
    } catch {
      continue;
    }
    if (kind === 'dir') {
      if (name.includes('/')) return { kind: 'error', reason: 'Is a directory', code: 126 };
      continue;
    }
    if (!ctx.vfs.access(path, 'x', ctx.user)) {
      denied = path;
      if (name.includes('/')) break;
      continue;
    }
    let source: string;
    try {
      source = ctx.vfs.readText(path, ctx.user);
    } catch {
      // Executable but not readable. A real kernel could still run a binary;
      // nothing aboard is a binary, so there is no honest way to pretend.
      denied = path;
      break;
    }
    return interpret(ctx, path, source);
  }

  if (denied !== undefined) return { kind: 'error', reason: 'Permission denied', code: 126 };
  if (name.includes('/')) return { kind: 'error', reason: 'No such file or directory', code: 127 };
  return { kind: 'error', reason: 'command not found', code: 127 };
}

/** The first line of a file, without its newline. */
function firstLine(source: string): string {
  const end = source.indexOf('\n');
  return end === -1 ? source : source.slice(0, end);
}

/** Decide what language a file is in, from its shebang. */
function interpret(ctx: ShellContext, path: string, source: string): Program {
  const shebang = firstLine(source);
  if (!shebang.startsWith('#!')) {
    // No shebang means sh, which is what every shell does and what every
    // half-finished script aboard relies on.
    return { kind: 'script', path, source };
  }

  const words = shebang.slice(2).trim().split(/\s+/).filter((w) => w.length > 0);
  // `#!/usr/bin/env python3` -- the interpreter is the argument to env.
  const first = p.basename(words[0] ?? '');
  const named = first === 'env' ? p.basename(words[1] ?? '') : first;

  if (named === '' || SHELL_INTERPRETERS.has(named)) return { kind: 'script', path, source };

  const spec = ctx.commands.get(named);
  if (spec) return { kind: 'interpreted', path, interpreter: named, spec };
  return { kind: 'error', reason: `${shebang.slice(2).trim()}: bad interpreter`, code: 126 };
}

/** A shebang line is a comment to sh, but the parser should not have to know. */
function stripShebang(source: string): string {
  if (!source.startsWith('#!')) return source;
  const end = source.indexOf('\n');
  return end === -1 ? '' : source.slice(end + 1);
}

/**
 * Run a shell script in a subshell.
 *
 * Its `cd`, its variables and its `exit` stay inside -- that is what makes a
 * script safe to run -- but everything it does to the filesystem, the services
 * and the process table is real, because those are the machine and not the
 * shell. It runs as the current user with no elevation of any kind: a script
 * is a way of typing several commands, never a way of becoming someone else.
 */
async function runShellScript(
  ctx: ShellContext,
  path: string,
  source: string,
  argv: string[],
  io: ExecIO,
): Promise<number> {
  if (ctx.scriptDepth >= MAX_SCRIPT_DEPTH) {
    io.err(`sh: ${path}: script nested too deeply\n`);
    return 1;
  }

  let body: Script;
  try {
    body = parse(stripShebang(source));
  } catch (e) {
    const message = e instanceof ShellSyntaxError ? e.message : String(e);
    io.err(`${path}: syntax error: ${message}\n`);
    return 2;
  }

  const inner = new ShellContext({
    vfs: ctx.vfs,
    procs: ctx.procs,
    services: ctx.services,
    jobs: ctx.jobs,
    clock: ctx.clock,
    epoch: ctx.epoch,
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
    params: [path, ...argv.slice(1)],
    scriptDepth: ctx.scriptDepth + 1,
  });

  try {
    const code = await runScript(inner, body, io);
    // `exit 3` inside a script is the script's status, not the session's.
    return inner.exited ?? code;
  } finally {
    ctx.substitutionStderr += inner.substitutionStderr;
    adoptScreenState(ctx, inner);
  }
}

/**
 * Carry a child shell's screen requests back to the parent.
 *
 * The host only ever looks at the shell it drives, so an editor opened by a
 * script would otherwise be created and then dropped on the floor.
 */
function adoptScreenState(ctx: ShellContext, inner: ShellContext): void {
  if (inner.screenRequest !== undefined) ctx.screenRequest = inner.screenRequest;
  if (inner.clearRequested) ctx.clearRequested = true;
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
