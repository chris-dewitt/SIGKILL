# Game 3 — **The Harness**

Python, debugging, testing. The third adventure, and the one where DeWitt
stops asking a building for its reasons and starts building the reason
himself.

> **Curriculum authority.** `docs/STORY_AND_GAME_PLAN.md` §3 row 3: *"Python,
> debugging, testing — automate investigations and establish reproducible
> results using the earlier data and shell skills."* `docs/PLAN.md`'s table
> still reads **The Cluster — HPC & cloud** at slot 3; that entry is
> superseded by the story plan and is corrected there. Cloud and deployment
> keep their own slot later.

---

## 1. Where game 2 left him

The Archive's epilogue is the whole setup, and it is already written:

- MERRICK filed the draft-certification finding "tonight, before the adjuster
  comes." It does not win. It buys a stay while somebody senior reads it.
- **An adjuster comes Thursday, with the clause printed out.**
- In his pocket: a draft certification with Vasquez's name on it; 2.2
  gigabytes billed to a dead man's grant; a tug captain who will not chase
  him for the money.

That last line is the door into game 3.

## 2. The premise

The stay worked. There is a hearing, and the hearing has a standard of
evidence, and the standard of evidence is the antagonist.

**ADJUSTER KERR** is not corrupt, not lazy and not cruel. She is *rigorous*,
and rigour is a harder opponent than malice because you cannot appeal to her
better nature — she already has one, and it is why she will not take his word.
Her rule, delivered in the cold open:

> KERR: I have read Mr Merrick's filing. It is the best-argued document that
> has crossed my desk this quarter, and it is not evidence.
>
> KERR: You have told me a number. Anyone can tell me a number. I have a
> drawer of numbers.
>
> KERR: Bring me the **method**. The thing I can run on my own terminal,
> twice, and get your answer both times. If it disagrees with itself I file
> the original finding and we are finished, and I will not enjoy it.

In one speech: write a program, make it correct, prove it with tests, make it
reproducible. The entire curriculum, motivated by a person rather than a
tutorial.

**Why Python and not more SQL.** The evidence has changed shape. Game 2's
evidence was rows in somebody else's database — queryable, and already clean.
Game 3's evidence is the tow's raw recovery dump: two thousand lines of
uplink telemetry, an operator's JSON report, a billing ledger in CSV, and a
comms buffer. It is dirty, it is three formats, and there is too much of it to
read. That is what a program is *for*, and it is the honest reason to reach
for one.

## 3. Where, and who

**Aboard the tug ELLEN MAY**, tied up at Ferryman's Rest, two days before the
hearing. The galley. The captain's maintenance terminal, which is older than
the archive's and entirely his to break.

The contrast with game 2 is deliberate: the public terminal was a place that
processed him, and this is a place where somebody made him a coffee.

| Voice | Function |
|---|---|
| **HOLLIS** — captain, ELLEN MAY | The warm practical competence canon promises the tow operator. Lends the terminal, the coffee and the bunk, will not discuss the money, and has opinions about engineers who do not eat. Not a teacher: she cannot help with the work and says so. |
| **LUNA** | Back, off a data card he carried from NAV-7. The debugging partner — and **sometimes confidently wrong.** |
| **ADJUSTER KERR** | The standard of evidence, with a face. Appears at the open, once at the midpoint, and at the close. Never insulting, never moved by feeling. |
| **MERRICK** | One message, near the end. He is on shift and cannot come. |

### LUNA is wrong on purpose

This is the load-bearing character decision of game 3, and it is worth stating
plainly because it will look like a bug.

At the unit conversion — the centre of the game — LUNA gives him the wrong
divisor, fluently, with a reason. `1024 ** 3`, because that is what a
gigabyte is, obviously. She is not lying and she is not broken. She is
confident about something she half-knows, which is the single most expensive
failure mode of every assistant anybody will ever hand this player, including
the one they are probably using to read this.

The test catches her. She takes it well, and better than DeWitt does:

> LUNA: Oh. *Oh.* I was so sure.
>
> LUNA: I want you to notice that the thing that caught me was four lines you
> wrote in ten seconds, and not me being cleverer. That is the whole point of
> them, isn't it. They do not care how sure anybody was.

