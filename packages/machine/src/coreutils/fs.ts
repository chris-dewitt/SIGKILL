import { FsError, isFsError } from '../errors.js';
import * as p from '../vfs/path.js';
import type { CommandSpec } from '../shell/exec.js';
import { emit, formatMode, looksLikeMode, parseArgs, parseMode, usage } from './helpers.js';

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
    run: (ctx, _argv, io) => {
      io.out(ctx.cwd + '\n');
      return 0;
    },
  },

  {
    name: 'cd',
    summary: 'change the current directory',
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

        let names: string[];
        let base: string;
        if (stat.kind === 'dir') {
          try {
            names = ctx.vfs.readdir(abs, ctx.user);
          } catch (e) {
            io.err(`ls: cannot open directory '${target}': ${isFsError(e) ? e.reason : String(e)}\n`);
            code = 2;
            continue;
          }
          if (all) names = ['.', '..', ...names];
          base = abs;
        } else {
          names = [target];
          base = p.dirname(abs);
        }

        const rows: string[] = [];
        for (const name of names) {
          if (!all && name.startsWith('.')) continue;
          if (!long) { rows.push(name); continue; }
          const childPath = name === '.' ? base : name === '..' ? p.dirname(base) : p.join(base, name);
          try {
            const s = ctx.vfs.lstat(childPath, ctx.user);
            const link = s.kind === 'symlink' ? ` -> ${ctx.vfs.readlink(childPath, ctx.user)}` : '';
            rows.push(
              `${formatMode(s.kind, s.mode)} ${String(s.uid).padStart(4)} ${String(s.gid).padStart(4)} ` +
              `${String(s.size).padStart(7)} ${name}${link}`,
            );
          } catch {
            rows.push(name);
          }
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
    run: (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'stat: missing operand');
      let code = 0;
      for (const operand of operands) {
        try {
          const s = ctx.vfs.lstat(ctx.resolve(operand), ctx.user);
          emit(io, [
            `  File: ${operand}`,
            `  Size: ${s.size}\tInode: ${s.ino}\tType: ${s.kind}`,
            `Access: (${(s.mode & 0o7777).toString(8).padStart(4, '0')}/${formatMode(s.kind, s.mode)})  Uid: ${s.uid}  Gid: ${s.gid}`,
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
