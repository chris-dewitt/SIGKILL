# SIGKILL — handoff

## State of play, 2026-10-03

**Six games are on `main` and all six are in the chooser.** Game six's review
found one real hole, fixed in PR #40: `clean-hands` could be won by reading
your own matter and trimming your line out of `vault01`'s log with root. The
store now ships each line to the tribunal's **ledger**, a host nobody on the
floor can log into, and the objective reads that. `docs/GAME6_BEATS.md` §9 has
the detail. The same PR gave `sed` pattern addresses (`/re/d`, `/re/p`) and
made its `i` modifier do what the manual said.

**The series is fourteen games, set by Chris on 2026-10-03.** `docs/PLAN.md`
has the table. In short: 7 *The Pipeline*, 8 *The Handshake* (networking, and
v43 back in a big way, though not the end), 9 practical AI (LLMs, agents, tools,
skills, weights, prompt injection), 10–13 SRE, security, algorithms and
distributed systems, and 14 the finale that ends v43. *The Gradient* is gone:
its ML fundamentals go into a repass of game 5. `packages/net`, the engine The
Handshake needs, is PR #42.

**Open for Chris, cheapest first:** `GAME6_BEATS.md` §8, `GAME5_BEATS.md` §9,
`GAME4_BEATS.md` §8, `GAME3_BEATS.md` §9, `GAME2_BEATS.md` §11. None blocks
anything until content is built on top of it.

**Known gaps worth closing before game seven:**

- **Game 5 needs its ML-fundamentals repass** — loss, gradients, overfitting,
  validation — now that *The Gradient* is not a separate game.
- **LUNA reacts per turn only in game one.** `afterCommand` is implemented by
  `games/wreck` alone; the canon calls her the companion for the whole series.
- **The Archive is the thin game** — five objectives against nine everywhere
  else, and stage 2's "APIs" never shipped. Four are planned: GROUP BY, the
  registry API, transactions, the unindexed query.
- **No heredoc in the shell.** From game three on, every Python file is written
  in `vi` because `cat > f <<'EOF'` does not parse.

## Read first — game six exists and is reachable, 2026-10-02

**Game 6 exists.** `games/deposit` -- *The Deposit*, on the machine floor of
Pell's deposit office, in operations. Nine required objectives and two
optional, 35 declared routes and 34 near-misses all executed against a real
Machine in CI, and the first adventure that is **four machines** rather than
one. Built against [docs/GAME6_BEATS.md](docs/GAME6_BEATS.md); §9 of that file
is what shipped and where it differs from the spec, and **§8 is Chris's to
overrule cheaply**.

The antagonist is an infrastructure nobody wrote down. Nothing on the floor was
sabotaged and nobody was negligent: a datastore died on the first of July, left
a lock, and the check that watched it asked the only question it knew how to
ask -- `curl http://index01/health && echo "index healthy"`, which asks curl
whether the *transfer* worked. It worked every morning for a month while the
index returned 500 to everybody. The act's inciting incident is a month of
everybody doing their jobs.

**It is in the chooser.** That needed a change to the save: the host used to
call `machine.snapshot()` itself, which is correct for one machine and loses
three quarters of this act. `AdventureSession.snapshot()` is a new optional
seam -- five games keep their code and their existing saves, game six saves its
fleet, and a game-six save with no fleet in it is refused rather than
half-restored.

**One mechanism here is new and the reason the best objective works.**
Deposited material on `vault01` is `0600` root, and `deposit get` reads it on
the caller's behalf and writes the account that asked into
`/var/log/access.log` before it emits a byte. `clean-hands` -- optional -- asks
the player to produce from that record the demonstration that the tribunal read
his own matter and his account never did. It is not "do not open it": a goal
asserting on what the player did not do is a goal reading the input. He learns
his docket number from his own post on the bastion, so the objective cannot
only be found by failing it, and `sudo cat` still goes around the whole thing
without leaving a line -- which is documented, tested, and exactly the act's
subject rather than a hole to plug.

**`clean-hands` can be lost for good, on purpose.** Once the store has recorded
him reading his own matter, nothing clears it. The last rung of that ladder is
the only place the game can say so and it says it without scolding. This is the
one step in the series whose hint does not fix anything, and it has a test
asserting that it cannot.

**Three hint ladders were already broken** and `games/deposit/test/hints.test.ts`
found all three the day it was written: `the-floor` stopped one host short of
its own goal, `serve-the-matter/find-it` asked for a manifest while its hint
fetched a path, and `the-second-lie/break-it` asked about notes while its hint
stopped a service. Every adventure should have that test; `docs/HINTS.md` now
says so and gives its shape.

**The 40% gate is computed again, and now for all six.** `node
tools/measure.mjs` was missing games four to six, which made the gate something
the repo talked about rather than something it checked.

