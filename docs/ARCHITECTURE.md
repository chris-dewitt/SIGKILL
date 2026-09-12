# Architecture

How the Machine is put together, and how one command gets from a keypress to
a changed filesystem. Read this before changing anything in
`packages/machine`.

---

## The shape of it

```
apps/terminal          The page. CRT, chip bar, input, worker wiring.
                       Knows about the DOM. Knows nothing about how a shell works.
       |
packages/machine       THE MACHINE. A deterministic virtual computer.
                       Knows nothing about screens, browsers, or time.
       |
       +-- vfs/        Filesystem: inodes, permissions, symlinks, snapshots
       +-- shell/      Lexer -> parser -> expansion -> executor
       +-- coreutils/  50 commands written against the above
       +-- proc/       Processes, systemd units, jobs, cron
       +-- net/        Hosts, each of which is another Machine
       +-- lang/       PythonRuntime *interface* (no implementation)
       |
packages/python        Pyodide behind that interface, in a Web Worker
packages/crt           Phosphor renderer: buffer, glyph atlas, WebGL2 CRT pass
packages/quest         Objectives and hint ladders -- see docs/HINTS.md
packages/editor        vi and nano -- see docs/FULLSCREEN.md
games/wreck            Adventure 1: the NAV-7 world seed and the Act I ladders
```

Dependencies point one way: `apps` → `packages` → nothing. `packages/machine`
imports nothing outside itself. If you are about to add a dependency to it,
stop and read [DECISIONS.md](DECISIONS.md) §1 first.

---

## One command, end to end

Trace `grep FAIL /var/log/boot.log | wc -l`. Every arrow is a real function
call you can breakpoint.

**1. `Machine.exec(input)`** — `src/machine.ts`

Resolves which machine the player is actually on. After `ssh`, that is the
top of `session.stack`, not `this`. Then calls `run(shell, input)`.

**2. `run(ctx, input)`** — `src/shell/exec.ts`

Owns the output buffers and the promise that nothing thrown escapes. Parses
first; a syntax error returns exit code 2 and never propagates.

**3. `lex(input)`** — `src/shell/lexer.ts`

Produces tokens. Quoting is preserved *structurally*, not stripped — a word
is a list of parts tagged `bare`, `dquoted`, `squoted` or `subst`. That is
what lets expansion later tell `*.txt` (a glob) from `'*.txt'` (a literal).

**4. `parse(tokens)`** — `src/shell/parser.ts`

Recursive descent into `Script → AndOr → Pipeline → Command`. Redirections
and `NAME=value` assignments attach to the command they belong to.

**5. `runScript` → `runAndOr` → `runPipeline`** — `src/shell/exec.ts`

`runAndOr` short-circuits on `&&` / `||` by exit code. `runPipeline` runs
stages in order, feeding each stage's captured stdout into the next stage's
`stdin`. **stderr never enters a pipe** — it goes straight to the terminal,
which is why `cat /nope | wc -l` prints an error *and* `0`.

**6. `runSimple` → `expandWords`** — `src/shell/expand.ts`

In order: tilde, parameters (`$X`, `${X}`, `$?`), command substitution
(which recursively re-enters `run`), field splitting, then globbing.
Quoted parts opt out of the last two stages — that is the entire reason
quoting exists.

**7. Command lookup and dispatch**

`ctx.commands.get(argv[0])`. Not found → `sh: x: command not found`, exit
127. Found → `withRedirects` wraps the call, buffering output destined for
a file, then runs `spec.run(ctx, argv, io)`.

**8. The command does its work**

It reads and writes `ctx.vfs` **as `ctx.user`**. The VFS enforces
permissions; commands never check them by hand. An `FsError` thrown here is
caught in `runSimple` and formatted as `tool: path: reason`.

**9. Unwind**

Exit code becomes `$?`. Redirected buffers are written to the VFS. Output
returns to `Machine.exec`'s caller.

---

## What lives where

### `vfs/` — the filesystem

`Vfs` holds inodes in a `Map`. Every operation takes a `User` and checks
permissions against `mode`, `uid` and `gid`, with uid 0 bypassing, exactly as
on a real system. Symlinks are followed with a depth cap that raises `ELOOP`.

