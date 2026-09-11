import type { ShellContext, ExecIO } from '../shell/exec.js';

/** Split argv into flags and operands, honouring `--` and clustered short flags. */
export function parseArgs(
  argv: string[],
  opts: { flags?: string[]; valued?: string[] } = {},
): { flags: Set<string>; values: Map<string, string>; operands: string[] } {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const operands: string[] = [];
  const known = new Set(opts.flags ?? []);
  const valued = new Set(opts.valued ?? []);

  let i = 1;
  for (; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') { i++; break; }
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

  return { flags, values, operands };
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
