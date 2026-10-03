# Game 5 repass — ML fundamentals in *The Containment*

**Beats for the repass Chris set on 2026-10-03. Draft 1, a proposal.** Nothing
here is built. §8 is his to overrule cheaply.

*The Gradient* is no longer a separate game, so its curriculum (loss,
gradients, overfitting, validation) comes here. *The Containment* already
teaches evaluation: reading a model, measuring it, and finding the number was
never compared to anything. The repass adds the other half, which is **making
one.**

Practical AI (LLMs, agents, tools, skills, weights, prompt injection) is game
9's and is not in this repass. `ask-it-nicely` stays as built.

---

## 1. The gap this fills, in the story

As built, the act ends with `the-honest-number`: a clean split, the vendor's
model re-scored, and a figure Kerr can file. Oduya concedes. The tow is still
contested.

That leaves the insurer one argument, and it is a good one:

> **The classifier was poor. No classifier could have done better from those
> records. The determination was the best available.**

Kerr will not let DeWitt answer that with an opinion. *Bring me the method.*
So he has to find out for himself whether anybody *could* have done better,
which means building a model from the insurer's own training data. That
question is the whole repass, and the story asks it rather than a tutorial.

**The answer is the best finding in the act:** no model could have done
better, because **the records contain no field that measures whether anyone is
aboard.** `dataset.ts` already says so about NAV-7's row ("the row has no field
for it"). The repass lets the player *prove* it. A model trained honestly
learns the base rate and nothing else. A model that seems to learn more is
memorising, and validation catches it.

So the insurer's defence collapses in the other direction. The determination
was not the best available; **no determination was available.** Kerr can file
that, and it is stronger than "the vendor's model was bad".

## 2. Why this fits the act, not just the syllabus

- **It is objective 5 again, from the inside.** The first thing gradient
  descent learns is the bias, and the bias is the base rate. The player watches
  their own model rediscover "always abandoned" one step at a time. They have
  already written that model by hand.
- **Overfitting is the leak again, from the inside.** In objective 6 the
  vendor's score was inflated by records the model had already seen. In the
  repass the player's own model scores well on records it has seen and badly
  on the ones it has not, and it is their mistake this time, caught by their
  own validation set. Same failure, now one they can feel.
- **Loss is calibration with teeth.** Objective 8 shows the model was 0.97
  sure when it was wrong. Log-loss is the measurement that charges for that:
  accuracy forgives a confident wrong answer and loss does not.

## 3. The spine, as revised

Objectives 1–8 are unchanged. Three are added before the last one, and the
last one is re-scoped. **Twelve required, two optional**, against nine for
every other game. §8 item 1 is whether that is too long.

| # | id | Teaches | Closes when |
|---|----|---------|-------------|
| 1–7 | *(as built)* | tokens, attention, accuracy, base rate, leakage, the matrix | *(as built)* |
| 8 | `not-confidence` | calibration **and log-loss** | The confidence on the wrong answers is measured, and the vendor's mean log-loss is written next to the constant model's |
| 9 | `downhill` | the loss, the gradient, a learning rate, training a model by hand | His own model's loss, written per step, falls, and ends no worse than the constant model's |
| 10 | `it-learned-the-paperwork` | overfitting | A model whose training loss is far below its loss on held-out rows, with both numbers recorded |
| 11 | `hold-some-back` | train / validation / test, early stopping | A validation split exists, the stopping point is chosen on it, and the test split is scored once |
| 12 | `the-honest-number` | writing it up | *Re-scoped:* the vendor's clean figure **and** his own model's, and the statement that neither beats the base rate on crewed vessels |
| — | `ask-it-nicely` *(optional)* | *(as built)* | *(as built)* |
| — | `what-she-is` *(optional, secret)* | *(as built)*, plus §6 | *(as built)* |

Goals read files, never commands, as everywhere else. Each new objective needs
its `routes` and `nearMisses` declared and run by the harness.

### 8. `not-confidence`, extended

Log-loss is one line of Python per row. The player computes it for the vendor's
scored file and for a constant model that always says the base rate. The
generator has to make the constant model's loss come out **at or below** the
vendor's, so loss gives the same verdict as objective 5 by a different route.
That is a dataset requirement, not a guess about the current rows: §7 item 3.

### 9. `downhill` — the one that does the teaching

Logistic regression in plain Python: a weight per feature, a bias, the sigmoid,
the loss, and the gradient worked out by hand as *which way, and how much,
each weight should move*. The player writes the loop and logs the loss at each
step to a file. The goal reads the file: the loss falls, and it ends at or
below the constant model's.

The bias does nearly all of the work and the weights on `transits` and
`lastFiling` stay near zero. **That is the finding, and the player should be
allowed to notice it before anybody says it.** The model has learned the base
rate, because that is everything those columns contain.

A learning rate set too high makes the loss climb or oscillate. That is a hint
rung and a near-miss, not an objective: the goal reads "falls", and an
exploding log does not satisfy it.

### 10. `it-learned-the-paperwork`