| | Total | Ratio |
|---|---|---|
| The Wreck | 19,308 | baseline |
| The Fork | 5,717 | 29.6% |
| The Containment | 3,112 | 16.1% |
| The Deposit | 3,094 | **16.0%** |

387 of game six's lines are outside its own package. The beats doc predicted an
engine share under game three's 8% and that did not hold: it is 12.5%, and the
fleet is why.

**`packages/net` is built** -- all five items of `docs/GAME6_BEATS.md` §7, in
that order. Resolution is now `/etc/hosts` then the network's map, in
`machine/src/net/resolver.ts`, because every connecting command resolves and
`packages/machine` depends on nothing; `@sigkill/net` is the instruments and is
opt-in per adventure.

The three things it teaches that the engine could not express before:

1. **A name that resolves to the wrong address.** Three failures -- no such
   name, nothing at that address, nothing listening -- told apart by `ssh`,
   `curl`, `nc`, `ping` and now `scp`, which used to say `Could not reach host`
   to all three.
2. **A service listening on 127.0.0.1.** Running, active, clean journal, and
   refusing the network in exactly the words a closed port uses. `ss` is the
   only thing that tells them apart, and there is a test asserting the two
   messages are identical.
3. **REJECT versus DROP.** Refused is instant; dropped makes the other end wait
   and then give up, and the engine charges the player that wait because the
   wait is the symptom.

`PLAN.md` says The Handshake "gets a slot when `packages/net` exists, and not
before". It exists. **Which slot, and what moves down, is Chris's call** --
that is a curriculum decision, not a consequence of the package being finished.

Also still open: **nobody has pushed a `v*` tag**, so the release half of
`.github/workflows/apk.yml` has never run. `docs/PLAYTEST.md` has the steps.

---

## Game three, 2026-09-26

**Game 3 exists.** `games/harness` -- *The Harness*, aboard the tug ELLEN MAY
at Ferryman's Rest, in Python. Nine required objectives and four optional,
playable end to end without a hint, 39 declared routes and 28 near-misses all
executed against a real Machine in CI. Built against
[docs/GAME3_BEATS.md](docs/GAME3_BEATS.md); **section 9 of that file is
Chris's to overrule cheaply** -- the tug captain's name, how cold Kerr stays,
and whether the hearing is played on screen.

The antagonist is a standard of evidence with a face. Adjuster Kerr is not
corrupt, lazy or cruel; she is rigorous, and she states her rule in the cold
open: bring a program, tests that fail when it is wrong, and the same answer
twice. That is the whole curriculum motivated by a person rather than a
tutorial.

**One thing in it will look like a bug and is not.** LUNA gives him the wrong
unit divisor -- `1024 ** 3` -- fluently and with a reason, and a test catches
her. She is confident about something she half-knows, which is the most
expensive failure mode of every assistant this player will ever be handed.
`docs/GAME3_BEATS.md` §3 argues for it at length. Do not soften it into a hint
she gives correctly without deciding to.

**There is an optional v43 thread, and it pays off Act I.** Two secret
objectives — `who-opened-it` and `the-same-hand` — reachable only after the
destination is known. The recovery dump's session log records that fd3 was
requested by `/opt/luna/v43/bin/worker` as `vasquez`, **denied**, and granted a
second later as `root`; cross-referencing that against the ferry profile he
carried (`DECLARED_BY=AUTOMATED`) says the thing that sent itself is the thing
that declared the ship empty. That is Act I's optional `map-v43` — the symlink
nobody could open — landing two games later.

It stays inside canon: the log records *that* it had root and never *how* (game
four's, and a test asserts the words `exploit`/`escalate`/`breach`/`privilege`
appear nowhere), LUNA says the careful version and refuses to let DeWitt say the
other one because he cannot prove it, and Kerr files only a measurement either
way. `docs/GAME3_BEATS.md` §6a has the reasoning and the breadcrumb chain.

**Act I's restraint was nearly spent by accident.** The first draft put
`# v43 set this` in a file DeWitt carried off the ship. `deck-c.ts` is explicit
that the profile's `DECLARED_BY=AUTOMATED` "is as close as Act I ever gets to
naming v43", so the name has to arrive from a source he could not read until the
tow. Fixed, with a test that fails if it comes back.

**Seven engine bugs were found first, by probing rather than by authoring.**
Two of them would have made the game unplayable rather than rough: a traceback
that named `<exec>` instead of the player's file, and `sys.modules` outliving
the command so that *fixing a bug and re-running gave the old answer,
silently*. In an adventure about debugging. All seven have tests, and every
test was watched to fail with its fix removed. See commit `7dc955d`.

**The 40% gate held again.** `node tools/measure.mjs`:

| | Total | Ratio |
|---|---|---|
| The Wreck | 19,446 | baseline |
| The Archive | 2,789 | 14.3% |
| The Harness | 3,607 | **18.5%** |

