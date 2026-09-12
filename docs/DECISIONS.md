# Decisions

Choices that look arbitrary from inside the code, written down so they stop
being re-litigated. Each records what was decided, why, and what it costs.

If you want to reverse one, that is fine — but read the cost first, and
update the entry rather than leaving it stale.

---

## 1. `packages/machine` depends on nothing

**Decided:** the engine has zero runtime dependencies and imports nothing
outside itself.

**Why:** it runs in Node for tests, in a browser for the game, and eventually
inside a Capacitor container. It is eighteen kilobytes. Every dependency
added to it is a dependency shipped to every player, audited in CI forever,
and — once the app can hold a secret — an exfiltration surface.

**Cost:** things get written by hand that a library would provide. Path
arithmetic, base64, glob-to-regex. All of them are small and all of them are
tested.

**If you need a library:** put it in a package that wraps it behind an
interface, the way `packages/python` wraps Pyodide, and give the engine the
interface.

---

## 2. Puzzle goals assert on world state, never on input

**Decided:** a goal is a predicate over the Machine. It never inspects what
the player typed.

**Why:** this is the whole product difference. A pattern-matched terminal
punishes a player for solving the puzzle in a way the author did not
anticipate — a correct command that produces nothing is the single worst
experience this genre has. State-based goals accept every correct route for
free, including ones nobody imagined.

It is not hypothetical: `test/python.test.ts` solves Act I in Python, and the
goal accepts it without knowing Python exists.

**Cost:** goals must be written against observable state, which sometimes
means modelling something properly rather than faking it. That is usually
the right pressure.

**Enforced by:** `test/goal.test.ts`, `test/services.test.ts`.

---

## 3. The virtual clock, and why `sleep` moves it

**Decided:** time is a number the Machine owns. `tick(ms)` is the only way it
advances. `sleep` calls it. Nothing reads wall time.

**Why:** determinism. Identical input must produce byte-identical snapshots,
or puzzles cannot be verified in CI and saves cannot be trusted. It also
makes scheduled behaviour testable instead of flaky — a cron test advances
three minutes and asserts, rather than waiting three minutes and hoping.

**Cost:** `sleep 30` is instant in real seconds. That is correct here, and
players find it a relief rather than a lie.

**The trap:** cron is exactly the feature that tempts someone to reach for
`new Date()`. There is a test asserting the hour field resolves against
`machine.epoch`. Do not delete it.

---

## 4. Python is bulk-copied, not syscall-bridged

**Decided:** each `python3` run copies the machine's filesystem into Pyodide,
runs, and diffs the tree back out.

**Why:** the alternative is intercepting every `open()` across a Worker
boundary, which means an async syscall bridge, which means either
`SharedArrayBuffer` plus COOP/COEP headers (awkward under Capacitor) or a
rewrite of Python's IO layer. Bulk copy is one operation in and one diff out,
easy to reason about and easy to keep deterministic. The machine's disk is a
few dozen small files.

**Cost:** copying is proportional to disk size, so a very large world would
get slow. If an adventure ever has thousands of files, revisit this — do not
work around it by making the copy partial and clever.

**Two bugs this shape already caused,** both fixed and both tested: empty
directories did not cross (a directory with no files has nothing to imply
it), and the interpreter's filesystem went stale between runs. If you touch
`packages/python/src/bridge.ts`, those are the failure modes to think about.

---

## 5. The executor is async

**Decided:** `Machine.exec` returns a promise, and `CommandFn` may return
`number | Promise<number>`.

**Why:** Python runs in a Web Worker, and a Worker cannot be awaited from a
synchronous call stack. Keeping `exec` synchronous would have meant running
Pyodide on the main thread — trading the isolation rule for convenience and
blocking the UI on every long-running call.

**Cost:** one async command makes the entire pipeline awaitable, and it
already has. Most commands are still synchronous functions and should stay
that way; `async` is not free clarity.

**Consequence in the app:** commands take real time, so the terminal holds a
busy guard. A second Enter while one is in flight would interleave output and
race the machine's state.

---

## 6. `systemctl enable` creates a symlink

**Decided:** enabled state is a symlink in
`/etc/systemd/system/multi-user.target.wants`, not a boolean.

**Why:** it is what really happens, so `ls -l` shows it, `readlink` explains
it, and a player who later meets a real system recognises it. It also
persists through a snapshot with no extra machinery, because the filesystem
already persists.

**Cost:** `isEnabled` is a filesystem lookup rather than a field read. This
has never mattered.

**The general principle:** when the honest mechanism is no harder than the
shortcut, take the honest mechanism. It is free teaching.

---

## 7. Unit files are re-read on every operation

**Decided:** `ServiceManager` loads `.service` files from the VFS each time,
rather than caching a parsed registry.

**Why:** a unit file is then a real file. The player can `cat` it, `grep` it,
edit it, and write a new one — and the system responds. Caching would make
those actions silently ineffective, which is precisely the "terminal feels
fake" failure.

**Cost:** parsing on each call. It is a handful of short files.

---

## 8. Two tracks, one Machine

**Decided:** Cadet and Operator are two interfaces over one engine, sharing
every puzzle and every goal predicate. They differ in the chip bar, hint
policy, checkpoint frequency, goal *variants*, and which manual `man` shows.

**Why:** the alternative is two content sets, which is roughly double the
authoring and guarantees they drift. Sharing the goal means a Cadet and an
Operator are genuinely playing the same game.

**Cost:** roughly 1.3× authoring per puzzle, not 2×.

---

## 9. Content packs are data, never code

**Decided:** goal predicates and preconditions compile into the app bundle.
Nothing executable is ever loaded from downloaded content.

**Why:** a content pack that can ship JavaScript is remote code execution
wearing a hat. This is a security boundary, not a preference.

**Cost:** an adventure cannot be shipped as a pure data update; it is part of
the build. Given thirteen separate store listings, that was always true.

---

## 10. No third-party SDKs

**Decided:** no ads, no analytics, no crash reporter that uploads content.

**Why:** partly the product — this is a paid game and not a funnel. But it is
also a security control. If the app ever holds an API key, every SDK in the
process is a way for it to leave.

**Cost:** no telemetry, so playtesting has to be done by watching people
play. For a game of this size that is the better method anyway.
