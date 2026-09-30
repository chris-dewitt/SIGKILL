# Game 5 — **The Containment**

ML fundamentals, evaluation, and AI fluency. The fifth adventure, and the one
where DeWitt stops reading what people decided and starts reading what a
*model* decided, and finds out that nobody ever checked it.

> **Curriculum authority.** `docs/STORY_AND_GAME_PLAN.md` §3 stage 5: *"ML
> fundamentals, modeling, evaluation, AI fluency, prompting — test claims,
> assess datasets and models, understand uncertainty and limitations."*
>
> `docs/PLAN.md`'s adventure table still lists **The Containment** at slot 4 and
> **The Fork** at slot 5. The swap argued in `GAME4_BEATS.md` §8 is now built:
> game four is The Fork, shipped and tested. The table is the thing that is out
> of date, for the third time, and the story plan has won every one of these.

---

## 1. Where game four left him

- Kerr filed a **documented sequence with an unreviewed control**. Not
  negligence — she was explicit that there is none in the sequence.
- The tow is **contested**, and will be for a long time.
- He has three commits, tagged, in a repository Pell's office holds: the
  sandbox widened, the assembly reading through the gap a year later, and the
  check deleted at 02:14.
- He has a commit of his own, on a branch of his own, restoring Chen's guard
  four years and seven months late.
- If he followed the optional thread, LUNA has read eleven years of somebody
  changing her and being kind about it, and has not worked out what she thinks.

What he still does not have is **why anybody was allowed to tow an occupied
ship**. Kerr's filing makes the tow contested; it does not explain it.

And the answer has been sitting in front of him since Act I, in a field nobody
read twice:

```
DECLARED_BY=AUTOMATED
```

That is the door.

## 2. The premise

**A model declared NAV-7 empty. Nobody ever checked whether it could tell.**

The salvage insurer runs an occupancy classifier over transit records: given a
vessel's traffic, filings and telemetry summary, it reports *crewed* or
*abandoned*, and an abandoned hull can be lawfully taken. It reported abandoned
for NAV-7 on the morning of the sixth. That report is the entire legal basis of
the tow, and it is four years old, and its accuracy has been quoted in three
filings as **99.2%**.

It is 99.2% accurate. It is also useless, and those are not in tension — which
is the whole adventure.

Two findings, and the second one is the better one:

1. **The test set is contaminated.** The evaluation split was drawn after
   deduplication was skipped, so records the model trained on appear in the set
   it was scored against. The quoted number measures memory, not judgement.
2. **The model is not looking at occupancy at all.** In the glass box, the
   attention head that drives the decision keys on the *grant code prefix* in
   the filing header — and research vessels under a private grant file
   differently from commercial traffic. It learned "this kind of paperwork means
   nobody is aboard", because in its training data that was nearly always true.

Nobody lied. An insurer bought a classifier, a vendor reported the number their
harness produced, and a number that was computed correctly answered a question
nobody had asked. **This is the same shape as game four one turn further on:**
The Fork was two correct decisions producing a third thing nobody chose; this is
one correct measurement of the wrong quantity.

**Why ML and not more git.** A repository records intent. A model records
*nothing* — it has no message, no author, no date, no reason. The only way to
find out what it is doing is to measure it, and the only way to measure it is to
build the thing that measures it. That is the curriculum, and it is also why
this act cannot be solved by reading: there is nothing in here to read.

## 3. Where, and who

**A hearing annexe on Ferryman's Rest**, with a terminal the tribunal has
granted him read access to under disclosure. Three weeks after the deposit
office.

| Voice | Function |
|---|---|
| **KERR** | Present now, not corresponding. She got him the disclosure and she is the reason it is bounded. She will not help him interpret anything and says so. |
| **LUNA** | Travels with him. This act is strange for her in a way §7 covers: she is a model being asked to help audit a model. |
| **ODUYA** | The vendor's evaluation engineer, by written answer only. Not a villain. She reports what her harness reported, and when DeWitt shows her the leak she says the most honest thing anybody says in the act. |
| **The classifier** | `occupancy-v4`. Has no voice, which is the point. |

## 4. The artefacts

Everything authored. Nothing is fetched, nothing is trained at runtime, and
`packages/ml` supplies the model.

| On disk | Teaches | The finding |
|---|---|---|
| `vocab.txt` — the tokenizer's whole table | tokens are a lookup, not words | The model never saw a sentence. It saw integers. |
| `occupancy-v4/weights` + the glass box | embeddings, attention, next-token | The head that decides is reading the grant prefix. |
| `train.csv` / `test.csv` — the splits as shipped | train/test discipline | 41 records appear in both. |
| `report.md` — the vendor's own eval | accuracy, base rates | 99.2%, and a base rate of 98.8% abandoned. |
| `labels.csv` | confusion matrix, precision/recall | It has never once correctly called a crewed vessel. |
| `calibration.csv` | confidence is not correctness | It reports 0.97 on the cases it gets wrong. |
| `NAV7.row` — the actual input, that morning | the whole act, in one row | Everything about it is ordinary except the grant code. |

## 5. The spine — nine objectives, two optional

Goals read state: files he writes, models he runs, scripts he leaves behind.
Never the command. Python is the tool throughout — he learned it in game three
and used it to drive `bisect` in game four; here he uses it to *measure*.