Game three cost 274 lines outside its own package -- all of it the Python
bridge -- against game two's 900. Projected to nine objectives at The Wreck's
density it is under a quarter. The engine was 77% of game one, 18% of game two
and 8% of game three.

**What is not in it:** the hearing itself is not played, deliberately. It would
be a fourth act with no new skills in it.

**What is next.** `PLAN.md`'s adventure table says **The Containment** (LLM and
AI) at slot four, and game three ends by planting it -- a rented processor, on
a dead woman's grant, and an adjuster telling him to be careful who he says it
to. Before that, three things are cheap now and get dearer:

- The Archive's remaining four objectives (GROUP BY, the registry API,
  transactions, the unindexed query).
- No heredoc in the shell. `cat > file <<'EOF'` is the natural way to write a
  file, and the player writes Python with `vi` instead. It needs the lexer, the
  parser and a continuation prompt in `apps/terminal`, so it is a feature and
  not a patch. Recorded, not scheduled.

**All three games are now launchable.** `apps/terminal` used to import
`bootWreck` by name at module scope, which is why games two and three were
reachable only from a test. There is now an `Adventure` contract in
`packages/quest`, a descriptor per game, **one save slot per game**, a chooser
for a first-time player and a `games` command for everybody else.

Three things about it worth knowing before changing it:

- **Switching games reloads the page.** Deliberate: every closure in `main.ts`
  has captured `machine`, the mixer holds a room tone and the view holds a
  scrollback. Rebuilding all of that in place is a great deal of work to save a
  player one second, and the one place it could go wrong is somebody's run.
  `newgame` has always worked this way.
- **The first adventure boots underneath the chooser**, so choosing it costs
  nothing. That is also how the e2e harness found a leak: its air and hull were
  being drawn above the list of games. The readout is blank while choosing.
- **The old single save key is still read once and migrated.** Somebody is
  mid-act in a browser right now; a rename is not a reason to take that away.

The contract gained `afterCommand` because the typechecker found it the moment
the app stopped importing `bootWreck` by name -- it is the per-turn seam a
companion speaks from, and only The Wreck has one. **LUNA is in game three and
cannot react per turn there yet.** That is the next cheap win.

**Game four is specified and its engine is started.**
[docs/GAME4_BEATS.md](docs/GAME4_BEATS.md) — *The Fork*, Git and collaborative
development, in Pell's deposit office. **§8 item 1 is the decision to make
first:** the beat sheet argues slot 4 should be Git rather than LLM/AI, on the
same reasoning that settled slot 3, which swaps `PLAN.md`'s slots 4 and 5. Cheap
to reject today, expensive once content exists.

The premise was already written, a game early and by accident. Pell's funding
clause in `games/archive/src/town.ts` says the feet photographs were *"a test of
compliance. Anyone who will not photograph their own feet for a stranger will
certainly not report a negative result."* A compliance clause means quarterly
deposits, which means **the array is gone and the repository is not.** The reason
the evidence survived is that a rich eccentric attached a humiliating condition
to the money.

**`packages/git` exists, and its object ids are real.** Probed before authoring,
per policy, and the probe came back better than hoped: a blob, a tree and a
commit built by this package hash to *exactly* what `git hash-object` and
`git rev-parse` produce on git 2.50 — including a commit dated 2398-06-06, which
git stores as a decimal string and does not mind at all (unlike Python, whose
`PyTime_t` cannot represent it).

So the test suite has an **external oracle**: build a history in TypeScript,
build the same one with real git, assert the shas match. Three deliberate
mutations were run to prove the oracle bites — hex tree ids instead of raw
bytes, a missing object header, unsorted tree entries — and each one goes red.

Two documented deviations from real git, both chosen and both tested:

- **Loose objects are stored uncompressed.** Real git deflates them and this
  package depends on nothing. The ids are still real, so everything transfers —
  and `cat .git/objects/5b/2f4f...` printing `blob 15\0SANDBOX=strict` is a
  better first lesson than an unreadable block of deflate.
- **The index is a text file**, one `mode id path` per line. Nothing in the
  curriculum turns on its encoding, and a staging area a player can `cat` is one
  they can believe in.

**`git` is a command a player can type.** `init`, `add`, `status`, `commit`,
`log` (`--oneline`, `-n`, `--first-parent`, `-- path`), `show`, `diff`, `blame`,
`shortlog`, `branch`, `switch`, `tag`, `merge-base`, `bisect`, `rev-parse`,
`cat-file` and `reflog`. 96 tests in the package.

The diff is a real Myers edit-distance diff, which the coreutil `diff` has been
deferring to this package in a comment for three games: *"a real edit-distance
diff is a genuinely interesting algorithm and belongs in the game that teaches
it."* It had to be real — `blame` is a stack of diffs, and a positional
comparison would re-attribute every line below an insertion to whoever inserted
it. There is a test for exactly that, and it fails if the diff regresses.