Now give the model more to work with: the filing class and grant code as
one-hot columns, a small training sample, and many steps. Training loss goes to
nearly nothing. Loss on rows it never saw goes up. Recording both numbers
closes the objective.

The player has rebuilt the vendor's failure by hand: a model that learned what
the paperwork looks like, not who is aboard. It should feel like objective 6
again, and this time it is their own mistake.

### 11. `hold-some-back`

Split the training file three ways. Train on one part, pick the step where
validation loss is lowest, and score the test part **once**. The goal checks
that the three splits do not overlap (the player has learned to look for that),
that the chosen step is the validation minimum, and that a test score exists.

### 12. `the-honest-number`, re-scoped

Same rule as before: a figure and a method, never a verdict. It now carries
two figures. One is the vendor's on a clean split. The other is the best his
own honest model reaches, which matches the base rate and finds no crewed
vessel. Kerr files the sentence, not DeWitt: *the records do not contain the
information the determination claims to have drawn from them.*

The near-miss for "the tow was illegal" stays, and so does Oduya.

## 4. Kerr's line

One new line in the cold open of the repass beat, at the point the insurer's
answer arrives:

> KERR: Their answer is that nobody could have done better. It is a good
> answer. It is also a claim, and you know what I do with claims.

And when he files:

> KERR: You built the thing they said could not be built, and it could not be
> built. That is a finding. I can use a finding.

## 5. LUNA

She is a model watching him train one. Two beats, both short, and neither a
repeat of game three's confident error:

- At `downhill`, when the bias moves and the weights do not: something close
  to *"It found out most ships are empty. That's all it found out. I would
  like it noted that I was not trained on shipping records."*
- At `it-learned-the-paperwork`: she recognises the shape. She has been
  corrected by Vasquez's edits for eleven years (game 4) and she asks, without
  answering it, whether any of what she knows is the paperwork.

That second beat feeds `what-she-is` without resolving it, under the same rule
as games 4 and 5: the finale needs a partner with something left to be.

## 6. `what-she-is`, touched lightly

No change to the objective. One added line if the player has done
`downhill` first: she knows now that she was made by something like the loop he
just wrote, run for far longer, by people who are dead. That is a fact she
can hold, and the beat still does not say what it means.

## 7. Engine work, from a probe on 2026-10-03

Probed before writing this, per policy, with `NodePythonRuntime` against a
real Machine:

1. **`random` is not deterministic. This is a bug and it comes first.**
   `import random; print(random.random())` gave a different value on every
   run, within one Machine and across two. Rule 1 says the Machine is
   deterministic, and the Python bridge pins `time.time()` but not the seed.
   Any player who shuffles a split or initialises weights randomly gets a
   different answer each run, which is the `sys.modules` bug from game 3 in
   a new costume. **Fix in `packages/python/src/bridge.ts`:** seed `random`
   per command from a constant, or from the virtual clock, and add a test
   that is watched to fail without it. String `hash()` is already stable,
   so the hash seed is already pinned.
2. **Training is fast enough on a laptop.** Plain-Python logistic regression on
   2,000 rows, 4 features, 200 full passes: **1.4 s** under Node, and two runs
   are byte-identical. A phone will be several times slower. The objectives
   should be designed for about 1,000 rows and 100 passes, and **timed on a
   real phone before content is built on them**, the same gate as Phase 2.
3. **The dataset needs one change.** Today `transits` and `lastFiling` are
   pure noise, which is exactly right for §1's finding and must stay. The
   generator also has to guarantee (a) the constant model's log-loss is at or
   below the vendor's, and (b) a one-hot model on a small sample overfits
   visibly. Both get asserted in `dataset.ts`'s test, like the existing four
   numbers. The existing four must not move.
4. **No NumPy.** It is not bundled (`import numpy` fails), and adding it means
   megabytes in an offline app. Plain Python is also better teaching here: the
   gradient is a line the player wrote, not a call.
5. **No new package.** `packages/ml` stays the model the player inspects.
   Training is what the player does in their home directory, the same split
   as the metrics in GAME5_BEATS §8.

## 8. Open for Chris

1. **Twelve required objectives.** Every other game has nine. The alternative
   is to fold `hold-some-back` into `it-learned-the-paperwork`, which makes
   eleven, but validation then arrives as a fix rather than a discipline. I
   would keep twelve.
2. **"No determination was available" as the finding.** It is stronger than
   the current ending, and it moves the act from "the vendor was sloppy" to
   "the question could not be answered from those records". That is a bigger
   claim, and it is Kerr's to file rather than DeWitt's. Cheap to reject now.
3. **The shortcut is the vessel type in the code and the grant code in
   GAME5_BEATS §2.** `glassbox.ts` and `dataset.ts` key the model on `tender`;
   the beats doc says grant prefix. The code is what plays. The repass uses
   both columns as one-hot features, so it works either way, but §2 should be
   corrected to match the code.
4. **The `random` fix (§7 item 1) is an engine bug, not content.** It can ship
   on its own ahead of any of this.
