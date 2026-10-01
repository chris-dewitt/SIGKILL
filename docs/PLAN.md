# SIGKILL — development plan

> **2026-09-20:** [STORY_AND_GAME_PLAN.md](STORY_AND_GAME_PLAN.md) supersedes
> this document's narrative, fixed game count, and curriculum order, and
> [ACT1_BEATS.md](ACT1_BEATS.md) supersedes both for Act I — it is approved and
> built. This file retains the earlier development roadmap; its phase/status
> statements are historical, not a fresh implementation report. Engineering and
> security constraints still apply unchanged.

**Status (2026-09-26):** Phases 0, 1, 2 and 3 complete, gates included. Phase
4 no longer exists: see below. Next is **game 2, The Archive**, on a planet,
in SQL; the wa-sqlite determinism spike is done and it passes.
**Companion:** the illustrated version of this plan lives as a shared artifact;
this file is the one that gets updated.

---

## Locked decisions

Settled during planning. Closed unless deliberately reopened.

| Question | Decision |
|----------|----------|
| Code execution | Real engines, authored world. Valid-but-unanticipated commands must work. |
| Stack | TypeScript core; Kotlin for the on-device LLM plugin; Python for the authoring toolchain; GLSL for the CRT. |
| Mobile input | Real keyboard plus a context-aware chip bar. Not tap-to-compose. |
| Audience | Two tracks — **Cadet** (zero experience) and **Operator** (knows Python, weak on infra). Built for Chris first. |
| Business | Paid, one price per game. No ads, no IAP, no subscription, no accounts. |
| Distribution | 13 separate store listings, 13 separate one-time purchases. |
| Progression | Metroidvania skill-gating plus immersive-sim solution depth. Roguelite survives as an optional endless mode. |
| Art | Monochrome blocky sprites on phosphor CRT, one accent hue per adventure, pure ASCII for diegetic moments. |
| AGI engine | Glass-box simulated model for teaching; real bundled on-device model for the finale. |
| Model delivery | Bundled via Play Asset Delivery. Genuinely offline, forever. |
| Boss win condition | Multiple deterministic objectives, exact-matchable, testable in CI. |
| Glass box depth | A real tiny transformer with live attention and embeddings rendered on the CRT. |
| Puzzle format | Agent-drafted against a strict schema, validated in CI: every puzzle declares what it teaches, ships ≥3 solution routes and ≥2 rejected near-misses, and fails the build otherwise. Chris reviews. |
| APK timing | Capacitor wrapped **now**, alongside Phase 2, so every input change is tested on a real device. Android IME, keyboard resize and safe areas are exactly the risks Phase 2 exists to find. |
| Renderer | Full canvas glyph-atlas plus WebGL post-pass — real phosphor persistence, bloom, barrel distortion. The series' visual identity is worth half of Phase 2. Accessibility is rebuilt deliberately (hidden DOM mirror + hidden input for IME), not dropped. |
| Narrative | Chris picks a voice from drafted samples, then Claude writes to it and Chris edits. |

### Why TypeScript

Every real engine this project needs already exists, mature and offline, as a
web technology: Python is Pyodide, SQL is wa-sqlite, Git is isomorphic-git.
There is no Godot or Flutter equivalent — in those stacks you embed CPython
yourself and reimplement the rest.

Second: the core verb is typing, and web gets the platform's own text input —
real IME, autocomplete, selection, accessibility — instead of a game engine's
reimplementation of it.

Third: one codebase ships a browser demo *and* a Play listing.

---

## The Machine

One deterministic, snapshottable virtual computer that all thirteen games run
on. This is the whole investment.

```
Presentation   CRT renderer · chip bar · sprites · companion · a11y mirror
Session        history · completion · hint ladder · goal evaluator · saves
THE MACHINE    VFS · shell parser · coreutils · process table · virtual clock · network
Real engines   Pyodide → python3 · wa-sqlite → sqlite3 · isomorphic-git → git · llama.cpp → the AGI
Platform       Capacitor/Android · Web · Play Asset Delivery
```

All engines bind to the **same VFS**. Bash and Python share one filesystem:
write a script in the shell, run it with `python3`, and `grep` sees the change.
Nothing simulated can fake that, and every player who tries it understands
immediately that the machine is real.

### A puzzle is data

