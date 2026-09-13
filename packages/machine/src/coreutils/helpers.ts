import type { ShellContext, ExecIO } from '../shell/exec.js';
import { isFsError } from '../errors.js';

/** Split argv into flags and operands, honouring `--` and clustered short flags. */
export function parseArgs(
  argv: string[],
  opts: { flags?: string[]; valued?: string[] } = {},
): {
  flags: Set<string>;
  values: Map<string, string>;
  operands: string[];
  /**
   * Index in `operands` where the arguments after `--` begin.
   *
   * Everything from here on was explicitly protected by the caller and must
   * never be reinterpreted as an option -- `head -- -5` means the file named
   * `-5`. Equals `operands.length` when there was no `--`.
   */
  separator: number;
} {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const operands: string[] = [];
  const known = new Set(opts.flags ?? []);
  const valued = new Set(opts.valued ?? []);

  let i = 1;
  let separator = -1;
  for (; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') { separator = operands.length; i++; break; }
    if (arg.length > 1 && arg.startsWith('-') && !/^-\d+$/.test(arg)) {
      if (arg.startsWith('--')) {
        const [name, inline] = arg.slice(2).split('=', 2);
        if (valued.has(`--${name}`)) {
          values.set(`--${name}`, inline ?? argv[++i] ?? '');
        } else {
          flags.add(`--${name}`);
        }
        continue;
      }
      const cluster = arg.slice(1);
      for (let c = 0; c < cluster.length; c++) {
        const flag = `-${cluster[c]}`;
        if (valued.has(flag)) {
          // A value may be attached (-d, / -n5) or separate (-d , / -n 5).
          const attached = cluster.slice(c + 1);
          values.set(flag, attached.length > 0 ? attached : (argv[++i] ?? ''));
          break;
        }
        flags.add(flag);
      }
      continue;
    }
    operands.push(arg);
  }
  for (; i < argv.length; i++) operands.push(argv[i]!);

  return { flags, values, operands, separator: separator < 0 ? operands.length : separator };
}

/** Join lines back into text with a trailing newline, the way coreutils do. */
export function lines(text: string): string[] {
  if (text.length === 0) return [];
  const out = text.split('\n');
  if (out[out.length - 1] === '') out.pop();
  return out;
}

export function emit(io: ExecIO, rows: string[]): void {
  if (rows.length === 0) return;
  io.out(rows.join('\n') + '\n');
}

export function usage(io: ExecIO, message: string): number {
  io.err(message.endsWith('\n') ? message : message + '\n');
  return 2;
}

/** Read operands as files, falling back to stdin when there are none. */
export function readInputs(
  ctx: ShellContext,
  io: ExecIO,
  operands: string[],
  tool: string,
): { text: string; code: number; sources: Array<{ name: string; text: string }> } {
  if (operands.length === 0) {
    return { text: io.stdin, code: 0, sources: [{ name: '-', text: io.stdin }] };
  }
  let code = 0;
  const sources: Array<{ name: string; text: string }> = [];
  for (const operand of operands) {
    if (operand === '-') { sources.push({ name: '-', text: io.stdin }); continue; }
    try {
      sources.push({ name: operand, text: ctx.vfs.readText(ctx.resolve(operand), ctx.user) });
    } catch (e) {
      const reason = e instanceof Error && 'reason' in e ? (e as { reason: string }).reason : String(e);
      io.err(`${tool}: ${operand}: ${reason}\n`);
      code = 1;
    }
  }
  return { text: sources.map((s) => s.text).join(''), code, sources };
}

export function formatMode(kind: string, mode: number): string {
  const type = kind === 'dir' ? 'd' : kind === 'symlink' ? 'l' : '-';
  const rwx = (bits: number): string =>
    `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${bits & 1 ? 'x' : '-'}`;
  return type + rwx((mode >> 6) & 7) + rwx((mode >> 3) & 7) + rwx(mode & 7);
}

/**
 * Pull a bare `-N` count out of the operands, as `head -5` and `tail -20` use.
 *
 * `parseArgs` deliberately leaves `-5` alone -- it cannot know whether a lone
 * negative number is a flag or an argument -- so the commands that accept the
 * historical form ask for it here. Without this, `head -5 file` tries to open
 * a file called `-5`, which is the error a player sees the first time they
 * reach for the form every other system accepts.
 *
 * Returns the count and the operands with it removed.
 */
export function takeCountOperand(
  operands: string[],
  separator = operands.length,
): { count: number | undefined; rest: string[] } {
  const rest: string[] = [];
  let count: number | undefined;
  for (const [index, operand] of operands.entries()) {
    const numeric = /^-(\d+)$/.exec(operand);
    // Only the first one, only before any filename, and never past `--`:
    // after that boundary the caller has said `-5` is a filename and meant it.
    if (numeric && count === undefined && rest.length === 0 && index < separator) {
      count = Number(numeric[1]);
      continue;
    }
    rest.push(operand);
  }
  return { count, rest };
}

