# SIGKILL — handoff

Written 2026-09-12, updated after the Act I content push. Read this, then `CLAUDE.md`, then `docs/ARCHITECTURE.md`.
This file is the state of play; the others are the rules.

**Latest:** Act I is four puzzles and finishable end to end without a hint.
Voice is locked to **2, Wounded Machine**. Scope is locked to **the whole of
game 1, act by act, no deadlines**. See §8.

---

## 1. Where the code actually is

| Branch / PR | State | Contains |
|---|---|---|
| Branch / PR | State | Contains |
|---|---|---|
| `main` @ `94653cb` | **current** | everything below |
| PR #1–#11 | merged | phases 0–1, Android wrap, renderer, hints, editors, the coreutils sweep, the Act I blocker |
| PR #12 | merged | Deck C, puzzles 3–4, shell scripts, 32 manual pages |

`pnpm -r test` on `main`: **489 tests** — 214 machine, 130 editor, 36 crt,
29 quest, 27 python, 53 wreck. Typecheck clean, build clean. No open branches.

---

## 2. What is built

**`packages/machine`** — the deterministic virtual computer. 21 kB gzipped,
zero runtime dependencies, 57 commands. VFS with real uid/gid permissions and
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

**`packages/ascii`** — the art toolkit. Frames, gauges, sparklines and block
layout, no dependencies, shared by all thirteen games. `SAFE_COLS` is 34,
which is what a portrait phone really gives you. Two rules worth knowing:
art goes through `view.writeArt` (clipped) and never `write` (reflowed, which
scrambles it), and a column of sparklines must share an axis or the healthy
rows look like an emergency. It also carries a 5x3 block font, because all
thirteen games need their name up front.

**Art in the wreck** — `src/act1/art.ts` is the live diagrams (`deck`,
`pressure`), `src/act1/cards.ts` is the three set pieces. The division of
labour is by job, not taste: **typography is a logo** (cold open only, or it
becomes a watermark), **the schematic is the ship's condition** (cold open and
ending, drawn from `/etc/hull` so it can never disagree with `deck`), and
**the face is the character** (three appearances an act -- waking, the story
turn, the ending). Chris chose all three styles and "act boundaries only".

Two rules that are load-bearing:

1. Art goes through `view.writeArt` / `asArt`, never `write`. The Machine says
   which output that is via `preformatted`, modelled on `clearRequested`.
2. Only one number on the schematic is hearsay: `hullClaim`. It is a literal on
   purpose -- the epilogue turns on ORACLE having recited 61% off Vasquez's
   clipboard for eleven years -- while the sealed count beside it is measured.
   Computing the percentage would destroy the reveal.