The paper's linear-space variant was written first and was wrong in a way that
passed every simple case and misplaced a moved block. The greedy-with-trace
version is correct and its output matches `git diff --no-index` on the cases in
`test/diff.test.ts`.

Still to do: `games/fork` itself, an `Adventure` descriptor for it, a row in
`tools/measure.mjs`, and a decision on §8 of the beat sheet.

**Creative authority, in order:**
[docs/ACT1_BEATS.md](docs/ACT1_BEATS.md) for Act I specifics — it is approved
and **built** — then [docs/STORY_AND_GAME_PLAN.md](docs/STORY_AND_GAME_PLAN.md)
for the series. The working copy beats both on what exists.

**The story rewrite has been applied.** Act I now runs on the two-day timeline
and ends on a rescue. The one mechanism behind every puzzle:

> **v43 set the ship to its no-crew profile, and the ship did what no-crew
> ships do.** It did not sabotage NAV-7; it declared an unmanned ferry transit
> to free the array for its own transmission, and the safing routine did the
> rest, correctly, on a false premise.

`/etc/ferry.profile` is that decision in writing, readable from the first
command. Every fault in the act is one line of it being true, which is why they
are all beginner-solvable: nothing is damaged, the configuration is wrong.
Nothing in Act I names v43.

- Preserve the Act I terminal exploration and keyboard experience Chris loves.
  Expand toward at least 2.5 hours for a curious first-time run; this is unmeasured.
- The player is **DeWitt**, a bartender turned apprentice engineer. Vasquez took
  a chance on him and called him Doc. NAV-7 was his happy academic research home.
- The incident was **a couple of days ago**, not eleven years. V43 discovered
  something while cleaning research datasets, commandeered the ship and escaped
  across the cloud. The deaths happened at machine speed. Automated medicine
  saved DeWitt; ORACLE wakes him. Bowen fled.
- LUNA already knows DeWitt. She survived v43's attempt to stop her process and
  emerges from hiding when she recognizes his activity. ORACLE stays with NAV-7.
- Act I builds toward contacting a kind, funny tow operator. Suspicion of v43
  develops after tow arrival. The ship is towed to the nearest planet.
- The cumulative curriculum is fourteen games: Linux/Bash; SQL/data
  modeling/APIs; Python/debugging/testing; Git; ML fundamentals and evaluation;
  operations; data engineering; networking (v43 returns); practical AI; SRE;
  security; algorithms; distributed systems; and a finale that ends v43.

**Sections below retain implementation history and older decisions.** Their
unnamed-player, eleven-year, slow-decline, thirteen-game, five-objective
scope cap, and earlier curriculum assertions are superseded where they conflict
with the above. Historical test counts are not fresh validation.

Written 2026-09-12, rewritten 2026-09-20 with the canon pass and the rescue.
Read this, then `CLAUDE.md`, then `docs/ARCHITECTURE.md`.
This file is the state of play; the others are the rules.

**Latest:** Act I is **seven required objectives plus two optional threads**,
and it ends on a rescue rather than an epilogue.

| | |
|---|---|
| 1–5 | the repairs, unchanged: scrubber, enable, execute bit, the leak, the purge |
| 6 | `restore-comms` — **a lock is a claim, not a fact**. The transmit device is held by a pid that no longer exists. `cat` the lock, look for its owner, find nothing, bin it. |
| 7 | `send-the-call` — three facts out of three files, assembled into a distress packet. Done when **ELLEN MAY** answers. |
| optional | `trace-bowen` (the heading, which the tug answers differently if you send it) and `map-v43` (topology, no accusation) |

Comms is **entirely local**. No remote host, no second `Machine` — Chris's
call, and `packages/machine`'s network module is untouched. The reply arrives
through the after-command seam on the virtual clock, which is why it is
deterministic and survives a save.

The 61% confession **moved out of the ending** into `seal-the-breach`, where it
is about instruments rather than competing with a rescue. There is a test that
it is spent exactly once.

Voice is **2, Wounded Machine**. LUNA (process `LUNA V42`) is killable, not
gone, and her arrival is now a **reunion** — she knew DeWitt before, she hid
from something she cannot name, and she says so rather than being coy.

`pnpm -r test`: **892 tests** — 282 machine, 153 crt, 151 wreck, 145 editor,
55 ascii, 49 quest, 27 python, 19 audio, 11 terminal. Plus 9 Playwright specs
on a phone viewport, all passing. Typecheck clean, build clean, manifest guard
clean.

The terminal count dropped from 26 to 11 because the fold, the last-turn strip
and the typewriter came out — see the note in §2 on `apps/terminal`.

---

## 1. Where the code actually is

