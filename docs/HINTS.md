# Hints and objectives

Read this before writing a ladder. `packages/quest` is the machinery;
`games/wreck/src/objectives.ts` is the worked example.

---

## The three rules

**1. A goal is a fact about the world, never a string the player typed.**

```ts
done: (w) => w.services.get('scrubber')?.state === 'active'
```

Not "did they run `systemctl start`". `sed`, a redirect, a Python one-liner and
an editor are all the same answer, and a player who finds a route we did not
think of has *won*, not cheated. This is the same invariant the shell tests
enforce in `packages/machine/test/goal.test.ts`; it holds for objectives too.

**2. The ladder always ends at the command.**

A hint system that stops at "think about permissions" is one a stuck player
quits over. The last rung says exactly what to type, and the validator fails CI
if it does not. A player who reads the answer still has to understand it to
type the next one — that is the whole of the pedagogy here, and it is not
undermined by telling somebody the thing they were going to look up anyway.

**3. Hints cost nothing.**

No timer, no currency, no penalty, no "are you sure". A hint you have to pay
for is a hint a learner refuses on principle and then rage-quits over. What the
book *does* keep is a count, so a run that never asked can be recognised as one
later.

---

## Shape

An objective is a title, a `done` predicate, and an ordered list of **steps**.

```ts
{
  id: 'atmosphere',
  title: 'Get the atmosphere scrubber running',
  done: (w) => w.services.get('scrubber')?.state === 'active',
  steps: [
    { id: 'raise-target', pending: (w) => !breathable(w), rungs: [...] },
    { id: 'start-it',     pending: (w) => !running(w),    rungs: [...] },
  ],
}
```

Steps are what make a hint feel like it is watching rather than reciting. The
book asks each step's `pending` in order and hints about the **first one still
true**. A player who has already fixed the config gets nudged about starting
the service — not told a third time to edit a file they already edited.

Escalation is counted **per step**, so progress earns a fresh nudge rather than
inheriting the bluntness of the last problem. That is deliberate, and there is
a test named for it.

Each step's `rungs` go `nudge` → `direction` → `command`:

| Tier | Says |
|------|------|
| `nudge` | Where to look. Names no file, no flag, no command. |
| `direction` | What the mechanism is, and which file or unit it lives in. |
| `command` | The literal line, in a `command:` field as well as the prose. |

A rung may carry `track: 'cadet'` or `track: 'operator'`. Cadet ladders get an
extra `direction` rung for machinery an Operator already knows (`man`, `cat`,
what a service *is*). The validator checks **each track separately**, because a
lopsided ladder strands exactly one kind of player and is invisible otherwise.

---

## Why `command:` is a separate field

```ts
{ tier: 'command', command: 'sudo systemctl start scrubber', lines: ['    sudo systemctl start scrubber'] }
```

Prose cannot be tested. The field can: `games/wreck/test/wreck.test.ts` drives
a real machine to each step, asserts the step is pending, runs the `command`
string through the actual shell, and asserts the step stops being pending.

**A hint that has drifted out of date now fails CI instead of stranding
somebody at two in the morning.** Any adventure that adds a ladder should copy
that test; it is about twenty lines and it is the most valuable test in the
content layer.

It is also the string a tappable "do it" chip would send, which matters more on
a phone than on a keyboard.

---

## Validation

`assertObjectives` runs in the `Questbook` constructor, so broken content
throws at boot rather than going quiet at the moment somebody needs help. It
catches duplicate ids, empty ladders, rungs that escalate backwards, a ladder
that never reaches the command, a `command` rung with no `command`, a
`requires` naming an objective that does not exist, and requirement cycles.

Run `validateObjectives` directly in a content test to get the list instead of
a throw.

---

## Voice

Hints are diegetic: the ship's daemon is talking, not a tooltip. The speaker
name is one option on `questCommands`, so the voice can be recast without
touching a ladder.

> ORACLE: The scrubber did not just fail. It refused.
> ORACLE: It said why, at the time, and this ship writes everything down.

Write the `nudge` as something a character would say and the `command` as
something an engineer would say. The tier is the register, not just the
specificity.

---

## Determinism

`Questbook` holds no clock and no randomness. `snapshot()` / `restore()` carry
the reveal state, so a save remembers what it had already told you, and two
players who type the same things see the same hints in the same order. Same
rule as the Machine — see [DECISIONS.md](DECISIONS.md).
