# SIGKILL — handoff

Written 2026-09-12. Read this, then `CLAUDE.md`, then `docs/ARCHITECTURE.md`.
This file is the state of play; the others are the rules.

---

## 1. Where the code actually is

| Branch / PR | State | Contains |
|---|---|---|
| `main` @ `3187023` | **current** | Machine, Python, phosphor renderer, Android wrap |
| PR #1, #2, #3, #4 | merged | Phases 0–1, the Android wrap, the renderer |
| **PR #5 / `phase-2-hints`** | **open, needs review** | `packages/quest` + the Act I hint ladders |

`pnpm check` on `phase-2-hints`: **240 tests** — 132 machine, 36 crt, 29 quest,
27 python, 16 wreck. Typecheck 6/6, build clean.

### A mistake that happened twice — do not make it a third time

Both times a branch was merged **while a later commit was still being pushed to
it**, stranding that commit on a closed PR's branch:

- The renderer sat orphaned on `phase-1-complete` for a day. `main` had a
  placeholder `packages/crt` the whole time and CI ran 159 tests, while I
  reported 195. Recovered in PR #4.
- The hint system did the same thing on `phase-2-crt-renderer` minutes later.
  Recovered same-session into PR #5.

**Rule: after opening a PR, do not push more work to that branch.** Start a new
branch off `main` for the next thing. And after any merge, verify with
`git merge-base --is-ancestor <sha> origin/main` rather than trusting that a
push "went in".

Also: `git ls-remote --heads origin` is the recovery tool. Nothing was ever
lost, only misplaced.

---

## 2. What is built

**`packages/machine`** — the deterministic virtual computer. 21 kB gzipped,
zero runtime dependencies, 50 commands. VFS with real uid/gid permissions and
symlink loop detection; a quote-preserving shell (pipes, `&&`/`||`, redirection,
subshells, `$(...)`); a process table with systemd-style units read from the
filesystem; a virtual clock with `sleep`, background jobs and cron; a simulated
network where every host is another `Machine`.

**`packages/python`** — real Python via Pyodide in a Web Worker, bound to the
VFS by bulk copy-in / diff-out. `NodePythonRuntime` is **tests only** — never
wire it into the app; the Worker is what keeps player code away from the DOM.

**`packages/crt`** — the phosphor renderer. Unwrapped logical lines reflowed on
demand, a glyph atlas, and a switchable WebGL2 pass. `?plain` turns the shader
off.

