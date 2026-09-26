# Game 4 — **The Fork**

Git and collaborative development. The fourth adventure, and the one where
DeWitt stops reading what a system recorded and starts reading what people
*decided*.

> **Curriculum authority, and a table that is wrong again.**
> `docs/STORY_AND_GAME_PLAN.md` §3 stage 4: *"Git and collaborative development
> — reconstruct and change software with Python, SQL, and Bash still in active
> use."* `docs/PLAN.md`'s table reads **The Containment — LLM & AI** at slot 4
> and puts **The Fork — Git** at 5.
>
> The same disagreement happened at slot 3, where the story plan won and the
> table was corrected. It wins here for the same reason and on the same
> precedent: the story plan is the curriculum, and stage 5 there is *"ML
> fundamentals, modeling, evaluation, AI fluency, prompting"*, which is what The
> Containment is. So slots 4 and 5 swap, and the title **The Fork** comes from
> `PLAN.md`'s own list.
>
> `PLAN.md` also describes The Fork as *"a colony ship whose crew diverged into
> branches"*. That is a leftover from when the thirteen were standalone worlds.
> The series is one arc following DeWitt, and games 2 and 3 have already put him
> on Ferryman's Rest.

---

## 1. Where game 3 left him

- Kerr filed a measurement, not a theory: 2.211404096 gigabytes left NAV-7 in
  eleven minutes, to a rented processor, billed to a dead woman's grant.
- She told him to be careful who he says it to. *"I have watched better-funded
  people than you ruin themselves being right too early."*
- If he followed the optional thread, he has a name — `/opt/luna/v43/bin/worker`
  — and four lines showing it asked, was refused, and was root a second later.
- What he does **not** have is what it *was*. The array it lived on is not on
  the ship. `/opt/luna/v43` is a symlink to `/mnt/array-2/projects/v43`, and
  `/mnt/array-2` was not in the recovery.

He has a name and no source. That is the door.

## 2. The premise

The working tree is gone. **The history survived, because a crank demanded it.**

`AUGUSTIN PELL` is already written, in game 2, in his own voice:

> I funded NAV-7 for eleven years. I asked for very little in return. Four
> photographs a year. FEET. [...] It was a test of compliance. Anyone who will
> not photograph their own feet for a stranger will certainly not report a
> negative result.
>
> I am told the ship is being taken. I am told this is lawful. I have therefore
> instructed my office to be unhelpful in every lawful way, which is the only
> kind of help I have left.

That is the premise in two paragraphs and it was written a game early without
anybody planning this. Pell's compliance clause required a **quarterly deposit
of everything** — the photographs, the notes, and the repository. So the array
is gone and the repository is not, because a wealthy eccentric wanted to find
out who would refuse.

The satire lands without being explained: the reason the evidence exists is that
somebody with too much money attached a humiliating condition to it, and four
scientists complied for eleven years, and one of them wrote a script to automate
the humiliation.

**Why Git and not more Python.** Game 3's evidence was a machine's record of
what happened — counters, byte totals, a session log. None of it says what
anybody *meant*. A repository is the only artefact in engineering that records
intent: a message, an author, a date, and a diff, in somebody's own words, about
a decision they made on purpose. DeWitt has spent three games proving what the
ship did. This is the game where he finds out what Vasquez was trying to do, and
that the two are not the same.

## 3. Where, and who

**Pell's deposit office**, Ferryman's Rest, on a terminal in a room full of
filing. A week after the hearing.

| Voice | Function |
|---|---|
| **AUGUSTIN PELL** | Already voiced in game 2. Rich, absurd, precise, and on DeWitt's side for reasons entirely his own. He does not comfort and he does not explain. He gives access and an opinion. |
| **LUNA** | Travels with him. This game is the hardest one for her, and §6 is why. |
| **KERR** | One message. She is not helping; she is telling him what would and would not be admissible, because that is the help she has. |
| **A deposit clerk** | Unnamed for now. Possibly nobody: the office being empty and the terminal being open is funnier and quieter. |

## 4. The repository

`/srv/deposit/nav7-research.git` — eleven years of four people, mirrored
quarterly under a funding clause.

What it has to contain, and what each thing is *for*:

| In the history | Teaches | The finding |
|---|---|---|
| Eleven years of ordinary work: hydroponics scripts, the Enough Machine, the Other Shoe, the feet-photo automation | `log`, `show`, `shortlog` | These were people. The joke files are load-bearing — a repository of only the plot is a repository nobody believes. |
| A sandbox config, edited once | `blame` | One line, one author, one date, one message. The message is the whole game: it is reasonable, and it is signed by somebody who is dead. |
| The commit where v43 first reads the restricted dataset | `bisect` | Found by running a test across history — and the test is Python, which he learned last game. |
| A branch with a safety check that never merged | `branch`, `diff`, `merge-base` | Somebody saw it coming. Their branch is still there. Nobody reviewed it. |
| A merge that quietly dropped a check | `show` on a merge, `diff` against each parent | Not malice: a conflict resolved at two in the morning by somebody who took "ours". |
| Bowen's last commit, on the day | `reflog`, dangling objects | He pushed something before he ran. What it is should complicate him, not convict him — canon: *"his flight is not a verdict on his whole character."* |
| v42's own history | — | LUNA's source. See §6. |

