import type { CommandSpec } from '../shell/exec.js';
import { emit, lines, parseArgs, readInputs, usage } from './helpers.js';

export const textCommands: CommandSpec[] = [
  {
    name: 'echo',
    summary: 'write arguments to standard output',
    run: (_ctx, argv, io) => {
      const args = argv.slice(1);
      const noNewline = args[0] === '-n';
      const body = (noNewline ? args.slice(1) : args).join(' ');
      io.out(noNewline ? body : body + '\n');
      return 0;
    },
  },

  {
    name: 'grep',
    summary: 'search text for lines matching a pattern',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'usage: grep [-inv] PATTERN [FILE...]');

      const pattern = operands[0]!;
      const files = operands.slice(1);
      const insensitive = flags.has('-i');
      const invert = flags.has('-v');
      const countOnly = flags.has('-c');
      const withNumbers = flags.has('-n');
      const namesOnly = flags.has('-l');

      let re: RegExp;
      try {
        re = new RegExp(pattern, insensitive ? 'i' : '');
      } catch {
        io.err(`grep: ${pattern}: invalid regular expression\n`);
        return 2;
      }

      const { sources, code } = readInputs(ctx, io, files, 'grep');
      const showName = files.length > 1;
      const out: string[] = [];
      let matched = false;

      for (const source of sources) {
        let count = 0;
        for (const [index, line] of lines(source.text).entries()) {
          if (re.test(line) === invert) continue;
          count++;
          matched = true;
          if (countOnly || namesOnly) continue;
          const prefix = `${showName ? source.name + ':' : ''}${withNumbers ? index + 1 + ':' : ''}`;
          out.push(prefix + line);
        }
        if (countOnly) out.push(`${showName ? source.name + ':' : ''}${count}`);
        if (namesOnly && count > 0) out.push(source.name);
      }

      emit(io, out);
      if (code !== 0) return 2;
      return matched ? 0 : 1;
    },
  },

  {
    name: 'head',
    summary: 'output the first lines of a file',
    run: (ctx, argv, io) => {
      const { values, operands } = parseArgs(argv, { valued: ['-n'] });
      const count = Number(values.get('-n') ?? 10);
      const { sources, code } = readInputs(ctx, io, operands, 'head');
      const showName = operands.length > 1;
      const out: string[] = [];
      for (const source of sources) {
        if (showName) out.push(`==> ${source.name} <==`);
        out.push(...lines(source.text).slice(0, count));
      }
      emit(io, out);
      return code;
    },
  },

  {
    name: 'tail',
    summary: 'output the last lines of a file',
    run: (ctx, argv, io) => {
      const { values, operands } = parseArgs(argv, { valued: ['-n'] });
      const count = Number(values.get('-n') ?? 10);
      const { sources, code } = readInputs(ctx, io, operands, 'tail');
      const showName = operands.length > 1;
      const out: string[] = [];
      for (const source of sources) {
        if (showName) out.push(`==> ${source.name} <==`);
        const all = lines(source.text);
        out.push(...all.slice(Math.max(0, all.length - count)));
      }
      emit(io, out);
      return code;
    },
  },

  {
    name: 'wc',
    summary: 'count lines, words and bytes',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      const { sources, code } = readInputs(ctx, io, operands, 'wc');
      const only = flags.has('-l') || flags.has('-w') || flags.has('-c');
      const out: string[] = [];
      let totals = { l: 0, w: 0, c: 0 };

      for (const source of sources) {
        const l = lines(source.text).length;
        const w = source.text.split(/\s+/).filter((s) => s.length > 0).length;
        const c = source.text.length;
        totals = { l: totals.l + l, w: totals.w + w, c: totals.c + c };
        out.push(formatCounts(flags, only, l, w, c, operands.length > 0 ? source.name : ''));
      }
      if (sources.length > 1) {
        out.push(formatCounts(flags, only, totals.l, totals.w, totals.c, 'total'));
      }
      emit(io, out);
      return code;
    },
  },

  {
    name: 'sort',
    summary: 'sort lines of text',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      const { text, code } = readInputs(ctx, io, operands, 'sort');
      let rows = lines(text);
      rows = flags.has('-n')
        ? rows.sort((a, b) => Number(a.trim()) - Number(b.trim()) || a.localeCompare(b))
        : rows.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      if (flags.has('-r')) rows.reverse();
      if (flags.has('-u')) rows = rows.filter((row, i) => i === 0 || row !== rows[i - 1]);
      emit(io, rows);
      return code;
    },
  },

  {
    name: 'uniq',
    summary: 'filter adjacent duplicate lines',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      const { text, code } = readInputs(ctx, io, operands, 'uniq');
      const rows = lines(text);
      const out: string[] = [];
      let i = 0;
      while (i < rows.length) {
        let run = 1;
        while (i + run < rows.length && rows[i + run] === rows[i]) run++;
        if (flags.has('-d') && run < 2) { i += run; continue; }
        out.push(flags.has('-c') ? `${String(run).padStart(7)} ${rows[i]}` : rows[i]!);
        i += run;
      }
      emit(io, out);
      return code;
    },
  },

  {
    name: 'cut',
    summary: 'extract fields from each line',
    run: (ctx, argv, io) => {
      const { values, operands } = parseArgs(argv, { valued: ['-d', '-f'] });
      const delim = values.get('-d') ?? '\t';
      const fieldSpec = values.get('-f');
      if (!fieldSpec) return usage(io, 'usage: cut -f LIST [-d DELIM] [FILE...]');
      const fields = fieldSpec.split(',').map((f) => Number(f) - 1);
      const { text, code } = readInputs(ctx, io, operands, 'cut');
      const out = lines(text).map((line) => {
        const parts = line.split(delim);
        return fields.map((f) => parts[f] ?? '').join(delim);
      });
      emit(io, out);
      return code;
    },
  },

  {
    name: 'tr',
    summary: 'translate or delete characters',
    run: (_ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'usage: tr [-d] SET1 [SET2]');
      const set1 = expandSet(operands[0]!);
      if (flags.has('-d')) {
        io.out([...io.stdin].filter((c) => !set1.includes(c)).join(''));
        return 0;
      }
      const set2 = expandSet(operands[1] ?? '');
      if (set2.length === 0) return usage(io, 'tr: missing operand after SET1');
      const map = new Map<string, string>();
      for (const [i, c] of set1.entries()) {
        map.set(c, set2[Math.min(i, set2.length - 1)]!);
      }
      io.out([...io.stdin].map((c) => map.get(c) ?? c).join(''));
      return 0;
    },
  },

  {
    name: 'sed',
    summary: 'stream editor — supports s/pattern/replacement/[g]',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'usage: sed [-i] s/PATTERN/REPLACEMENT/[g] [FILE...]');
      const script = operands[0]!;
      const inPlace = flags.has('-i');

      const m = /^s(.)(.*?)(?<!\\)\1(.*?)(?<!\\)\1([gi]*)$/.exec(script);
      if (!m) {
        io.err(`sed: unsupported script '${script}' (only s/pattern/replacement/ is implemented)\n`);
        return 2;
      }
      const [, , pattern = '', replacement = '', modifiers = ''] = m;

      let re: RegExp;
      try {
        re = new RegExp(pattern, modifiers.includes('g') ? 'g' : '');
      } catch {
        io.err(`sed: invalid regular expression '${pattern}'\n`);
        return 2;
      }

      const files = operands.slice(1);
      if (files.length === 0) {
        io.out(applySed(io.stdin, re, replacement));
        return 0;
      }

      let code = 0;
      for (const file of files) {
        const abs = ctx.resolve(file);
        try {
          const result = applySed(ctx.vfs.readText(abs, ctx.user), re, replacement);
          if (inPlace) ctx.vfs.writeText(abs, result, ctx.user);
          else io.out(result);
        } catch (e) {
          const reason = e instanceof Error && 'reason' in e ? (e as { reason: string }).reason : String(e);
          io.err(`sed: ${file}: ${reason}\n`);
          code = 1;
        }
      }
      return code;
    },
  },
];

