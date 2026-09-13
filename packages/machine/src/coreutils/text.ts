import type { CommandSpec } from '../shell/exec.js';
import { isFsError } from '../errors.js';
import { emit, expandTree, lines, parseArgs, readInputs, takeCountOperand, usage } from './helpers.js';

export const textCommands: CommandSpec[] = [
  {
    name: 'tee',
    summary: 'copy stdin to a file and to stdout',
    manual:
      'tee [-a] FILE...\n\n' +
      'Read standard input, write it to each FILE and to standard output.\n' +
      '  -a  append instead of overwriting\n\n' +
      'The point is the "and": a pipeline can be saved and kept flowing at the\n' +
      'same time, which `>` cannot do because it swallows the output.',
    plain:
      'Saves what is coming down a pipe to a file AND keeps it on screen.\n' +
      '  cat /var/log/boot.log | grep FAIL | tee fails.txt\n' +
      'You see the failures and you have a copy of them. Add -a to add to the\n' +
      'end of a file instead of replacing it.',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv, { flags: ['-a'] });
      const append = flags.has('-a');
      let code = 0;

      for (const operand of operands) {
        const path = ctx.resolve(operand);
        try {
          if (append && ctx.vfs.exists(path, ctx.user)) ctx.vfs.append(path, io.stdin, ctx.user);
          else ctx.vfs.writeText(path, io.stdin, ctx.user);
        } catch (e) {
          io.err(`tee: ${operand}: ${isFsError(e) ? e.reason : String(e)}\n`);
          code = 1;
        }
      }

      // Down the pipe as well, always -- that is the whole job.
      io.out(io.stdin);
      return code;
    },
  },

  {
    name: 'echo',
    summary: 'write arguments to standard output',
    manual:
      'echo [ARG...]\n' +
      '\n' +
      'Write its arguments to standard output, separated by spaces.\n' +
      '\n' +
      'Mostly used to see what an expansion actually produced, and to put text\n' +
      'into a file with a redirect:\n' +
      '\n' +
      '  echo O2_TARGET=21 >> /etc/life_support.conf\n' +
      '  echo "$PATH"',
    plain:
      'Prints whatever you give it.\n' +
      '\n' +
      '  echo hello                     prints hello\n' +
      '  echo $HOME                     prints your home directory\n' +
      '  echo O2_TARGET=21 > file       puts that line INTO a file, replacing it\n' +
      '  echo more >> file              adds a line to the END of a file\n' +
      '\n' +
      'One > replaces the whole file. Two >> adds to it. Getting those the\n' +
      'wrong way round is how people lose work.',
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
    manual:
      'grep [-i] [-v] [-c] [-n] [-l] [-r] PATTERN [FILE...]\n' +
      '\n' +
      'Print the lines of each FILE that match PATTERN. With no FILE, read\n' +
      'standard input. PATTERN is a regular expression.\n' +
      '\n' +
      '  -i  ignore case\n' +
      '  -v  invert: print the lines that do NOT match\n' +
      '  -c  print how many lines matched, not the lines\n' +
      '  -n  prefix each line with its number in the file\n' +
      '  -l  print only the names of files with a match\n' +
      '  -r  recurse into directories (defaults to . with no FILE)\n' +
      '\n' +
      'This is the command that makes a large file usable. `cat` a five hundred\n' +
      'line log and you have learned nothing; grep one word out of it and you\n' +
      'have an answer. -c and a pipe into `sort | uniq -c` turn matches into\n' +
      'counts, which is how you tell a pattern from a coincidence.',
    plain:
      'Finds the lines in a file that contain a word, and prints just those.\n' +
      '\n' +
      '  grep FAIL /var/log/boot.log            the lines that say FAIL\n' +
      '  grep -i fail /var/log/boot.log         ignore capital letters\n' +
      '  grep -c FAIL /var/log/boot.log         just count them\n' +
      '  grep -n FAIL /var/log/boot.log         show line numbers\n' +
      '  grep -v OK /var/log/hull.log           the lines that DO NOT say OK\n' +
      '  grep -r scrubber /etc                  search a whole directory\n' +
      '\n' +
      'This is the most useful command on the ship. A log with five hundred\n' +
      'lines in it is unreadable and greppable at the same time.',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'usage: grep [-inv] PATTERN [FILE...]');

      const pattern = operands[0]!;
      const recursive = flags.has('-r') || flags.has('-R');

      // The README sends the player to look in /etc, and `grep -r` is how
      // anyone does that. Refusing a directory made the obvious move wrong.
      // With no path at all, recursive grep searches the current directory --
      // `grep -r needle` on its own is the commonest form of the command.
      const given = operands.slice(1);
      const targets = recursive && given.length === 0 ? ['.'] : given;
      const treeErrors: string[] = [];
      const files = recursive
        ? targets.flatMap((operand) => {
            const found = expandTree(ctx, operand);
            treeErrors.push(...found.errors);
            return found.files;
          })
        : targets;
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

      // A directory it could not open is an error like any other: say so, and
      // let it count towards the exit status.
      for (const error of treeErrors) io.err(`grep: ${error}\n`);
      const { sources, code } = readInputs(ctx, io, files, 'grep');
      // Recursive output always names the file, even for a single match: the
      // whole point was finding out *where* it is.
      const showName = files.length > 1 || recursive;
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
      if (code !== 0 || treeErrors.length > 0) return 2;
      return matched ? 0 : 1;
    },
  },

  {
    name: 'head',
    summary: 'output the first lines of a file',
    manual:
      'head [-n COUNT] [FILE...]\n' +
      '\n' +
      'Print the first COUNT lines of each FILE. Default 10. `head -3` works as\n' +
      'well as `head -n 3`.',
    plain:
      'Shows the beginning of a file -- the first ten lines, unless you ask for\n' +
      'a different number.\n' +
      '\n' +
      '  head file          first 10 lines\n' +
      '  head -3 file       first 3',
    run: (ctx, argv, io) => {
      const parsed = parseArgs(argv, { valued: ['-n'] });
      // `head -5` as well as `head -n 5`: the bare form is what people type.
      const { count: bare, rest: operands } = takeCountOperand(parsed.operands, parsed.separator);
      const count = Number(parsed.values.get('-n') ?? bare ?? 10);
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
    manual:
      'tail [-n COUNT] [FILE...]\n' +
      '\n' +
      'Print the last COUNT lines of each FILE. Default 10.\n' +
      '\n' +
      'On a log this is usually the right question: the end is now, and the\n' +
      'beginning is history. `grep X file | tail` answers "is it still\n' +
      'happening" where `grep -c` only answers "did it ever".',
    plain:
      'Shows the END of a file -- the last ten lines, unless you ask for more.\n' +
      '\n' +
      '  tail file          last 10 lines\n' +
      '  tail -20 file      last 20\n' +
      '\n' +
      'For a log, the end is what is happening now. That is usually the part\n' +
      'you want.',
    run: (ctx, argv, io) => {
      const parsed = parseArgs(argv, { valued: ['-n'] });
      // `head -5` as well as `head -n 5`: the bare form is what people type.
      const { count: bare, rest: operands } = takeCountOperand(parsed.operands, parsed.separator);
      const count = Number(parsed.values.get('-n') ?? bare ?? 10);
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
    manual:
      'wc [-l] [-w] [-c] [FILE...]\n' +
      '\n' +
      'Count lines, words and bytes.\n' +
      '\n' +
      '  -l  lines only\n' +
      '  -w  words only\n' +
      '  -c  bytes only\n' +
      '\n' +
      '`wc -l` on the end of a pipe is how you find out how big the thing you\n' +
      'just found actually is.',
    plain:
      'Counts things in a file.\n' +
      '\n' +
      '  wc -l file                 how many lines\n' +
      '  grep FAIL log | wc -l      how many lines matched\n' +
      '\n' +
      'Useful for finding out whether "a few" is three or three hundred.',
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
    manual:
      'sort [-n] [-r] [-u] [FILE...]\n' +
      '\n' +
      'Sort lines.\n' +
      '\n' +
      '  -n  compare as numbers, so 9 comes before 10\n' +
      '  -r  reverse\n' +
      '  -u  drop duplicates\n' +
      '\n' +
      'Almost always paired with uniq, which only notices duplicates that are\n' +
      'already next to each other.',
    plain:
      'Puts lines in order.\n' +
      '\n' +
      '  sort file            alphabetical\n' +
      '  sort -n file         numerical (9 before 10, not after)\n' +
      '  sort -r file         backwards\n' +
      '\n' +
      'Sorting first is what makes  uniq  work, because uniq only spots\n' +
      'repeats that are already neighbours.',
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
    manual:
      'uniq [-c] [-d] [FILE...]\n' +
      '\n' +
      'Collapse repeated ADJACENT lines.\n' +
      '\n' +
      '  -c  prefix each line with the number of times it occurred\n' +
      '  -d  print only the lines that repeated\n' +
      '\n' +
      'It only ever compares a line with the one before it, so sort first.\n' +
      '`sort | uniq -c` is the standard way to count how often each distinct\n' +
      'thing appears.',
    plain:
      'Removes repeated lines that are next to each other, and can count them.\n' +
      '\n' +
      '  sort names | uniq            each name once\n' +
      '  sort names | uniq -c         each name, with how many times it appeared\n' +
      '\n' +
      'Always sort first. uniq only notices a repeat if it is directly above.',
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
    manual:
      'cut -d DELIM -f LIST [FILE...]\n' +
      '\n' +
      'Print selected fields of each line.\n' +
      '\n' +
      '  -d  the character that separates fields (default tab)\n' +
      '  -f  which fields, counting from 1: -f 2 or -f 1,3\n' +
      '\n' +
      '  cut -d, -f1 /etc/crew.csv\n' +
      '  grep DROP log | cut -d\' \' -f2 | sort | uniq -c\n' +
      '\n' +
      'That last line is the shape of most real log work: find the lines, take\n' +
      'the one column that matters, and count what is left.',
    plain:
      'Pulls one column out of each line.\n' +
      '\n' +
      '  cut -d, -f1 /etc/crew.csv        first column of a comma-separated file\n' +
      '  cut -d\' \' -f2 file               second word of each line\n' +
      '\n' +
      '-d says what separates the columns, -f says which one you want. It is\n' +
      'how you turn lines into a list of just the part you care about.',
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
    manual:
      'tr [-d] SET1 [SET2]\n' +
      '\n' +
      'Translate characters from SET1 to SET2, position by position.\n' +
      '\n' +
      '  -d  delete the characters in SET1 instead\n' +
      '\n' +
      '  tr a-z A-Z      upper-case everything\n' +
      '  tr -d \' \'       remove every space\n' +
      '\n' +
      'Characters, not words: tr has no idea what a word is.',
    plain:
      'Swaps one set of characters for another, letter by letter.\n' +
      '\n' +
      '  tr a-z A-Z        make everything capitals\n' +
      '  tr -d \' \'         delete all the spaces\n' +
      '\n' +
      'It works on single characters, so it cannot replace a whole word. For\n' +
      'that, use sed.',
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
    manual:
      'sed [-i] s/PATTERN/REPLACEMENT/[g] [FILE...]\n' +
      '\n' +
      'Substitute. PATTERN is a regular expression; only the s command is\n' +
      'implemented aboard.\n' +
      '\n' +
      '  -i  edit the file in place instead of printing the result\n' +
      '  g   replace every match on a line, not just the first\n' +
      '  i   match without regard to case\n' +
      '\n' +
      '  sed \'s/no/yes/\' /etc/hull/c7.conf                  print the change\n' +
      '  sed -i \'s/^SEALED=.*/SEALED=yes/\' /etc/hull/c7.conf make it\n' +
      '\n' +
      'Run it without -i first. What it prints is exactly what it would have\n' +
      'written, which is a free rehearsal of an edit you cannot undo. ^ anchors\n' +
      'to the start of a line and .* means "the rest of it", so that pattern\n' +
      'replaces a whole SEALED= line whatever it used to say.',
    plain:
      'Changes text in a file without opening an editor.\n' +
      '\n' +
      '  sed \'s/old/new/\' file        show the file with old swapped for new\n' +
      '  sed -i \'s/old/new/\' file     actually change the file\n' +
      '\n' +
      'Without -i it only shows you what WOULD happen -- which is a good way to\n' +
      'check before you commit to it. Add a g at the end to replace every\n' +
      'match on a line instead of only the first:\n' +
      '\n' +
      '  sed -i \'s/16/21/g\' file\n' +
      '\n' +
      'It is the fast way to fix one number in a config file when you do not\n' +
      'feel like using vi.',
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