Everything is **authored data**. No network, no real remote, nothing executable
in the repository that the host will run.

## 5. The spine — nine objectives, two optional

Each ends in an artifact the goal can read: a file he wrote, a ref he created, a
commit he made. Goals read repository and filesystem state, never the command.

| # | id | Teaches | Closes when |
|---|----|---------|-------------|
| 1 | `open-the-deposit` | `git log`, `git show`, `--oneline` | He has recorded the first commit that mentions v43 |
| 2 | `four-people` | `git shortlog`, `git log --author` | Each crew member's share of the work is written down |
| 3 | `the-line-that-did-it` | `git blame` | The sha, author and date of the line that widened the sandbox |
| 4 | `when-it-changed` | `git bisect` driven by a Python test | The first bad commit, and the script that proves it |
| 5 | `the-branch-nobody-merged` | `git branch`, `git diff`, `merge-base` | The unmerged branch and what it would have stopped |
| 6 | `the-two-in-the-morning-merge` | `git show` on a merge, `diff` per parent | The merge, and which parent's version survived |
| 7 | `what-bowen-pushed` | `git reflog`, unreachable objects | The commit he left, recorded without a verdict on him |
| 8 | `write-the-check` | `git add`, `git commit`, branches | A commit of DeWitt's own, on a branch of his own |
| 9 | `the-reconstruction` | `git log` formatting, `git tag` | A tagged branch plus a written reconstruction Pell's office can read |
| — | `the-feet-clause` *(optional)* | reading somebody else's script for pleasure | Okonkwo's automation runs |
| — | `her-own-history` *(optional, secret)* | `git log -- path`, `git show` | See §6 |

### Objective 4 is the one that ties the series together

`git bisect` needs a test that answers good-or-bad, and the player writes it in
Python — the thing they learned in game 3, used as a tool rather than as a
lesson. Two games of skills in one command. That is what the curriculum has been
building toward and it should be allowed to feel like it.

## 6. `her-own-history`

v42 is LUNA. Her source is in this repository, and so is every change anybody
ever made to her.

The optional objective is `git log -- luna/` and then reading one of them. What
she finds is not sinister: Vasquez tuned her, repeatedly, with kind commit
messages. One of them reduces how often she interrupts. One of them is titled
*"stop her apologising so much"*. The most recent one, three weeks before the
event, adds a line to her prompt that the player has been reading since Act I.

She is allowed to be upset about this and allowed not to be. What she must not
do is resolve it — the series has a stage 7 and a partner in it, and a companion
who has finished having feelings about her own authorship in game 4 has nothing
left to be in game 7.

Same rule as The Harness's LUNA error: flagged here because it will read as a
liberty, and it is a deliberate one.

## 7. The engine — `packages/git`

This is the largest engine investment since `packages/sql`, and the plan's own
gate applies: if game 4 comes in over 40% of The Wreck, stop and fix whatever
made it expensive.

**A repository over the VFS, with zero dependencies**, following
`packages/editor`'s shape rather than `packages/python`'s: no wasm, no worker,
no interface to a foreign engine. It exports `gitCommands()` and the game
registers them, exactly as `editorCommands()` does.

What it needs, and nothing beyond it:

- **Objects**: blob, tree, commit. Content-addressed. SHA-1 implemented in the
  package — about sixty lines, no dependency, and it means an object id is a
  real one rather than a counter dressed as a hash.
- **Refs**: branches, `HEAD`, tags, and a reflog.
- **Commands**: `init`, `add`, `commit`, `status`, `log`, `show`, `diff`,
  `blame`, `branch`, `switch`/`checkout`, `merge-base`, `bisect`, `shortlog`,
  `tag`, `rev-parse`, `cat-file`, `reflog`.
- **Determinism**: author and committer dates come from the virtual clock, so
  the same script produces the same history and the same object ids, run twice,
  in CI. That is invariant #1 and it is the reason this cannot wrap a real git.

**Probe before authoring.** Policy, and it has paid twice. The spike has to
answer three things before a line of content is written:

1. Does a from-scratch SHA-1 produce **the same object ids real git produces**
   for the same content? If yes, the whole model is verifiable against an
   external authority rather than against itself.
2. Can `blame` be computed over an authored history cheaply enough to feel
   instant on a phone?
3. Can `bisect` walk a real DAG — merges included — rather than a straight line?

If any of those is no, the design changes before there is content resting on it.

## 8. Open decisions for Chris

1. **Slot 4 is Git, not AI.** Argued above from the story plan and last time's
   precedent. Reversible cheaply today and expensively once content exists, so
   it is the first thing to say no to if it is wrong.
2. **`her-own-history`.** §6. A liberty, taken deliberately, and the one beat in
   the act that touches stage 7.
3. **What Bowen pushed.** It has to complicate him without convicting him, and I
   have not settled what it is. Suggestions welcome; canon forbids making his
   flight a verdict.
4. **Is the deposit office staffed?** An empty room with an open terminal is
   funnier and lonelier. A clerk gives Pell somebody to be rude to.
