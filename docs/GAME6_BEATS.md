# Game 6 — **The Deposit**

Operations: systems with dependencies, failures that have to be observed before
they can be fixed, deploying and rolling back. The sixth adventure, and the
first in which DeWitt is responsible for something **staying up** rather than
for working out what was true.

> **Curriculum authority.** `docs/STORY_AND_GAME_PLAN.md` §3 stage 6: *"Cloud,
> DevOps, deployment — operate and change systems with dependencies, observe
> failures, deploy and roll back."*

---

## 1. Where game five left him

- The tow is **contested** and will be for a long time. Nothing he established
  in the annexe decided it; it made the question answerable.
- Kerr files method, not verdicts: *"the determination rests on a measure that
  does not distinguish the model from a constant."*
- Oduya filed her own account before anybody made her, and Kerr said that will
  matter more than anything either of them does.
- He has, across five games, become very good at establishing what is true and
  has never once been the person who has to keep a thing running.

That last line is the whole of why this game exists here.

## 2. The premise

Pell's deposit office — the same office that held the repository in game four —
runs the machines that hold deposited evidence for every contested matter in the
district. Hundreds of them. The infrastructure is old, under-funded and badly
documented, and the person who understood it has gone.

They hire DeWitt. Not because he is a party to one of the matters, but because
he is cheap, he has been in and out of their systems for a year, and nobody else
will take it.

**The evidence for his own tow is on those machines.** He did not choose that.
It is simply what is there, filed between four hundred other people's.

So the job comes with a rule, and the rule is the act:

> An operator may make the record available. An operator may never make the
> record convenient.

He has root on the thing his own case depends on. The temptation is not to
falsify anything — he would not, and the game should never suggest he would. The
temptation is smaller and much more real: **to look, to tidy, to fix a thing
that is only broken for him.** The lesson is that the record is worth something
precisely because the person holding it up did not touch it, and that *being
able to show he did not* is a technical problem with a technical answer.

Kerr's standard from game three — *tell me what it SAYS, and tell me where* —
becomes, for an operator: **the record has to be able to say it later.**

## 3. Where, and who

**The Pell deposit office, machine floor.** A bastion he logs into and three
hosts behind it:

| Host | What it is |
|---|---|
| `bastion` | Where he sits. His own account, his own scripts. |
| `vault01` | The deposit store. Files, hashes, the thing the job exists for. |
| `index01` | The catalogue service. Answers "where is matter 7714 filed". |
| `relay01` | Serves deposited material to the tribunal on request. |

Three hosts, because two is not a system and four does not fit on a phone.

**Kerr** is not his employer and does not appear often. She is the person who
will one day ask the relay for a file, and the game's pressure is the knowledge
that she will.

**Pell** is the clerk: decent, overworked, has been holding this together with
restarts for two years and is relieved to stop. He is not an antagonist. The
antagonist is **an infrastructure nobody wrote down**, which is the honest
antagonist of every operations job that has ever existed.

## 4. LUNA, intermittently

She is on `bastion`. She is not on the deposit hosts, because the deposit office
does not permit a process it did not install on machines that hold evidence —
which is the correct policy and is also, from her side, a wall.

So she can talk while he works at his own prompt, and goes quiet the moment he
`ssh`es anywhere that matters. That is:

1. **A real operations lesson.** The tooling you rely on is not on the box you
   are paged about. It never is.
2. **Characterisation that costs nothing.** She notices the boundary. She does
   not complain about it, and she does not ask him to carry her across it.
3. **A guard rail.** An assistant who can run commands on the failing host is
   an assistant who solves the puzzle. She cannot reach them, so she cannot.

She should say, once, something close to: *I can hear you typing and I cannot
see what you are typing at. I would like you to know that I do not like it, and
that the policy is right.*

## 5. The spine — nine objectives, two optional

Every number here is observed by the player from the running system. No
objective asserts on what was typed.

