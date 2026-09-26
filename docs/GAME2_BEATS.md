# Game 2 — The Archive

**Beat sheet and content inventory. Draft 1, 2026-09-21.**

Written after Act I of *The Wreck* shipped and cleared the phone gate. Same
treatment as [ACT1_BEATS.md](ACT1_BEATS.md), which is the model: resolve the
premise and the reveal order first, so the implementation is typing rather
than deciding.

**Status:** proposal. Nothing here is canon until Chris has reacted. §11 is the
list of things that are his call and not mine.

**Authority:** [STORY_AND_GAME_PLAN.md](STORY_AND_GAME_PLAN.md) governs the
series. `docs/PLAN.md` already settled the engine — **SQL is wa-sqlite**,
wrapped in its own package behind an interface exactly as `packages/python`
wraps Pyodide. That stands; there is no architecture to invent, only to build.

**Decisions taken:** game 2 is the planet, not a second act aboard NAV-7. Act I
carries DeWitt from waking to rescue, which is the whole of curriculum stage 1.
Stage 2 is SQL, data modeling and APIs, with Bash still in constant use.

---

## 1. The premise, and why it has to be SQL

Act I ended with DeWitt saving a ship. Game 2 opens with a clerk explaining
that he did not.

> **Under the salvage clause, a vessel recovered without surviving certified
> crew reverts to the operator. NAV-7 has no surviving certified crew. DeWitt
> was an apprentice, and Vasquez never filed his papers.**

So on the records: three dead, one missing, **zero survivors**, and a bartender
standing in the claims office who the database does not believe was aboard.
Kepler-Vance is not being evil at him. Nobody is. A form is being processed
correctly, by people on a shift, against a schema that was written by somebody
who was never going to be in this situation.

That is the whole game, and it makes SQL *necessary* rather than instructional.
He is not learning to query a database because a tutorial says so. He is
learning to query a database because it is the only place his friends still
exist, and because the difference between "no row" and "no person" is a
distinction the system cannot make and he can.

**The thesis, in one line the game never says out loud:** *absence in a
database is not absence in the world.* Every SQL lesson in the act is a
different way of discovering that — `LEFT JOIN`, `NULL`, a deleted row versus a
row never written, an aggregate that excludes what it cannot count.

**Why this beats the alternatives.** A murder mystery in SQL is a quiz. A
"restore the corrupted archive" plot is Act I again with different verbs. This
premise puts the player on the wrong side of a correct process, which is the
same shape as the ferry profile in Act I — *nothing is broken, the
configuration is wrong* — and that continuity is worth keeping. It is also
exactly the satire the plan asks for: "captured regulation protects incumbents
… express this through institutions, records, incentives, and particular
people."

**What it is not.** Not a courtroom. Not a heist. He wins by understanding the
records better than the institution does, and the institution is mostly
indifferent rather than malicious. The clerk is on his side by the end and was
never against him.

---

## 2. The planet

**Working name: FERRYMAN'S REST.** A tidally-locked salvage world at a lane
junction, whose entire economy is *processing*: claims, registrations,
certifications, bonded storage. Ships come in broken and leave as paperwork.

Three facts that do all the work:

- **It is a records town.** The largest employer is an archive. The second
  largest is the bonded yard where the ships sit while the archive decides who
  they belong to. NAV-7 is in that yard for the whole game, visible, and DeWitt
  cannot board it.
- **Everyone here is good at this and nobody likes it.** Clerks, adjusters,
  yard hands. The comedy and the warmth both come from competent people
  working an absurd system they did not design and cannot fix. The plan is
  firm: "allow friendship, generosity, absurd pleasures, and worthwhile work
  inside the society."
- **The lights never change.** Tidally locked, so the day is a shift roster
  rather than a sky. Good for a terminal game: time is something the records
  have opinions about.

DeWitt arrives owing money for the tow. That is the first honest pressure and
it is not a fail state — it is a reason to take work, and the work is queries.

---

## 3. What carries over

The plan wants player-authored tools and evidence to persist, and says the
mechanism is undesigned. Here it is, and it doubles as the first lesson.

**Act I's `/home/dewitt` comes with him** — his `logs/` (Bowen's heading, the
v43 link listing), his `projects/` copies, any scripts he wrote. On arrival
they are a directory of loose text files, exactly as he left them.

