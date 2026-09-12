# SIGKILL — agent pointer

Read this, then the architecture doc, then the code.

| Doc | Use for |
|-----|---------|
| **[HANDOFF.md](HANDOFF.md)** | **Read first.** Where the code is, what is open, what is waiting on Chris. |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | **Start here.** The map, and a full trace of one command from keypress to changed filesystem. |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why it is like this. Read before reversing anything that looks arbitrary. |
| [docs/TESTING.md](docs/TESTING.md) | The determinism harness and the goal-predicate pattern. |
| [docs/HINTS.md](docs/HINTS.md) | **Read before authoring an objective or a hint ladder.** |
| [docs/FULLSCREEN.md](docs/FULLSCREEN.md) | How `vi` takes the screen, and how to add another full-screen program. |
| [docs/PLAN.md](docs/PLAN.md) | North star — phases, risks, the thirteen adventures. |
| [packages/machine/README.md](packages/machine/README.md) | The engine's API surface. |
| [WORKING_ON.md](WORKING_ON.md) | Claim a package before editing it. Four of us share this repo. |

---

## What this is

Thirteen terminal survival adventures that teach real backend and ML
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
packages/crt/        Phosphor renderer: glyph atlas, WebGL2 CRT, terminal buffer.
packages/quest/      Objectives, state-aware hint ladders, `hint` and `objectives`.
packages/editor/     vi and nano over one text buffer. `vi`, `vim`, `nano`.
apps/terminal/       Playable web terminal; becomes the Capacitor app.
games/wreck/         Adventure 1: the NAV-7 world seed and the Act I ladders.
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

**Phase 0 complete. Phase 1 complete** — filesystem, shell, 57 commands,
processes and services, jobs and cron, the simulated network, and real Python
sharing the VFS.

**Phase 2 in progress** — the phosphor renderer and the Android wrap are in.
So is the hint system: `packages/quest` plus the Act I ladders in
`games/wreck`. 240 tests.

**Phase 2 gates everything downstream:** the mobile input model. Do not start
Phase 3 content until Chris has played twenty minutes on a real phone and
wants to keep going. Content built on unpleasant input is content thrown
away.