**Shipped**, in the order the player meets them. The ids are the ones in
`games/deposit/src/objectives.ts`; where this table used to guess at a name or
an order, it has been corrected to what exists.

| # | id | What it teaches |
|---|---|---|
| 1 | `the-floor` | `ssh`, `systemctl list-units`, reading an inventory you were not given |
| 2 | `the-check-that-lied` | `curl` exits 0 on a 500 — the whole act's pivot |
| 3 | `why-it-will-not-start` | `journalctl`, a unit file, `Requires=` |
| 4 | `ship-it` | the check edited so it would have caught this, and verified |
| 5 | `not-a-dns-problem` | telling three failures apart before touching anything |
| 6 | `after-the-reboot` | enabled is not running, and `After=` is ordering |
| 7 | `serve-the-matter` | the job: a deposited file retrieved end to end, on the record |
| 8 | `the-second-lie` | a health check that does not exercise what it checks |
| 9 | `the-handover` | the journal and the lock turned into a record somebody else can read |

Optional:

| # | id | What it is |
|---|---|---|
| A | `clean-hands` | prove, from the store's record, that he did not touch his own matter |
| B | `where-she-cannot-go` | establish the boundary LUNA sits behind, and why |

Two objectives this document named are not in that list, and both were folded
in rather than dropped. `put-it-back` — rollback — lives inside `ship-it`,
because the check is the thing being changed and its previous version is what
you compare against; a separate rollback objective would have needed a second
config broken for the purpose. The original `ship-it` (scp, restart, verify
from outside) is spread across `not-a-dns-problem` and `after-the-reboot`,
which is where those verbs actually arise.

### `the-check-that-lied` is the one that does the teaching

Pell's deploy script has checked the service the same way for two years:

```sh
curl http://index01/health && echo "index healthy"
```

It prints `index healthy`. It has printed `index healthy` every day for a month
while the index returned `500 catalogue locked` to every request, because **an
HTTP error is a successful transfer and curl exits 0.** The service has been
down for a month and the check has been green for a month, and nobody noticed
because nobody read what came back.

This is the same shape as game five's objective five: a number that was correct
and useless. Here it is a *check* that was correct and useless. The player fixes
it with `-f`, or by reading the body, or by asking for the status code — three
routes, all legitimate.

It also means the act's inciting incident is not sabotage. **It is a month of
everybody doing their jobs.**

### `the-handover` must not be a verdict

The handover is a record of what happened, generated from the journal: what
failed, when, what was done, what is still true. It must not conclude anything
about *why* the index locked, because he does not know, and because the one
thing this game is teaching is that an operator writes down what the system did.

If a player wants to speculate, the file is theirs and nothing stops them. The
goal predicate asks for the sequence and the times, not an opinion.

### `clean-hands`

The optional one worth building carefully. His own matter is on `vault01`. The
goal is **not** "do not open it" — a goal that asserts on what the player did
not do is a goal that reads the input, which this project does not do.

Instead: the deposit store records access, and the objective is to produce,
from that record, the demonstration that every file under his own matter was
read by the tribunal's account and never by his. Which means he has to *not*
have opened it, and has to be able to *show* it, and the second part is the
technical one.

A player who did open it cannot complete this objective, and should get a hint
ladder that says so without scolding: the record says what the record says.
That is the entire moral of the act arriving as an exit code.

## 6. What the engine already does

Probed before this document was written, per policy, in
`packages/machine/test/probe-net.test.ts` and `probe-ops.test.ts`. Five bugs and
one gap came out of it and all six are fixed:

- `curl -o`, `-f`, and the exit code on an HTTP error — objective 3 is
  **built on** the last of these, so it had to be right first.
- `curl` and `nc` calling a host that is down a name-resolution failure —
  objective 5 is built on that distinction.
- `Requires=` and `After=` were parsed by nobody — objectives 2 and 7.

So this act needs **no new engine package**, which is the result that chose it
over The Handshake. The engine-share curve was 77% → 18% → 8%; this one should
be lower still.