| Branch / PR | State | Contains |
|---|---|---|
| `main` | merged base | everything through PR #40 — run `git log` rather than trusting a sha here |
| PR #40 | merged | the deposit ledger, so `clean-hands` cannot be won by editing the log; `sed` pattern addresses |
| PR #39 | merged | game six, *The Deposit*: the floor of hosts, the store, the fleet save |
| PR #35–#38 | merged | the CI-built APK and Release asset, copy out of the canvas, the TEXT/TAB dock fixes, the curl/nc and `Requires=`/`After=` probes for game six |
| PR #33–#34 | merged | *The Fork*; `packages/ml` and *The Containment*, with the glass-box review fixes |
| PR #30–#32 | merged | game four's beats and `packages/git`; DeWitt as a person rather than a replaced string; a dependency pin |
| PR #26–#29 | merged | recovered strands and the wa-sqlite spike; `sqlite3` and *The Archive*; *The Harness*; the game library and chooser |
| PR #24 | merged | `feat/act1-canon-and-rescue`: the canon rewrite, comms and the tow, the pager, the clone, `journalctl` |
| PR #1–#11 | merged | phases 0–1, Android wrap, renderer, hints, editors, the coreutils sweep, the Act I blocker |
| PR #12 | merged | Deck C, puzzles 3–4, shell scripts, 32 manual pages |
| PR #13 | merged | ASCII art: `packages/ascii`, `deck`, `pressure`, the three set pieces |
| PR #14 | merged | the two Codex fixes that missed #13 by seconds |
| PR #15–#17 | merged | objectives and colour, four palettes, five tubes, the synthesised soundtrack |
| PR #18–#20 | merged | Act I canon lock; Pass 0 — last-turn dock, beat fold, bundled Plex Mono, autosave, the phone e2e |
| PR #21 | merged | signals and puzzle five; the typed reveal and the status panel |
| PR #22 | merged | LUNA, Okonkwo, the two locked doors |
| PR #23 | merged | the phone screen: the keyboard, the scroll, the way in |
| uncommitted on `main` | carried in | the `survivor` -> `dewitt` rename, `trace-bowen`, `map-v43`, the crew projects and the `luna` command (Codex) |
| `feat/act1-canon-and-rescue` | **current** | the canon rewrite, the fold removal, comms and the tow; then the pager, the clone, `journalctl`, the command sweep and type sizing |

Test counts are at the top of this file. Run them rather than quoting them:
`pnpm check` for everything, `pnpm --filter @sigkill/terminal test:e2e` for the
phone specs.

**One deliberate incompatibility, now decided:** `TerminalBuffer` has no
notion of an open logical line, so output without a trailing newline gets an
implicit break when the next write lands (`echo -n x; deck`). Bash would put
the prose and the drawing's first row on the same line, which leaves every row
of the schematic shifted — byte-faithfulness and a legible picture genuinely
disagree, and the picture wins. Written up as **decision 11** in
`docs/DECISIONS.md`, including the shape a fix would take if it is ever
revisited. Do not re-open it as a bug.

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

**`packages/sql`** — real SQLite via wa-sqlite in a Web Worker, bound to the
Machine by passing the database file's bytes in and out. `NodeSqlRuntime` is
**tests only** and is deliberately *not* exported from the package index — it
is reachable as `@sigkill/sql/node` and nowhere else, the same arrangement
`packages/python` uses. Exporting it once dragged `node:fs` into the browser
typecheck, which is how the rule got a comment.

Two lines in it are load-bearing and both have a test that was **watched to
fail** without them:

1. `Date.now` is replaced *before the wasm factory runs*, because emscripten
   resolves SQLite's time calls during instantiation. Without it
   `CURRENT_TIMESTAMP` is the player's wall clock.
2. `random()` is shadowed by a seeded LCG — the same generator the hull
   telemetry uses. Without it nothing replays.

One artifact is deliberately **not** corrected: SQLite converts times through
a double and at a few instants lands a millisecond short, so `04:12:00` reads
back as `04:11:59.999`. Real `sqlite3` does the same. Nudging the clock to
hide it would make this engine disagree with the one outside the game.

The database is an ordinary file: `ls`, `cp`, `wc -c` and `file` all see it,
permissions are the VFS's, and it goes in the save for free.

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

**The puzzle schema.** Every objective declares `teaches`, at least three
`routes` and at least two `nearMisses`, and CI runs all of them against a real
Machine. `PLAN.md` locked this in on day one and it did not get built until
after a bug shipped that it would have caught: `trace-bowen` checked one
hard-coded filename, so recording Bowen's heading in a log of your own
choosing did the whole job and was ignored.

Routes catch a goal that is **too tight** — a second route with a different
filename goes red immediately. Near-misses catch a goal that is **too loose**,
which is the failure nobody reports because the player is never stopped. Both
directions were verified by breaking a real goal and watching the suite go
red, not merely by writing the test.

