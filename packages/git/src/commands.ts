import type { CommandSpec, ShellContext } from '@sigkill/machine';
import { Repository } from './repo.js';
import { unified } from './diff.js';
import { blame, history } from './blame.js';
import { bisectCandidates, bisectNext, mergeBase, notIn, walk, type Walked } from './revwalk.js';
import type { CommitData, ObjectId } from './objects.js';

/**
 * `git`, as one command with subcommands, because that is what git is.
 *
 * Registered onto a machine by the adventure, the way `editorCommands()` is:
 * `packages/machine` depends on nothing and must not learn what a repository is.
 *
 * Two rules held throughout. **Real output shapes**, because a player who learns
 * to read `@@ -3,4 +3,5 @@` or a `blame` gutter here can read one anywhere, and a
 * house format would be teaching a dialect that exists only in this game. And
 * **no invented conveniences**: if a flag is not implemented, it says so rather
 * than quietly doing something else, because a command that ignores a flag is how
 * a player learns to distrust the whole machine.
 */

export interface GitOptions {
  /**
   * Whose name goes on a commit.
   *
   * Looked up per call rather than captured, so `sudo git commit` is authored by
   * whoever the shell says is running -- the same trap `sudo vi` has.
   */
  readonly identity?: (ctx: ShellContext) => { name: string; email: string };
}

const CRLF = '\n';

/** Seconds since the Unix epoch, from the virtual clock and never from wall time. */
const nowSeconds = (ctx: ShellContext): number =>
  Math.floor(((ctx.epoch ?? 0) + ctx.clock()) / 1000);

/**
 * Find the repository that contains the working directory.
 *
 * Walks upwards looking for `.git`, exactly as git does, so `git log` works from
 * a subdirectory. A player who has to stand in the root to use git has been given
 * a puzzle nobody meant to set.
 */
function open(ctx: ShellContext, opts: GitOptions): Repository | undefined {
  const identity = opts.identity ?? (() => ({ name: 'dewitt', email: 'dewitt@nav7' }));
  let dir = ctx.resolve('.');
  for (;;) {
    const candidate = new Repository({
      root: dir,
      vfs: ctx.vfs,
      user: ctx.user,
      now: () => nowSeconds(ctx),
      identity: () => identity(ctx),
    });
    if (candidate.exists) return candidate;
    if (dir === '/') return undefined;
    dir = dir.slice(0, dir.lastIndexOf('/')) || '/';
  }
}

const short = (id: ObjectId): string => id.slice(0, 7);

/**
 * A date a player can read, on the adventure's calendar.
 *
 * ISO rather than git's default `Mon Jun 6 04:12:00 2398 +0000`, because the
 * adventure's own logs and the archive's rows are all ISO and a player comparing
 * a commit to a telemetry line should be comparing like with like.
 */
const when = (seconds: number): string =>
  new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Where a bisect keeps its state. A file, so it survives a save. */
const BISECT = '.git/BISECT';