**`packages/editor`** (PR #6) — `vi`/`vim` and `nano` over one shared
`TextBuffer` with a real undo stack. Pure state machines: keys in, frames out,
no DOM, so every keystroke is unit-tested. See §4b and `docs/FULLSCREEN.md`.

**`games/wreck`** — the NAV-7 world seed and the Act I objectives.
`src/act1/deck-c.ts` is the deck: accounts, quarters, nine hull compartments
and 540 lines of deterministic pressure telemetry. `src/objectives.ts` is the
four puzzles. Nothing in either reads what the player typed.

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

### Read-only files could not be typed into at all

The first report was *"can't type within the file"* and I found a touch-path
bug, fixed it, and asked whether it had been a phone. It had not — it was a
laptop, and there was a fourth bug underneath:

```
/etc/life_support.conf   typed=YES
README                   typed=YES
/etc/crew.csv            typed=NO   "/etc/crew.csv" is read-only
/var/log/boot.log        typed=NO   "/var/log/boot.log" is read-only
```

`enterInsert()` refused on any file the player could not write. Most of `/etc`
and all of `/var/log` are root-owned, so the files a curious player opens first
were exactly the ones that silently did nothing when they pressed `i`.

**It was also wrong vi.** Real vi opens a read-only file, lets you change the
buffer freely, and refuses at `:w` with E45. Blocking the keystroke is an
invention, and it reads as a broken editor because nothing visibly happens.

Now: read-only files are editable in both editors; `:w` gives
`E45: readonly (add ! to override)`; `:w!` attempts it and the **filesystem**
refuses, with its real error (`EACCES: Permission denied`) shown on the status
line. `sudo vim /etc/crew.csv` opens it writable. That chain teaches the actual
lesson instead of hiding it.

The host reports a refused write through a new optional `notify()` on
`ScreenProgram` — writing it to the scrollback would have hidden it behind the
editor's own frame until the player quit.

### `sudo vi` opened writable and then threw the work away

Found while checking the read-only fix, and it was the advice I had just given:

```
sudo open   "/etc/crew.csv" 3L, 76C      <- writable, no [readonly]
sudo :w     EACCES: Permission denied    <- then refuses
```

`sudo` swaps `ctx.user` for exactly one command and restores it in a `finally`.
The editor outlives that: by the time the player types `:w`, the shell is the
unprivileged user again, and the host was writing as *the shell's* user.

`ScreenProgram` now carries `user`, captured (and copied) at launch, and the
host writes as that. Any future full-screen program must do the same — the rule
is in `docs/FULLSCREEN.md`.

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

## 4c. What a player actually types, and what the shell accepted

I swept ~100 commands a curious person types in Act I through the real Machine
and read the failures rather than guessing at them. Most were correct
behaviour and were left alone — `cd /nope` erroring, the scrubber refusing an
unbreathable target, `systemctl status` exiting 3 the way real systemd does.
The rest were genuine gaps, and clustered into two kinds:

**Flag forms people type, that were rejected:**

- `head -5` / `tail -20` — only `head -n 5` worked. `parseArgs` deliberately
  leaves a bare `-5` alone (it cannot know whether a lone number is a flag), so
  the commands that accept the historical form now ask for it via
  `takeCountOperand`.
- `chmod +x` — octal only. `chmod +x script.sh` is one of the first real things
  anybody learns to type; octal-only is a teaching gap, not a simplification.
  `parseMode` now takes `+x`, `u+w`, `go-rwx`, `a=r`, comma clauses and `X`.
- `grep -r` — refused a directory outright, while the README sends the player
  to look in `/etc`. It walks the tree now, skips what it cannot read, and
  keeps GNU's exit codes exactly (2 on any error, even with matches found —
  `/etc/shadow` is unreadable forever, so that path is exercised constantly).

**Commands reached for and missing:** `date`, `uname`, `df`, `tee`,
`basename`, `dirname`. 57 commands now.

`date` is the interesting one: it reads `epoch + clock()` and nothing else, so
it is deterministic and only moves when ship time moves (`sleep 90` advances it
by ninety seconds). `ShellContext` gained `epoch` for it. **Never reach for
`new Date()` here** — a clock that follows the player's wall time would break
replay for every puzzle downstream.

`df` measures the real tree rather than printing a made-up number, so it
responds to what the player does.

**Still missing, in rough order of how much a player wants them:**

| Missing | Why it matters | Size |
|---|---|---|
| `less` / `more` | a pager is the natural next use of the `ScreenProgram` seam | medium, and fun |
| `journalctl` | systemd is right there; `journalctl -u scrubber` is the obvious move | medium — needs a log store |
| `for` / `if` / `while` | shell control flow; probably its own teaching beat | large |
| `awk` | a whole language; maybe never, or as its own adventure | large |
| `sed -n '1,3p'` | only `s///` is implemented; addresses are a natural extension | small |
| `diff`, `xargs`, `history`, `alias`, `file`, `realpath`, `type` | each cheap on its own | small |

**The method is the reusable part:** write a sweep of plausible player
commands, run it against the Machine, read the exit codes. It takes a minute
and it is the only way to find what is missing rather than what you remember
building.

### The review that followed, and why bot findings get verified not trusted

An automated review left eight findings on that PR. **Every one was real**, and
they were all in the new code. Worth keeping as a calibration point: careful
work plus 395 passing tests still shipped eight defects, and a second reader
found them in minutes.