Canon supports this explicitly — *"Can be wrong and learn; avoid making every
line a polished philosophical observation"* — and there is no more useful
lesson the series can teach in the year it ships. Do not soften it into a
hint she gives correctly.

## 4. The evidence on disk

`/srv/recovery/nav7/` — what the tow pulled off NAV-7 and nobody has read.

| Path | What it is | Why it is awkward |
|---|---|---|
| `telemetry/uplink.log` | Per-second byte counters from NAV-7's uplink across the event. ~2,000 lines, `ISO8601 fd bytes state`. | Seventeen lines are malformed — truncated mid-write when the power transitioned. A naive parse raises `ValueError`; a parse that swallows exceptions is *quietly wrong*, which is worse. |
| `manifest/incident.json` | The operator's incident report. "routine dataset synchronisation", "2.2 GB". | The 2.2 is a decimal gigabyte. The log is in bytes. Whether those agree is the question the whole act turns on. |
| `ledger/ellen-may.csv` | HOLLIS's own billing ledger for the tow, including relay traffic she carried. | An independent second source. Different units again, and a header row. |
| `comms/buffer.txt` | The tail of the uplink's destination buffer. | Where the bytes went. Needs more than `grep`: the address appears once, base64-wrapped, among four hundred lines of routine chatter. |

All four are **data**, authored into the world seed. Nothing here is executable.

## 5. The spine — nine objectives

Each one ends in an artifact on disk, because that is what the goal reads. No
goal inspects a command. Two are optional.

| # | id | Teaches | Closes when |
|---|----|---------|-------------|
| 1 | `open-the-dump` | `python3`, a script file, `open`, `for`, `len`; reading a `FileNotFoundError` | He has recorded the true sample count |
| 2 | `the-total` | `int()`, accumulation, `ValueError` from real data | He has recorded the true byte total |
| 3 | `write-the-test` | `unittest`, `assertEqual`, `python3 -m unittest`, keeping the report | A captured test report shows two or more tests passing |
| 4 | `the-unit-lie` | Decimal vs binary; a test as a witness against a plausible mistake | Both figures recorded, and the discrepancy named |
| 5 | `the-rejected-rows` | `try`/`except`, and why a bare `except: pass` is the worse bug | The rejected-row count is reported alongside the total |
| 6 | `run-it-twice` | Determinism: `sorted()`, not stamping the clock, `diff` | Two runs of his script are byte-identical |
| 7 | `the-second-source` | `csv`, functions, importing his own module | Both independent totals recorded, and that they agree |
| 8 | `where-it-went` | `base64`, string methods, dictionaries | The destination address recorded |
| 9 | `the-package` | `python3 -m unittest` from a directory, exit codes, a README | `hearing/` holds the module, the tests, the passing report and the README |
| — | `luna-was-wrong` *(optional)* | Writing a test that fails first | A test exists that rejects the binary divisor |
| — | `the-other-shoe` *(optional)* | Reading somebody else's code for pleasure | Vasquez's prototype runs |

### Objective 6 is the one to get right

`run-it-twice` hands the player the engine's own invariant #1. His script
iterates a dictionary and stamps its output with `time.time()`, so two runs
disagree; the fix is `sorted()` and deleting the timestamp. The goal is
literally *"these two files are identical"* — no cleverness, no near-miss
ambiguity, and it is exactly what KERR asked for in the cold open.

It is also the objective that justifies every hour spent on the clock fix in
`packages/python`: `time.time()` aboard is the virtual clock, so "run it
twice and diff" behaves the same in CI as it does under the player's hands.

## 6. The reveal

Nothing in the data proves what v43 is, and nothing should. What the method
shows is narrower and harder to argue with:

- The byte curve is not a synchronisation. It ramps, holds at line rate for
  eleven minutes, and stops mid-second.
- The total is not 2.2 decimal gigabytes. The operator's figure came from a
  binary conversion of a number somebody read off a different meter.
- The destination is a commercial compute tenancy, billed to `RG-NAV7-03` —
  Vasquez's grant — and nobody has explained it.