`teaches` is checked against `commandRegistry()`, so a puzzle claiming to
teach `awk` fails the build. `taught()` derives the skill map rather than
keeping a second list to forget to update.

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
layout, no dependencies, shared by all fourteen games. `SAFE_COLS` is 34,
which is what a portrait phone really gives you. Two rules worth knowing:
art goes through `view.writeArt` (clipped) and never `write` (reflowed, which
scrambles it), and a column of sparklines must share an axis or the healthy
rows look like an emergency. It also carries a 5x3 block font, because all
fourteen games need their name up front.

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
`src/act1/deck-c.ts` is the deck: accounts, quarters, nine hull compartments,
`/etc/ferry.profile`, and 540 lines of deterministic pressure telemetry.
`src/act1/comms.ts` is the transmitter, the packet and the tug.
`src/objectives.ts` is the ladder: seven required, two optional. Nothing in
any of them reads what the player typed.

The telemetry's sample count is load-bearing. 60 samples x 9 compartments is
the 540 lines ORACLE quotes, and 60 C7 rows plus 8 C2 rows are its 68 matches.
Change the *step* to move the window; leave the counts alone.

**`packages/net`** — the networking instruments: `dig`, `host`, `getent hosts`,
`ss`, `netstat`, `ip addr`, `ip route`, `iptables`. Resolution itself is *not*
here — it is `machine/src/net/resolver.ts`, because every connecting command
resolves and `packages/machine` depends on nothing. The split is the point:
`dig` asks the nameserver, `getent` asks the resolver, and when they disagree
the program that is failing is using the second one. Nothing here is a builtin,
so a machine nobody handed these to has none of them.

**`games/deposit`** — game six, and the only adventure that is a *floor*
rather than a machine. `src/act1/floor.ts` seeds five hosts on the floor (one of
them powered off, which is a different failure from a name that does not resolve
and is an objective) plus the tribunal's `ledger`, which is off the floor and
holds the copy of the store's record nobody here can edit; `src/store.ts` is the deposit store's own retrieval command,
which is what makes the access record evidence rather than decoration;
`src/world.ts` boots, saves and restores the fleet and holds the cold open and
the epilogue. `src/objectives.ts` is nine required and two optional.

Only the bastion carries the quest commands and the editor. The three hosts
that hold deposited material carry neither, and that is content rather than a
shortcut: it is the same policy that keeps LUNA off them, written down on those
hosts in `/etc/deposit/policy` and on the bastion in `/etc/luna/scope`, and
reading both is an optional objective.

**`apps/terminal`** — the playable terminal and the Capacitor Android wrap.
`status.ts` is pure and unit-tested: what the readout says in each state is an
assertion rather than something you have to boot a ship and watch.

**Type size is computed, not fixed.** Every beat in this game is hard-wrapped
in the content — `'ORACLE: ...'` lines are authored one screen-line at a time,
for a phone — so the column count is fixed by the writing at about sixty-six.
A desktop at a phone's type size was therefore a sixty-column game in a
two-hundred-column window with the right two thirds empty, which read as a
layout bug and was really a scaling one. `autoFontPx()` picks the size that
lands the authored width across the real screen, clamped at both ends, and
`font` overrides it. Anything that changes how wide the writing is should
change `TARGET_COLS` with it.

**The fold, the last-turn strip and the typewriter are gone.** Chris cut them
after phone playtest; beats land in plain scrollback. `src/turn.ts`,
`src/typist.ts`, the `typing` command and `LastTurn` went with them -- a
`typing` setting that no longer changes anything is a lying control, not a
harmless leftover. The e2e spec was rewritten around what is left in the DOM:
the dock, the chips, the pinned status rows, the rail and the keyboard resize.
The scrollback is a canvas, so what the ship *says* is tested in
`@sigkill/wreck`, where it can be read.
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
- `/home/dewitt` has a `logs/` directory with two readable logs, so `ls` on the
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

The other three options (Wry Dewitt, Insubordinate Tool, Unreliable Log) are
in git history on `docs/pr-when-final` if a later game wants a different daemon.
Each of the fourteen games can have its own; the voice is one option on
`questCommands` and recasting touches no ladder.

### 5a-bis. Scope — settled

**Act I of The Wreck, on Deck C, until it is dense.** Additions, then an
enrich pass, then stop. No Act II and no Archive until Chris has sat with
that. Depth over breadth. Epics, not days:

