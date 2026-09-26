import * as p from '../vfs/path.js';
import { execArgv, type CommandSpec } from '../shell/exec.js';
import { emit, lines, parseArgs, usage } from './helpers.js';

/**
 * The small commands that answer "what is this thing".
 *
 * Every one of these was reached for during a command sweep and was not
 * there. They are cheap individually and they matter collectively: a shell
 * where half the obvious questions have no answer teaches people to stop
 * asking, which is the same failure furniture causes in the world.
 */

/** Is this byte run plausibly text? The same question `file` actually asks. */
function looksTextual(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  // A NUL is the classic giveaway, and more than a few unprintables means
  // whatever it is, nobody wants it on their terminal.
  let odd = 0;
  for (const byte of bytes.slice(0, 1024)) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) odd++;
  }
  return odd / Math.min(bytes.length, 1024) < 0.1;
}

export const inspectCommands: CommandSpec[] = [
  {
    name: 'realpath',
    summary: 'resolve a path to its real one',
    manual:
      'realpath PATH...\n' +
      '\n' +
      'Print the absolute path with every symlink and every . and .. resolved.\n' +
      'Fails if the path does not exist, which is the point: a link that goes\n' +
      'nowhere is a different problem from a link you cannot read, and this\n' +
      'says which you have.',
    plain:
      'Tells you where a path really points, following any shortcuts.\n' +
      '\n' +
      '    realpath /opt/luna/v43\n' +
      '\n' +
      'Useful when ls shows a name with an arrow after it and you want to\n' +
      'know what is on the other end.',
    run: (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'usage: realpath PATH...');
      let code = 0;
      for (const operand of operands) {
        try {
          emit(io, [ctx.vfs.realpath(ctx.resolve(operand), ctx.user)]);
        } catch {
          io.err(`realpath: ${operand}: No such file or directory\n`);
          code = 1;
        }
      }
      return code;
    },
  },

  {
    name: 'readlink',
    summary: 'print what a symlink points at',
    manual:
      'readlink [-f] PATH...\n' +
      '\n' +
      'Print the target of a symbolic link. Unlike realpath this works on a\n' +
      'link whose target does not exist -- the link still says where it meant\n' +
      'to go, and that is often the only thing left to learn from it.\n' +
      '\n' +
      '  -f  resolve the whole chain, which does require the target to exist\n' +
      '\n' +
      'Exits 1 on anything that is not a link.',
    plain:
      'Tells you where a shortcut points.\n' +
      '\n' +
      '    readlink /opt/luna/v43\n' +
      '\n' +
      'It works even when the thing on the other end is missing, which is\n' +
      'exactly when you most want to know where it was supposed to be.',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'usage: readlink [-f] PATH...');
      const chase = flags.has('-f');

      let code = 0;
      for (const operand of operands) {
        const abs = ctx.resolve(operand);
        try {
          emit(io, [chase ? ctx.vfs.realpath(abs, ctx.user) : ctx.vfs.readlink(abs, ctx.user)]);
        } catch {
          // Real readlink is silent here and exits 1. Not every path is a
          // link, and saying so on stderr would make `readlink` unusable in
          // the loops people write around it.
          code = 1;
        }
      }
      return code;
    },
  },

  {
    name: 'file',
    summary: 'say what kind of thing a file is',
    manual:
      'file PATH...\n' +
      '\n' +
      'Guess what a file contains by looking at it rather than at its name.\n' +
      'Directories, symlinks, empty files, text and data are distinguished;\n' +
      'a script with a #! line is named by its interpreter.',
    plain:
      'Tells you what sort of file something is without opening it.\n' +
      '\n' +
      '    file /usr/local/bin/hull-check\n' +
      '\n' +
      'Handy before you cat something: a file full of binary will make a mess\n' +
      'of your terminal, and this is how you find out first.',
    run: (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'usage: file PATH...');

      let code = 0;
      for (const operand of operands) {
        const abs = ctx.resolve(operand);
        let stat;
        try {
          stat = ctx.vfs.lstat(abs, ctx.user);
        } catch {
          emit(io, [`${operand}: cannot open (No such file or directory)`]);
          code = 1;
          continue;
        }

        if (stat.kind === 'dir') {
          emit(io, [`${operand}: directory`]);
          continue;
        }
        if (stat.kind === 'symlink') {
          const target = ctx.vfs.readlink(abs, ctx.user);
          const dangling = ctx.vfs.exists(abs, ctx.user) ? '' : ' (broken)';
          emit(io, [`${operand}: symbolic link to ${target}${dangling}`]);
          continue;
        }

        let bytes: Uint8Array;
        try {
          bytes = ctx.vfs.read(abs, ctx.user);
        } catch {
          emit(io, [`${operand}: cannot open (Permission denied)`]);
          code = 1;
          continue;
        }

        if (bytes.length === 0) {
          emit(io, [`${operand}: empty`]);
          continue;
        }
        if (!looksTextual(bytes)) {
          emit(io, [`${operand}: data`]);
          continue;
        }

        const text = new TextDecoder().decode(bytes);
        const shebang = /^#!\s*(\S+)/.exec(text);
        if (shebang) {
          const interpreter = p.basename(shebang[1] ?? '');
          const named = interpreter === 'env' ? (/^#!\s*\S+\s+(\S+)/.exec(text)?.[1] ?? 'script') : interpreter;
          const exec = (stat.mode & 0o111) !== 0 ? '' : ', not executable';
          emit(io, [`${operand}: ${named} script, ASCII text${exec}`]);
          continue;
        }
        emit(io, [`${operand}: ASCII text`]);
      }
      return code;
    },
  },

  {
    name: 'type',
    summary: 'say what a command actually is',
    manual:
      'type NAME...\n' +
      '\n' +
      'Say how the shell would resolve a name: a builtin, or a file on PATH.\n' +
      'This is the question behind half of "but it works for me" -- two\n' +
      'machines with the same command name running different things.',
    plain:
      'Tells you what a command is and where it comes from.\n' +
      '\n' +
      '    type ls\n' +
      '    type hull-check\n' +
      '\n' +
      'If a command is not found, this tells you that too, which is a faster\n' +
      'answer than running it and reading the error.',
    run: (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'usage: type NAME...');

      let code = 0;
      for (const name of operands) {
        if (ctx.commands.has(name)) {
          emit(io, [`${name} is a shell builtin`]);
          continue;
        }
        const found = (ctx.env['PATH'] ?? '')
          .split(':')
          .filter((dir) => dir.length > 0)
          .map((dir) => p.join(dir, name))
          .find((candidate) => {
            try {
              return (ctx.vfs.stat(candidate, ctx.user).mode & 0o111) !== 0;
            } catch {
              return false;
            }
          });
        if (found) {
          emit(io, [`${name} is ${found}`]);
          continue;
        }
        io.err(`type: ${name}: not found\n`);
        code = 1;
      }
      return code;
    },
  },

  {
    name: 'diff',
    summary: 'show what changed between two files',
    manual:
      'diff [-q] FILE1 FILE2\n' +
      '\n' +
      'Compare line by line and print the lines that differ, in the classic\n' +
      'format: < is FILE1, > is FILE2.\n' +
      '\n' +
      '  -q  say only whether they differ\n' +
      '\n' +
      'Exits 0 when they match and 1 when they do not, so it can be tested.\n' +
      'Copy a config before you edit it and this tells you exactly what you\n' +
      'did, which is the cheapest review available.',
    plain:
      'Compares two files and shows the lines that are not the same.\n' +
      '\n' +
      '    cp /etc/life_support.conf /tmp/before\n' +
      '    vi /etc/life_support.conf\n' +
      '    diff /tmp/before /etc/life_support.conf\n' +
      '\n' +
      'Lines marked < come from the first file, lines marked > from the\n' +
      'second. Nothing printed means the files are identical.',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      if (operands.length !== 2) return usage(io, 'usage: diff [-q] FILE1 FILE2');
      const [left, right] = operands as [string, string];

      const load = (name: string): string[] | undefined => {
        try {
          return lines(ctx.vfs.readText(ctx.resolve(name), ctx.user));
        } catch (e) {
          const reason = e instanceof Error && 'reason' in e ? (e as { reason: string }).reason : String(e);
          io.err(`diff: ${name}: ${reason}\n`);
          return undefined;
        }
      };

      const a = load(left);
      const b = load(right);
      if (!a || !b) return 2;

      /*
       * A line-by-line comparison, not a real LCS diff.
       *
       * Honest about what it is: this reports the lines that differ at the
       * same position, which is exactly right for the thing it is for here --
       * comparing a config against a copy of itself, where a value changed
       * and nothing moved. A real edit-distance diff is a genuinely
       * interesting algorithm and belongs in the game that teaches it, not
       * smuggled in here.
       */
      const changes: string[] = [];
      const height = Math.max(a.length, b.length);
      for (let i = 0; i < height; i++) {
        const from = a[i];
        const to = b[i];
        if (from === to) continue;
        changes.push(`${i + 1}c${i + 1}`);
        if (from !== undefined) changes.push(`< ${from}`);
        if (from !== undefined && to !== undefined) changes.push('---');
        if (to !== undefined) changes.push(`> ${to}`);
      }

      if (changes.length === 0) return 0;
      if (flags.has('-q')) {
        emit(io, [`Files ${left} and ${right} differ`]);
        return 1;
      }
      emit(io, changes);
      return 1;
    },
  },

  {
    name: 'xargs',
    summary: 'turn input into arguments for another command',
    manual:
      'xargs [-n MAX] COMMAND [ARG...]\n' +
      '\n' +
      'Read words from standard input and run COMMAND with them appended.\n' +
      '\n' +
      '  -n MAX  at most MAX arguments per run, so the command runs repeatedly\n' +
      '\n' +
      'The classic use is turning a list of names into a list of things done\n' +
      'to them:\n' +
      '\n' +
      '  ls /etc/hull | xargs -n 1 echo checking\n' +
      '\n' +
      'A pipe sends text to a command\'s input. Many commands want arguments\n' +
      'instead, and this is the adapter between the two.',
    plain:
      'Takes a list of things coming down a pipe and hands them to another\n' +
      'command as arguments.\n' +
      '\n' +
      '    grep -l SEALED=no /etc/hull/*.conf | xargs cat\n' +
      '\n' +
      'Some commands read a pipe. Others only take filenames. xargs is how\n' +
      'you connect the first kind to the second.',
    run: async (ctx, argv, io) => {
      // `-n` takes a value, which `parseArgs` knows how to do properly --
      // reaching into argv by hand left the count sitting in `operands` and
      // xargs ran the number as the command.
      const { values, operands } = parseArgs(argv, { valued: ['-n', '--max-args'] });
      const maxText = values.get('-n') ?? values.get('--max-args');
      const max = maxText === undefined ? Infinity : Number(maxText);
      if (maxText !== undefined && (!Number.isFinite(max) || max < 1)) {
        return usage(io, `xargs: invalid number '${maxText}'`);
      }

      const command = operands.length > 0 ? operands : ['echo'];

      const words = io.stdin.split(/\s+/).filter((w) => w.length > 0);
      if (words.length === 0) {
        // Real xargs runs the command once with no arguments. That surprises
        // people, and here it would mean `cat` reading a pipe that is empty.
        return 0;
      }

      const size = Number.isFinite(max) ? Math.max(1, max) : words.length;
      let code = 0;
      for (let i = 0; i < words.length; i += size) {
        const batch = words.slice(i, i + size);
        const result = await execArgv(ctx, [...command, ...batch], io);
        if (result !== 0) code = result;
      }
      return code;
    },
  },
];
