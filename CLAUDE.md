# SIGKILL — agent pointer

Read this, then the architecture doc, then the code.

| Doc | Use for |
|-----|---------|
| **[HANDOFF.md](HANDOFF.md)** | **Read first.** Where the code is, what is open, what is waiting on Chris. |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | **Start here.** The map, and a full trace of one command from keypress to changed filesystem. |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why it is like this. Read before reversing anything that looks arbitrary. |
| [docs/TESTING.md](docs/TESTING.md) | The determinism harness and the goal-predicate pattern. |
| [docs/GAME6_BEATS.md](docs/GAME6_BEATS.md) | **Game six, built** — operations. §9 is what shipped and where it differs; §8 is Chris's to overrule cheaply. |
| [docs/PLAYTEST.md](docs/PLAYTEST.md) | Getting the game onto a phone — LAN browser, CI-built APK, the checklist. |
| [docs/HINTS.md](docs/HINTS.md) | **Read before authoring an objective or a hint ladder.** |
| [docs/FULLSCREEN.md](docs/FULLSCREEN.md) | How `vi` takes the screen, and how to add another full-screen program. |
| [docs/PLAN.md](docs/PLAN.md) | North star — phases, risks, the fourteen adventures. |
| [packages/machine/README.md](packages/machine/README.md) | The engine's API surface. |
| [packages/net/README.md](packages/net/README.md) | Name resolution, sockets, routes and the firewall — and which tool asks which question. |
| [WORKING_ON.md](WORKING_ON.md) | Claim a package before editing it. Four of us share this repo. |

---

## What this is

Fourteen terminal survival adventures that teach real backend and ML
infrastructure engineering. Phone-first, offline, paid once per game, no ads,
no accounts, no telemetry.

Every game runs on one deterministic virtual computer — **the Machine**
(`packages/machine`). That package is the whole investment. Treat it
accordingly.

---

## Git identity — always use this

```
git config user.name "Chris-dewitt"
git config user.email "chnodewi@unc.edu"
```

Never commit as Claude.

---

## Rules that are not negotiable

Breaking these is expensive to undo, and usually silent.

### 1. The Machine is deterministic

No `Date.now()`, no `Math.random()`, no host I/O anywhere in
`packages/machine`. Time comes from the virtual clock — `machine.tick(ms)` is
the only way it moves, and `ctx.clock()` is the only way to read it.

This is what lets every puzzle be replayed headlessly in CI. A single
wall-clock call destroys that property for the whole project.

### 2. Goals assert on world state, never on input

```ts
// Right — any route that reaches this state wins.
goal: (m) => m.vfs.readText('/etc/life_support.conf').includes('O2_TARGET=21')

// Wrong — the bug that makes a terminal feel fake.
goal: (m) => m.lastCommand.startsWith('sed -i')
```

`packages/machine/test/goal.test.ts` enforces it. Act I is already solvable
with `sed`, with `echo` and redirection, with a pipe into a redirect, and
from Python — and the goal knows about none of them.

### 3. Player code never runs in the host context

No `eval`, no `new Function`, no dynamic `import()` of anything a player or a
content pack supplied. Python runs in Pyodide inside a Web Worker and nowhere
else. `NodePythonRuntime` is for tests only — never wire it into the app.

Content packs are **data**. Goal predicates and preconditions compile into
the bundle. A pack that can ship executable code is remote code execution
wearing a hat.

### 4. `packages/machine` depends on nothing

Zero runtime dependencies, and it imports nothing outside itself. If you need
a library, wrap it in its own package behind an interface — the way
`packages/python` wraps Pyodide — and hand the engine the interface.

### 5. No third-party SDKs anywhere

No ads, no analytics, no crash reporter that uploads content. Pinned
lockfile, audited in CI. This is a security control, not a preference: the
moment the app can hold a secret, every SDK in it is a way out.

### 6. The Machine has no screen

It returns text and raises flags. No ANSI, no colour, no layout. `clear` sets
`ctx.clearRequested` and the renderer decides what that means.

### 7. A pull request means the branch is finished

Chris reviews and merges the moment a PR appears. That is the agreement, and
it is the right one — a PR is a request to merge, not a progress bar.

So: **do the whole job first.** All the code, the tests, `pnpm check` green,
the docs updated. *Then* open the PR.

If more genuinely has to follow, say so in two places — the first line of the
PR body and the chat message — in those words: **more coming, do not merge
yet.** Silence means finished.

Never push to a branch after its PR is open except to answer CI or review, and
say so when you do.

Getting this wrong is not a small mistake. Three commits were stranded on
already-merged branches in one session because a push and a merge raced; each
one needed a fresh branch and a new PR to recover. After any merge, verify
with `git merge-base --is-ancestor <sha> origin/main` rather than assuming the
push landed.

---

## Layout