## 7. The other track — `packages/net`

Chris's call was *ops now, and start the networking engine in parallel*, so The
Handshake can be authored later against something real instead of being bent to
fit what exists.

What it needs, in the order a game would want it — **all five built, 2026-10-03**:

1. ✅ **`/etc/hosts` and a resolver** — resolution as a file the player can read,
   edit and break, instead of one map lookup inside `Network.resolve()`.
   `machine/src/net/resolver.ts`; the file wins over the map, as `hosts: files
   dns` makes it win on a real box.
2. ✅ **`dig` / `host`** — and `getent hosts`, which is the one that matters:
   dig asks the nameserver, getent asks the resolver, and when those two
   disagree the program that is failing is using the second one.
3. ✅ **`ss` / `netstat`** — what is listening *and on which address*. Ports can
   now be bound to loopback, so a service can be running, listening, and
   refusing you in the same words a closed port uses.
4. ✅ **`ip addr` / `ip route`** — a host answers to one or more addresses, every
   subnet is a /24, and routing is one hop through a box with a leg in both
   that is up *and* forwarding. Opt-in per network: this act's own ledger sits
   on 10.9.0.4 as *flavour*, and an engine that read a topology into that and
   then refused to connect would be inventing a fact.
5. ✅ **A firewall** — `iptables`, the INPUT chain, and the distinction the
   whole thing is for: REJECT is refused at once, DROP says nothing and the
   other end waits. The engine charges the player that wait.

TLS last and possibly never: a trust store the player can inspect is a good
lesson, and a simulated handshake they cannot verify is a bad one.

**`PLAN.md` says The Handshake "gets a slot when `packages/net` exists, and not
before".** It exists. Whether that is slot 7 and what moves down is Chris's
call, not one to be made by the person who happened to finish the package.

What the package deliberately will not model, recorded where the next author
will look: NAT, a forwarding chain, connection tracking, multi-hop routing,
output filtering. `packages/machine/test/probe-net.test.ts` fails if any of
them quietly arrives.

## 8. Open decisions for Chris

1. **The office hires him at all.** He is a party to one of the matters on those
   machines. A real deposit office might refuse him on that ground alone. The
   act's answer is that they are too short-handed to care and that the conflict
   is named out loud in the cold open — but "they would never" is a fair
   objection and the fix is cheap: make the matters anonymous to the operator
   and have him work out, partway through, that one of them is his.
2. **Pell as decent rather than negligent.** A month of green checks on a dead
   service is somebody's fault. The act says it is nobody's, which is truer and
   less satisfying. He could instead have known and said nothing.
3. **`clean-hands` as optional.** It is arguably the best thing in the act and
   it is currently something a player can miss entirely. Making it required
   means failing a player who opened a file in the first ten minutes out of
   ordinary curiosity, which seems worse.
4. **The title.** *The Deposit* is flat. It is also what the place is called.

---

## 9. What shipped, 2026-10-02

Written after the fact, because a spec that is quietly wrong about the thing it
specified is worse than no spec.

Eleven objectives: nine required, two optional. 35 declared routes and 34
near-misses, each one executed against a real Machine in CI. 22 hint steps,
each one's bottom rung run against a world standing on that step.

### The store, which this document did not foresee

`clean-hands` as specified above rests on "the deposit store records access",
and nothing in the engine recorded anything. With the material left
world-readable, `cat` leaves no line -- so the objective's second clause, that
the record shows no read by his account, would have been satisfiable while
reading whatever he liked. The objective would have been a lie.

So: deposited material is `0600` and owned by root, and `deposit` is a command
on `vault01` and nowhere else. It reads on the caller's behalf and appends
`<stamp> <account> <matter>/<file>` to `/var/log/access.log` **before** it
emits a byte, and refuses to serve at all if it cannot record, because a
retrieval the store cannot record is one it should not serve.

