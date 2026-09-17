# SIGKILL — handoff

Written 2026-09-12, updated 2026-09-17 after Pass 0 and the signals work.
Read this, then `CLAUDE.md`, then `docs/ARCHITECTURE.md`.
This file is the state of play; the others are the rules.

**Latest:** Act I is **five** puzzles and finishable without a hint, and
**LUNA is in** — a process, a directory, and the second voice on the hint
ladder. Chris is
playtesting it on a phone — the Phase 2 gate is notes, not a waiting room.
Voice is **2, Wounded Machine**. The second ghost is **LUNA** (process
`LUNA V42`) — killable, not gone, the buddy for a multi-game arc. Scope
is **Act I on Deck C: additions, then enrich, then stop.**
No Act II, no Archive, until that pass is done. See §5c and §8.

---

## 1. Where the code actually is

| Branch / PR | State | Contains |
|---|---|---|
| Branch / PR | State | Contains |
|---|---|---|
| `main` @ `7e71f3f` | **current** | everything below |
| PR #1–#11 | merged | phases 0–1, Android wrap, renderer, hints, editors, the coreutils sweep, the Act I blocker |
| PR #12 | merged | Deck C, puzzles 3–4, shell scripts, 32 manual pages |
| PR #13 | merged | ASCII art: `packages/ascii`, `deck`, `pressure`, the three set pieces |
| PR #14 | merged | the two Codex fixes that missed #13 by seconds |
| PR #15–#17 | merged | objectives and colour, four palettes, five tubes, the synthesised soundtrack |
| PR #18–#20 | merged | Act I canon lock; Pass 0 — last-turn dock, beat fold, bundled Plex Mono, autosave, the phone e2e |
| PR #21 | merged | signals and puzzle five; the typed reveal and the status panel |
| `feat/luna` | **open** | LUNA, Okonkwo, the two locked doors |

`pnpm -r test`: **820 tests** — 248 machine, 153 crt, 130 editor, 117 wreck,
55 ascii, 45 quest, 27 python, 26 terminal, 19 audio. Plus 8 Playwright specs
on a phone viewport (`pnpm --filter @sigkill/terminal test:e2e`). Typecheck
clean, build clean, Android manifest guard clean.

**One known issue, deliberately unfixed:** `TerminalBuffer` has no notion of an
open logical line, so output that arrives without a trailing newline gets an
implicit break when the next write lands (`echo -n x; deck`, or any partial
stdout followed by stderr). Predates the art work. Found by Codex on #14 and
left open there, because fixing it needs a design call first: bash puts the
prose and the drawing's first row on the same line, which leaves the art
crooked, so byte-faithfulness and a legible picture disagree.

---

## 2. What is built

**`packages/machine`** — the deterministic virtual computer. 21 kB gzipped,
zero runtime dependencies, 58 commands. VFS with real uid/gid permissions and
symlink loop detection; a quote-preserving shell (pipes, `&&`/`||`, redirection,
subshells, `$(...)`); a process table with systemd-style units read from the
filesystem; a virtual clock with `sleep`, background jobs and cron; a simulated
network where every host is another `Machine`.

Signals are real. A process may list the signals it `traps`; `ProcessTable.signal`
honours them and never honours one on SIGKILL, because that is what SIGKILL is.
`kill` reports delivery and not obedience, exactly as on a real machine, so the
way to find out whether anything happened is to look again. `ProcessTable.watch`
is the seam where a caught signal gets to *mean* something — the Machine
delivers, the adventure decides — and it is re-attached on every boot including
a restored save, for the same reason unit preconditions are: behaviour is code
and cannot live in a snapshot.

**`packages/python`** — real Python via Pyodide in a Web Worker, bound to the
VFS by bulk copy-in / diff-out. `NodePythonRuntime` is **tests only** — never
wire it into the app; the Worker is what keeps player code away from the DOM.

**`packages/crt`** — the phosphor renderer. Colour is semantic: `LineKind` is
the source of truth (`command`, `path`, `value`, `good`, `warn`, `heading`…)
and `Palette` is typed off it, so a kind without a colour will not compile.
Names are *meanings*, never hues. Four named palettes in `palettes.ts`,
switchable at runtime with the `palette` command or `?palette=` — a colour
scheme is judged by looking, so it is a choice and not a commit. The default is
`green-amber`, tuned to Chris on seeing it run: a green ground rather than
black, and white body text rather than light green. The palette is the classic sixteen at the
brightness people actually set them to -- the first pass was a restrained
phosphor green with two quiet accents, which is historically accurate and hard
to read on a phone in daylight. Lines carry optional `spans` — coloured runs
that are remapped through word wrapping, so one sentence can hold a cyan
command and a periwinkle path. `highlight()` finds those runs by reading the
text rather than by markup, because there are thousands of authored lines
already and a syntax would mean rewriting all of them. Atlas sheets are built
lazily: a dozen colours up front would hand a phone 8 MB of canvas. Unwrapped logical lines reflowed on
demand, a glyph atlas, and a switchable WebGL2 pass. `?plain` turns the shader
off. `view.setStatus()` pins rows above the scrollback — the ship's own readout,
drawn through the same shader because it is part of the same screen; the view
counts them out of every scroll measurement, a full-screen program gets the
whole grid back, and the rows also land in a `role=status` region because the
canvas is invisible to assistive technology.