The worst was a permissions bug. `vfs.chmod` follows a symlink to its target,
but the mode was read with `lstat`, which returns the *link's* own fixed 0777.
So `chmod g+r link` on a 0600 file wrote **0777** to it — world write and
execute on a private file, from a command that asked for group read. Reading
with `stat` fixes it, and the rule is general: **read the mode from the same
inode the write will land on.**

The rest: `grep -r PATTERN` with no path searched nothing instead of `.`;
`epoch` was not in `MachineSnapshot`, so `date` jumped across a save (a
determinism break, which is invariant #1); `chmod -x` was eaten by the flag
parser; `head -- -5` ignored the `--` boundary, so a file genuinely named `-5`
was unreachable; recursive grep swallowed unreadable directories and could
report "no matches" for a tree it never opened; `dirname /` returned `.`;
and `a+X` did not apply to directories, which is half the point of `X`.

Two things this changed in the code beyond the fixes:

- `parseArgs` now returns `separator`, the index in `operands` where arguments
  after `--` begin. Anything that reinterprets an operand must respect it.
- `expandTree` returns `{ files, errors }` rather than swallowing what it could
  not read.

And one of my own, found by the tests I wrote for the fix: the epoch restore
used a truthiness check, so `epoch: 0` — the Unix epoch, a perfectly legal
calendar — silently fell through to the default. Check `undefined`, not truth.

**Verify a bot finding before fixing it.** All eight here were genuine, but the
P1's *described symptom* was only reproducible once the fixture had an
`/etc/sudoers`; without it `sudo` correctly refused and the command never ran,
which looked like the bug was absent. A finding you cannot reproduce is a
finding you do not understand yet.

### The working agreement with Chris

**A pull request means the branch is finished.** He reviews and merges as soon
as one appears — that is the agreement and it is the right one. Do the whole
job, get `pnpm check` green, update the docs, *then* open the PR.

If more has to follow, say **"more coming, do not merge yet"** in the first
line of the PR body *and* in the chat message. Silence means finished.

Never push to a branch after its PR is open except to answer CI or review.

### A mistake that happened three times — do not make it a fourth

Three times a branch was merged **while a later commit was still being pushed
to it**, stranding that commit on a closed PR's branch. The cause was mine
every time: opening a PR before the work was done, then continuing to push to
it. See the agreement above.

- The renderer sat orphaned on `phase-1-complete` for a day. `main` had a
  placeholder `packages/crt` the whole time and CI ran 159 tests, while I
  reported 195. Recovered in PR #4.
- The hint system did the same thing on `phase-2-crt-renderer` minutes later.
  Recovered same-session into PR #5.
- The `sudo` editor fix did it again on `fix/editor-typing`. Recovered into
  PR #8 within a minute, because the check below had become a habit by then.

**After any merge, verify with `git merge-base --is-ancestor <sha> origin/main`**
rather than trusting that a push went in. It is two seconds and it is the only
reason the third one cost a minute instead of a day.

Also: `git ls-remote --heads origin` is the recovery tool. Nothing was ever
lost, only misplaced.

---

## 5. Decisions — settled, and what is still open

### 5a. The ORACLE voice — settled

**Chris picked option 2, the Wounded Machine.** Grieving, formal, occasionally
fragments; specific numbers because a machine that has counted something says
how many. It carries real weight and it needs a light hand or it drags — the
discipline is that ORACLE is precise about what it does and does not know, and
corrects itself out loud rather than being reassuring.

All four Act I objectives and every hint rung are written in it. The register to
match, if you are adding lines:

> ORACLE: I want to be accurate about this. Nothing has been saved. The
> ORACLE: reserve is still what it was [...] But the number is going up
> ORACLE: instead of down, and it has not done that since day nine.

The other three options (Wry Survivor, Insubordinate Tool, Unreliable Log) are
in git history on `docs/pr-when-final` if a later game wants a different daemon.
Each of the thirteen games can have its own; the voice is one option on
`questCommands` and recasting touches no ladder.

### 5a-bis. Scope — settled

**The whole of game 1 (The Wreck), act by act, Act I first, no deadlines.**
Depth over breadth. Chris's words: *"what we create must be of highest
quality"*, *"depth, depth, depth"*. Epics, not days:

| | Epic | State |
|---|---|---|
| E1 | The Machine — engine, shell, VFS, services, Python, renderer | done |
| E2 | The frame — save/load, live clock, progression | not started |
| E3 | Act I — Breathe. Deck C | **4 of ~8 puzzles** |
| E4–E6 | Acts II–IV | not started |
| E7 | Procedural audio — Web Audio, state-driven, zero assets | decided, not built |
| E8 | Ship — Play Store | not started |

### 5b. Also open

- **The phone playtest is still the Phase 2 gate**, and is now specifically a
  test of the editor: is vi tolerable on a touchscreen with the chip bar doing
  the work? If it is not, fix that before any Act II content. Instructions in §6.
- Remaining Phase 2 polish: gestures, haptics, audio, tablet/landscape layouts.
- **Four story questions are still Chris's to answer**, and Act II cannot be
  written around them: how long should an act be; can the player lose; does
  Vasquez stay dead; and what the ending of game 1 means.
- `games/wreck` Acts II+ are unwritten. Act I is four puzzles and complete.
- vi leaves out visual mode, marks, macros and named registers. `:help` inside
  it says so rather than pretending. Add them only if a puzzle needs them.
- Missing commands and shell features are catalogued in §4c, with sizes.
  `less` is the one I would do next: it is a pager, which is the natural
  second use of the full-screen seam, and `/var/log/hull.log` is now 540 lines
  — which is exactly the file a pager exists for.

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

## 7. The Act I content push — what shipped and what it found

Act I was two puzzles that ended in six moves. It is now four, and the act is
finishable without ever typing `hint` — there is a test that plays it that way.

| # | Objective | Teaches | Done when |
|---|---|---|---|
| 1 | `atmosphere` | `systemctl status`, reading a config, an editor or `sed` | scrubber active |
| 2 | `survive-a-reboot` | start vs enable, symlinks on disk | scrubber enabled |
| 3 | `hull-watch` | **`ls -l`, the execute bit, `chmod +x`** | hull-monitor active and enabled |
| 4 | `seal-the-breach` | **`grep`, `-c`, `cut \| sort \| uniq -c`, dates over counts** | `/etc/hull/c7.conf` says `SEALED=yes` |

### The content

`games/wreck/src/act1/deck-c.ts`. The rule it is written to: **every file is a
lead, a lesson, or a person.** Anything else is furniture, and furniture teaches
the player that looking around does not pay.

- `/etc/passwd`, `/etc/group` — five crew names, so `ls -l /home` is a story
- `/home/vasquez/.bash_history` — nineteen real commands that all run aboard.
  The strongest teaching device on the ship: commands in the hands of somebody
  who had a reason to type them
- `/home/vasquez/notes/` — `todo` (C7 is line five, capitalised), `seal.sh`
  (hers, also not executable), `scrubber-notes.txt`, `hull-notes.txt`
- `/home/chen/crew-health.csv` — O2 saturation per person per day, declining
- `/home/bowen/pod-manifest.txt` — the thread into Act II
- `/etc/hull/c1..c9.conf` — nine compartments, one open
- `/var/log/hull.log` — 540 lines, deliberately unreadable, LCG-generated so it
  is byte-identical on every machine. **C2 dropped too and was patched**, so
  counting matches finds two compartments and only the dates find the live one

### Engine work the content forced

Every one of these was found by writing content or by reading a transcript, not
by unit tests:

1. **Shell scripts run.** `resolveProgram` in `shell/exec.ts`: a name with a
   slash is a path, a bare name is searched on `PATH`, and a readable file with
   an x bit is a program. Shebangs route to `sh` or to any interpreter aboard
   (`#!/usr/bin/env python3` works). Scripts run in a subshell — their `cd`,
   variables and `exit` stay inside; what they do to the filesystem is real.
2. **A newline ends a statement.** It was plain whitespace, so `echo one\necho
   two` ran as one command and printed `one echo two`. Nothing noticed for
   months because nothing ever handed the parser two lines. Line continuation
   (`\` at end of line) works, and `|`, `&&`, `||` keep reading across a break.
3. **Positional parameters.** `$1`…`$9`, `${10}`, `$0`, `$#`, `$@`, `$*`.
4. **`sudo` dispatches through the shell**, not the command table. It used to
   say `command not found` for `sudo ./seal.sh` — a script sitting right there.
5. **Root respects the execute bit.** `vfs.can()` let uid 0 bypass every check,
   so `sudo ./seal.sh` ran a 0644 file. Linux requires at least one x bit even
   for root, and here it is the difference between "chmod +x is the fix" and
   "sudo is the fix" — which is the entire lesson of puzzle 3.
6. **`ls -l FILE` never worked.** It joined an absolute operand onto its own
   directory, failed to stat the result, and silently printed the bare filename
   with no mode, owner or size. Only ever visible on an absolute path.
7. **`ls -l` and `stat` name the owner**, read from `/etc/passwd` and
   `/etc/group`, with column widths from the longest entry.
8. **`systemctl --failed`.** Two units fail at boot now; this is how anybody who
   has run a real machine asks what is broken.
9. **32 manual pages.** `man` is the discovery route the cold open teaches, and
   31 of the most basic commands had no page at all — `man ls` printed one line.
   Every command aboard now has both an operator and a cadet page, guarded by a
   test that fails if one goes missing.

### Tests worth knowing about

- `games/wreck/test/wreck.test.ts` — `can be played end to end without ever
  asking for a hint` is the one that matters. It follows only the note, the
  logs, the unit status and Vasquez's history, and asserts `hintsTaken === 0`.
- `the numbers in the writing are the numbers in the world` — ORACLE quotes 540
  lines and 68 matches. A change to the telemetry generator that makes those
  wrong fails CI instead of turning ORACLE into a liar.
- `games/wreck/test/transcript.test.ts` — not a test, a reading tool. Prints a
  full session. Run it and *read it*; that is how 5 of the 9 engine bugs above
  were found. Needs `--disable-console-intercept`, or vitest swallows the output
  of a passing test:

  ```
  pnpm --filter @sigkill/wreck exec vitest run transcript --disable-console-intercept
  pnpm --filter @sigkill/wreck exec vitest run hints --disable-console-intercept
  ```
- `games/wreck/test/hints.test.ts` — prints every rung of every ladder on both
  tracks, and asserts no rung repeats another and no nudge contains its own
  answer. That last one caught the operator ladder naming C7 before it had
  taught `grep`.

---

## 8. What I would do next

1. **Playtest Act I end to end** on a phone. Four puzzles, ~25 commands. The
   artifact is republished. Everything below is guesswork until this happens.
2. **Puzzle 5 — SIGKILL.** `ps`, `kill`, signals. The game is named after it
   and does not contain it. Natural shape: something is holding the reserve
   line open, `ps` finds it, `kill` does not work, `kill -9` does, and ORACLE
   has an opinion about what that means.
3. **Save/load.** `snapshot()` exists and the app never calls it. Close the tab,
   lose the run. This is the largest hole in the frame and it is not content.
4. **A live O2 countdown.** The cold open prints `9h 14m` as a string. It should
   come off the virtual clock, and the epilogue's point — that ORACLE has been
   reciting a number off a clipboard — sharpens if the other numbers are live.
5. **`less`.** A 540-line log is exactly what a pager is for, and the
   full-screen seam is already built (`docs/FULLSCREEN.md`).
6. **Procedural audio** (E7). Decided: Web Audio, state-driven, zero assets.
7. **Act II.** Bowen's heading is 114 mark 9 and deck B is open to space.

`apps/terminal` still has zero tests. The Playwright harness that found the
touch bugs should become permanent.

Do not recreate deleted roadmaps. Do not widen a PR on your own. If a test
fails, say so with the output.