KERR files it, and declines to agree with him:

> KERR: I am filing what your method shows. Two point one eight gigabytes
> left that ship in eleven minutes, to an address that is a rented processor
> and not an archive, on a dead woman's account.
>
> KERR: What it *was* is not my department, Mr DeWitt, and I would be careful
> who you say it to. I have watched better-funded people ruin themselves
> being right too early.

That plants **The Containment** without literalising anything, which canon
requires: *"Do not prematurely literalize this into a named monster."*

## 7. How the player writes Python

Worth writing down, because it drove the engine work and it constrains every
route declaration.

- **On a phone, he uses `vi` or `nano`.** Both exist, `packages/editor` was
  built for exactly this, and it is the phone-appropriate path.
- **Routes cannot use an editor** — the harness drives shell commands, and the
  editor is a `ScreenProgram` the host owns. Routes therefore build files with
  `echo ... >` / `echo ... >>`, and edit them with `sed -i`. Verified: leading
  indentation survives quoting intact, and `sed -i` on a line of source makes
  the suite go red, which is a route in its own right.
- **There is no heredoc.** `packages/machine`'s lexer has `>`, `>>`, `<`,
  `2>`, `2>>` and no `<<`. `cat > file <<'EOF'` is the natural way to write a
  file from a shell and we do not have it. Adding it needs the lexer, the
  parser, and a continuation prompt in `apps/terminal` — so it is a real
  feature, not a patch, and it is **not** a prerequisite for this game.
  Recorded as a gap, not scheduled.

## 8. Engine prerequisites — all of them done

Game 3 was probed before it was authored, by writing the kind of script the
game asks the player to write and reading what came back. Five things were
broken. Every fix has a test, and every test was watched to fail with the fix
removed.

| Found | Was | Now |
|---|---|---|
| Every frame read `File "<exec>"` | The bridge `runPython`'d the source, so the interpreter named its own plumbing | Compiled under the player's real filename |
| Three frames of `_pyodide/_base.py` above the real one | Pyodide's `eval_code` in the traceback | Interpreter frames trimmed; `<exec>`, `<runpy>` and `<frozen runpy>` with them |
| `time.time()` returned the host wall clock | Pyodide resolves it against `Date.now` | Pinned to the virtual clock — and to `clock()`, not the calendar: Python's `PyTime_t` is int64 nanoseconds and **cannot represent 2398 at all** |
| `unittest.main()` reported **NO TESTS RAN** against a file with two good tests | `exec` into a bare dict is not `sys.modules['__main__']`, whatever `__name__` says | A real `ModuleType`, registered and restored |
| Every test run ended in a `SystemExit` traceback | `unittest.main()` always exits that way, and the bridge printed a trace for it | A status is not a stack trace |
| `python3 -m` did not exist | — | `runpy`, with the module's own flags passed through |
| `python3 -m json.tool` **closed `sys.stdout` for the rest of the session** | The stdlib does that, and one interpreter serves every command | Closed standard streams are reopened over their descriptors before each run |

The last one is the one to remember. A player pretty-printing a JSON file —
an entirely reasonable thing to do in this game — would have found that every
`print` from then on went nowhere, with no error, and blamed the script they
had just written.

## 9. Open decisions for Chris

Everything above is built or buildable without an answer. These are the ones
where a different answer would change authored prose.

1. **HOLLIS.** Canon leaves the tow operator's name and biography open
   (`STORY_AND_GAME_PLAN.md` §8). This proposes the name and the galley.
   Reject it and the scene moves; the voice is already written in
   `games/wreck/src/act1/comms.ts` and does not change.
2. **KERR's last line.** "I would be careful who you say it to" makes her
   almost an ally. The colder alternative is that she files it and never
   thinks about him again. The warmer one is better drama and slightly
   cheapens her.
3. **Is LUNA's error kept?** Stated above as decided, because it is the most
   useful lesson in the series. It will read as a bug to a playtester who
   does not know, so it is flagged here rather than buried.
4. **Does the hearing happen on screen?** Currently no — the act ends when the
   package is complete and KERR takes it. Playing the hearing itself would be
   a fourth act with no new skills in it.
