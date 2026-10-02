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

| # | id | What it teaches |
|---|---|---|
| 1 | `the-floor` | `ssh`, `systemctl status`, reading an inventory you were not given |
| 2 | `why-it-will-not-start` | `journalctl`, a unit file, `Requires=` |
| 3 | `the-check-that-lied` | `curl` exits 0 on a 500 — the whole act's pivot |
| 4 | `put-it-back` | rollback: the previous config, restored, verified |
| 5 | `not-a-dns-problem` | telling three failures apart before touching anything |
| 6 | `ship-it` | `scp`, restart, verify from outside |
| 7 | `after-the-reboot` | `After=` is ordering and not a dependency |
| 8 | `serve-the-matter` | the job: a deposited file retrieved end to end |
| 9 | `the-handover` | the journal turned into a record somebody else can read |

Optional:

| # | id | What it is |
|---|---|---|
| A | `clean-hands` | prove, from the system, that he did not touch his own matter |
| B | `where-she-cannot-go` | establish the boundary LUNA sits behind, and why |

### Objective 3 is the one that does the teaching

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

### Objective 9 must not be a verdict

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

What it needs, in the order a game would want it:

1. **`/etc/hosts` and a resolver** — resolution as a file the player can read,
   edit and break, instead of one map lookup inside `Network.resolve()`.
2. **`dig` / `host`** — asking the resolver a question and seeing its answer,
   which is the only way DNS becomes teachable rather than magic.
3. **`ss` / `netstat`** — what is listening, which is also the honest answer to
   half the questions this act's objective 5 raises.
4. **`ip addr` / `ip route`** — addresses and routes as state.
5. **A firewall** — the first thing that can *deliberately* refuse, as distinct
   from the three accidental failures.

TLS last and possibly never: a trust store the player can inspect is a good
lesson, and a simulated handshake they cannot verify is a bad one.

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