export function gitCommands(opts: GitOptions = {}): CommandSpec[] {
  const run: CommandSpec['run'] = (ctx, argv, io) => {
    const [subcommand, ...rest] = argv.slice(1);

    if (subcommand === undefined) {
      io.err(`usage: git <command> [args]${CRLF}`);
      io.err(`commands: init add status commit log show diff blame branch switch${CRLF}`);
      io.err(`          merge-base bisect shortlog tag rev-parse cat-file reflog${CRLF}`);
      return 1;
    }

    if (subcommand === 'init') {
      const root = ctx.resolve(rest[0] ?? '.');
      const repo = new Repository({
        root,
        vfs: ctx.vfs,
        user: ctx.user,
        now: () => nowSeconds(ctx),
        identity: () => opts.identity?.(ctx) ?? { name: 'dewitt', email: 'dewitt@nav7' },
      });
      const already = repo.exists;
      repo.init();
      io.out(`${already ? 'Reinitialized existing' : 'Initialized empty'} Git repository in ${root}/.git/${CRLF}`);
      return 0;
    }

    const repo = open(ctx, opts);
    if (repo === undefined) {
      io.err(`fatal: not a git repository (or any of the parent directories): .git${CRLF}`);
      return 128;
    }

    /** `HEAD` unless the player named something, resolved or complained about. */
    const rev = (spec: string | undefined): ObjectId | undefined => {
      const id = repo.resolve(spec ?? 'HEAD');
      if (id === undefined) {
        io.err(`fatal: ambiguous argument '${spec ?? 'HEAD'}': unknown revision${CRLF}`);
      }
      return id;
    };

    switch (subcommand) {
      // ------------------------------------------------------------- staging
      case 'add': {
        if (rest.length === 0) return usage(io, 'usage: git add <path>...');
        let added = 0;
        for (const operand of rest) {
          const absolute = ctx.resolve(operand);
          const relative = absolute.startsWith(`${repo.root}/`)
            ? absolute.slice(repo.root.length + 1)
            : operand;
          try {
            const stat = ctx.vfs.lstat(absolute, ctx.user);
            const paths = stat.kind === 'dir'
              ? repo.walkWorkTree(relative)
              : [relative];
            for (const path of paths) {
              repo.stage(path);
              added++;
            }
          } catch {
            io.err(`fatal: pathspec '${operand}' did not match any files${CRLF}`);
            return 128;
          }
        }
        // git says nothing on success, and being quiet is worth learning.
        return added === 0 ? 1 : 0;
      }

      case 'status': {
        const branch = repo.currentBranch();
        io.out(branch === undefined ? `HEAD detached${CRLF}` : `On branch ${branch}${CRLF}`);
        const state = repo.status();
        if (state.staged.length > 0) {
          io.out(`${CRLF}Changes to be committed:${CRLF}`);
          for (const path of state.staged) io.out(`\tmodified: ${path}${CRLF}`);
        }
        if (state.changed.length > 0) {
          io.out(`${CRLF}Changes not staged for commit:${CRLF}`);
          for (const path of state.changed) io.out(`\tmodified: ${path}${CRLF}`);
        }
        if (state.untracked.length > 0) {
          io.out(`${CRLF}Untracked files:${CRLF}`);
          for (const path of state.untracked) io.out(`\t${path}${CRLF}`);
        }
        if (state.staged.length + state.changed.length + state.untracked.length === 0) {
          io.out(`nothing to commit, working tree clean${CRLF}`);
        }
        return 0;
      }

      case 'commit': {
        const at = rest.indexOf('-m');
        if (at === -1 || rest[at + 1] === undefined) {
          return usage(io, 'usage: git commit -m <message>');
        }
        const message = rest.slice(at + 1).join(' ');
        const state = repo.status();
        if (state.staged.length === 0) {
          io.err(`nothing added to commit${CRLF}`);
          return 1;
        }
        const id = repo.commit(message);
        const branch = repo.currentBranch() ?? 'HEAD';
        io.out(`[${branch} ${short(id)}] ${message.split('\n')[0]}${CRLF}`);
        return 0;
      }

      // ------------------------------------------------------------- reading
      case 'log': {
        /*
         * Flags are parsed rather than sniffed, and an unknown one is refused.
         *
         * This was a handful of `includes` checks, which meant `--reverse` was
         * accepted, ignored, and answered with the newest commit first -- the
         * exact behaviour the header of this file forbids. A command that
         * quietly does something else is how a player learns to distrust the
         * whole machine, and the player who typed `--reverse` had the right
         * idea and was told by the output that they were wrong.
         */
        const dashdash = rest.indexOf('--');
        const flags = dashdash === -1 ? rest : rest.slice(0, dashdash);
        const paths = dashdash === -1 ? [] : rest.slice(dashdash + 1);

        let oneline = false;
        let firstParentOnly = false;
        let reverse = false;
        let patch = false;
        let author: string | undefined;
        let format: string | undefined;
        let dateShort = false;
        let limit: number | undefined;
        const revs: string[] = [];

        for (let i = 0; i < flags.length; i++) {
          const arg = flags[i]!;
          const eq = arg.indexOf('=');
          const name = eq === -1 ? arg : arg.slice(0, eq);
          const inline = eq === -1 ? undefined : arg.slice(eq + 1);
          const value = (): string | undefined => inline ?? flags[++i];

          if (!arg.startsWith('-')) revs.push(arg);
          else if (name === '--oneline') oneline = true;
          else if (name === '--first-parent') firstParentOnly = true;
          else if (name === '--reverse') reverse = true;
          else if (name === '-p' || name === '--patch') patch = true;
          else if (name === '--author') author = value();
          else if (name === '--format' || name === '--pretty') {
            const spec = value() ?? '';
            format = spec.startsWith('format:') ? spec.slice('format:'.length) : spec;
          } else if (name === '--date') dateShort = (value() ?? '') === 'short';
          else if (name === '-n') limit = Number(value());
          else if (/^-\d+$/.test(arg)) limit = Number(arg.slice(1));
          else {
            io.err(`fatal: unrecognised argument: ${arg}${CRLF}`);
            return 128;
          }
        }

        const head = rev(revs[0]);
        if (head === undefined) return 128;

        // One walk per path, unioned in history order, so `-- a b` means
        // "commits touching either" the way git means it.
        let walked: Walked[];
        if (paths.length <= 1) {
          walked = walk(repo, [head], {
            ...(firstParentOnly ? { firstParentOnly } : {}),
            ...(paths[0] === undefined ? {} : { path: paths[0] }),
          });
        } else {
          const keep = new Set<ObjectId>();
          for (const path of paths) {
            for (const step of walk(repo, [head], { path })) keep.add(step.id);
          }
          walked = walk(repo, [head], {
            ...(firstParentOnly ? { firstParentOnly } : {}),
          }).filter((step) => keep.has(step.id));
        }

        if (author !== undefined) {
          const needle = author.toLowerCase();
          walked = walked.filter(
            (step) =>
              step.commit.author.name.toLowerCase().includes(needle) ||
              step.commit.author.email.toLowerCase().includes(needle),
          );
        }
        if (reverse) walked = [...walked].reverse();
        if (limit !== undefined && Number.isFinite(limit)) walked = walked.slice(0, limit);

        if (walked.length === 0) {
          io.out(`no commits${CRLF}`);
          return 0;
        }

        const day = (seconds: number): string =>
          dateShort ? when(seconds).slice(0, 10) : when(seconds);

        /** The placeholders worth having. Anything else is left as typed. */
        const formatted = (id: ObjectId, commit: CommitData, spec: string): string =>
          spec
            .replace(/%H/g, id)
            .replace(/%h/g, short(id))
            .replace(/%P/g, commit.parents.join(' '))
            .replace(/%an/g, commit.author.name)
            .replace(/%ae/g, commit.author.email)
            .replace(/%ad/g, day(commit.author.when))
            .replace(/%s/g, commit.message.split('\n')[0] ?? '');

        const diffOf = (id: ObjectId, commit: CommitData): void => {
          const parent = commit.parents[0];
          const before = parent === undefined ? new Map() : repo.treeFiles(parent);
          const after = repo.treeFiles(id);
          for (const [path, entry] of after) {
            if (before.get(path)?.id === entry.id) continue;
            const old = before.get(path);
            for (const line of unified(
              old === undefined ? '' : repo.readBlob(old.id),
              repo.readBlob(entry.id),
              { beforeName: path, afterName: path },
            )) {
              io.out(`${line}${CRLF}`);
            }
          }
        };

        for (const { id, commit } of walked) {
          if (format !== undefined) {
            io.out(`${formatted(id, commit, format)}${CRLF}`);
          } else if (oneline) {
            io.out(`${short(id)} ${commit.message.split('\n')[0]}${CRLF}`);
          } else {
            io.out(`commit ${id}${CRLF}`);
            if (commit.parents.length > 1) {
              io.out(`Merge: ${commit.parents.map(short).join(' ')}${CRLF}`);
            }
            io.out(`Author: ${commit.author.name} <${commit.author.email}>${CRLF}`);
            io.out(`Date:   ${day(commit.author.when)}${CRLF}${CRLF}`);
            for (const line of commit.message.split('\n')) io.out(`    ${line}${CRLF}`);
            io.out(CRLF);
          }
          if (patch) diffOf(id, commit);
        }
        return 0;
      }

      case 'show': {
        const id = rev(rest.find((a) => !a.startsWith('-')));
        if (id === undefined) return 128;
        const object = repo.read(id);
        if (object.type !== 'commit') {
          io.out(new TextDecoder().decode(object.content));
          return 0;
        }
        const commit = repo.readCommit(id);
        io.out(`commit ${id}${CRLF}`);
        if (commit.parents.length > 1) {
          io.out(`Merge: ${commit.parents.map(short).join(' ')}${CRLF}`);
        }
        io.out(`Author: ${commit.author.name} <${commit.author.email}>${CRLF}`);
        io.out(`Date:   ${when(commit.author.when)}${CRLF}${CRLF}`);
        for (const line of commit.message.split('\n')) io.out(`    ${line}${CRLF}`);
        io.out(CRLF);

        /*
         * A merge is shown against its first parent, which is what git does and
         * is also the trap objective six turns on: the change a merge made
         * relative to the *other* side is invisible here, and finding it needs
         * `git diff <merge>^2 <merge>`.
         */
        const parent = commit.parents[0];
        const before = parent === undefined ? new Map() : repo.treeFiles(parent);
        const after = repo.treeFiles(id);
        for (const [path, entry] of after) {
          const old = before.get(path);
          if (old?.id === entry.id) continue;
          for (const line of unified(
            old === undefined ? '' : repo.readBlob(old.id),
            repo.readBlob(entry.id),
            { beforeName: path, afterName: path },
          )) {
            io.out(`${line}${CRLF}`);
          }
        }
        for (const [path, entry] of before) {
          if (after.has(path)) continue;
          for (const line of unified(repo.readBlob(entry.id), '', { beforeName: path, afterName: path })) {
            io.out(`${line}${CRLF}`);
          }
        }
        return 0;
      }

      case 'diff': {
        const args = rest.filter((a) => !a.startsWith('-'));
        const dashdash = rest.indexOf('--');
        const only = dashdash === -1 ? undefined : rest[dashdash + 1];

        // Two revisions, one revision against the working tree, or the working
        // tree against the index.
        const [leftSpec, rightSpec] = args;
        const left = leftSpec === undefined ? undefined : rev(leftSpec);
        if (leftSpec !== undefined && left === undefined) return 128;
        const right = rightSpec === undefined ? undefined : rev(rightSpec);
        if (rightSpec !== undefined && right === undefined) return 128;

        const from = left === undefined ? repo.head() : left;
        const before = from === undefined ? new Map() : repo.treeFiles(from);
        const after = right === undefined ? undefined : repo.treeFiles(right);

        const paths = new Set<string>([
          ...before.keys(),
          ...(after === undefined ? repo.walkWorkTree() : [...after.keys()]),
        ]);

        let any = false;
        for (const path of [...paths].sort()) {
          if (only !== undefined && path !== only) continue;
          const old = before.get(path);
          const oldText = old === undefined ? '' : repo.readBlob(old.id);
          let newText: string;
          if (after === undefined) {
            try {
              newText = ctx.vfs.readText(`${repo.root}/${path}`, ctx.user);
            } catch {
              newText = '';
            }
          } else {
            const entry = after.get(path);
            newText = entry === undefined ? '' : repo.readBlob(entry.id);
          }
          const out = unified(oldText, newText, { beforeName: path, afterName: path });
          if (out.length > 0) any = true;
          for (const line of out) io.out(`${line}${CRLF}`);
        }
        return any ? 0 : 0;
      }

      case 'blame': {
        const args = rest.filter((a) => !a.startsWith('-'));
        const path = args[args.length - 1];
        if (path === undefined) return usage(io, 'usage: git blame [<rev>] <path>');
        const id = rev(args.length > 1 ? args[0] : 'HEAD');
        if (id === undefined) return 128;

        const lines = blame(repo, id, path);
        if (lines.length === 0) {
          io.err(`fatal: no such path ${path} in ${short(id)}${CRLF}`);
          return 128;
        }
        for (const line of lines) {
          io.out(
            `${short(line.commit)} (${line.author.padEnd(12)} ${when(line.when)} ${String(line.line).padStart(3)}) ${line.text}${CRLF}`,
          );
        }
        return 0;
      }

      case 'shortlog': {
        const summaryOnly = rest.includes('-s') || rest.includes('--summary');
        const unknown = rest.find(
          (a) => a.startsWith('-') && !['-s', '--summary', '-n', '--numbered'].includes(a),
        );
        if (unknown !== undefined) {
          io.err(`fatal: unrecognised argument: ${unknown}${CRLF}`);
          return 128;
        }
        const head = rev(rest.find((a) => !a.startsWith('-')));
        if (head === undefined) return 128;
        const counts = new Map<string, string[]>();
        for (const { commit } of walk(repo, [head])) {
          const list = counts.get(commit.author.name) ?? [];
          list.push(commit.message.split('\n')[0] ?? '');
          counts.set(commit.author.name, list);
        }
        const ordered = [...counts].sort((a, b) =>
          b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1),
        );
        for (const [author, messages] of ordered) {
          if (summaryOnly) {
            io.out(`${String(messages.length).padStart(6)}\t${author}${CRLF}`);
            continue;
          }
          io.out(`${author} (${messages.length}):${CRLF}`);
          for (const message of messages) io.out(`      ${message}${CRLF}`);
          io.out(CRLF);
        }
        return 0;
      }

      case 'branch': {
        const name = rest.find((a) => !a.startsWith('-'));
        if (name === undefined) {
          const current = repo.currentBranch();
          for (const branch of repo.branches()) {
            io.out(`${branch === current ? '*' : ' '} ${branch}${CRLF}`);
          }
          return 0;
        }
        const at = repo.resolve(rest[1] ?? 'HEAD');
        if (at === undefined) {
          io.err(`fatal: not a valid object name: '${rest[1] ?? 'HEAD'}'${CRLF}`);
          return 128;
        }
        repo.writeRef(`refs/heads/${name}`, at);
        return 0;
      }

      case 'switch':
      case 'checkout': {
        const args = rest.filter((a) => !a.startsWith('-'));
        /*
         * `-c` (switch) and `-b` (checkout) both mean "make it and move onto
         * it", which is how anybody actually starts a branch. Without it the
         * only way onto a new branch was `git branch x && git switch x`, and
         * `git switch -c x` failed with "invalid reference" -- a refusal that
         * told the player their correct command was wrong.
         */
        const creating = rest.includes('-c') || rest.includes('-b');
        const target = args[0];
        if (target === undefined) return usage(io, `usage: git ${subcommand} [-c] <branch|commit>`);

        if (creating) {
          if (repo.branches().includes(target)) {
            io.err(`fatal: a branch named '${target}' already exists${CRLF}`);
            return 128;
          }
          const from = repo.resolve(args[1] ?? 'HEAD');
          if (from === undefined) {
            io.err(`fatal: invalid reference: ${args[1] ?? 'HEAD'}${CRLF}`);
            return 128;
          }
          const previous = repo.head();
          repo.writeRef(`refs/heads/${target}`, from);
          repo.checkout(from);
          ctx.vfs.writeText(`${repo.gitDir}/HEAD`, `ref: refs/heads/${target}${CRLF}`, ctx.user);
          repo.noteMove(previous, from, `checkout: moving to ${target}`);
          io.out(`Switched to a new branch '${target}'${CRLF}`);
          return 0;
        }

        const id = repo.resolve(target);
        if (id === undefined) {
          io.err(`fatal: invalid reference: ${target}${CRLF}`);
          return 128;
        }
        const isBranch = repo.branches().includes(target);
        const previous = repo.head();
        repo.checkout(id);
        if (isBranch) {
          ctx.vfs.writeText(`${repo.gitDir}/HEAD`, `ref: refs/heads/${target}${CRLF}`, ctx.user);
          io.out(`Switched to branch '${target}'${CRLF}`);
        } else {
          ctx.vfs.writeText(`${repo.gitDir}/HEAD`, `${id}${CRLF}`, ctx.user);
          io.out(`Note: switching to '${target}'. You are in detached HEAD state.${CRLF}`);
        }
        repo.noteMove(previous, id, `checkout: moving to ${target}`);
        return 0;
      }

      case 'tag': {
        const name = rest.find((a) => !a.startsWith('-'));
        if (name === undefined) {
          for (const tag of repo.tags()) io.out(`${tag}${CRLF}`);
          return 0;
        }
        const at = repo.resolve(rest[1] ?? 'HEAD');
        if (at === undefined) {
          io.err(`fatal: not a valid object name: '${rest[1] ?? 'HEAD'}'${CRLF}`);
          return 128;
        }
        repo.writeRef(`refs/tags/${name}`, at);
        return 0;
      }

      case 'rev-parse': {
        const spec = rest.find((a) => !a.startsWith('-'));
        const id = rev(spec);
        if (id === undefined) return 128;
        io.out(`${id}${CRLF}`);
        return 0;
      }

      case 'cat-file': {
        const wantsType = rest.includes('-t');
        const spec = rest.find((a) => !a.startsWith('-'));
        const id = rev(spec);
        if (id === undefined) return 128;
        const object = repo.read(id);
        if (wantsType) {
          io.out(`${object.type}${CRLF}`);
          return 0;
        }
        if (object.type === 'tree') {
          for (const entry of repo.readTree(id)) {
            io.out(
              `${entry.mode.padStart(6, '0')} ${entry.mode === '40000' ? 'tree' : 'blob'} ${entry.id}\t${entry.name}${CRLF}`,
            );
          }
          return 0;
        }
        io.out(new TextDecoder().decode(object.content));
        return 0;
      }

      case 'reflog': {
        const entries = repo.reflog();
        if (entries.length === 0) {
          io.out(`no reflog${CRLF}`);
          return 0;
        }
        // Newest first, the way git shows it -- which is the order that matters
        // when what you are looking for is the last thing anybody did.
        for (const [i, entry] of [...entries].reverse().entries()) {
          const [, to, ...what] = entry.split(' ');
          io.out(`${short(to ?? '')} HEAD@{${i}}: ${what.join(' ')}${CRLF}`);
        }
        return 0;
      }

      case 'merge-base': {
        const [a, b] = rest.filter((x) => !x.startsWith('-'));
        if (a === undefined || b === undefined) {
          return usage(io, 'usage: git merge-base <rev> <rev>');
        }
        const left = rev(a);
        const right = rev(b);
        if (left === undefined || right === undefined) return 128;
        const base = mergeBase(repo, left, right);
        if (base === undefined) {
          io.err(`fatal: ${short(left)} and ${short(right)} share no history${CRLF}`);
          return 1;
        }
        io.out(`${base}${CRLF}`);
        return 0;
      }

      // ------------------------------------------------------------- bisect
      case 'bisect':
        return bisectCommand(ctx, repo, rest, io);

      default:
        io.err(`git: '${subcommand}' is not a git command${CRLF}`);
        return 1;
    }
  };

  return [
    {
      name: 'git',
      summary: 'read and change a repository of work',
      manual:
        `git <command> [args]${CRLF}${CRLF}` +
        `  init [dir]                 start a repository${CRLF}` +
        `  add <path>...              stage a change${CRLF}` +
        `  status                     what is staged, changed and untracked${CRLF}` +
        `  commit -m <message>        record the staged change${CRLF}` +
        `  log [--oneline] [-n N] [--first-parent] [<rev>] [-- <path>]${CRLF}` +
        `  show [<rev>]               one commit, with its diff${CRLF}` +
        `  diff [<rev> [<rev>]] [-- <path>]${CRLF}` +
        `  blame [<rev>] <path>       who last touched each line${CRLF}` +
        `  shortlog [<rev>]           commits grouped by author${CRLF}` +
        `  branch [<name> [<rev>]]    list or create a branch${CRLF}` +
        `  switch <branch|commit>     move the working tree${CRLF}` +
        `  tag [<name> [<rev>]]       list or create a tag${CRLF}` +
        `  merge-base <rev> <rev>     where two histories parted${CRLF}` +
        `  bisect start|good|bad|reset|log${CRLF}` +
        `  rev-parse <rev>            the full id of anything${CRLF}` +
        `  cat-file [-t] <rev>        an object's type or contents${CRLF}` +
        `  reflog                     every move HEAD has made${CRLF}${CRLF}` +
        `A revision is a branch, a tag, HEAD, a full or abbreviated object id,${CRLF}` +
        `or any of those with ~n or ^n after it.${CRLF}${CRLF}` +
        `TWO DIFFERENCES FROM THE GIT YOU MAY KNOW. Loose objects here are not${CRLF}` +
        `compressed, so you can cat one and read it; the object ids are still${CRLF}` +
        `real. And .git/index is a text file, one line per staged path. Both are${CRLF}` +
        `so that you can look, and neither changes what an id or a tree means.${CRLF}`,
      plain:
        `A repository is a record of every version of a set of files, and of who${CRLF}` +
        `changed what, when, and what they said about it.${CRLF}${CRLF}` +
        `The four you need first:${CRLF}${CRLF}` +
        `  git log --oneline     the history, one line per change${CRLF}` +
        `  git show <id>         one change, in full${CRLF}` +
        `  git blame <file>      who last touched each line of a file${CRLF}` +
        `  git status            what you have changed and not yet recorded${CRLF}${CRLF}` +
        `An id is the long hex name of a change. You almost never type all of${CRLF}` +
        `it -- the first seven characters are enough.${CRLF}${CRLF}` +
        `It is all just files. Try:  ls .git    and    cat .git/HEAD${CRLF}`,
      preformatted: true,
      run,
    },
  ];
}