```ts
export const RESTORE_ATMOSPHERE: Puzzle = {
  id:      'wreck.act1.atmosphere',
  teaches: ['cat', 'grep', 'redirection', 'systemctl'],
  world:   snapshot('wreck/act1/deck-c'),

  // Solution-agnostic. We assert on the world, not the input.
  goal: (m) =>
    m.fs.readText('/etc/life_support.conf').includes('O2_TARGET=21') &&
    m.services.get('scrubber').state === 'running',

  hints: [
    "The scrubber reads a config file. Find it.",
    "Config lives under /etc. Try: ls /etc",
    "sed -i is one way. So is python3. So is opening it in an editor.",
  ],
};
```

Cadet surfaces hints on request and after visible struggle. Operator charges
for them in oxygen.

---

## Two tracks, one Machine

Not a difficulty slider — two interfaces over one Machine, sharing every puzzle
and every goal predicate. Roughly 1.3× authoring, not 2×. Switchable mid-run,
because the point is that a Cadet becomes an Operator.

| | Cadet | Operator |
|---|-------|----------|
| Chip bar | Verbose — shows what each command does | Bare — completions only |
| Hints | Offered after visible struggle, free | Requested only, cost oxygen or trace |
| Mistakes | Narrated as learning by the companion | Consequences land, in fiction |
| Checkpoints | Frequent and automatic | At act boundaries |
| Goals | The stated objective | Harder variants — no downtime, no root, no reboot |
| Docs | `man` rewritten plainly, in-fiction | Real man pages, terse and unfriendly, as intended |

---

## The thirteen

Wave one is committed. The rest are sketched so the engine is built against the
full arc rather than one game.

| # | Title | Teaches |
|---|-------|---------|
| 01 | **The Wreck** | Linux & bash |
| 02 | **The Archive** | SQL & data |
| 03 | **The Harness** | Python, debugging & testing |
| 04 | **The Fork** | Git & collaborative development |
| 05 | **The Containment** | LLM & AI |
| 06 | The Handshake | Networking — DNS, TCP, TLS, routing, firewalls |
| 07 | The Pipeline | Data engineering — ETL, streams, backfills, idempotency |
| 08 | The Gradient | ML fundamentals — loss, gradients, overfitting, validation |
| 09 | The Daemon | SRE — signals, systemd, observability, on-call, postmortems |
| 10 | The Payload | Security — injection, auth, secrets, threat modeling (defensive framing) |
| 11 | The Index | Algorithms — search, sort, hashing, trees, complexity |
| 12 | The Contract | Distributed systems — APIs, idempotency, retries, consistency |
| 13 | The Bootstrap | Compilers — build a language, then use it to escape |

Order follows `docs/STORY_AND_GAME_PLAN.md` §3, which is the curriculum
authority: Python, debugging and testing third, Git fourth, ML and AI fluency
fifth. Cloud and deployment arrive with slot 6 and after, rather than before the
player can write a program.

Games 01–05 are built. Beats for each are in `docs/ACT1_BEATS.md` and
`docs/GAME2_BEATS.md` through `docs/GAME5_BEATS.md`.

---

## Security posture

Non-negotiable. Written down now so it stays closed later.

| Surface | Rule |
|---------|------|
| Player code | Python runs only inside Pyodide in a Web Worker — no DOM, no real network, a fetch shim we own. The host context never calls `eval` on player input. |
| Content packs | Packs are **data**. Goal predicates compile into the app bundle, never load as remote modules. A pack that can ship code is RCE wearing a hat. |
| Dependencies | No ads SDK, no analytics SDK, no crash reporter that uploads content. Pinned lockfile, audited in CI. |
| Player data | Saves are local. No accounts, no telemetry, no PII. The privacy policy says "we collect nothing" and is true. |
| CSP | Strict. `wasm-unsafe-eval` scoped to the worker only. No remote script, no remote style. |
| Model licensing | Verified permissive for redistribution in a *paid* app before a byte ships. Checked at the llama.cpp spike, not at submission. |
| If BYO key ever ships | Android Keystore at rest. Never logged, never in a crash report. Hard per-session cap. No auto-retry. Visible spend meter. A command that revokes and zeroes it. Device→provider directly — **never proxied through a server we run.** |

---

## Phases

Sized for 20–30 hrs/week with agents doing volume work in parallel. Every phase
ends in something playable on a phone, because a milestone you cannot play is a
milestone you cannot evaluate.

### Phase 0 — Foundation ✅

Monorepo with strict package boundaries, TypeScript strict, Vitest, CI on every
push, playable web terminal.

**Gate:** a glowing green prompt that echoes what you type. ✅

### Phase 1 — The Machine ✅