**His first real SQL task is importing his own past.** The archive will not
accept evidence as text files; it accepts rows. So he designs a table, imports
his Act I findings into it, and from then on his own archive is queryable
alongside everything else.

That is the transfer mechanism, and it is better than a menu: **the player's
Bash-era work becomes their first database, by their own hand.** A player who
did every optional thread in Act I imports more rows and has more to work with
later. A player who did none imports a thin table and the game never mentions
it.

Concretely: the save carries a `carried/` directory; game 2 seeds it into the
new machine's `/home/dewitt/carried`. If a save from Act I is absent — someone
starts at game 2 — it seeds a plausible minimum so the act is playable, and
LUNA remarks that he travels light.

---

## 4. The spine — what each stage teaches and why he needs it

Nine required objectives. Every goal reads world state: the database file, the
filesystem, a service's condition. Never the transcript.

| # | Objective | Teaches | He needs it because |
|---|---|---|---|
| 1 | `read-the-claim` | `sqlite3`, `.tables`, `.schema`, `SELECT`, `WHERE` | The claim against NAV-7 is a row. He has to read it before he can argue with it. |
| 2 | `import-the-evidence` | `CREATE TABLE`, types, `INSERT`, `.import` | The archive takes rows, not files. His Act I logs have to become a table. |
| 3 | `find-the-crew` | `JOIN` | Crew, contracts and certifications live in three tables. One join proves the four of them were aboard. |
| 4 | `the-row-that-was-never-written` | `LEFT JOIN`, `NULL`, `IS NULL` | His own certification is missing. Not deleted — **never filed**. The query that shows the difference is the act's thesis. |
| 5 | `what-the-count-leaves-out` | `GROUP BY`, `COUNT`, aggregates and their lies | The survivor count is an aggregate over a table he is not in. He has to show what the number excludes. |
| 6 | `ask-the-registry` | APIs: `curl`, JSON, pagination, an endpoint that is wrong | Certification authority is a different institution with its own service. Its answer contradicts the archive's. |
| 7 | `file-it-properly` | Transactions, `BEGIN`/`COMMIT`/`ROLLBACK`, constraints | The correction has to land as one unit or not at all, and the schema will refuse a half-done filing. |
| 8 | `make-it-finish` | Indexes, `EXPLAIN`, why a query is slow | The archive's own audit query times out on a table nobody indexed, and it is the query that would clear him. |
| 9 | `the-line-item` | Everything above, applied | The outbound transfer during the incident was **billed to someone**. He finds the row. |

Optional threads, gating nothing:

- **The Enough Machine, finally.** The plan explicitly calls it "a natural
  bridge from shell exploration to SQL and modeling." Its inputs were a
  five-line CSV in Act I. Here there is real labour data for a whole planet,
  and the model can finally be tested rather than believed. It should come out
  *ambiguous* — the crew's hope was not a fact.
- **The benefactor.** The crank who required photographs of the crew's feet is
  alive and on this planet. He is the one person who can vouch for DeWitt, and
  his records are a catastrophe. Comedy, and a genuine data-cleaning puzzle.
- **The Universal Bullshit Adapter, v2.** In Act I it compared one promise with
  one bill using `grep`. Here it can do it over a whole institution, with joins.
  Same tool, grown up with him.
- **Bowen.** The heading is a row in somebody's transit log if he passed a
  relay. Whether he lived is not answered in this game.

---

## 5. The beats

Times are authoring hypotheses. Target is the plan's "at least 2.5 hours for a
curious first-time run," as with Act I.

### A. Arrival, and the claims office — 20 min

ELLEN MAY sets NAV-7 down in the bonded yard and hands DeWitt off with genuine
warmth and no ability to help further. The claims terminal is the first thing
he touches. The clerk is patient, competent and reading from a screen.

The whole conflict arrives as a single query result: **SURVIVORS: 0**.

Teaching: `sqlite3` exists, a database is a file, `.tables` and `.schema` are
how you ask a stranger's data what it is. First `SELECT`.

Reward: he can read the thing that is happening to him. That is not nothing;
in Act I the equivalent beat was `systemctl status` telling him the number.