| # | id | Teaches | Closes when |
|---|----|---------|-------------|
| 1 | `what-it-was-asked` | reading a model card, `cat`, tokenization | The exact input row for NAV-7 is recorded, and its tokens |
| 2 | `a-token-is-a-number` | vocabulary, `<unk>`, encode/decode | He has shown what the model actually received, unknowns included |
| 3 | `look-inside` | attention, the glass box | The head driving the decision is named, with what it attends to |
| 4 | `the-number-they-quoted` | accuracy, reproducing a result | He reproduces 99.2% himself, from their split |
| 5 | `the-base-rate` | base rates, the null model | A constant "always abandoned" scores 98.8%, written down |
| 6 | `both-sides-of-the-split` | leakage, dedup, hashing | The overlapping records are found and counted |
| 7 | `the-matrix` | confusion matrix, precision/recall | Per-class numbers, and the recall on *crewed* |
| 8 | `not-confidence` | calibration | The confidence on the wrong answers, measured |
| 9 | `the-honest-number` | evaluation harness, writing it up | A clean split, a re-scored model, and a figure Kerr can file |
| — | `ask-it-nicely` *(optional)* | prompting, and its limits | Prompt variations change the output; the *decision* does not |
| — | `what-she-is` *(optional, secret)* | see §7 | — |

### Objective 5 is the one that does the teaching

The player reproduces 99.2% in objective 4 and feels good. Then they write nine
lines that always answer "abandoned" and score 98.8%, and the whole quoted
achievement collapses into **0.4 percentage points**. Nothing was falsified. The
number was just never compared to anything.

That is the act's thesis and it wants to arrive as arithmetic the player did
themselves, not as a line of dialogue.

### Objective 9 must not be a verdict

Same rule as The Fork. He produces a figure and a method; the argument is
Kerr's. A near-miss exists for writing "the tow was illegal" — which may even be
true and is still not his to file.

## 6. Oduya

She answers once, in writing, and she is the reason this act is not about a
villain:

> I ran the harness we were given. The split came with the dataset. I did not
> write the dedup step and I did not know there wasn't one.
>
> You are right. I have re-run it on your split and I get sixty-one percent, and
> on crewed vessels I get almost nothing, and I have known how to check that for
> nine years and I did not check it, because the number came back high and I had
> four other models to score that week.
>
> I am going to put that in writing to my employer. I would rather you heard it
> from me first.

Nobody in this series is wicked and this is the clearest case of it: a competent
person, a correct computation, and no time. **Her admission must not resolve the
act** — the tribunal still has to decide, and the tow is still contested at the
end.

## 7. `what-she-is`

LUNA is a model, helping audit a model, in an act whose lesson is that a model's
confidence says nothing about whether it is right.

The optional objective is running the glass box **on her own architecture** —
`packages/ml` is the same engine — and finding that her attention is legible in
exactly the same way the classifier's is. What she does with that is the beat.

She does not conclude that she is "just" a mechanism, and she does not conclude
that she is more than one. She notices that she has spent four games saying "I
do not know" and meaning it, and that the classifier said 0.97 and did not, and
that she cannot tell from the inside which of those she is doing right now.

**Same rule as game four, for the same reason.** She does not resolve it. Stage
7 needs a partner with something left to be, and a companion who has finished
having feelings about her own nature in game five arrives at the confrontation
with nothing. Flagged here because it will read as a liberty, and it is a
deliberate one.

## 8. The engine — `packages/ml`

Landed and probed ahead of this document, per policy, and the probe answered the
three questions that mattered:

1. **Does a hand-built circuit survive layer norm and softmax?** Yes. Every
   position but the first attends to its predecessor with better than 0.5 of its
   weight, and the rendered matrix is the offset diagonal the mechanism implies.
2. **Is it legible on a phone?** Yes — two heads, twelve positions, and a
   shaded matrix that fits in 34 columns.
3. **Is it deterministic?** Yes, and there is no unseeded sampling path at all.

What this act still needs from the engine, and does not have yet:

- **A classifier head.** Everything so far is next-token. `occupancy-v4` reports
  two classes, which is a different read of the same logits and a small
  addition.
- **A metrics module.** Accuracy, confusion matrix, precision, recall and
  calibration bins. Deliberately *not* in `packages/ml`: the player is supposed
  to write these in Python, and an engine that already had them would be doing
  objectives 4 through 8 for them. What belongs in the package is the model;
  what belongs in the player's home directory is the measuring.
- **A spurious-feature circuit.** §2's second finding needs a constructed head
  that attends to the grant-code token rather than the occupancy tokens. This is
  the same construction as `sameTokenHead` pointed at a different column, and it
  is the one piece of authored weight-setting this act adds.

## 9. Open decisions for Chris

1. **The insurer's classifier as the cause.** This makes `DECLARED_BY=AUTOMATED`
   — planted in Act I, named in game three — the thing the whole tow rests on.
   It is the tightest available link between the curriculum stage and the story,
   and it is reversible cheaply today.
2. **Oduya's admission.** §6. A named person conceding error, in writing, in an
   act about nobody being wicked. She could also simply not answer, which is
   bleaker and possibly truer.
3. **`what-she-is`.** §7, and the one beat that touches stage 7.
4. **Is 0.4 points too neat?** 99.2 against a 98.8 base rate is a very clean
   number. Real leakage is messier. I think the cleanliness is the point — it is
   what makes the arithmetic land on a phone — but it is the kind of tidy that
   can read as authored.
