# SIGKILL — agent pointer

Read this before touching anything.

| Doc | Use for |
|-----|---------|
| **[docs/PLAN.md](docs/PLAN.md)** | **North star** — architecture, phases, risks. Phase 1 in progress. |
| [WORKING_ON.md](WORKING_ON.md) | Claim a package before editing it. Four agents share this repo. |
| [README.md](README.md) | What this is, how to run it |

---

## What this is

Thirteen terminal survival adventures that teach real backend and ML
infrastructure engineering. Phone-first, offline, paid once per game, no ads,
no accounts, no telemetry.

Every game runs on one deterministic virtual computer — **the Machine**
(`packages/machine`). That package is the whole investment. Treat it accordingly.

---

## Git identity — always use this

```
git config user.name "Chris-dewitt"
git config user.email "chnodewi@unc.edu"
```

Never commit as Claude.

---

## Rules that are not negotiable

These exist because breaking them is expensive to undo later, not because
they are stylistic preferences.

### 1. The Machine is deterministic

No `Date.now()`, no `Math.random()`, no host I/O anywhere in
`packages/machine`. Time comes from the virtual clock (`machine.tick(ms)`).
Randomness, when it arrives, comes from a seeded generator.

This is what lets every puzzle be replayed headlessly in CI. A single wall-clock
call silently destroys that property for the whole project.

### 2. Goals assert on world state, never on input

A puzzle is solved when the world reaches a state. It is never solved by
matching what the player typed.

```ts
// Right — any route that reaches this state wins.
goal: (m) => m.vfs.readText('/etc/life_support.conf').includes('O2_TARGET=21')

// Wrong — this is the bug that makes a terminal feel fake.
goal: (m) => m.lastCommand.startsWith('sed -i')
```

`packages/machine/test/goal.test.ts` enforces this. If that file ever needs a
special case for a particular command, the design has regressed and the fix
belongs in the goal, not the test.

### 3. Player code never runs in the host context

No `eval`, no `new Function`, no dynamic `import()` of anything a player or a
content pack supplied. Player Python runs in Pyodide inside a Web Worker, and
nowhere else.

Content packs are **data**. Goal predicates compile into the app bundle. A pack
that can ship executable code is remote code execution wearing a hat.

### 4. No third-party SDKs

No ads, no analytics, no crash reporter that uploads content. Every dependency
is a deliberate decision and CI audits the tree. This is a security control,
not a philosophy — the moment the app can hold a secret, every SDK in it is an
exfiltration surface.

### 5. The Machine has no screen

It returns text and raises flags. It does not emit ANSI escapes, colours, or
layout. Whatever renders it decides what those mean. See `clearRequested`.

---

## Layout

```
packages/machine/    The Machine — VFS, shell, coreutils. The crown jewel.
packages/crt/        Renderer (Phase 2)
apps/terminal/       Playable web terminal; becomes the Capacitor app
games/wreck/         Adventure 1 content (Phase 3)
```

Package boundaries are the contract between agents. Import across them through
the package entrypoint (`@sigkill/machine`), never by reaching into `src/`.

---

## Commands

```bash
pnpm install
pnpm check         # typecheck + test — run before every push
pnpm dev           # terminal at http://localhost:5173 (--host is on, so a phone
                   # on the same wifi can reach it)
pnpm test          # all packages
pnpm build
```

---

## Adding a command to the shell

1. Write it in `packages/machine/src/coreutils/{fs,text,sys}.ts` as a `CommandSpec`.
2. Give it `manual` (terse, real register) and `plain` (Cadet rewrite). `man`
   picks by track.
3. Add a test. Include the failure paths — the error messages are the teaching.
4. Errors come from `FsError` with a real errno, so the message matches what
   the player would see on a real machine.

## Current phase

**Phase 1 — the Machine.** VFS, shell and coreutils are in and green.
Next: process table and virtual clock scheduler, then Pyodide bound to the VFS.

Do not start Phase 3 content until the Phase 2 input gate passes: twenty
minutes on a real phone that Chris wants to keep playing.