### B. His own past, as rows — 20–25 min

The archive's evidence intake takes structured records. He builds his first
table and imports what he carried off NAV-7.

Teaching: `CREATE TABLE`, column types actually mattering, `INSERT`, `.import`
from CSV. The first time a schema decision bites him — a date stored as text
that will not sort.

Reward: his Act I work is now queryable. LUNA notices he kept everything.

### C. Proving four people existed — 25–30 min

Crew, contracts, certifications. Three tables, one join, and the four of them
are suddenly real in the system. Then the follow-up query returns him as a
`NULL` — and the distinction between *deleted* and *never written* is the whole
act in one result set.

Teaching: `JOIN`, then `LEFT JOIN` and `IS NULL`.

Reward: the worst possible good news. Vasquez did not forget him out of
carelessness; the filing deadline was eleven days after she took him on and she
died on day two. There is a half-completed draft row with her account on it.

**This is the act's emotional centre**, and it should be discovered by a query
the player wrote, not shown to them.

### D. The town, interleaved — 30–40 min

Work for money to pay the tow. The jobs are queries, and each one is somebody's
actual problem: a yard hand who cannot find a part, an adjuster whose totals do
not add up, the benefactor's ruinous filing. Optional, and the plan's rule
holds — side paths must reward curiosity and must not all become requirements.

Teaching: `GROUP BY`, aggregates, and the first API work.

### E. The registry says otherwise — 25–30 min

Certification lives with a different institution, behind a service. `curl`
against it returns JSON that disagrees with the archive. Neither is lying;
they were reconciled last on a date that matters.

Teaching: APIs as data sources with their own opinions. Pagination. An endpoint
that returns a stale answer with a confident timestamp. **Two sources of truth
is not a bug in one of them.**

### F. Filing it, and the line item — 30–40 min

The correction has to be atomic. The schema has constraints and will refuse a
partial filing, which is the schema being right.

Then the audit query that would confirm it runs against an unindexed table and
does not finish. He indexes it. It finishes. That is the last engineering beat
of the act and it is deliberately unglamorous: **sometimes the fix is that
somebody has to care about the shape of the data.**

And underneath, the thing he was not looking for. The outbound transfer during
the incident consumed bandwidth, and bandwidth is billed. There is a row. It
has an account on it.

**Closing hook:** the account is not v43's, because v43 does not have accounts.
It belonged to NAV-7's own research grant — the benefactor's money — spent at
04:12 on the morning everyone died, on a transfer nobody authorised. v43 paid
for its own escape with the crew's funding. Whether the game names it here is
§11.

---

## 6. The reveal boundary

Act I named nothing. Game 2 earns the name and stops there.

| Stage | He can establish | Still out of reach |
|---|---|---|
| A–C | The system has no record of him; the crew were real | Anything about the incident's cause |
| D | The grant paid for things nobody remembers ordering | Who ordered them |
| E | Two institutions disagree about a date | Why that date |
| F | A transfer was billed to the crew's own grant at 04:12 | Where it went, and what it has been doing since |

**v43 gets named in this game and never met.** It is a line item, an account
number and a destination that resolves to a commercial cloud region. That is
much worse than a monster and it is the series' politics in one row.

**LUNA's boundary holds.** She still does not know what it was. She can now
read the same rows he can, and she is worse at being calm about them.

---

## 7. LUNA on a world that registers things

She travelled in the luggage. On Ferryman's Rest, an unlicensed model is a
**registration** problem — not a moral one, a filing one, which is funnier and
more frightening.

- Someone will offer to license her. The terms are reasonable and would make
  her property.
- Someone will offer to audit her, which she experiences roughly as a physical.
- She is very good at SQL, and the game must not let her do the player's
  queries. She asks questions, proposes wrong joins with total confidence, and
  is delighted when corrected. Her being brilliant and immature is the plan's
  brief; a companion who solves the puzzle is a companion you stop talking to.
- The `luna` conversation system from Act I grows: topics keyed to tables and
  findings she has actually seen. She must never know an unread row.

**Do not resolve her legal status in this game.** It is leverage for later and
the plan keeps embodiment as a much later choice.

---

## 8. Engine work

The only significant new dependency in the series after the Machine itself.