`sudo cat` goes around all of it and leaves no line. That is written down in
`store.ts`, asserted in `store.test.ts`, and is not a gap to plug: he is the
operator of the machine the evidence is on, and an engine that pretended
otherwise would teach something false about Unix. The mode bits make the
recorded path the ordinary one. They are not a cage, and the act is about what
he does when nothing stops him.

### The record had to leave the box (2026-10-03, after merge)

Found in review: the same root that lets `sudo cat` around the store also lets
him *edit the record*. Read your own matter, then on `vault01`:

```
grep -v dewitt /var/log/access.log > /tmp/a; sudo cp /tmp/a /var/log/access.log
```

Every tribunal line survives, his does not, and `clean-hands` completed. The
test that "deleting the record does not help" passed because deleting all of it
removes the tribunal's lines too; trimming one line was never tried.

The fix is what real audit logging does: ship each line off the machine as it
is written. `deposit` now appends the same line to the tribunal's **ledger** —
a host that is not on the floor, has no SSH port and no account for anybody
here, and is readable at `http://ledger/vault01` — and refuses to serve if
either copy cannot be written (both are checked before either is written, so a
refused read never leaves a ledger line). `clean-hands` reads the ledger.

He can still rewrite `vault01`'s log; nothing in the engine pretends otherwise.
It just no longer pays. `/etc/deposit/policy` and `man deposit` both name the
ledger, so the player is told where the copy that counts lives, and the
forfeit rung shows his line from there. A save from before the ledger is
restored with one, seeded from `vault01`'s record as it stands — the best that
can be done after the fact, and the argument for shipping logs in the first
place.

### He learns the number from his own post

The trap this document nearly contained: if the only way to find out which
matter is his is to open it on `vault01`, `clean-hands` cannot be discovered
without being failed. `~/NOTICE` on the bastion -- Tessaly's notice of
contest, which he has had for months -- names matter 7714 and says in as many
words that it is his copy of the docket number and not the file. A party to a
matter has their own paperwork and no right at all to the file, which is both
true and exactly the shape of the objective.

### The step that cannot be cleared

`clean-hands/and-not-you` is pending only in a world where the store has
already recorded him reading his own matter, and in that world nothing clears
it. Every other step in the series is a thing to do; this one is a thing to be
told, and its bottom rung shows him the line rather than pretending to repair
it. `hints.test.ts` documents the exception and asserts the behaviour: once his
account is in the record the objective cannot be completed -- not by writing a
file, not by copying the log, and not by deleting it.

### Three hint ladders were already broken

Found by `hints.test.ts` the day it was written, not by playing:

- `the-floor` wanted three hosts in the notes and its ladder reached two.
- `serve-the-matter/find-it` asked for the manifest's own words while its hint
  fetched a path from the index.
- `the-second-lie/break-it` asked about the notes while its hint stopped a
  service, so taking the hint changed nothing the step could see.

A hint that does nothing is worse than no hint, and all three were invisible to
the route harness, which only ever checks that a declared solution works.

### The save had to change

`AdventureSession.snapshot()` is new, and optional. The host had always called
`machine.snapshot()` itself, which is right for one machine and loses three
quarters of this act: every service repaired on another host gone, while the
questbook -- stored separately -- went on reporting those objectives as met.
The five single-machine games are untouched and their saves still open. A
game-six save with no fleet in it is refused rather than half-restored, and the
host already does the right thing with a refusal.

### What it cost

`node tools/measure.mjs`, which now knows about games four to six:

| | Total | Ratio |
|---|---|---|
| The Wreck | 19,308 | baseline |
| The Fork | 5,717 | 29.6% |
| The Containment | 3,112 | 16.1% |
| The Deposit | 3,094 | **16.0%** |

387 of those lines are outside `games/deposit`: the network probes, the
`Requires=`/`After=` parser, `snapshotFleet`, `World.network` and the host seam
above. §6 predicted an engine share lower than game three's 8% and that did not
hold -- 387 of 3,094 is 12.5%. The fleet is why, and a fleet is a thing the
engine did not have.