```
packages/machine/    The Machine — vfs, shell, coreutils, proc, net, lang. The crown jewel.
packages/python/     Pyodide behind the PythonRuntime interface, in a Worker.
packages/sql/        wa-sqlite behind the SqlRuntime interface, in a Worker.
packages/crt/        Phosphor renderer: glyph atlas, WebGL2 CRT, terminal buffer.
packages/quest/      Objectives, state-aware hint ladders, `hint` and `objectives`.
packages/editor/     vi and nano over one text buffer. `vi`, `vim`, `nano`; also `less`.
packages/git/        Git's object model, with ids that match real git byte for byte.
packages/ml/         A real transformer small enough to read: the glass box.
packages/ascii/      Frames, gauges, sparklines and a block font for the art.
packages/audio/      The ship's sound, synthesised from its state. No audio files.
apps/terminal/       Playable web terminal; becomes the Capacitor app.
games/wreck/         Adventure 1: the NAV-7 world seed and the Act I ladders.
games/archive/       Adventure 2: Ferryman's Rest, the claims database, SQL.
games/harness/       Adventure 3: the tug ELLEN MAY, the recovery dump, Python.
games/fork/          Adventure 4: Pell's deposit office, the repository, Git.
games/containment/   Adventure 5: the annexe and the evaluation, models and measuring.
games/deposit/       Adventure 6: the machine floor, a fleet of hosts, operations.
```

Dependencies point one way: `apps` → `packages` → nothing. Import across
packages through the entrypoint (`@sigkill/machine`), never into `src/`.

---

## Commands

```bash
pnpm install
pnpm check         # typecheck + every test — run before every push
pnpm dev           # terminal at http://localhost:5173
                   # --host is on, so a phone on the same wifi can reach it
pnpm test
pnpm build
```

The first `pnpm dev` or `pnpm build` copies Pyodide into
`apps/terminal/public/pyodide` (~12 MB, gitignored, regenerated not
committed).

---

## Adding a command

1. Write it in `packages/machine/src/coreutils/{fs,text,proc,jobs,net,sys}.ts`
   as a `CommandSpec`.
2. Give it both `manual` (terse, real register — Operators) and `plain`
   (rewritten — Cadets). `man` picks by `ctx.track`.
3. Throw `FsError` with a real errno rather than inventing error text. The
   error messages are the teaching material.
4. Add a test, including the failure paths.

## Adding a subsystem

Add a determinism test for it. Run the same script twice, compare snapshots.
`test/jobs.test.ts` and `test/net.test.ts` both have one — copy either.

---

## Status

**Phase 0 complete. Phase 1 complete** — filesystem, shell, 58 commands,
processes and services, jobs and cron, the simulated network, and real Python
sharing the VFS.

**Phase 2 complete** — the phosphor renderer, the Android wrap, and the hint
system (`packages/quest` plus the Act I ladders). Chris has playtested Act I on
a phone and wants to keep going.

**Seven games exist, and all seven are in the chooser.** *The Wreck* (bash), *The
Archive* (SQL), *The Harness* (Python, debugging, testing), *The Fork* (Git),
*The Containment* (models and evaluation), *The Deposit* (operations, across
a fleet of hosts), and *The Pipeline* (data engineering). Run `pnpm check` for the test count rather than trusting one
written here; it was wrong in this file for three games running.

The 40% gate was applied through game six and held each
time — `node tools/measure.mjs` computes it, and `HANDOFF.md` has the latest
table. The series is fourteen games; `docs/PLAN.md` has the order Chris set
on 2026-10-03, and game seven is *The Pipeline*. See `docs/PLAYABILITY_PASS.md` for its scope and the playability pass.

**Every puzzle declares its own routes.** `Objective` carries `teaches`,
`routes` and `nearMisses`, and `packages/quest/src/harness.ts` runs them against
a real Machine in CI — so "this puzzle has three solutions" is something the
build knows rather than something an author believed. Do not add an objective
without them; `validate.ts` fails the build.

**Probe the engine before authoring a game.** Game three found seven bugs in
`packages/python` by writing the kind of script the game asks the player to
write, *before* writing any content. Two would have made the act unplayable —
including `sys.modules` outliving a command, so that fixing a bug and re-running
gave the old answer silently. None was visible from the engine's own tests.
Half a day of probing; it would have cost the whole act.

**Every game is launchable.** `packages/quest/src/adventure.ts` is the
`Adventure` contract, each game exports a descriptor, and `apps/terminal` keeps
one save slot per game with a chooser and a `games` command. Add a game by
adding a descriptor and one line to `apps/terminal/src/library.ts`; if it needs
more than that, the contract is wrong rather than the game. A game that is more
than one machine also implements `AdventureSession.snapshot()`, or a reload
silently undoes everything done on the other hosts — `games/deposit` is the
worked example.

**Phase 2 gated everything downstream** on the mobile input model, and it
passed. Content built on unpleasant input is content thrown away, so if the
input model changes, re-test it on a real phone before building more.