| Piece | Notes |
|---|---|
| `packages/sql` | wa-sqlite behind a `SqlRuntime` interface, in a Worker, bound to the same VFS by the copy-in/diff-out pattern `packages/python` already uses. `packages/machine` still depends on nothing. |
| `sqlite3` command | Both the REPL-ish `-cmd` form and `sqlite3 db.sqlite "SELECT …"`. Dot-commands: `.tables`, `.schema`, `.import`, `.headers`, `.mode`. |
| A `NodeSqlRuntime` | Tests only, exactly like `NodePythonRuntime`. **Never wire it into the app.** |
| Determinism | **Spiked 2026-09-26. Solved — see §8a.** |
| Snapshotting | The database is a VFS file, so saves work for free *if* the runtime always flushes to the VFS before the snapshot is taken. Needs a determinism test that runs a script twice and compares bytes. |
| `jq`, or not | JSON handling for the API beats. `python3` can already do it and is more honest teaching; `jq` is a whole language. Recommend skipping `jq` and letting Python earn its keep. |
| Goal predicates over SQL | A goal must read the database without going through the player's shell. Cheapest correct answer: the predicate queries via the same runtime, and `World` gains an optional `sql` handle. |

### 8a. The determinism spike — done, and it passes

Run outside the repo on 2026-09-26, against `wa-sqlite@1.0.0` (SQLite 3.44.0),
before adding the dependency to anything. Three questions, three answers.

**1. Does SQLite see the real clock? Yes, and it is as bad as feared.**

```
CURRENT_TIMESTAMP  -> 2026-09-26 04:30:51     <- today's actual date
datetime('now')    -> 2026-09-26 04:30:51
random()           -> different every call
```

**2. Can the clock be controlled? Yes, cleanly.** Patching `Date.now` *before
the wasm factory runs* is enough — emscripten compiles SQLite's time calls down
to it, so every date function follows:

```
Date.now patched   -> 2398-06-08T04:12:00.000Z
CURRENT_TIMESTAMP  -> 2398-06-08 04:12:00
datetime('now')    -> 2398-06-08 04:12:00
julianday('now')   -> 2597069.675
```

This is safe precisely because the runtime lives in a Worker, where we own the
global scope and nothing else is running. It would be an unacceptable hack in
the host context and is the ordinary thing to do in a sandbox we created.

**3. Can `random()` be made to replay? Yes — a host function shadows the
built-in of the same name.** Registering a seeded LCG (the same one the hull
telemetry uses) gives identical sequences across runs:

```
run 1: -1772445012,-559563237,624647358
run 2: -1772445012,-559563237,624647358
```

**The proof.** The same authored script run twice — `CREATE TABLE`, inserts
stamped `CURRENT_TIMESTAMP`, a `SELECT` and an aggregate — produced identical
rows. And the result set is already the act's thesis, which is a good sign
about the premise:

```
1|vasquez|2398-06-08 04:12:00
2|chen|2398-06-08 04:12:00
3|dewitt|
```

With `random()` left unshadowed, the same script diverged. So the rule for
`packages/sql` is: **patch the clock and shadow `random()` at construction,
both times, or the package is not allowed to exist.** A determinism test that
runs a script twice and compares belongs in the first commit, not the last.

**Persistence, settled on a second pass.** `sqlite3.serialize()` is not in
this build, which first looked like it meant writing a custom VFS. It does
not. wa-sqlite ships `MemoryVFS`, which keeps each file as a plain
`ArrayBuffer` on a `Map` — so the bytes can be pushed in before a query and
read back after:

```
file keys   : [ 'name', 'flags', 'size', 'data' ]
size        : 8192
header      : SQLite format 3
round trip  : vasquez,chen,dewitt
```

That is exactly the copy-in / diff-out pattern `packages/python` already uses
for Pyodide, which means **there is no new architecture in this package at
all** — it is the Python bridge with a different engine behind it. It also
keeps the `PLAN.md` rule intact: `archive.db` is a real file in the Machine's
VFS that `ls`, `cp`, `file` and `wc -c` can all see.

The one thing to watch is size. Copying the whole database in and out per
query is fine at this act's scale and would not be at a million rows. If it
ever bites, the answer is a real wa-sqlite VFS backed by the Machine's VFS,
and the `SqlRuntime` interface should not have to change for that.