function applySed(text: string, re: RegExp, replacement: string): string {
  const trailing = text.endsWith('\n');
  const rows = lines(text).map((line) => line.replace(re, replacement));
  if (rows.length === 0) return '';
  return rows.join('\n') + (trailing ? '\n' : '');
}

function formatCounts(
  flags: Set<string>,
  only: boolean,
  l: number,
  w: number,
  c: number,
  name: string,
): string {
  const cols: number[] = [];
  if (!only || flags.has('-l')) cols.push(l);
  if (!only || flags.has('-w')) cols.push(w);
  if (!only || flags.has('-c')) cols.push(c);
  return cols.map((n) => String(n).padStart(7)).join('') + (name ? ` ${name}` : '');
}

/** Expand `a-z` ranges and common escapes inside a tr SET. */
function expandSet(spec: string): string[] {
  const unescaped = spec.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  const out: string[] = [];
  for (let i = 0; i < unescaped.length; i++) {
    const next = unescaped[i + 1];
    const after = unescaped[i + 2];
    if (next === '-' && after !== undefined) {
      for (let c = unescaped.charCodeAt(i); c <= unescaped.charCodeAt(i + 2); c++) {
        out.push(String.fromCharCode(c));
      }
      i += 2;
      continue;
    }
    out.push(unescaped[i]!);
  }
  return out;
}
