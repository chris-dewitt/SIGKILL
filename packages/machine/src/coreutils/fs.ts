import { FsError, isFsError } from '../errors.js';
import * as p from '../vfs/path.js';
import type { CommandSpec } from '../shell/exec.js';
import { emit, formatMode, groupNames, looksLikeMode, parseArgs, parseMode, passwdNames, usage } from './helpers.js';

export const fsCommands: CommandSpec[] = [
  {
    name: 'basename',
    summary: 'strip the directory from a path',
    manual:
      'basename PATH [SUFFIX]\n\n' +
      'Print PATH with any leading directories removed, and SUFFIX removed\n' +
      'from the end if it is there.',
    plain:
      'Gives you just the file name out of a long path.\n' +
      '  basename /etc/life_support.conf        -> life_support.conf\n' +
      '  basename /etc/life_support.conf .conf  -> life_support',
    run: (_ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      const path = operands[0];
      if (path === undefined) return usage(io, 'basename: missing operand');

      // Trailing slashes are not part of the name: basename /etc/ is "etc".
      const trimmed = path.replace(/\/+$/, '');
      let name = trimmed.slice(trimmed.lastIndexOf('/') + 1);
      const suffix = operands[1];
      if (suffix !== undefined && name !== suffix && name.endsWith(suffix)) {
        name = name.slice(0, -suffix.length);
      }
      io.out((name === '' ? '/' : name) + '\n');
      return 0;
    },
  },

  {
    name: 'dirname',
    summary: 'strip the file name from a path',
    manual: 'dirname PATH\n\nPrint PATH with its last component removed.',
    plain:
      'Gives you the folder a path is in.\n' +
      '  dirname /etc/life_support.conf  -> /etc',
    run: (_ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      const path = operands[0];
      if (path === undefined) return usage(io, 'dirname: missing operand');

      const trimmed = path.replace(/\/+$/, '');
      // An all-slash path trims to nothing and is the root. Answering "." there
      // would send `cd "$(dirname "$p")"` somewhere else entirely once a script
      // walked up to /.
      if (trimmed === '') {
        io.out((path.startsWith('/') ? '/' : '.') + '\n');
        return 0;
      }
      const cut = trimmed.lastIndexOf('/');
      // No slash at all means "here", which is what makes `cd $(dirname x)`
      // safe on a bare filename.
      if (cut < 0) io.out('.\n');
      else io.out((cut === 0 ? '/' : trimmed.slice(0, cut)) + '\n');
      return 0;
    },
  },

  {
    name: 'pwd',
    summary: 'print the current working directory',
    manual:
      'pwd\n' +
      '\n' +
      'Print the absolute path of the current working directory.\n' +
      '\n' +
      'Worth typing whenever a relative path does something you did not expect.\n' +
      'Most "the file was empty" confusion is really "I was not where I thought".',
    plain:
      'Prints where you are.\n' +
      '\n' +
      'Paths are like folders: /home/survivor/logs means logs, inside survivor,\n' +
      'inside home. pwd tells you which of those you are standing in right now.',
    run: (ctx, _argv, io) => {
      io.out(ctx.cwd + '\n');
      return 0;
    },
  },

  {
    name: 'cd',
    summary: 'change the current directory',
    manual:
      'cd [DIR]\n' +
      '\n' +
      'Change the working directory. With no argument, go to $HOME.\n' +
      '\n' +
      '  cd /etc      absolute: from the root, no matter where you are\n' +
      '  cd logs      relative: inside where you already are\n' +
      '  cd ..        up one\n' +
      '  cd -         back to the previous directory',
    plain:
      'Moves you to a different directory.\n' +
      '\n' +
      '  cd logs    go into the logs directory that is here\n' +
      '  cd ..      go back up one\n' +
      '  cd         go home\n' +
      '\n' +
      'If it says "no such file or directory", run ls first and see what is\n' +
      'actually there. Names are case sensitive.',
    run: (ctx, argv, io) => {
      const target = argv[1] ?? ctx.home;
      const dest = target === '-' ? (ctx.env['OLDPWD'] ?? ctx.cwd) : ctx.resolve(target);
      try {
        const stat = ctx.vfs.stat(dest, ctx.user);
        if (stat.kind !== 'dir') {
          io.err(`cd: ${target}: Not a directory\n`);
          return 1;
        }
        if (!ctx.vfs.access(dest, 'x', ctx.user)) {
          io.err(`cd: ${target}: Permission denied\n`);
          return 1;
        }
      } catch (e) {
        io.err(`cd: ${target}: ${isFsError(e) ? e.reason : String(e)}\n`);
        return 1;
      }
      ctx.env['OLDPWD'] = ctx.cwd;
      ctx.cwd = ctx.vfs.realpath(dest, ctx.user);
      ctx.env['PWD'] = ctx.cwd;
      return 0;
    },
  },

  {
    name: 'ls',
    summary: 'list directory contents',
    manual:
      'ls [-l] [-a] [PATH...]\n' +
      '\n' +
      'List directory contents, or a named file.\n' +
      '\n' +
      '  -l  long form: mode, owner, group, size, name\n' +
      '  -a  include entries beginning with a dot\n' +
      '\n' +
      'The -l column is ten characters: type, then read/write/execute for the\n' +
      'owner, the group and everybody else. `-rwxr-xr-x` is a file anyone may\n' +
      'run; `-rw-r--r--` is the same file that nobody may run. A missing x is\n' +
      'invisible to cat and obvious here.',
    plain:
      'Lists what is in a directory.\n' +
      '\n' +
      '  ls            what is here\n' +
      '  ls /etc       what is in /etc\n' +
      '  ls -l         the long version: who owns each thing, how big, and who\n' +
      '                is allowed to do what with it\n' +
      '  ls -a         also show hidden files, the ones whose names start with .\n' +
      '\n' +
      'In the long version the left hand column is permissions. The x letters\n' +
      'mean "may be run as a program". If a script will not run, look there.',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      const long = flags.has('-l');
      const all = flags.has('-a') || flags.has('-A');
      const targets = operands.length > 0 ? operands : ['.'];
      let code = 0;
      const blocks: string[] = [];

      for (const target of targets) {
        const abs = ctx.resolve(target);
        let stat;
        try {
          stat = ctx.vfs.stat(abs, ctx.user);
        } catch (e) {
          io.err(`ls: cannot access '${target}': ${isFsError(e) ? e.reason : String(e)}\n`);
          code = 2;
          continue;
        }

        /*
         * Display name and the path to stat are not the same thing, and
         * conflating them was a real bug: `ls -l /etc/motd` joined the operand
         * onto its own directory, failed to stat the nonsense that came out,
         * and silently printed the bare filename with no mode, owner or size.
         * It only ever showed up on an absolute path, which is why it survived.
         */
        let entries: Array<{ name: string; path: string }>;
        if (stat.kind === 'dir') {
          let names: string[];
          try {
            names = ctx.vfs.readdir(abs, ctx.user);
          } catch (e) {
            io.err(`ls: cannot open directory '${target}': ${isFsError(e) ? e.reason : String(e)}\n`);
            code = 2;
            continue;
          }
          if (all) names = ['.', '..', ...names];
          entries = names.map((name) => ({
            name,
            path: name === '.' ? abs : name === '..' ? p.dirname(abs) : p.join(abs, name),
          }));
        } else {
          // A named file is listed as the player named it, and stat'd by where
          // it actually is.
          entries = [{ name: target, path: abs }];
        }

        // Resolved once per target rather than once per row: a directory of
        // forty files should not re-read /etc/passwd forty times.
        const users = long ? passwdNames(ctx) : new Map<number, string>();
        const groups = long ? groupNames(ctx) : new Map<number, string>();

        interface Row { mode: string; owner: string; group: string; size: string; label: string }
        const cells: Row[] = [];
        const rows: string[] = [];

        for (const { name, path: childPath } of entries) {
          if (!all && p.basename(name).startsWith('.') && stat.kind === 'dir') continue;
          if (!long) { rows.push(name); continue; }
          try {
            const s = ctx.vfs.lstat(childPath, ctx.user);
            const link = s.kind === 'symlink' ? ` -> ${ctx.vfs.readlink(childPath, ctx.user)}` : '';
            // A uid with no passwd entry prints as its number, which is what
            // real ls does and is a real thing to notice about a file.
            cells.push({
              mode: formatMode(s.kind, s.mode),
              owner: users.get(s.uid) ?? String(s.uid),
              group: groups.get(s.gid) ?? String(s.gid),
              size: String(s.size),
              label: `${name}${link}`,
            });
          } catch {
            rows.push(name);
          }
        }

        if (cells.length > 0) {
          // Column widths come from the longest entry, as real ls does. A fixed
          // width is fine until a group is called "engineering", and then every
          // row after it is a different shape and the listing stops being
          // readable at a glance -- which is the only thing `-l` is for.
          const width = (pick: (row: Row) => string): number =>
            Math.max(...cells.map((row) => pick(row).length));
          const owners = width((r) => r.owner);
          const groupWidth = width((r) => r.group);
          const sizes = width((r) => r.size);
          rows.push(
            ...cells.map(
              (r) =>
                `${r.mode} ${r.owner.padEnd(owners)} ${r.group.padEnd(groupWidth)} ` +
                `${r.size.padStart(sizes)} ${r.label}`,
            ),
          );
        }

        if (targets.length > 1 && stat.kind === 'dir') blocks.push(`${target}:\n${rows.join('\n')}`);
        else blocks.push(rows.join('\n'));
      }

      const text = blocks.filter((b) => b.length > 0).join('\n\n');
      if (text.length > 0) io.out(text + '\n');
      return code;
    },
  },

  {
    name: 'cat',
    summary: 'concatenate files to standard output',
    manual:
      'cat [-n] [FILE...]\n' +
      '\n' +
      'Concatenate files to standard output. With no FILE, read standard input.\n' +
      '\n' +
      '  -n  number the lines\n' +
      '\n' +
      'Fine for a note, wrong for a log. A file of five hundred lines scrolls\n' +
      'past and teaches you nothing; use grep, head or tail on those.',
    plain:
      'Prints the whole contents of a file onto the screen.\n' +
      '\n' +
      '  cat README        read the note\n' +
      '  cat -n file       with line numbers\n' +
      '\n' +
      'Good for short files. For a long one, everything scrolls away -- use\n' +
      'head, tail or grep instead.',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      const number = flags.has('-n');
      if (operands.length === 0) {
        io.out(number ? numberLines(io.stdin) : io.stdin);
        return 0;
      }
      let code = 0;
      for (const operand of operands) {
        if (operand === '-') { io.out(io.stdin); continue; }
        try {
          const text = ctx.vfs.readText(ctx.resolve(operand), ctx.user);
          io.out(number ? numberLines(text) : text);
        } catch (e) {
          io.err(`cat: ${operand}: ${isFsError(e) ? e.reason : String(e)}\n`);
          code = 1;
        }
      }
      return code;
    },
  },

  {
    name: 'mkdir',
    summary: 'create directories',
    manual:
      'mkdir [-p] DIR...\n' +
      '\n' +
      'Create directories.\n' +
      '\n' +
      '  -p  create missing parents, and do not complain if it already exists',
    plain:
      'Makes a new directory.\n' +
      '\n' +
      '  mkdir notes            make one here\n' +
      '  mkdir -p a/b/c         make the whole chain, even if a and b are missing',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'mkdir: missing operand');
      let code = 0;
      for (const operand of operands) {
        try {
          if (flags.has('-p')) ctx.vfs.mkdirp(ctx.resolve(operand), ctx.user);
          else ctx.vfs.mkdir(ctx.resolve(operand), ctx.user);
        } catch (e) {
          io.err(`mkdir: cannot create directory '${operand}': ${isFsError(e) ? e.reason : String(e)}\n`);
          code = 1;
        }
      }
      return code;
    },
  },

  {
    name: 'rmdir',
    summary: 'remove empty directories',
    manual:
      'rmdir DIR...\n' +
      '\n' +
      'Remove empty directories. Refuses a directory with anything in it, which\n' +
      'is the entire reason to prefer it to `rm -r`.',
    plain:
      'Deletes an empty directory. If there is anything inside, it refuses --\n' +
      'which is a feature, not an obstacle.',
    run: (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'rmdir: missing operand');
      let code = 0;
      for (const operand of operands) {
        try {
          ctx.vfs.rmdir(ctx.resolve(operand), ctx.user);
        } catch (e) {
          io.err(`rmdir: failed to remove '${operand}': ${isFsError(e) ? e.reason : String(e)}\n`);
          code = 1;
        }
      }
      return code;
    },
  },

  {
    name: 'rm',
    summary: 'remove files and directories',
    manual:
      'rm [-r] [-f] PATH...\n' +
      '\n' +
      'Remove files.\n' +
      '\n' +
      '  -r  recurse into directories\n' +
      '  -f  do not complain about what is not there\n' +
      '\n' +
      'There is no undo, no trash, and no confirmation. Read the path twice\n' +
      'before you press return, especially with -r.',
    plain:
      'Deletes a file. Permanently. There is no recycle bin on this ship.\n' +
      '\n' +
      '  rm notes.txt       delete a file\n' +
      '  rm -r olddir       delete a directory and everything inside it\n' +
      '\n' +
      'Look at the path before you press return.',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      const recursive = flags.has('-r') || flags.has('-R') || flags.has('--recursive');
      const force = flags.has('-f') || flags.has('--force');
      if (operands.length === 0) return force ? 0 : usage(io, 'rm: missing operand');
      let code = 0;
      for (const operand of operands) {
        const abs = ctx.resolve(operand);
        try {
          const stat = ctx.vfs.lstat(abs, ctx.user);
          if (stat.kind === 'dir' && !recursive) {
            io.err(`rm: cannot remove '${operand}': Is a directory\n`);
            code = 1;
            continue;
          }
          ctx.vfs.rm(abs, ctx.user);
        } catch (e) {
          if (force && isFsError(e) && e.code === 'ENOENT') continue;
          io.err(`rm: cannot remove '${operand}': ${isFsError(e) ? e.reason : String(e)}\n`);
          code = 1;
        }
      }
      return code;
    },
  },

  {
    name: 'touch',
    summary: 'create a file or update its timestamp',
    manual:
      'touch FILE...\n' +
      '\n' +
      'Create each FILE if it does not exist, and update its timestamp if it\n' +
      'does. The usual way to make an empty file to write into.',
    plain:
      'Makes an empty file, or updates the time on one that already exists.\n' +
      '\n' +
      '  touch notes.txt',
    run: (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'touch: missing file operand');
      let code = 0;
      for (const operand of operands) {
        const abs = ctx.resolve(operand);
        try {
          if (!ctx.vfs.exists(abs, ctx.user)) ctx.vfs.writeText(abs, '', ctx.user);
        } catch (e) {
          io.err(`touch: cannot touch '${operand}': ${isFsError(e) ? e.reason : String(e)}\n`);
          code = 1;
        }
      }
      return code;
    },
  },

  {
    name: 'cp',
    summary: 'copy files and directories',
    manual:
      'cp [-r] SOURCE... DEST\n' +
      '\n' +
      'Copy files. With more than one source, DEST must be a directory.\n' +
      '\n' +
      '  -r  copy a directory and its contents\n' +
      '\n' +
      'Copying before editing something important is the cheapest insurance\n' +
      'available on this ship.',
    plain:
      'Copies a file.\n' +
      '\n' +
      '  cp a.txt b.txt            make a copy under a new name\n' +
      '  cp a.txt /tmp/            copy it into another directory\n' +
      '  cp -r logs /tmp/          copy a whole directory\n' +
      '\n' +
      'Make a copy before you edit anything you cannot replace.',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      if (operands.length < 2) return usage(io, 'cp: missing destination file operand');
      const recursive = flags.has('-r') || flags.has('-R');
      const dest = operands[operands.length - 1]!;
      const sources = operands.slice(0, -1);
      const destAbs = ctx.resolve(dest);
      const destIsDir = ctx.vfs.exists(destAbs, ctx.user) && ctx.vfs.stat(destAbs, ctx.user).kind === 'dir';

      if (sources.length > 1 && !destIsDir) {
        return usage(io, `cp: target '${dest}' is not a directory`);
      }

      let code = 0;
      const copy = (from: string, to: string): void => {
        const stat = ctx.vfs.stat(from, ctx.user);
        if (stat.kind === 'dir') {
          if (!recursive) throw new FsError('EISDIR', from);
          ctx.vfs.mkdirp(to, ctx.user);
          for (const child of ctx.vfs.readdir(from, ctx.user)) {
            copy(p.join(from, child), p.join(to, child));
          }
          return;
        }
        ctx.vfs.write(to, ctx.vfs.read(from, ctx.user), ctx.user, stat.mode);
      };

      for (const source of sources) {
        const fromAbs = ctx.resolve(source);
        const toAbs = destIsDir ? p.join(destAbs, p.basename(fromAbs)) : destAbs;
        try {
          copy(fromAbs, toAbs);
        } catch (e) {
          io.err(`cp: cannot copy '${source}': ${isFsError(e) ? e.reason : String(e)}\n`);
          code = 1;
        }
      }
      return code;
    },
  },

  {
    name: 'mv',
    summary: 'move or rename files',
    manual:
      'mv SOURCE... DEST\n' +
      '\n' +
      'Move or rename. Renaming and moving are the same operation: a file\'s name\n' +
      'is an entry in a directory, so changing the entry is all either one does.',
    plain:
      'Moves a file, or renames it -- they are the same thing.\n' +
      '\n' +
      '  mv a.txt b.txt        rename\n' +
      '  mv a.txt /tmp/        move it somewhere else',
    run: (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      if (operands.length < 2) return usage(io, 'mv: missing destination file operand');
      const dest = operands[operands.length - 1]!;
      const destAbs = ctx.resolve(dest);
      const destIsDir = ctx.vfs.exists(destAbs, ctx.user) && ctx.vfs.stat(destAbs, ctx.user).kind === 'dir';
      let code = 0;
      for (const source of operands.slice(0, -1)) {
        const fromAbs = ctx.resolve(source);
        const toAbs = destIsDir ? p.join(destAbs, p.basename(fromAbs)) : destAbs;
        try {
          ctx.vfs.rename(fromAbs, toAbs, ctx.user);
        } catch (e) {
          io.err(`mv: cannot move '${source}': ${isFsError(e) ? e.reason : String(e)}\n`);
          code = 1;
        }
      }
      return code;
    },
  },

  {
    name: 'ln',
    summary: 'create a symbolic link (-s)',
    manual:
      'ln [-s] TARGET LINK\n' +
      '\n' +
      'Create a link.\n' +
      '\n' +
      '  -s  symbolic: LINK is a small file holding a path to TARGET\n' +
      '\n' +
      'A symlink can point at something that is not there yet, or is not there\n' +
      'any more. `ls -l` shows where each one points. This is how `systemctl\n' +
      'enable` remembers a service: a symlink in a directory init reads at boot.',
    plain:
      'Makes a link -- a name that points at a file somewhere else, like a\n' +
      'shortcut.\n' +
      '\n' +
      '  ln -s /var/log/boot.log boot        make the link\n' +
      '  ls -l boot                          see where it points\n' +
      '\n' +
      'The ship uses these to remember which services start at boot.',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      if (!flags.has('-s')) return usage(io, 'ln: only symbolic links (-s) are supported');
      if (operands.length < 2) return usage(io, 'ln: missing operand');
      try {
        ctx.vfs.symlink(operands[0]!, ctx.resolve(operands[1]!), ctx.user);
        return 0;
      } catch (e) {
        io.err(`ln: ${operands[1]}: ${isFsError(e) ? e.reason : String(e)}\n`);
        return 1;
      }
    },
  },

  {
    name: 'chmod',
    summary: 'change file mode bits',
    manual:
      'chmod MODE PATH...\n' +
      '\n' +
      'Change permission bits.\n' +
      '\n' +
      'Symbolic MODE: who (u, g, o, a), an operator (+, -, =), and the bits\n' +
      '(r, w, x).\n' +
      '\n' +
      '  chmod +x script.sh      let anybody execute it\n' +
      '  chmod u+w file          give the owner write\n' +
      '  chmod go-rwx secret     take everything away from everyone else\n' +
      '\n' +
      'Octal MODE: three digits, owner-group-other, each the sum of read 4,\n' +
      'write 2, execute 1.\n' +
      '\n' +
      '  chmod 755 script.sh     rwx for the owner, rx for everyone else\n' +
      '  chmod 644 notes.txt     the ordinary file\n' +
      '  chmod 600 private       only the owner, at all\n' +
      '\n' +
      'The execute bit is not advice. A file without it is not a program, and\n' +
      'the kernel will refuse to run it however correct the contents are --\n' +
      'including when you are root. `ls -l` is where you look; chmod +x is the\n' +
      'fix.',
    plain:
      'Changes who is allowed to do what with a file.\n' +
      '\n' +
      'The one you will need most:\n' +
      '\n' +
      '  chmod +x script.sh      make a script runnable\n' +
      '\n' +
      'A script that is not "executable" cannot be run at all, even though you\n' +
      'can read it perfectly well with cat. The x in `ls -l` is what says it\n' +
      'may be run -- if it is missing, put it back with chmod +x.\n' +
      '\n' +
      '  chmod 644 notes.txt     owner can read and write, others can read\n' +
      '  chmod 600 private       only the owner, nobody else\n' +
      '\n' +
      'You can only change a file you own, so files belonging to root need\n' +
      'sudo in front.',
    run: (ctx, argv, io) => {
      // `chmod -x file` is a real command and `-x` is the mode, so the mode is
      // taken before any flag parsing -- otherwise the parser eats it and the
      // command reports a missing operand for an argument that was right there.
      const first = argv[1];
      const modeFirst = first !== undefined && looksLikeMode(first);
      const operands = modeFirst ? argv.slice(1) : parseArgs(argv).operands;

      if (operands.length < 2) return usage(io, 'chmod: missing operand');
      const spec = operands[0]!;
      if (!looksLikeMode(spec)) {
        return usage(io, `chmod: invalid mode: '${spec}'  (try 755, +x, u+w, go-rwx)`);
      }

      let code = 0;
      for (const operand of operands.slice(1)) {
        const path = ctx.resolve(operand);
        try {
          // `stat`, not `lstat`: vfs.chmod follows a symlink to its target, so
          // the mode must be read from the same inode it will be written to.
          // Reading the link's own fixed 0777 and writing that through would
          // hand out write and execute on whatever it points at.
          const target = ctx.vfs.stat(path, ctx.user);
          const mode = parseMode(spec, target.mode, target.kind === 'dir');
          if (mode === null) {
            return usage(io, `chmod: invalid mode: '${spec}'  (try 755, +x, u+w, go-rwx)`);
          }
          ctx.vfs.chmod(path, mode, ctx.user);
        } catch (e) {
          io.err(`chmod: ${operand}: ${isFsError(e) ? e.reason : String(e)}\n`);
          code = 1;
        }
      }
      return code;
    },
  },

  {
    name: 'stat',
    summary: 'display file status',
    manual:
      'stat PATH...\n' +
      '\n' +
      'Show a file\'s size, type, inode, mode and ownership, with the mode given\n' +
      'both as octal and as the letters `ls -l` prints. Use it when you want one\n' +
      'file\'s details rather than a directory\'s worth.',
    plain:
      'Shows everything the ship knows about one file: how big, who owns it,\n' +
      'who may do what with it, and when it last changed.',
    run: (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'stat: missing operand');
      const users = passwdNames(ctx);
      const groups = groupNames(ctx);
      let code = 0;
      for (const operand of operands) {
        try {
          const s = ctx.vfs.lstat(ctx.resolve(operand), ctx.user);
          emit(io, [
            `  File: ${operand}`,
            `  Size: ${s.size}\tInode: ${s.ino}\tType: ${s.kind}`,
            `Access: (${(s.mode & 0o7777).toString(8).padStart(4, '0')}/${formatMode(s.kind, s.mode)})  Uid: (${s.uid}/${users.get(s.uid) ?? '?'})  Gid: (${s.gid}/${groups.get(s.gid) ?? '?'})`,
            `Modify: ${s.mtime}`,
          ]);
        } catch (e) {
          io.err(`stat: cannot stat '${operand}': ${isFsError(e) ? e.reason : String(e)}\n`);
          code = 1;
        }
      }
      return code;
    },
  },

  {
    name: 'find',
    summary: 'search for files in a directory tree',
    manual:
      'find [PATH] [-name PATTERN] [-type f|d]\n' +
      '\n' +
      'Walk a directory tree and print what matches.\n' +
      '\n' +
      '  -name  match the file\'s own name, globs allowed: -name \'*.conf\'\n' +
      '  -type  f for a regular file, d for a directory\n' +
      '\n' +
      'Quote the pattern. Unquoted, the shell expands it before find ever\n' +
      'sees it, against the wrong directory.\n' +
      '\n' +
      '  find /etc -name \'*.conf\'\n' +
      '  find /home -type d',
    plain:
      'Looks for files by name, anywhere below a directory.\n' +
      '\n' +
      '  find /etc -name \'*.conf\'      every .conf file under /etc\n' +
      '  find /home -type d            every directory under /home\n' +
      '\n' +
      'Put quotes around a pattern with a * in it, or the shell will try to be\n' +
      'helpful first and get it wrong.',
    run: (ctx, argv, io) => {
      const { values, operands } = parseArgs(argv, { valued: ['-name', '-type'] });
      const root = operands[0] ?? '.';
      const namePattern = values.get('-name');
      const typeFilter = values.get('-type');
      const results: string[] = [];

      const walk = (rel: string): void => {
        const abs = ctx.resolve(rel);
        let stat;
        try {
          stat = ctx.vfs.lstat(abs, ctx.user);
        } catch {
          return;
        }
        const name = p.basename(abs);
        const kindLetter = stat.kind === 'dir' ? 'd' : stat.kind === 'symlink' ? 'l' : 'f';
        const nameOk = !namePattern || matchGlob(namePattern, name);
        const typeOk = !typeFilter || typeFilter === kindLetter;
        if (nameOk && typeOk) results.push(rel);
        if (stat.kind !== 'dir') return;
        let children: string[];
        try {
          children = ctx.vfs.readdir(abs, ctx.user);
        } catch {
          io.err(`find: '${rel}': Permission denied\n`);
          return;
        }
        for (const child of children) walk(rel === '/' ? `/${child}` : `${rel}/${child}`);
      };

      walk(root);
      emit(io, results);
      return 0;
    },
  },
];

function numberLines(text: string): string {
  const rows = text.split('\n');
  const trailing = rows[rows.length - 1] === '';
  if (trailing) rows.pop();
  const out = rows.map((line, i) => `${String(i + 1).padStart(6)}\t${line}`);
  return out.join('\n') + (out.length > 0 ? '\n' : '');
}

function matchGlob(pattern: string, name: string): boolean {
  const re = new RegExp(
    '^' +
      pattern
        .split('')
        .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
        .join('') +
      '$',
  );
  return re.test(name);
}