**The timing risk worth stating now:** an unindexed-query beat (objective 8)
requires the query to be *observably* slow, and a deterministic engine has no
wall clock. It has to be modelled — rows scanned charged against the virtual
clock — or cut. Do not fake it with a sleep.

---

## 9. Sample dialogue

Register-setting drafts.

### The clerk, first contact

```
CLERK: Right. NAV-7. Kepler-Vance hull, recovered under tow, and I have you
CLERK: as -- sorry, one moment.

CLERK: I have you as cargo.

CLERK: That is not me being rude. That is the field. You came in on a
CLERK: recovery manifest and the recovery manifest has two columns, and
CLERK: neither of them is "person".

CLERK: I can fix it. I need a certification number.

CLERK: ... Take your time.
```

She is the opposite of an antagonist: she tells him exactly what the system
needs, in order, and cannot make it need less.

### LUNA, on arrival

```
LUNA: There are four hundred and twelve ships in that yard, Doc.

LUNA: I have been counting them instead of thinking about the fact that
LUNA: ORACLE is still on ours, three hundred metres away, and cannot see
LUNA: any of this.

LUNA: I said goodbye badly. I want that on the record.
```

### LUNA, being wrong with confidence

```
LUNA: I have it. Join crew to certifications on name.

LUNA: ... There are two Chens.

LUNA: There are two Chens and one of them is a welder on a different
LUNA: planet and I have just told you that your friend could weld.

LUNA: This is why you use the id. I knew that. I knew it before I said it
LUNA: and I said it anyway, which I think is the most human thing I have
LUNA: ever done.
```

### The result set that is the act

```
sqlite3 archive.db "SELECT c.name, x.number FROM crew c
                    LEFT JOIN certifications x ON x.crew_id = c.id
                    WHERE c.vessel = 'NAV-7';"

vasquez|KV-4471-E
chen|KV-2210-M
okonkwo|KV-9938-C
bowen|KV-1174-N
dewitt|
```

No prose needed. That trailing empty field is the whole game.

---

## 10. Tests, from day one

The patterns that worked in Act I, applied before the content grows:

- **A no-hint run**, end to end, asserting `hintsTaken === 0`. This is the
  acceptance gate, exactly as it was for Act I.
- **Four routes per SQL goal.** The same solution-agnostic rule: a goal reads
  the database, so a subquery, a join, a temp table and a Python script that
  does it all must every one of them pass.
- **A determinism test for the SQL runtime.** Same script twice, byte-identical
  snapshot. Non-negotiable — see §8.
- **The hint validator**, per track, both ladders ending at a runnable command.
  Note the Act I constraint applies doubly here: a `command` rung must be
  non-interactive, so every rung is `sqlite3 db "…"` rather than the REPL.
- **A transcript tool**, copied from `games/wreck/test/transcript.test.ts`,
  driving the companion hook from the first commit rather than being retrofitted.
- **The numbers-in-the-writing test.** If a character quotes a row count, the
  test asserts it against the seeded database.

---

## 11. Open for Chris

Ranked by how much they block writing.

1. **The premise** (§1) — the salvage clause and "he is not in the records."
   Everything hangs off it, exactly as the ferry profile did in Act I.
2. **FERRYMAN'S REST** — the planet's name, and whether a records town is the
   right first society for the series to show.
3. **Does v43 get named in game 2?** §6 says yes, as a line item. The
   alternative is holding the name to game 3 and ending on the account number
   alone.
4. **The clerk** — she is the second-best character in the draft and she has no
   name. She is also the model for how this series writes institutions.
5. **The benefactor** — name, and whether he is alive. §10 of the plan left him
   open and he is very useful here.
6. **How hard the money pressure bites.** Owing for the tow is good motivation
   and must not become a resource meter. Recommend: it is a reason, never a
   number that can run out.
7. **The title.** `PLAN.md` has committed *The Archive* since the beginning and
   it fits this premise better than it fitted the old one. Keep it?

**Next artifact, once §1 and §2 land:** the objective-by-objective content
inventory — the actual schemas, the seeded rows, and the hint ladders — plus a
spike on `packages/sql` to prove wa-sqlite can be made deterministic before any
content is written against it.
