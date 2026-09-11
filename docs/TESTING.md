# Testing

The Machine is deterministic, which makes CI the real correctness gate rather
than a smoke check. This is how to use that.

```bash
pnpm check                                   # typecheck + every test
pnpm --filter @sigkill/machine test          # engine only, ~1s
pnpm --filter @sigkill/python test           # real Python, ~3s after Pyodide boots
pnpm --filter @sigkill/machine test:watch    # while working
```

Run `pnpm check` before every push. CI runs the same thing, so a red CI means
it was not run.

---

## The three kinds of test

### 1. Unit tests — does this piece behave?

`vfs.test.ts`, `path.test.ts`, and the field-matching blocks in
`jobs.test.ts`. Ordinary, fast, no ceremony.

**Test the failure paths.** In this project the error messages *are* the
teaching material, so a wrong `ENOTDIR` is a wrong lesson.

```ts
it('refuses to read a directory', () => {
  try {
    vfs.read('/home', alice);
    expect.unreachable('should have thrown EISDIR');
  } catch (e) {
    expect((e as FsError).code).toBe('EISDIR');
  }
});
```

### 2. Behaviour tests — does the shell do what a shell does?

`shell.test.ts`, `services.test.ts`, `net.test.ts`, `python.test.ts`. Drive
the Machine through `exec` and assert on output, exit codes, and world state.

```ts
it('sends stderr to the terminal, never down the pipe', async () => {
  const r = await m.exec('cat /nope | wc -l');
  expect(r.stderr).toContain('No such file or directory');
  expect(r.stdout.trim()).toBe('0');
});
```

Assert exit codes, not just text. `systemctl status` returning 3 for an
inactive unit is a real contract that a puzzle may rely on.

### 3. Property tests — the two invariants

These are the ones that protect the whole project. Do not delete them, and
add to them when you add a subsystem.

---

## Determinism

Every subsystem that touches time, ordering, or identifiers gets a test that
runs the same script twice and compares snapshots.

```ts
it('produces identical snapshots for identical input', async () => {
  const script = ['echo start > log', 'sleep 90 &', 'sleep 3m', 'wait'];

  const run = async (): Promise<unknown> => {
    const m = boot();
    for (const line of script) await m.exec(line);
    return m.snapshot();
  };

  expect(await run()).toEqual(await run());
});
```

This catches, in one assertion: wall-clock reads, unseeded randomness,
iteration-order dependence, and identifier allocation that is not sequential.

**If you add a subsystem, add one of these for it.** `jobs.test.ts` and
`net.test.ts` both have one; copy either.

### What makes a test non-deterministic

- `Date.now()` or `new Date()` anywhere in `packages/machine` — use
  `ctx.clock()`.
- `Math.random()` — there is no seeded generator yet; if you need one, add it
  to the Machine rather than reaching for the global.
- Iterating a `Set` or `Map` and depending on order — sort first.
- `Promise.all` over operations that mutate the machine — `expandWords` awaits
  in sequence for exactly this reason.

---

## Solution-agnostic goals

A goal predicate reads world state. A test proves it accepts every honest
route and rejects the near misses.

```ts
const goal = (m: Machine): boolean =>
  m.vfs.readText('/etc/life_support.conf', ROOT_USER).includes('O2_TARGET=21') &&
  m.services.get('scrubber')?.state === 'active';

const routes: Array<[string, string[]]> = [
  ['sed then start',    ["sudo sed -i 's/16/21/' /etc/...", 'sudo systemctl start scrubber']],
  ['edit then restart', ["sudo sed -i 's/16/21/' /etc/...", 'sudo systemctl restart scrubber']],
  ['enable and boot',   ["sudo sed -i 's/16/21/' /etc/...", 'sudo systemctl enable scrubber']],
];

for (const [name, commands] of routes) {
  it(`accepts: ${name}`, async () => { /* ... */ });
}

it('rejects fixing the config without starting the service', async () => { /* ... */ });
```

**Every puzzle gets at least three accepted routes and two rejected near
misses.** Three routes is the threshold where a goal that secretly depends on
one particular command tends to fall over.

Rejections matter as much as acceptances: a goal that accepts a half-finished
state is a puzzle that completes itself.

> If one of these files ever needs a special case for a particular command,
> the design has regressed. Fix the goal, not the test.

---

## Testing Python

`packages/python` runs a real interpreter, so its tests are slower and boot
Pyodide once per file:

```ts
const runtime = new NodePythonRuntime();
beforeAll(async () => { await runtime.ready(); }, 180_000);
```

`NodePythonRuntime` exists **only for tests**. The game uses
`WorkerPythonRuntime`, because player code must not share a context with the
DOM. Do not wire the Node one into the app.

When touching `bridge.ts`, the failure modes that have actually bitten are
empty directories not crossing the boundary and the interpreter's filesystem
going stale between runs. Both have tests; keep them.

---

## Conventions

**Name the behaviour, not the function.** `'sends stderr to the terminal,
never down the pipe'` beats `'test stderr'`. These names are read by someone
debugging a failure at speed.

**One `boot()` per file.** A small helper that builds the world the tests
need, so each test starts from a known machine.

**Comment the non-obvious assertion.** If a test encodes a real-world
behaviour — cron's day-of-month OR day-of-week rule, `grep -v 0` dropping
only the literal `0` — say so. Someone will otherwise "fix" it.

**Add a regression test when you fix a bug**, and say in a comment what the
bug was. `test/shell.test.ts` has the attached-option-value case
(`cut -d, -f1` silently eating `-f1`), which is the archetype: a correct
command producing nothing at all.