**`packages/quest`** (PR #5) — objectives and hint ladders. See §4.

**`games/wreck`** — the NAV-7 world seed and the Act I objectives.

**`apps/terminal`** — the playable terminal and the Capacitor Android wrap.
`android/app/src/main/AndroidManifest.xml` is tracked in git on purpose and
guarded by `tools/check-manifest.mjs` in CI: `adjustResize`, **no INTERNET
permission**, `allowBackup="false"`. A Capacitor upgrade will try to undo all
three.

---

## 3. Invariants — breaking these is silent and expensive

1. **Determinism.** No `Date.now()`, no `Math.random()`, no host I/O anywhere in
   `packages/machine`. Time moves only through `tick(ms)`.
2. **Solution-agnostic goals.** A puzzle goal asserts on world *state*, never on
   what the player typed. `sed`, a redirect, a Python one-liner and an editor
   all pass, including routes nobody anticipated. See
   `packages/machine/test/goal.test.ts` and `packages/quest`.
3. **`packages/machine` imports nothing outside itself.** Dependencies point one
   way: `apps` → `packages` → nothing.
4. **Import across packages through the entrypoint** (`@sigkill/machine`), never
   into `src/`.
5. **No ads, ever, and no third-party SDKs.** Chris was explicit. It is also a
   security control: every SDK is an exfiltration surface in a game that runs
   player-authored code.
6. **Never proxy a player's API key through a server we run.** The finale ships
   a bundled on-device model via Play Asset Delivery instead.
7. **Commit as Chris** (`Chris-dewitt` / `chnodewi@unc.edu`), never as Claude.
   SIGKILL's history does carry `Co-Authored-By: Claude ...` trailers;
   Dead Drift's `CLAUDE.md` forbids them. Follow each repo's own rule.

---

## 4. The hint system (PR #5) — the part most likely to be misused

Full guide in **`docs/HINTS.md`**. The three things that matter:

- **A goal is a fact about the world.** `done` and `pending` read `{ vfs,
  services }` and nothing else. Never check what was typed.
- **Every ladder ends at the literal command**, and the validator fails CI if it
  does not — *per track*, because a rung restricted to one track leaves the
  other ladder ending early and strands exactly one kind of player, invisibly.
- **Hints cost nothing.** No timer, no currency, no penalty. The book counts
  them so a no-hint run can be recognised, and that is all.

Steps are what make it feel alive: the book hints about the first step still
`pending`, and escalation is counted *per step*, so progress earns a fresh
nudge instead of inheriting the last problem's bluntness.

`command` rungs carry the command in its own field, not only in prose, because
prose cannot be tested. `games/wreck/test/wreck.test.ts` drives a real machine
to each step and runs that string through the actual shell. **Copy that test
into every adventure that adds a ladder** — it is ~20 lines and it is the
reason a hint cannot quietly go out of date.

---

## 5. Open decisions — waiting on Chris, blocking nothing else

### 5a. The ORACLE voice — pick one

Chris asked for options and has not had them. The ladder *shape* is settled;
the voice is one option on `questCommands` and recasting it touches no ladder,
so this can be answered any time. Same moment in all four (cold open, then the
first hint) so they are comparable:

**Option 1 — The Wry Survivor** *(what is currently committed)*
> You're awake. Good. I'm what's left of the maintenance daemon. I can't move,
> I can't see, and I can't fix anything myself. You can.
>
> The scrubber did not just fail. It refused. It said why, at the time, and
> this ship writes everything down.

Dry, competent, faintly self-deprecating. Easiest to write a lot of, lowest
risk, least distinctive.

**Option 2 — The Wounded Machine**
> You're awake. I did not expect that. I have been reading the same four
> hundred log lines for eleven years and none of them ever changed.
>
> The scrubber refused. I want you to understand that it was not a fault — it
> was asked for something impossible and it said no. I have thought about that
> a great deal.

Grieving, formal, occasionally fragments. Carries real weight. Risk: needs a
light hand or it drags.

**Option 3 — The Insubordinate Tool**
> You're awake, which makes you the single most qualified crew member aboard.
> That is not a compliment. That is arithmetic.
>
> The scrubber refused an order. I would have told whoever gave it as much, but
> nobody asked me, and now nobody can.

Brisk, sardonic, loyal underneath. Most fun to read, most fun to write. Risk:
lands in Portal's shadow if it gets glib.

**Option 4 — The Unreliable Log**
> `[4112.000] console: session opened`
> `[4112.004] operator detected. 1 of 1.`
> I am not supposed to address you directly.
>
> `[0000.884] scrubber: FAIL - configuration rejected`
> It refused. It is still refusing. I have not been able to stop reading it.

ORACLE barely has a personality; system-log register that slips into first
person. Coldest, most diegetic, quietly the creepiest. Risk: hardest to sustain
for thirteen games.

My pick: **3**, with **2**'s weight for the act endings. Chris edits from there.

### 5b. Also open

- **Playtest feedback is the Phase 2 gate.** Do not start Phase 3 content until
  Chris has played twenty minutes on a real phone and wants to keep going.
  Content built on unpleasant input is content thrown away. Instructions in §6.
- Remaining Phase 2 polish: chip-bar tuning, gestures, haptics, audio,
  tablet/landscape layouts.
- `games/wreck` Acts II+ are unwritten. Only Act I exists.

---

## 6. How Chris playtests

```bash
git fetch origin phase-2-hints && git checkout phase-2-hints
pnpm install
pnpm dev            # http://localhost:5173
```

`.npmrc` must keep `enable-pre-post-scripts=true` — pnpm defaults it off now,
and without it the 12 MB Pyodide copy step is silently skipped and `python3`
fails at runtime with nothing in the console explaining why.

On a phone, same wifi: `pnpm dev` already binds `0.0.0.0`, so open
`http://<laptop-ip>:5173`. For a real APK:

```bash
pnpm --filter @sigkill/terminal android:debug
```

**What to try, in order:** `ls`, `cat README`, `systemctl status scrubber`,
then `hint` three times and notice it stops at the command; fix the config any
way you like; `hint` again and notice it has moved on to starting the service;
`sudo systemctl start scrubber`; `objectives`. Then `?plain` in the URL to see
the CRT shader off. Then `python3 -c 'print(1+1)'` to pay the interpreter cost
once.

**What to judge:** whether typing on a phone is tolerable. Nothing else on this
list matters as much.

---

## 7. What I would do next

1. Get PR #5 reviewed and merged. **New branch off `main` for anything after
   it.**
2. Chris picks a voice; rewrite `games/wreck/src/objectives.ts` prose only.
3. Phone playtest. Report honestly; if the input model is bad, fix that before
   anything else.
4. Then, and only then, Act II of The Wreck.

Do not recreate deleted roadmaps. Do not widen a PR on your own. If a test
fails, say so with the output.
