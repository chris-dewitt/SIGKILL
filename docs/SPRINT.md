# Sprint 2 — `sqlite3` on the ship

> **Done.** `sqlite3` shipped in PR #27 and game two was built on it. This file
> is kept as the record of how the sprint was scoped, not as current work —
> `HANDOFF.md` has what is open now.

Written 2026-09-26, after Act I shipped and the wa-sqlite spike passed.

**One sentence:** make `sqlite3` a real command on a real database file, as
deterministic as the rest of the Machine — so that when game 2's content
starts, none of the engine is a question any more.

This sprint is deliberately **story-free.** It does not need Chris's answers to
`GAME2_BEATS.md` §11, and it should not wait for them. If the premise changes
completely, every line of this sprint still stands.

---

## Why this and not content

Game 2 is SQL. Everything downstream of that — objectives, hint ladders, the
claims database, the clerk — is authored against a capability that does not
exist yet. Writing content first means writing it against an imagined
interface and finding out later which parts were fiction.

Act I is the evidence: the content pipeline is fast *once the engine is
honest*. The nine engine bugs in §7 of `HANDOFF.md` were all found by writing
content against something not quite finished. Doing the engine first is the
cheaper order.

---

## What the spike already settled

Do not re-litigate these; they are measured, and the evidence is in
`GAME2_BEATS.md` §8a.

| Question | Answer |
|---|---|
| Does SQLite see the real clock? | Yes. `CURRENT_TIMESTAMP` returned today's actual date. |
| Can it be controlled? | Yes. Patch `Date.now` **before the wasm factory runs**; every date function follows. |
| Is `random()` deterministic? | No — and a host function shadows the built-in, so a seeded LCG replays exactly. |
| Can we get the database bytes out? | Yes. `MemoryVFS` keeps each file as an `ArrayBuffer`; round-tripped rows successfully. |
| Is there new architecture here? | **No.** It is `packages/python`'s bridge with a different engine behind it. |

---

## The goal, stated as something you can watch happen

At the end of this sprint, on the real terminal:

```
$ sqlite3 /home/dewitt/archive.db "CREATE TABLE crew(id INTEGER PRIMARY KEY, name TEXT);"
$ sqlite3 /home/dewitt/archive.db "INSERT INTO crew(name) VALUES ('vasquez'),('dewitt');"
$ sqlite3 /home/dewitt/archive.db "SELECT * FROM crew;"
1|vasquez
2|dewitt
$ ls -l /home/dewitt/archive.db
-rw-r--r-- 1 dewitt dewitt 8192 ... archive.db
$ file /home/dewitt/archive.db
/home/dewitt/archive.db: data
```

The last two lines are the point. The database is **a file on the ship**, not a
thing the game keeps somewhere else, and every command already aboard can see
it. That is the `PLAN.md` rule — *all engines bind to the same VFS* — and it is
what makes a player believe the machine is real.

---

## The work, in order

Each item ends in something testable. Do not start the next until the current
one has a test.

### 1. `packages/sql` skeleton and the `SqlRuntime` interface

Mirror `packages/python` exactly: the interface lives in
`packages/machine/src/lang/sql.ts`, the implementation lives in
`packages/sql`, and **`packages/machine` depends on nothing**. The Machine is
handed a runtime or it reports that `sqlite3` is not installed, which is a
legitimate state for a machine to be in.

```ts
export interface SqlRuntime {
  readonly version: string;
  ready(): Promise<void>;
  run(request: SqlRequest): Promise<SqlResult>;
}
```

`SqlRequest` carries the SQL, the database file's current bytes, and the ship
clock. `SqlResult` carries rows, column names, an error, and the database
bytes *after*. No path handling inside the runtime — the command owns the
filesystem, exactly as the Python bridge does.

**Done when:** the interface compiles and a stub runtime makes `sqlite3`
report a version.

### 2. `NodeSqlRuntime`, for tests only

Same rule as `NodePythonRuntime`, and worth restating because it has to be
obeyed: **never wire it into the app.** The Worker is what keeps player-written
SQL away from the DOM.