function usage(io: { err: (s: string) => void }, message: string): number {
  io.err(`${message}${CRLF}`);
  return 2;
}

/**
 * `git bisect`, which is the one subcommand with state.
 *
 * Kept in `.git/BISECT` as two lines of text rather than in memory, so it
 * survives a save -- a bisect a player abandons overnight and comes back to is
 * exactly the situation the command is for.
 */
function bisectCommand(
  ctx: ShellContext,
  repo: Repository,
  args: readonly string[],
  io: { out: (s: string) => void; err: (s: string) => void },
): number {
  const path = `${repo.root}/${BISECT}`;
  const read = (): { good: string[]; bad?: string } => {
    if (!ctx.vfs.exists(path, ctx.user)) return { good: [] };
    const state: { good: string[]; bad?: string } = { good: [] };
    for (const line of ctx.vfs.readText(path, ctx.user).split('\n')) {
      const [kind, id] = line.split(' ');
      if (kind === 'good' && id) state.good.push(id);
      if (kind === 'bad' && id) state.bad = id;
    }
    return state;
  };
  const write = (state: { good: string[]; bad?: string }): void => {
    const body = [
      ...state.good.map((id) => `good ${id}`),
      ...(state.bad === undefined ? [] : [`bad ${state.bad}`]),
    ].join('\n');
    ctx.vfs.writeText(path, body === '' ? '' : `${body}\n`, ctx.user);
  };

  const [action, ...rest] = args;

  if (action === 'reset' || action === undefined) {
    if (action === 'reset' && ctx.vfs.exists(path, ctx.user)) ctx.vfs.rm(path, ctx.user);
    if (action === undefined) {
      io.err(`usage: git bisect start|good|bad|reset|log${CRLF}`);
      return 2;
    }
    io.out(`bisect: over${CRLF}`);
    return 0;
  }

  if (action === 'start') {
    write({ good: [] });
    io.out(`bisect: mark a known good commit with  git bisect good <rev>${CRLF}`);
    io.out(`        and a known bad one with       git bisect bad <rev>${CRLF}`);
    return 0;
  }

  if (action === 'log') {
    const state = read();
    for (const id of state.good) io.out(`good ${id}${CRLF}`);
    if (state.bad !== undefined) io.out(`bad ${state.bad}${CRLF}`);
    return 0;
  }

  if (action !== 'good' && action !== 'bad') {
    io.err(`usage: git bisect start|good|bad|reset|log${CRLF}`);
    return 2;
  }

  const spec = rest[0] ?? 'HEAD';
  const id = repo.resolve(spec);
  if (id === undefined) {
    io.err(`fatal: bad revision '${spec}'${CRLF}`);
    return 128;
  }

  const state = read();
  if (action === 'good') state.good.push(id);
  else state.bad = id;
  write(state);

  if (state.bad === undefined || state.good.length === 0) {
    io.out(`bisect: ${action} ${id.slice(0, 7)} recorded. Now mark the other end.${CRLF}`);
    return 0;
  }

  const remaining = bisectCandidates(repo, { good: state.good, bad: state.bad });
  const next = bisectNext(repo, { good: state.good, bad: state.bad });
  if (next === undefined) {
    const commit = repo.readCommit(state.bad);
    io.out(`${state.bad} is the first bad commit${CRLF}`);
    io.out(`Author: ${commit.author.name} <${commit.author.email}>${CRLF}`);
    io.out(`    ${commit.message.split('\n')[0]}${CRLF}`);
    return 0;
  }

  // Git's own phrasing, because the number is the point: it halves each time.
  const steps = Math.max(0, Math.ceil(Math.log2(Math.max(1, remaining.length))));
  io.out(
    `Bisecting: ${remaining.length - 1} revisions left to test after this (roughly ${steps} steps)${CRLF}`,
  );
  io.out(`[${next.id}] ${next.commit.message.split('\n')[0]}${CRLF}`);
  repo.checkout(next.id);
  ctx.vfs.writeText(`${repo.gitDir}/HEAD`, `${next.id}${CRLF}`, ctx.user);
  return 0;
}

export { notIn, history };
