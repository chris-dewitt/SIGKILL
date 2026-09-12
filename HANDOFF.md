# SIGKILL — handoff

Written 2026-09-12, updated after the first real playtest. Read this, then `CLAUDE.md`, then `docs/ARCHITECTURE.md`.
This file is the state of play; the others are the rules.

---

## 1. Where the code actually is

| Branch / PR | State | Contains |
|---|---|---|
| `main` @ `0b78b20` | **current** | Machine, Python, renderer, Android wrap, hints |
| PR #1–#5 | merged | Phases 0–1, Android wrap, renderer, hint system |
| PR #6 | merged | `packages/editor` — vi and nano — plus the Act I trail fix |
| **PR #7 / `fix/editor-typing`** | **open, needs review** | the three touch-path bugs below |

`pnpm check` on `fix/editor-typing`: **360 tests** — 132 machine, 118 editor,
36 crt, 29 quest, 27 python, 18 wreck. Typecheck 7/7, build clean.

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

**`packages/quest`** — objectives and hint ladders. See §4.

**`packages/editor`** (PR #6) — `vi`/`vim` and `nano` over one shared
`TextBuffer` with a real undo stack. Pure state machines: keys in, frames out,
no DOM, so every keystroke is unit-tested. See §4b and `docs/FULLSCREEN.md`.

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

## 4. The hint system — the part most likely to be misused

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

## 4b. The editor, and the playtest that caused it

Chris played it and hit two things. Both were real design failures, not bugs:

> *"what fucking file am I writing into when I use ls all I see is the fucking
> README"* — and — *"WTF, can't use VIM???"*

He was right twice. `sed -i` is an indefensible first-ever file edit, and a hint
that names `/etc/life_support.conf` cold is asking someone to edit a file they
cannot see from where they are standing.

**What changed:**

- `vi`, `vim` and `nano` exist, over one shared `TextBuffer`. vi has modes,
  counts, operators, `/` search, undo/redo and ex commands including
  `:%s/a/b/g`. nano has no modes and prints its keys on screen.
- **The chip bar becomes the editor's keys** in editor mode — `i ESC :w :wq dd
  u` in normal mode, `ESC ← → ↑ ↓` in insert. That is the whole answer to
  pressing Escape on a phone, and the reason vi is usable there at all.
- The prompt input is **collapsed, never hidden**, so the soft keyboard stays up.
  Hiding it leaves a phone player able to tap chips but unable to type.
- `/home/survivor` has a `logs/` directory with two readable logs, so `ls` on the
  first command is no longer a dead end that reads as a broken game.
- The README is a trail: `systemctl status scrubber` → `ls /etc` → open it with
  either editor → start the service.
- The first hint rung now hands over a **diagnostic** (`systemctl status
  scrubber`) rather than a mood. Telling someone how to diagnose is not a
  spoiler; telling them the fix is. There is a test named for that line.

### The touch path was broken, and unit tests could not have caught it

Second playtest: *"is VIM broken? I'm trying vim (filename), and then can't type
within the file."* It worked on a physical keyboard and failed on a phone, so I
drove the built app in headless Chromium on a touch viewport and reproduced it
in one run. Three separate bugs, all of them in the glue between the editor and
the DOM, none of them reachable by the editor's own tests:

1. **Tapping a chip lost focus.** `refreshChips()` rebuilds the buttons on every
   keystroke, so the tapped button stopped existing mid-gesture, focus fell to
   `<body>`, and the soft keyboard closed. Everything typed after that went
   nowhere. Fixed with `preventDefault` on pointerdown (so an on-screen key
   never takes focus at all) plus an explicit refocus after each tap.
2. **`:w` and `:wq` chips never sent Enter** — they typed the command into the
   ex line and sat there.
3. **nano's `^O` and `^X` chips typed a literal caret and a letter into the
   file** instead of sending Ctrl.

The mapping from a chip label to keystrokes now lives in
`packages/editor/src/chips.ts` — **in the package, not the app** — precisely so
it can be tested without a browser. `test/chips.test.ts` finishes a whole edit
by taps alone.

Also added: typing a letter in normal mode now says
`Not a command: q -- press i to start typing, or :help`. Real vi beeps and moves
on; this is a teaching game, and silence there looks exactly like a broken
editor. That is the literal complaint that started this.

**Lesson for whoever is next: the editor is pure and well-tested, and that is
not enough.** Anything that touches focus, the soft keyboard, or the chip bar
has to be driven in a real browser on a touch viewport. Playwright and Chromium
are available in the cloud session (`/opt/pw-browsers/chromium-1194`); serve
`apps/terminal/dist` and drive it. Twenty minutes of that found three bugs that
344 unit tests did not.

**The constraint this introduced, which matters for every future ladder:** a
`command` rung's `command` field must be non-interactive, because CI runs it
through the real shell. `vi` changes nothing by itself. So the prose leads with
the editor and the field carries the one-line `sed` equivalent. `docs/HINTS.md`
says so.

**Where a new full-screen program goes:** `docs/FULLSCREEN.md`. The seam is
`ctx.screenRequest`, which follows `clearRequested` exactly — the Machine raises
a flag, the host decides what it means, and the Machine still depends on
nothing. A Machine with no screen never drives the program, so `vi` in a cron
job is a no-op rather than a hang.

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

- **The phone playtest is still the Phase 2 gate**, and is now specifically a
  test of the editor: is vi tolerable on a touchscreen with the chip bar doing
  the work? If it is not, fix that before any Act II content. Instructions in §6.
- Remaining Phase 2 polish: gestures, haptics, audio, tablet/landscape layouts.
- `games/wreck` Acts II+ are unwritten. Only Act I exists.
- vi leaves out visual mode, marks, macros and named registers. `:help` inside
  it says so rather than pretending. Add them only if a puzzle needs them.

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

**What to try, in order:**

1. `ls` — there is a `logs/` directory now. `cat logs/vasquez.log`.
2. `cat README` — it names the diagnostic, the directory and both editors.
3. `systemctl status scrubber` — the refusal, in its own words.
4. `hint`, three times. It hands over a diagnostic first and the fix last.
5. `vi /etc/life_support.conf` — `j`, `$`, then `r2` … or just `i` and type.
   Save and quit with `:wq`. Every key you need is on the chip bar.
6. `nano /etc/life_support.conf` if vi annoys you: `^O` then `^X`.
7. `sudo systemctl start scrubber`, then `objectives`.
8. `?plain` in the URL to see it with the CRT shader off.
9. `python3 -c 'print(1+1)'` — local only; the artifact host will not serve
   Pyodide's `.zip` standard library, and `python3` says so plainly there.

**What to judge:** whether editing a file on a phone is tolerable. That is the
gate. Nothing else on this list matters as much.

---

## 7. What I would do next

1. Get PR #6 reviewed and merged. **New branch off `main` for anything after
   it.**
2. Phone playtest of the editor specifically. If vi-on-glass is bad, that is the
   next piece of work and it outranks everything else.
3. Chris picks an ORACLE voice (§5a); rewrite `games/wreck/src/objectives.ts`
   prose only — no ladder shape changes.
4. Then, and only then, Act II of The Wreck.

Do not recreate deleted roadmaps. Do not widen a PR on your own. If a test
fails, say so with the output.