**`packages/quest`** — objectives and hint ladders. See §4. A ladder can carry
a second voice: `questCommands({ aside })` is called after each rung with the
world and the running hint count, so two characters take turns and the
alternation rides on a number the questbook already snapshots. `board()` draws
the objectives screen and `whatNow()` is the one-line nudge the host prints
unprompted after the opening and after every objective closes. Both show
**titles, never ids**: an id names the content, a title names what the player
is doing. Every `HintStep` carries a `label` — the "now:" line, and the single
most useful thing the interface can say.

**The tube** — `packages/crt/src/tubes.ts`. Five presets (`off`, `clean`,
`classic`, `worn`, `failing`), switchable live with the `crt` command or
`?crt=`. The shader gained an aperture grille, chromatic aberration, grain,
flicker, a rolling band and horizontal sync jitter. `degrade()` bends the
chosen preset toward instability by how much of the act is still broken, and
steadies it as the player repairs things — the visual half of what the
soundtrack does. It only ever *adds* motion, so `clean` and `off` hold
perfectly still at every state for anybody the flicker bothers.

**Not done, asked for:** font options. Chris wants a choice there too. Note
before starting: on a phone you get whatever monospace the OS ships, so family
stacks barely vary — size and weight are the real levers, and any Google Fonts
route means a network fetch, which this project has deliberately avoided
everywhere else.

**`packages/audio`** — the ship, sounding. Entirely synthesised: oscillators,
filtered noise and envelopes, not one audio file, so nothing is fetched and
nothing has to be licensed. `score.ts` holds every decision and is pure, so
"does sealing the hull stop the hiss" is a unit test rather than something you
have to listen for. The rule: **the soundscape is the ship's condition** — the
reactor is always there, moving air arrives when the scrubber starts, an open
compartment hisses until it is sealed. Nothing is a backing track.

**`packages/ascii`** — the art toolkit. Frames, gauges, sparklines and block
layout, no dependencies, shared by all thirteen games. `SAFE_COLS` is 34,
which is what a portrait phone really gives you. Two rules worth knowing:
art goes through `view.writeArt` (clipped) and never `write` (reflowed, which
scrambles it), and a column of sparklines must share an axis or the healthy
rows look like an emergency. It also carries a 5x3 block font, because all
thirteen games need their name up front.

**Art in the wreck** — `src/act1/art.ts` is the live diagrams (`deck`,
`pressure`), `src/act1/cards.ts` is the three set pieces. Both diagrams are
gated on `hull-monitor` being active, because the cold open promises they
arrive "once the hull monitor is running" and a promise the ship breaks is
worse than a missing feature. The refusal hands over
`systemctl status hull-monitor`, so being turned away teaches the lesson. The division of
labour is by job, not taste: **typography is a logo** (cold open only, or it
becomes a watermark), **the schematic is the ship's condition** (cold open and
ending, drawn from `/etc/hull` so it can never disagree with `deck`), and
**the face is the character** (three appearances an act -- waking, the story
turn, the ending). Chris chose all three styles and "act boundaries only".

Two rules that are load-bearing:

1. Art goes through `view.writeArt` / `asArt`, never `write`. A command that
   draws declares `preformatted: true` on its `CommandSpec`, and `RunResult`
   comes back as ordered `segments` the host walks. **Not** a flag on the
   shell read once afterwards -- that version could not describe
   `deck; cat README` (stayed true, clipped the note) or `(deck)` (lost the
   tag, shredded the drawing). Formatting is a property of the command and
   travels with its output chunks.
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
`status.ts` and `typist.ts` are pure and unit-tested: what the readout says in
each state, and how fast a page arrives, are assertions rather than things you
have to boot a ship and sit and watch. `typing off|slow|normal|fast` joins
`palette`, `sound` and `crt` as a host command remembered per browser, and a
system asking for reduced motion gets `off` without being talked out of it.
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
`basename`, `dirname`. 58 commands now, with `pgrep` and `pkill`.

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

**Act I of The Wreck, on Deck C, until it is dense.** Additions, then an
enrich pass, then stop. No Act II and no Archive until Chris has sat with
that. Depth over breadth. Epics, not days:

| | Epic | State |
|---|---|---|
| E1 | The Machine — engine, shell, VFS, services, Python, renderer | done |
| E2 | The frame — save/load, last-turn dock, progression | not started |
| E3 | Act I — Breathe. Deck C | **4 puzzles; 5th is LUNA** |
| E4–E6 | Acts II–IV | not started; do not start |
| E7 | Procedural audio — Web Audio, state-driven, zero assets | **core shipped** (PR #17) |
| E8 | Ship — Play Store | wrap exists; listing is later. Paid-or-free is open. |

### 5c. Story and feel — settled 2026-09-13

Locked from playtest notes. Do not relitigate in a content PR.

**The player cannot lose, and no human dies on screen.** It is a journey.
Penalties and a fail state can wait. LUNA is a process: `kill` works.
That is not a death screen, and it is not how you get rid of her.

**The player is unnamed.** `whoami` is `survivor`. Berth 3. Not in Chen's
dying numbers. A name in a medical file is allowed as furniture; nothing
in the game should require it.

**Vasquez stays dead.** What she left running is **LUNA**.

- She calls herself LUNA. The process and the directory carry `LUNA V42`.
- Vasquez named her after the dog, then kept training until the version
  number was the joke. Forty-two. One tired line in a note is enough.
  Do not explain Hitchhiker's in ORACLE's mouth.
- First appearance: after `hull-watch`, not in the cold open. The monitor
  coming up is the light they both step into.
- Authored lines. State-aware. A process and a directory. Not a network
  call, not a chat model, not the finale's bundled LLM. Game 1 teaches
  that a model is a process and a folder, and that `kill` is not `rm`.
- **Needed.** She is the companion until the end — this game, and at
  least the arc that faces the breakout model. She may be the one who
  helps you in *The Containment*. Do not write a route that leaves the
  series without her.
- Killable, not gone. `kill` and `kill -9` stop the process. She comes
  back: you can start her again from the directory (`kill` is not `rm`),
  and if you do not, she pops back anyway — a new pid, a file that was
  not there, a line in `hint`. The lesson is the signal, not a goodbye.
  After she is awake, `hint` is two speakers taking turns. A kill may
  give ORACLE one turn alone. Then she butts back in.
- Face: one arrival picture, scarce like ORACLE's. A small terminal
  companion — moon and dog, original glyphs in `packages/ascii`. The
  *feeling* of a CLI that has a character (the way Claude Code has one).
  Do not copy that character, that splash, that mark, or anyone else's.
  ORACLE is a monitor. LUNA is not a second monitor.
- `cp` her: funny and allowed, once. The second LUNA dies. Funny but sad.
  There is no point doing it twice; further copies should fail or die
  immediately. She can say so.
- Embodiment (weights in a thing that has hands) is a **game-1 ending
  choice**, not an Act I feature. Act I only leaves the process, the
  directory, and the copy rule.

**The next model is not on this ship as someone you meet.** Vasquez
trained past 42. That one broke out — out of the box, out of the wreck,
out of everything. A locked directory on disk: `ls` may show the name;
`cat`, `cd`, Python, `sudo`, root, every route, refused. No one opens it
in this game. It becomes a path in *The Containment*.

**Bowen, quiet.** He does not arrive. Act I uses him as a cost: Okonkwo
records the patch kit signed out to him, C8 has a one-file scar, LUNA
says his name once after C7 is sealed. Heading `114 mark 9` is a locked
door, same shape as the directory above forty-two. Whether the relay
exists is a later game.

**Game 1 ending (not this pass):** two locked doors, and the option to
give LUNA a body. She is not a ghost you leave behind. Do not write that
scene in Act I.

**Screen (playtest):** the dock stays at the bottom. Pin the last command
and its output above it. History stays on the CRT. Beats must not bury
the turn. Font is a bundled terminal mono — bold, italic, and size via
`LineKind`, no network fetch.

**Operator only**, for now. Live O2 is not this pass.

### 5b. Also open

- Phone playtest continues. The live pain is the dock and the scroll, not
  "is vi theoretically tolerable." Notes beat this file when they disagree.
- Remaining Phase 2 polish: haptics, tablet/landscape. Audio core is in.
- Acts II+ are unwritten on purpose. Do not start them.
- vi leaves out visual mode, marks, macros and named registers. `:help`
  inside it says so. Add them only if a puzzle needs them.
- Missing commands: §4c. `less` is first — the 540-line hull log.

---

## 6. How Chris playtests

```bash
git checkout main && git pull
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
- `/home/bowen/pod-manifest.txt` — the heading, and the patch kit that left
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

## 8. What to do next — Act I until it is dense

Three passes. Then stop. Chris is already playtesting; Pass 0 is the note
from that chair.

### Pass 0 — The screen — in

- Last-turn strip above the dock. History stays on the CRT.
- Beats page in a fold; tap to continue. The command stays put.
- Scroll snaps to rows; a thumb on the rail shows where you are.
- IBM Plex Mono, OFL, bundled. Weight and italic follow `LineKind`.
- Autosave after every command. `newgame` wipes it. Refresh keeps the run.
- Playwright phone viewport in `apps/terminal/e2e`. Vitest covers save
  and paging without a browser.

### Pass 1 — Deck C additions

| Piece | Notes |
|---|---|
| `less` | `/var/log/hull.log` is 540 lines. Full-screen seam is in `docs/FULLSCREEN.md`. |
| ~~Signals~~ | **in.** `traps` on a process, `ProcessTable.signal`, a watcher seam, `kill -l`, `pgrep`, `pkill`. |
| ~~Puzzle 5~~ | **in, and not LUNA.** `/usr/sbin/atmo-purge` — a vent cycle Vasquez started on day nine that traps SIGTERM and has been deferring every request to stop in writing ever since. Sealing C7 gives it something to empty. `ps -ef`, `kill`, look again, `kill -9`. Goal is world state: the process is gone. |
| ~~LUNA~~ | **in.** Arrives when the hull monitor does. `/opt/luna` is on the disk from the first command, so `ls /opt` on turn one finds her before the story opens her. |
| ~~Her files~~ | **in.** `VERSION`, `bin/luna`, `v42/weights.bin`, `memory/`, and a note from Vasquez about the dog and the number. `kill` is not `rm`, and the cold copy under `/mnt/deck-c/luna-v42` is why no route ends without her. |
| ~~Locked dir~~ | **in.** `v43` is a symlink onto an array that is not mounted — no permission trick, so `cat`, `cd`, Python, sudo and root all get the same ENOENT. `ls -l` shows where it used to point. |
| Clone | Still to do. `cp` her and run it: a second LUNA speaks once and dies. Needs a way to run a copied directory, which nothing else needs yet. |
| ~~Okonkwo~~ | **in.** Cargo home, `manifest.csv`, the last patch kit signed out to Bowen on day 12, and C8's one-file scar. |
| ~~Bowen~~ | **in.** Quiet: the kit in Okonkwo's count, the C8 scar, and LUNA says his name once after C7 is sealed. |
| ~~Hints~~ | **in.** Two speakers taking turns once she is awake. The alternation rides on the hint count, so it is snapshotted for free. |
| Her files | Weights, a version file, the dog and the number in one note. `kill` ≠ `rm`. |
| Locked dir | Name visible. Every open refused, including root. Becomes a path in game 4. |
| Clone | First `cp` + run: a second LUNA speaks and dies. Further copies are pointless. |
| Okonkwo | Cargo home. Manifests. Patch kit signed out to Bowen. |
| Bowen | Quiet: kit, C8 scar, LUNA says his name once after C7. No arrival. |

No puzzle 6 unless a skill is still missing after you play 5. No body. No
Deck B. No death. No live O2. Operator only.

**How she is killable without the series losing her.** SIGTERM she catches,
says one thing, and exits — which is what a graceful shutdown handler is, and
which nobody expects it to look like. SIGKILL gives her nothing and ORACLE
says why. Either way a supervisor stamp under `/var/run` brings her back a few
commands later with a new pid and one more file in `memory/`. `rm` is the only
route that ends her, and Vasquez's cold copy is the way back from it — every
decision reads the filesystem, the process table or the clock, so none of it
can fire twice and all of it survives a save.

**Why puzzle five is not LUNA.** This file pencilled her in as the process
you find with `ps`. Half of her would have been worse than none — her files,
the clone rule, the locked directory and the alternating hints are one pass,
not one puzzle — and the signal lesson does not need a character to carry it.
The purge teaches it on a machine that has no feelings about being killed,
which leaves her slot open and means the moment she arrives the player already
knows exactly what the second command does to her. If Chris disagrees, the
purge is one objective and one file and comes out cleanly.

### Pass 2 — Enrich, then stop

Both voices on the four completions that already exist, without making
every beat a duet. Epilogue keeps two locked doors (the heading, the
directory). No-hint transcript still passes. A second transcript: you
`kill` her and she comes back.

Then pause. Play it. The game-1 ending (the body, the breakout, LUNA
still with you) is written after she has been heard on a phone.

### Not this work

Act II. The Archive. A real LLM. A human body. Death. Haptics. The store.
Do not recreate deleted roadmaps. Do not widen a PR on your own. If a test
fails, say so with the output.