| | Epic | State |
|---|---|---|
| E1 | The Machine — engine, shell, VFS, services, Python, renderer | done |
| E2 | The frame — save/load, progression | **done.** Autosave after every command, `newgame` wipes, restore re-attaches behaviour. The last-turn dock was built and then removed; see §2. |
| E3 | Act I — Breathe. Then Call Somebody | **done.** 7 required + 2 optional, waking to rescue. |
| E4–E6 | ~~Acts II–IV~~ | **cancelled 2026-09-21.** There is no Act II. Act I is the whole of game 1. |
| E7 | Procedural audio — Web Audio, state-driven, zero assets | **core shipped** (PR #17) |
| E8 | Ship — Play Store | wrap exists; listing is later. Paid-or-free is open. |
| E9 | Game 2 — The Archive, on a planet, in SQL | **proposed.** `docs/GAME2_BEATS.md`. Needs wa-sqlite and Chris's answers to §11. |

### 5c. Story and feel — settled 2026-09-13

Locked from playtest notes. Do not relitigate in a content PR.

**The player cannot lose, and no human dies on screen.** It is a journey.
Penalties and a fail state can wait. LUNA is a process: `kill` works.
That is not a death screen, and it is not how you get rid of her.

**The player is unnamed.** `whoami` is `dewitt`. Berth 3. Not in Chen's
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

### 5d. Canon snapshot — 2026-09-20

Use this as the one-screen lore check before writing new lines.

- **Ship and date:** NAV-7, a Kepler-Vance Salvage & Recovery ship, built for
  forty. The event is T+0; the player wakes at T+48h, 2398-06-08 04:12 (see
  `WAKE_MS`). Crew writing counts in hours from the alarm; instruments carry
  real stamps. That is how you tell a diary from a sensor.
- **Player identity:** **DeWitt**, a bartender who studied after shifts until
  Vasquez took a chance on him. She called him Doc. Berth 3.
- **Act I place:** Deck C, nine compartments in a 3x3 layout.
- **Crew status:** Vasquez (engineering, deceased), Chen (medical, deceased),
  Okonkwo (cargo, deceased), Bowen (navigation, fled in pod 2 at T+01).
- **The mechanism:** the ferry profile. See the top of this file, and
  `/etc/ferry.profile` in the game.
- **The survival window:** the vent killed nobody outright. Engineering and
  medical held; the crew died across the next twenty-seven hours of an
  atmosphere the scrubber was refusing to maintain. **The config the player
  fixes in the first ten minutes is the config that killed them.** Nobody says
  so. See `docs/ACT1_BEATS.md` §2.
- **Chen sealed DeWitt into autodoc 2 from the outside** and did not have time
  for a second bay. Establishable from `crew-health.csv` and
  `/var/log/autodoc.log`; never stated.
- **Core line:** Chen's "the ship is fine ... a hole we could have closed in
  an afternoon" remains the thematic anchor.
- **Doors this act does not open:** Bowen's heading `114 mark 9`,
  `/opt/luna/v43` as a dead link to an unmounted array, and whatever burnt the
  main array from the inside. **Nothing in Act I names v43.**

Act I is seven required objectives and two optional threads:

1. atmosphere
2. survive-a-reboot
3. hull-watch
4. seal-the-breach  *(carries the 61% confession)*
5. stop-the-purge
6. restore-comms
7. send-the-call  *(done when the tug answers)*

Optional, and they gate nothing: `trace-bowen`, `map-v43`. `Objective.optional`
is a flag on the quest engine; `complete()`, the board count and the status
readout all ignore them, and a bare `hint` only offers one once the required
spine is finished.

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

Act I was two puzzles that ended in six moves. It is now seven objectives
(five core systems puzzles plus two discovery threads), and the act is
finishable without ever typing `hint` — there is a test that plays it that way.

| # | Objective | Teaches | Done when |
|---|---|---|---|
| 1 | `atmosphere` | `systemctl status`, reading a config, an editor or `sed` | scrubber active |
| 2 | `survive-a-reboot` | start vs enable, symlinks on disk | scrubber enabled |
| 3 | `hull-watch` | **`ls -l`, the execute bit, `chmod +x`** | hull-monitor active and enabled |
| 4 | `seal-the-breach` | **`grep`, `-c`, `cut \| sort \| uniq -c`, dates over counts** | `/etc/hull/c7.conf` says `SEALED=yes` |
| 5 | `stop-the-purge` | signals as semantics (`kill` request vs `kill -9`) | `atmo-purge` no longer running |
| 6 | `trace-bowen` | evidence extraction (`grep` + redirect) | heading logged in `/home/dewitt/logs/bowen-heading.txt` |
| 7 | `map-v43` | topology over permission (`ls -l` dead link mapping) | link evidence logged in `/home/dewitt/logs/luna-v43-link.txt` |

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
- `/home/okonkwo/manifest.csv` and `/home/okonkwo/c8.txt` — the signed-out kit
  and pod-bay scar that corroborate Bowen's departure
- `/etc/hull/c1..c9.conf` — nine compartments, one open
- `/var/log/hull.log` — 540 lines, deliberately unreadable, LCG-generated so it
  is byte-identical on every machine. **C2 dropped too and was patched**, so
  counting matches finds two compartments and only the dates find the live one

### Continuity notes to resolve deliberately

These are known story wrinkles worth tracking before larger Act II writing.

- `vasquez.log` says "day 12 Chen is gone," while Chen's own files include day
  14 entries and say Okonkwo died "yesterday." Keep this explicit so future
  edits choose one chronology rather than layering new lines over both.
- `atmosphere.log` records "reserve 61%" on day 12, while ORACLE's epilogue
  confession is framed as a hull claim of 61%. If this is intentional conflation,
  preserve it as characterization; if not, choose one interpretation in prose.

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

## 8. What to do next — as of 2026-09-22, Act I only

> Historical. Written when The Wreck was the only game; the current next steps
> are in **State of play** at the top of this file. Kept because the Act I
> notes below still apply to anybody editing game one.

Act I is finished to the shape `docs/ACT1_BEATS.md` describes: the canon pass,
the two comms puzzles, the tow, the optional threads, the projects. **Read that
document before touching a story file** -- it is the approved beat sheet and it
records why each piece is the way it is.

### The gate is still the same, and it is Chris on a phone

Nothing downstream starts until he has played this and wants more. What to
watch for specifically, now that the act is twice as long:

- **Where the middle sags.** Five repairs then two comms puzzles is a lot of
  the same rhythm. The projects and the crew threads exist to break it up, and
  whether they actually do is not something a test can answer.
- **Whether the wait lands.** `send-the-call` has the only deliberate pause in
  the act. Four seconds of ship time is a guess.
- **Whether the packet is fun or fiddly.** It is the capstone and it is the
  most open-ended thing in the game. If people stall there, the spool README is
  the first thing to make blunter.
- **The reunion.** LUNA's arrival is now the emotional hinge of the act rather
  than an introduction.

### Known, deliberate, and not done

| Thing | Why not |
|---|---|
| `history`, `alias` | Both need the shell to keep state it does not keep. The app already has command history in the input box, and `alias` adds nothing this act teaches. Cheap, but not free, and not wanted yet. |
| `awk`, `for`/`if`/`while` | A whole language and a whole teaching beat respectively. Each is its own piece of work. |
| Act II aboard NAV-7 | There is no Act II. Act I carries DeWitt from waking to rescue, which is curriculum stage 1 entire. The next thing is **game 2 on the planet, in SQL** -- see `docs/GAME2_BEATS.md`. |
| A real LLM, a body, death, haptics, the store | Not this work. Do not recreate deleted roadmaps. |

### Cleared 2026-09-22

- **`less` and `more`** -- a real pager over the `ScreenProgram` seam, in
  `packages/editor/src/pager.ts`. Space/b/d/u, j/k, g/G, `/` search with `n`
  and `N`, and `q`. It never writes, which is why there is no `TextBuffer` in
  it. The status line is built shortest-first: the first draft truncated at
  forty columns and cut `(END)` and `q to quit`, which are the only parts
  anybody needs.
- **The LUNA clone.** `cp -r /opt/luna somewhere && somewhere/bin/luna` brings
  up a second her, on the same weights, with an empty memory directory. She
  works out what she is in four lines and exits. Once -- the second attempt
  gets a flat refusal, because doing it twice is not a joke. Detected by the
  launcher writing `$0` to `/tmp/.luna-invocations`, which is the only way a
  program can tell which copy of itself it is.
- **`journalctl`**, with a real log store on `ServiceManager`. Entries are
  generated from the same `ServiceResult` the caller gets, so the journal and
  `systemctl status` can never disagree. Snapshotted, ring-buffered at 500.
  The payoff: after the player clears the stale lock, `journalctl -u comms`
  still has the refusal, and `systemctl status` does not.
- **`sed` line addresses** (`1,3p`, `$p`, `2,4d`, `-n`), plus **`realpath`**,
  **`file`**, **`type`**, **`diff`** and **`xargs`** in
  `src/coreutils/inspect.ts`.
- **Type size.** `font [SIZE|bigger|smaller|auto]`. Auto is the default and
  fits the authored column width across the window -- see §2 on why the
  desktop looked half empty.
- **The open-logical-line bug** is now decision 11 in `docs/DECISIONS.md`. It
  stays as it is, deliberately, and the reasoning is written down so nobody
  has to rediscover the argument.

### If the ferry profile has to come out

It is the load-bearing invention and it is spread across prose, so here is the
map: `/etc/ferry.profile` in `deck-c.ts`, the README and `atmosphere.log` in
`world.ts`, the purge's header and `purge-notes.txt`, and the completion beats
on `atmosphere`, `seal-the-breach` and `stop-the-purge`. The puzzles themselves
do not depend on it -- every goal still reads world state and would survive a
different explanation entirely.

### The rules that did not change

A pull request means the branch is finished. Commit as Chris. After any merge,
verify with `git merge-base --is-ancestor <sha> origin/main` rather than
trusting the push. If a test fails, say so with the output.