- [x] VFS — inodes, POSIX permissions, symlinks with loop detection, errno
- [x] Shell — quoting, globbing, pipes, `&&`/`||`, redirection, subshells, expansion
- [x] 64 coreutils commands, plus 17 adventure and host commands
- [x] Snapshot/restore round-tripping exactly; virtual clock
- [x] Determinism harness and solution-agnostic goal tests
- [x] Command substitution `$(...)` and backticks
- [x] Process table, systemd units, `sudo` backed by /etc/sudoers
- [x] Background jobs (`&`), `jobs`, `wait`, `cron`
- [x] Pyodide bound to the VFS, in a Web Worker
- [x] Simulated network — `ssh`/`scp`/`curl`/`nc`/`ping` against other Machine instances
- [x] Async executor (required before any real engine could be bound)

**Gate:** bash → python → bash on a phone. Write a file in the shell, edit it
with `python3`, `grep` sees the change. ✅ — verified in a browser at 400px,
and Act I now has a fourth solution that goes through Python.

### Phase 2 — Feel

Two tracks of work, both gated on the same thing.

**Input** — chip bar, completion, symbol row, gesture history, haptics,
landscape and tablet layouts, external-keyboard support.

**Renderer** — canvas glyph-atlas terminal with a hidden DOM mirror for
screen readers and a hidden input for IME (the architecture real terminal
emulators use), plus a WebGL2 post-pass: phosphor persistence and decay,
bloom, barrel distortion, scanlines. Lands in `packages/crt`.

**Capacitor** — wrapped at the start of this phase, not the end. Every input
change gets tested on a real APK, because Android IME quirks, keyboard
resize and safe-area behaviour are precisely what this phase exists to find.

Also: audio, companion dialogue system, sprite pipeline.

**Gate — the real one:** twenty minutes on Chris's phone, and he wants to keep
going. **Everything downstream is blocked on this.** Content built on
unpleasant input is content thrown away.

### Phase 3 — The Wreck ✅

Cold open, both tracks live, save/load, hint ladder. The content pipeline got
exercised and we learned what authoring costs.

Delivered: seven required objectives and two optional threads, from waking to
rescue. Measured content is ~6,100 words of prose and beats across 62 readable
files, plus 54 hint rungs on two tracks
(`vitest run measure --disable-console-intercept`).

**Gate: passed.** Chris has played it repeatedly and wants to keep going —
which is the Phase 2 gate as well, and the only one that ever mattered. The
measured content (~6,100 words, 54 hint rungs) is context for how much act
there is, not evidence for whether it is any good. That question is answered
by the person playing it, and it has been.

### Phase 4 — ~~The Wreck, complete~~ — folded into Phase 3

**There are no Acts II-IV.** Decided 2026-09-21: Act I carries DeWitt from
waking to rescue, which is curriculum stage 1 entire, so *The Wreck* is
finished at one act. What used to be Phase 4 is now the store work in E8 plus
the llama.cpp spike, neither of which blocks anything.

The 2.5-hour target in `STORY_AND_GAME_PLAN.md` is about a *curious* run --
projects, crew threads, conversations -- not about adding acts.

### Phase 5 — The Archive, and the honest measurement ✅ **passed**

Adventure two exists to answer one question: does the engine generalize?

**Gate:** if The Archive costs ≤40% of what The Wreck cost, the architecture
is validated and thirteen is real. If it costs more, stop and fix the engine
before building a third. **This number is the whole thesis.**

**Measured 2026-09-26 — `node tools/measure.mjs`:**

| | Lines of source |
|---|---|
| The Wreck — engine (8 packages + app) | 14,893 |
| The Wreck — content | 4,564 |
| **The Wreck total** | **19,457** |
| The Archive — `packages/sql` | 507 |
| The Archive — `games/archive` | 1,382 |
| The Archive — caused elsewhere (route harness, SQL interface, Act I retrofit) | 900 |
| **The Archive total** | **2,789 — 14.3%** |

**The honest caveat, because 14.3% is flattering.** The Archive is a shorter
game: five objectives to The Wreck's nine, and 276 lines of content per
objective against 507. Some of that gap is real reuse and some of it is
content not written yet.

So the number to trust is the projection. Finished to nine objectives, The
Archive costs **20%** at its own density and **31%** at The Wreck's. Both are
under the gate, and the second is the pessimistic case.

**Verdict: the architecture generalizes.** The engine was 77% of game one and
18% of game two. Build game three.

The one thing that did *not* come free was the puzzle schema — 900 lines of
harness, interface and retrofit, all of it caused by game two needing game
one's objectives to carry declarations. That cost is paid once. Game three
inherits it.