**Done when:** a test creates a table and reads a row back.

### 3. Determinism, before anything else is built on it

Two things, both at construction, both non-negotiable:

- Patch `Date.now` to the ship clock inside the worker before the factory runs.
- Shadow `random()` with a seeded LCG — the same generator `hullTelemetry`
  uses, so the whole project has one source of fake randomness.

**Done when:** a test runs a script twice from scratch and compares byte for
byte, and a second test proves it *fails* without the shadowing. The Act I
audio bug is the precedent: a regression test nobody has seen fail is a
regression test nobody should trust.

### 4. The VFS binding

Copy the database file's bytes into `MemoryVFS` before the query, read them
back after, write them to the Machine's VFS as the invoking user. Permissions
are the VFS's job, which means `sqlite3` on a root-owned database refuses for
the right reason and with the right errno.

**Done when:** `ls -l`, `cp`, `wc -c` and `file` all see the database, and a
query against a file the player cannot write fails with `EACCES`.

### 5. The `sqlite3` command

Both forms, because both are what people type:

```
sqlite3 db.sqlite "SELECT * FROM crew;"
sqlite3 db.sqlite < script.sql
```

Dot-commands: `.tables`, `.schema`, `.headers on|off`, `.mode list|column`,
`.import FILE TABLE`, `.quit`. Output defaults to `|`-separated, like the real
thing.

Both manual pages — operator and cadet — or the man-page guard fails the
build, correctly.

**Done when:** the man-page test passes and each dot-command has a test
including its failure path.

### 6. Snapshot and restore

The database is a VFS file, so this should be nearly free — *if* the runtime
always flushes before the snapshot is taken. Prove it rather than assume it.

**Done when:** a save taken mid-session restores with the rows intact, and the
determinism test still passes across a restore.

### 7. Goals that can query

`World` gains an optional `sql` handle so a goal predicate can ask the
database a question without going through the player's shell. Without this,
every game 2 objective would have to assert on file bytes, which is the
filename bug from Act I waiting to happen again in a new costume.

**Done when:** a goal predicate satisfied by four genuinely different queries —
a join, a subquery, a temp table, and a Python script that does it — passes all
four.

---

## Definition of done for the sprint

- `pnpm check` green, and the new package has its own determinism test
- `sqlite3` works on the real ship, against a file `ls` can see
- Both man pages for every new command
- `HANDOFF.md` §2 describes `packages/sql` the way it describes
  `packages/python`
- **No content written.** If it is tempting, that is the sprint working.

---

## Explicitly not in this sprint

| Thing | Why not |
|---|---|
| Any of game 2's story, schema or objectives | Blocked on `GAME2_BEATS.md` §11, and it should be. Build the capability first. |
| A real wa-sqlite VFS | `MemoryVFS` plus copy-in/diff-out is enough at this scale. Revisit if a database ever gets big enough to hurt. |
| The unindexed-query beat | It needs rows-scanned charged against the virtual clock, which is a design problem, not a plumbing one. `GAME2_BEATS.md` §8 flags it. Do not fake it with a sleep. |
| `jq` | `python3` already handles JSON and is more honest teaching. |
| Anything on the `apps/terminal` side | The app needs one line to hand the Machine a runtime. That is all. |

---

## Risks, ranked

1. **Determinism regressing silently.** The clock patch is one line in one
   place and nothing will shout if it is removed. Mitigation: the test from
   item 3, verified to fail without it.
2. **The Worker boundary.** Pyodide took real work to get right here and this
   will too. `packages/python/src/worker.ts` is the worked example; read it
   before writing a second one.
3. **Scope creep into content.** The moment `sqlite3` works it will be very
   tempting to write the claims database. See "definition of done".

---

## What Chris owes, and what it blocks

`GAME2_BEATS.md` §11, ranked. It blocks content authoring and **nothing in
this sprint**:

1. The premise — the salvage clause, and DeWitt not being in the records
2. FERRYMAN'S REST — the name, and whether a records town is the right first
   society for the series to show
3. Whether v43 is named in game 2, or held to game 3

Answering those while this sprint runs means content can start the day it ends.