/**
 * Parse a chmod mode: octal, or symbolic like `+x`, `u+w`, `go-rwx`, `a=r`.
 *
 * Symbolic modes are how anyone actually makes a script executable, and
 * `chmod +x` is one of the first real things a person learns to type. Octal
 * only is a teaching gap, not a simplification.
 *
 * Returns the new mode, or null if the spec is not a mode at all.
 */
/**
 * Does this argument look like a chmod mode rather than an option?
 *
 * `chmod -x file` is a real command and `-x` is the mode, but a generic flag
 * parser sees an option and eats it. chmod has to decide before parsing, which
 * is exactly what the real one does.
 */
export function looksLikeMode(arg: string): boolean {
  if (/^[0-7]{3,4}$/.test(arg)) return true;
  return arg.split(',').every((clause) => /^[ugoa]*[+\-=][rwxX]*$/.test(clause)) && arg !== '';
}

export function parseMode(spec: string, current: number, isDir = false): number | null {
  if (/^[0-7]{3,4}$/.test(spec)) return parseInt(spec, 8);

  let mode = current & 0o7777;
  // Comma-separated clauses, as in `u+rw,go-w`.
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)([+\-=])([rwxX]*)$/.exec(clause);
    if (!m) return null;

    const [, whoSpec = '', op = '', permSpec = ''] = m;
    const who = whoSpec === '' || whoSpec.includes('a') ? 'ugo' : whoSpec;

    let bits = 0;
    if (permSpec.includes('r')) bits |= 0o4;
    if (permSpec.includes('w')) bits |= 0o2;
    // `X` sets execute on directories, and on files that already have an
    // execute bit somewhere. That pair is the whole point: `chmod -R a+X`
    // makes a tree traversable without making every text file runnable.
    const executable = isDir || (mode & 0o111) !== 0;
    if (permSpec.includes('x') || (permSpec.includes('X') && executable)) bits |= 0o1;

    for (const [target, shift] of [['u', 6], ['g', 3], ['o', 0]] as const) {
      if (!who.includes(target)) continue;
      const field = bits << shift;
      const mask = 0o7 << shift;
      if (op === '+') mode |= field;
      else if (op === '-') mode &= ~field;
      else mode = (mode & ~mask) | field;
    }
  }
  return mode;
}

/**
 * Every regular file at or under a path, for `grep -r`.
 *
 * Unreadable directories are skipped rather than fatal: a player running
 * `grep -r secret /etc` should get the matches they *can* see, exactly as on
 * a real system, not one permission error and nothing else.
 */
export function expandTree(ctx: ShellContext, start: string): { files: string[]; errors: string[] } {
  const files: string[] = [];
  const errors: string[] = [];

  const walk = (path: string): void => {
    let kind: string;
    try {
      kind = ctx.vfs.lstat(ctx.resolve(path), ctx.user).kind;
    } catch {
      // Let the caller report it the way it reports any unopenable operand.
      files.push(path);
      return;
    }
    if (kind !== 'dir') {
      files.push(path);
      return;
    }
    let entries: string[];
    try {
      entries = ctx.vfs.readdir(ctx.resolve(path), ctx.user);
    } catch (e) {
      // A directory that cannot be read is an error, not an empty directory.
      // Swallowing it would let `grep -r` report "no matches" for a tree it
      // never actually looked inside.
      errors.push(`${path}: ${isFsError(e) ? e.reason : 'cannot be read'}`);
      return;
    }
    for (const entry of entries.sort()) walk(`${path.replace(/\/$/, '')}/${entry}`);
  };

  walk(start);
  return { files, errors };
}

/**
 * Read /etc/passwd into uid -> name.
 *
 * `ls -l` printing bare numbers is technically true and completely useless:
 * the whole reason to look at ownership is to find out *who*. Names come from
 * the same file a real system reads, so a player can `cat /etc/passwd`, see
 * why `ls` said what it said, and edit it if they feel like it.
 *
 * Unparsable lines are skipped rather than fatal -- a corrupted passwd file is
 * a situation, and `ls` still has to work while you are fixing it.
 */
export function passwdNames(ctx: ShellContext): Map<number, string> {
  const names = new Map<number, string>();
  let text: string;
  try {
    text = ctx.vfs.readText('/etc/passwd', ctx.user);
  } catch {
    return names;
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const [name, , uid] = line.split(':');
    const id = Number(uid);
    if (name === undefined || name === '' || !Number.isInteger(id)) continue;
    if (!names.has(id)) names.set(id, name);
  }
  return names;
}

/**
 * Read /etc/group into gid -> name, in the same spirit as passwdNames.
 */
export function groupNames(ctx: ShellContext): Map<number, string> {
  const names = new Map<number, string>();
  let text: string;
  try {
    text = ctx.vfs.readText('/etc/group', ctx.user);
  } catch {
    return names;
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const [name, , gid] = line.split(':');
    const id = Number(gid);
    if (name === undefined || name === '' || !Number.isInteger(id)) continue;
    if (!names.has(id)) names.set(id, name);
  }
  return names;
}