### Phase 6 — The Harness, and the gate a second time ✅ **passed**

Adventure three: Python, debugging and testing. `games/harness`, aboard the tug
ELLEN MAY, nine required objectives and two optional.

The gate is not a one-off. It was applied again, the same way, with each game
measured against the commit its own work started from:

**Measured 2026-09-26 — `node tools/measure.mjs`:**

| | Own engine | Content | Caused elsewhere | Total | Ratio |
|---|---|---|---|---|---|
| The Wreck | 14,882 | 4,564 | — | **19,446** | baseline |
| The Archive | 507 | 1,382 | 900 | **2,789** | 14.3% |
| The Harness | 0 | 3,333 | 274 | **3,607** | **18.5%** |

Game three needed **no new engine package at all** — the first game that has
been true of. Its entire cost outside its own directory was 274 lines of the
Python bridge, against game two's 900. Per objective it is the cheapest content
yet written: 256 lines across thirteen objectives, against The Archive's 276 and
The Wreck's 542.

**The engine share by game: 77%, 18%, 8%.** That is the curve the whole plan was
a bet on.

**The honest caveat this time is not the size, it is the finding.** Game three
was not cheap because Python was already finished. Seven things were broken in
`packages/python`, and they were found by *probing before authoring* — writing
the kind of script the game asks the player to write, and reading what came
back. Two would have made the adventure unplayable:

- Tracebacks named `<exec>`, a file nobody can open, under three frames of
  Pyodide's own plumbing.
- `sys.modules` outlived the command, so a player who found a bug, fixed it and
  re-ran got **the old answer, silently**. In an adventure about debugging.

Neither was visible from the engine's own 285 tests, because nothing had yet
asked Python to behave like a tool somebody works in rather than a feature that
exists. The lesson generalizes and is worth stating as policy: **probe the
engine with the new game's idiom before authoring the new game.** It cost half a
day and would have cost the whole act.

**Verdict: build game four.** `The Fork` — Git, in the Pell deposit office.
Game three also plants game five without literalising anything: a rented
processor, billed to a dead woman's grant, and an adjuster who declines to
speculate and advises him to do the same.

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Phone typing stays unpleasant | **Fatal** | Phase 2 is a hard gate, not a feature list. Insurance: external-keyboard path and tablet-first layout. |
| Content authoring is the real bottleneck | High | Puzzles-as-data plus a validator CLI; agents draft against a strict schema, Chris edits. Measured at Phase 3 before committing to Phase 4 volume. |
| Thirteen games is a fantasy | High | Thirteen is a direction, not a commitment. Ship one. The ≤40% number is the go/no-go. |
| Teaching something subtly wrong | High | Worse than not teaching. Every solution runs against real engines in CI; simulated behavior carries a doc comment citing the real tool. |
| Pyodide weight and cold start | Medium | Lazy-load on first Python use, preload behind a narrative beat. Bash-only puzzles never pay for it. |
| Real engines break the fiction | Medium | Largely designed out — goals are world-state predicates, so any correct route passes. |
| On-device LLM is unknown work | Medium | Adventure four, not one. One-weekend spike in Phase 4. License verified before shipping. |
| Four agents colliding | Medium | Strict package boundaries, TypeScript as the contract, `WORKING_ON.md`, small PRs, CI gates. |
| Dead Drift contention and burnout | Medium | **Resolved:** Dead Drift is still on and gets picked back up soon — not paused, not abandoned, just not now. Watch for the two-project pull rather than pretending it does not exist. |
| Paid app discovery on Play | Low | The free web demo is the discovery channel; the paid app is the artifact. |

## Opportunities

- **The niche is genuinely empty.** Teaching tools aren't games; games that
  teach coding aren't real.
- **The Machine is worth more than the games.** A deterministic, snapshottable
  POSIX + Python + SQL + Git sandbox in TypeScript is an interview platform, a
  course runtime, and a credible open-source project on its own.
- **A URL is free.** Same codebase, browser demo, shareable from week one.
- **Portfolio weight.** "I built a virtual computer that runs real Python and
  SQL offline, and shipped four games on it."
- **Learning by authoring.** A curriculum that must survive CI against real
  tools is the most demanding way to learn the material, and the most durable.
- **Accessibility as a differentiator.** Almost no games are screen-reader
  usable. This one nearly is by construction.
- **The glass-box transformer could stand alone.** A live attention visualizer
  over a real tiny model is a shareable artifact independent of the game.

---

## Open

- Whether commits in this repo carry AI co-author trailers. Currently they do;
  one line to change if not wanted.