Failures are `FsError` with a real errno (`ENOENT`, `EACCES`, `EISDIR`,
`ENOTDIR`, `ENOTEMPTY`, `ELOOP`, `EPERM`). A player who searches the error
text should find the real thing.

`snapshot()` / `Vfs.restore()` round-trip exactly. **A save file is a VFS
snapshot and nothing else.**

### `shell/` — the language

`types.ts` is the AST. `lexer.ts` and `parser.ts` build it. `expand.ts`
turns words into arguments. `exec.ts` runs the tree and owns `ShellContext`,
which is the bundle of everything a command can touch: vfs, user, cwd, env,
commands, procs, services, jobs, network, session, clock.

### `coreutils/` — the commands

Grouped by domain: `fs`, `text`, `proc`, `jobs`, `net`, `sys`. Each exports
an array of `CommandSpec`. `index.ts` assembles the registry.

A `CommandSpec` carries two manuals: `manual` (terse, real register — shown
to Operators) and `plain` (rewritten — shown to Cadets). `man` picks by
`ctx.track`. **Both tracks run the same command against the same Machine.**

### `proc/` — processes, services, jobs, cron

`table.ts` is a process table; nothing actually executes, a process is a row
that `ps` shows and `kill` removes.

`services.ts` is a small systemd. Two things to know:

- Unit *definitions* live in the filesystem and are re-read on every
  operation, so `.service` files can be `cat`-ed, `grep`-ed and written.
- **"Enabled" is not a field.** It is a symlink in
  `multi-user.target.wants`, as on a real system — so `ls -l` shows it and it
  snapshots for free.

A unit's start-time check (`Precondition`) is supplied by the *adventure*,
not the Machine. That seam is how a systems concept becomes a puzzle.

`cron.ts` parses `/etc/crontab` and fires on minute boundaries crossed by
`tick()`. Dates come from `machine.epoch + clock`, never `new Date()`.

### `net/` — the network

Each host is a full `Machine`. `ssh node01 cat /data/x` really does read a
file that exists only there. `ssh host` with no command pushes onto
`session.stack`; `exit` pops it. `curl` serves `/srv/http` from the host's own
VFS, so standing up a web server is a filesystem task.

### `lang/` — the interpreter seam

`PythonRuntime` is an interface. `packages/machine` has no Python in it.
`packages/python` supplies Pyodide: bulk-copy the VFS in, run, diff back out.
See [DECISIONS.md](DECISIONS.md) §4.

---

## Invariants

Break any of these and something downstream breaks silently.

### Determinism

No `Date.now()`, no `Math.random()`, no host I/O in `packages/machine`. Time
comes from the virtual clock; `tick(ms)` is the only way it moves. The same
input always produces byte-identical snapshots.

This is what makes every puzzle replayable headlessly in CI. One wall-clock
call destroys it for the whole project.

### Goals read state, never input

```ts
// Right — any route that reaches this state wins.
goal: (m) => m.vfs.readText('/etc/life_support.conf').includes('O2_TARGET=21')

// Wrong — the bug that makes a terminal feel fake.
goal: (m) => m.lastCommand.startsWith('sed -i')
```

`test/goal.test.ts` and `test/services.test.ts` enforce this. If either needs
a special case for a particular command, the design has regressed.

### The Machine has no screen

It returns text and raises flags. No ANSI, no colour, no layout. `clear` sets
`ctx.clearRequested`; the renderer decides what clearing means.

### Player code never runs in the host context

No `eval`, no `new Function`, no dynamic `import()` of anything a player or a
content pack supplied. Python runs in Pyodide inside a Web Worker, and
nowhere else.

---

## Adding things

**A command** → `coreutils/{fs,text,proc,jobs,net,sys}.ts`. Give it `manual`
and `plain`. Add a test including the failure paths — the error messages are
the teaching. Throw `FsError` rather than inventing error text.

**A service** → write a `.service` file into the world's VFS and register a
precondition with `machine.setPrecondition(name, check)`.

**A host** → `network.add({ hostname, ip, machine, ports, accounts })`. Give
it its own `Machine`; do not special-case it.

**A dependency on `packages/machine`** → don't. See
[DECISIONS.md](DECISIONS.md) §1.
