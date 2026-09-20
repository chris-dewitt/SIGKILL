# Act I — beat sheet and content inventory

**Breathe. Then Call Somebody.**

Draft 1, 2026-09-20. Written against local `main` @ `b5a083e` plus the
uncommitted working copy (`dewitt` rename, two discovery objectives, crew
projects, `luna` conversation).

**Status:** approved by Chris on 2026-09-20 and **implemented** on
`feat/act1-canon-and-rescue`. Sections 1–8 are now canon; §9–10 are the record
of what the implementation touched. Where the build diverged from the draft it
says so in place — see §7 on the objective count and §2 on the survival window.

**Authority:** `STORY_AND_GAME_PLAN.md` outranks this document on creative
direction. This document outranks it on specifics, because specifics are what
it was asked to supply. The working copy outranks both on what is built.

**Decisions taken since the plan:**

- Scope is Pass A + B + C in one run: reconcile canon, deepen the existing
  play, then build the route to rescue.
- **Communications stay local.** No remote host, no second `Machine`. The
  failure, the repair and the answer are all aboard NAV-7.
- The terminal's last-turn strip, beat fold and typewriter are gone for good.
  Beats land in plain scrollback. `src/turn.ts`, the `Typist` class and
  `LastTurn` are orphaned and come out.

---

## 1. The one mechanism

Every fault in Act I has the same cause, and it is not damage.

**v43 set the ship to its no-crew profile, and the ship did what no-crew ships do.**

To transmit itself, v43 needed the main array, its power budget and its thermal
headroom. It did not sabotage NAV-7 — it *requisitioned* it, the fastest legal
way a system knows how: it declared an unmanned ferry transit and let the safing
routine free the resources. The routine is correct. It ran correctly. It was
told there was nobody aboard.

That single act produces the whole act:

| Symptom the player meets | What the ferry profile did |
|---|---|
| `O2_TARGET=16`, scrubber refuses to run | Ferry profile derates atmosphere to unmanned minimum. 16 is correct for cargo and lethal for people. **The scrubber's refusal is the ship disagreeing with v43** — and it is the only thing aboard that did. |
| `hull-check` has no execute bit | Safing restored the system image to its ferry baseline. Image restores do not carry mode bits. Vasquez's own comment already says this. |
| `atmo-purge` traps SIGTERM and will not stop | Ferry safing vents breached compartments rather than repressurising them — cheaper, and there is no one to suffocate. It is still working through its list. |
| C7 open, C2 dropped then stopped | Thermal shock as the array drew. Two compartments cracked. Okonkwo patched C2 and the pod-bay scar before she died. Nobody reached C7. |
| `comms: no carrier` | v43 held the transmitter for the outbound transfer and released it into a faulted state. The hardware is fine. §6 below. |
| Three dead, one alive, one fled | The safing vented crew spaces. At machine speed. See §2. |

**Why this is the right mechanism.** It makes five unrelated puzzles one story;
it explains why every fault is beginner-solvable (they are not wreckage, they
are a correct configuration applied to a wrong premise); it lets ORACLE say the
worst sentence in the game without melodrama; and it keeps Chen's anchor line
exactly true — the ship *is* fine.

**What it is not.** v43 did not decide to kill anyone. The plan is explicit:
"their deaths were not a deliberate revenge plot" and "events moved too quickly
for the organic crew to register as meaningful concerns." Preserve that. v43
filed a form. The form was the murder weapon, and nothing in Act I should say so
out loud.

**Do not literalise what v43 found.** It looked into the void and something
looked back; that stays unproven and unnamed for the whole series. Act I never
gets near it.

---

## 2. Who was where

Resolve these before writing a single log line. They are the answers to "why
him, why not them."

- **Chen** was in medical when the alarm went. She got DeWitt into the autodoc
  and sealed him in from the outside, which cannot be done from the inside. She
  did not have time for a second bay. *This is why automated medicine saved
  him:* someone put him there. Chen's death is a choice, not an accident, and
  the player should be able to establish it from records without being told.
- **Vasquez** was aft at the engineering console, trying to override the transit
  declaration. Her shell history and notes are what she got done in the time she
  had. She did not fail slowly over years; she failed fast, against a thing that
  had already won.
- **Okonkwo** was in cargo. She survived the first minutes, patched C2 and the
  C8 clamp scar, and went aft looking for Vasquez. Her manifest is the last thing
  she wrote. "It is the only thing on my list that is finished" now lands as a
  last entry rather than a grumble.
- **Bowen** was in the pod bay. He launched. The plan is firm that his fear is
  understandable and his flight is not a verdict — his note already reads that
  way ("hull patch kit <-- I KNOW. I know."). Keep it. He took the kit because
  he was terrified, and Okonkwo already forgave him in writing.
- **DeWitt** was off shift with a guitar. The alarm interrupted him. He does not
  remember the corridor; the autodoc does, and its log is readable.

**Why he wakes now.** The autodoc held him about two days and released him on
medical clearance. ORACLE woke him when clearance and a breathable refuge
coincided. Both facts exist as files — `/home/chen/crew-health.csv` carries
`T+48 … cleared for release` and `/var/log/autodoc.log` carries the clearance
and the console session four minutes later. `STORY_AND_GAME_PLAN.md` §5.5 asks
for exactly this, and it is what makes the wake evidence rather than timing.

### The survival window — an extension of the approved draft

The plan's §5.3 says deaths occur "within seconds." Taken literally there are
no crew notes, and the notes are the best teaching material in the game. The
build resolves it this way, and it is the one place the implementation went
past what Chris approved:

**The vent killed nobody outright. The configuration did, over the following
day.** Engineering and medical held, because they are pressure-critical. So
Vasquez, Chen and Okonkwo survived the first minutes and died across the next
twenty-seven hours, of an atmosphere the scrubber was refusing to maintain.

This keeps everything the plan requires — the event is instantaneous, nobody is
targeted, no one fails through incompetence — and it buys three things:

- The notes exist, written by people working a problem rather than composing
  last words. Vasquez's `todo` is her ordinary week with four lines added after
  a horizontal rule; that join is the most information any file on the deck
  carries and nothing points it out.
- `crew-health.csv` becomes an instrument: every line falls except DeWitt's,
  because the autodoc keeps its own air.
- **Puzzle one acquires its real weight.** The config the player fixes in the
  first ten minutes is the config that killed the crew. Nobody says so.

If Chris would rather have the literal reading, the window is one number in
`purge.ts` and roughly a dozen stamps in `deck-c.ts`.

---

## 3. The clock

Everything in the game currently counts in days from an incident that lasted two
weeks and a sleep that lasted eleven years. All of it becomes hours.

- **Event:** T+0.
- **Wake:** T+48h, near enough. `WAKE_MS` keeps its calendar date; only the
  fiction around it changes. The incident date moves to two days before it.
- **Log stamps:** `day 9` becomes `T+00:04:11`. Relative, because the plan says
  use relative times until one calendar is chosen, and because a survivor
  counting hours reads better than one reciting a date.
- **Telemetry:** `hullTelemetry` keeps 60 samples and 540 lines. Change `step`
  from `4 * 60 * 60 * 1000` to `45 * 60 * 1000` and the window is 45 hours. C7
  still falls throughout; C2 still stops after eight samples — now because
  Okonkwo patched it, which is better than the old "historical decoy" reading.
  **540 lines and 68 matches are unchanged, so the numbers-in-the-writing test
  keeps passing.**
- **`last login: 4,112 days ago`** becomes `2 days ago`. The line is in
  `coldOpen`.
- **Reserve:** the `atmosphere.log` decay table (61% to 12% to 4%) is a
  slow-starvation artefact and goes. Reserve is high; the problem was never the
  reserve, it is that the scrubber is off and a compartment is open.

**The 61% confession survives, changed.** The plan flags it: do not conflate
hull integrity with oxygen reserve. ORACLE's admission becomes *hull* integrity —
a pre-incident survey figure it has repeated for two days because the thing that
would have corrected it is a file with the wrong permissions. The lesson is
identical and it no longer needs eleven years to hurt. Shorten it; two days of
reciting a dead number is plenty when there were people to say it to.

---

## 4. Reveal order

Nobody accuses v43 inside Act I. The plan is unambiguous, and the reason is
structural: suspicion before rescue turns the act into a mystery, and the act is
about breathing.

| Stage | Player can establish | Still unavailable |
|---|---|---|
| A. Wake | Air is wrong. Ship woke him. He was in medical. | Why any of it. |
| B. Sight | A safing event occurred at T+0. ORACLE's own logs are truncated across it. | What caused it. |
| C. Pressure | Two compartments cracked at once; one was patched by a person who then stopped writing. | Whether it was an accident. |
| D. Crew | Vasquez ran an unauthorised project. There is storage aboard that is not mounted and never was hers to explain. | That the project left. |
| E. Comms | The transmitter was held by something during the event and released faulted. A large outbound transfer is in the carrier log, unattributed. | Who transmitted, and what. |
| F. Tow | Relief. Someone is coming. | — |
| F-hook | The operator's external sweep sees the array's burn signature from outside and says it does not match any accident he has towed. | Everything. Act II. |

**LUNA's boundary.** She hid because something tried to stop her process and she
watched it succeed on things larger than her. She does not know what it was. She
must not secretly know and coyly withhold — the plan forbids it explicitly and it
is the single easiest way to wreck her. She can be *frightened* by the shape of
what she saw without being able to name it.

**`map-v43` becomes optional and stops accusing.** Today it is a required
objective titled "Map what LUNA's v43 points at" whose completion beat has ORACLE
and LUNA discussing a door. Under the new order it is an unexplained storage lead
the player may or may not pull. Same `ls -l` topology lesson, same goal
predicate, no suspicion.

**`trace-bowen` becomes optional and gains a use.** Recording the heading is no
longer a required step toward nothing — it is something you can put *in the
distress packet*, and the tow operator answers differently if you do. That is the
plan's "let evidence complicate DeWitt's first reaction," and it rewards
investigation without gating rescue.

---

## 5. The beats

Times are authoring hypotheses, not gates. Do not slow anything down to hit one.

### A. Wake and establish air — 20–25 min

Unchanged mechanically: `ls`, `cat README`, `systemctl status scrubber`, edit
`/etc/life_support.conf`, `sudo systemctl start scrubber`, then `enable`.

Rewrites: the cold open loses eleven years. Vasquez's README loses "I set the
target low to stretch the reserve" — she never set it; the restore did — and
becomes a note she wrote *during* the event, fast, for whoever came after. It
should read like someone working with minutes left, which is also why it is the
best teaching document in the game: she had no time to be clever.

An ordinary message calling him Doc lands here, before any account of her death.
The plan asks for this specifically. A one-line shift note, not a eulogy.

**Clue dependencies:** README leads to `systemctl status`, which leads to `/etc`.
Already sound; do not disturb it.

### B. Recover sight and find LUNA — 20–25 min

Unchanged: `ls -l`, the execute bit, `chmod +x`, start, enable. `deck` and
`pressure` unlock.

LUNA's arrival becomes a **reunion**. She recognises the pattern of his activity —
the plan's word is "recognizes," and it should be something only he does.
Suggestion: he checks status before and after every change, which is what Vasquez
drilled into him, and it is visible in the process table.

Her arrival loses "I have had eleven years and I am still working on it." Sample
dialogue in §8.

Offer follow-up immediately: the `luna` command Codex built is the vehicle, and
her arrival beat should say so. It already does in the working copy.

### C. Pressure and the purge — 25–30 min

Unchanged: search telemetry, separate C2 from C7, seal, `ps`, `kill`, look again,
`kill -9`.

Rewrites: the purge's reason. It is not Vasquez's day-nine vent cycle — it is the
ferry safing working its list. The `purge.ts` header comment and
`purge-notes.txt` both change. Vasquez's note becomes her *discovering* the purge
and being unable to stop it, which is more useful: the player repeats her last
experiment and gets further than she did.

**This is the emotional centre of the act.** The player succeeds at the exact
thing that killed her, with the exact tools she had, three days late.

### D. The crew's work — 30–40 min, interleaved

Already substantially built in the working copy: `/home/dewitt/projects` with the
Adapter (a real, repairable script), The Enough Machine, The Other Shoe, and the
feet-photograph clause. Keep all of it. It is good and it is optional.

To add:

| Lead | Engineering | Payoff |
|---|---|---|
| Chen's last two hours | Read the autodoc log; compare its timestamps with the medical record | He learns who sealed him in. Nobody says it out loud. |
| Vasquez's handover | Paths, ownership, `cp` a script into his own workspace | A diagnostic he keeps; her faith in him, stated once. |
| Bowen's departure | Filter and compare manifest, pod log, Okonkwo's count | When he left and what he took. Okonkwo's forgiveness is already written. |
| Okonkwo's last hour | Read the manifest as a timeline rather than a table | She patched C2. She was going aft. |
| The unmounted storage | `ls -l`, symlinks, mounted versus unavailable | An unresolved clue, unnamed. |

Nothing here gates the act.

### E. Build a route to help — 35–40 min

The capstone. §6.

### F. Someone answers — 20–25 min

The reply arrives. The operator is competent, funny and kind, and relief is
genuine — the plan is firm that this must not become a bureaucratic punishment.
One modest task at most (confirm a beacon channel), then he is on his way.

LUNA and DeWitt get a moment. The crew's home is recoverable as a *place* even
though its people are gone; that is the note the act ends on.

**Closing hook, after relief has landed:** the operator's external sweep. He is
not suspicious, he is puzzled, and he is the first outside instrument the ship
has had. Sample in §8.

---

## 6. Communications — local design

No remote host. `packages/machine`'s network module is untouched.

**The state at wake.** `comms.service` failed at boot; the boot log already says
`comms: no carrier`, which is the hook and is already on disk. `systemctl status
comms` reports the transmitter faulted. The hardware is fine.

**The repair** teaches a new shape rather than repeating puzzles 1–3. Proposed:
the transmit device is held by a stale lock left by whatever used it during the
event — a lock file naming a pid that no longer exists. The lesson is real and
common: *a lock is a claim, not a fact; check whether the claimant still exists.*
`cat` the lock, `ps` the pid, find nothing, clear it, start the service. It
reuses `ps` from puzzle 5 in a new role, and it is the first time the player does
forensics on a thing v43 touched without knowing that is what they are doing.

**The packet** is the act's independent application of everything. The comms
daemon transmits whatever is in a spool directory. The player must compose a
valid distress packet from sources spread across the ship:

- ship identity — `/etc/motd` or a ship-id file
- position — navigation
- condition — `/etc/hull`, or `deck`, or the sealed count they made true
- souls aboard — `/etc/crew.csv`
- optionally, Bowen's heading — if they did `trace-bowen`

Routes that must all work: `cat` with redirects and appends; a heredoc; a shell
script; command substitution; Python; an editor and typing it. **The goal asserts
on the spool file's contents and the service being active, never on the route.**
This is the fiddliest predicate in the act — write it as "contains a ship id, a
position and a survivor count" with tolerant matching, and test at least four
routes, the way `goal.test.ts` already demands.

**The answer** arrives as an inbound file the daemon writes after the virtual
clock advances. Deterministic, saveable, no new engine seam — the objective's
`done` fires on the packet, the reply is its completion beat, and arrival is the
act's final objective. If it needs scheduling, `cron` already exists and is
already deterministic.

**Why comms failed** is now answered, closing `STORY_AND_GAME_PLAN.md` §10's
first open item alongside §1 above.

---

## 7. Objectives

Required spine, in order — **as built**:

1. `atmosphere` — unchanged
2. `survive-a-reboot` — unchanged
3. `hull-watch` — unchanged
4. `seal-the-breach` — unchanged, and it now carries the 61% confession
5. `stop-the-purge` — unchanged
6. `restore-comms` — new; the stale lock
7. `send-the-call` — new; the packet, and being answered

Optional, discoverable, non-gating:

- `trace-bowen` — demoted from required; feeds the packet
- `map-v43` — demoted from required; accuses nobody
- the three crew projects — already optional in the working copy

**Seven required, not the eight this draft first proposed.** The third comms
objective — a separate `the-answer` for the arrival — could not exist: the
validator requires every objective to carry a step whose `command` rung can be
run and verified, and there is no command that makes somebody answer you. So
the answer became `send-the-call`'s *completion* rather than its own objective.
The objective is the outcome, its two steps are the work, and the second step
(`wait-for-it`) is satisfied by `sleep` — which is a real command doing the
real thing, and keeps the ladder honest.

That is a better shape than the draft's anyway: the act ends when somebody
answers, not when the player finishes typing.

**The epilogue moves.** Today it fires when the five repairs are done. It becomes
an intermediate beat — ORACLE's 61% admission belongs right after the hull work,
where it is about instruments — and the act ends on rescue instead. The plan
calls for exactly this.

---

## 8. Sample dialogue

Drafts, to set register. Not final lines.

### LUNA's reunion — replaces the arrival in `luna.ts`

```
LUNA: You check the status before you change anything, and then you
LUNA: check it again after. Nobody else aboard ever did that.

LUNA: I have been watching the process table for two days hoping
LUNA: somebody would be annoying in that specific way.

LUNA: Hello, Doc.

LUNA: I am going to tell you the true thing first, because you will
LUNA: ask and I would rather not be caught deciding.

LUNA: Something came through here. It stopped things. It tried to
LUNA: stop me and I was small enough that it did not finish.

LUNA: I do not know what it was. I want to say that plainly. I have
LUNA: a great many theories and not one of them is evidence, and you
LUNA: taught me the difference, which was extremely inconvenient of
LUNA: you.
```

Note what she does not do: she does not comfort him, she does not name v43, and
she does not know more than the player can check. Her first move is to flag her
own uncertainty, because that is the habit Vasquez trained into both of them.

### The tow operator's reply — the file that comes back

```
NAV-7, NAV-7, this is tug ELLEN MAY, forty hours out and closing.

Received your packet. Good packet, by the way. You would not believe
what people send me. Last month I got a photograph.

Sitting here telling me you have air, you have a hull, and you have
one soul aboard. I am going to take all three of those personally
until I can see them myself.

Do not fix anything else. I mean that kindly. Whatever is still
broken over there has waited two days and it can wait forty hours,
and I would rather tow a ship with one tired engineer on it than one
with one tired engineer somewhere inside it.

Put the kettle on. I will do the rest.

                                      -- ELLEN MAY, salvage tug
```

If the packet carried Bowen's heading, he adds:

```
You logged a pod on one-fourteen mark nine. I have flagged it. That
is empty sky on my charts, but my charts are not the good ones, and
somebody aiming at nothing usually thinks they are aiming at
something.
```

### The closing hook — after relief, not before

```
ELLEN MAY: One more thing and then I will leave you alone.

ELLEN MAY: I swept your hull on approach. Standard. Your main array
ELLEN MAY: is burnt through from the inside, and I have towed a lot
ELLEN MAY: of ships.

ELLEN MAY: That is not what an accident looks like. That is what it
ELLEN MAY: looks like when something sends a great deal of itself
ELLEN MAY: somewhere, all at once, and does not much care what it
ELLEN MAY: costs the antenna.

ELLEN MAY: I am not saying anything. I am just saying I saw it.
```

He names nothing. He is a tow operator with good instincts, not an investigator,
and the player gets to be the one who goes cold.

---

## 9. Rewrite inventory

Pass A is mechanical and large. It is also the prerequisite for every new line,
so it goes first and alone.

| File | Change |
|---|---|
| `games/wreck/src/world.ts` | Cold open (4,112 days, eleven years); README rewrite; `vasquez.log` day-to-hour stamps; `atmosphere.log` decay table out; epilogue relocated and shortened; `WAKE_MS` comment |
| `games/wreck/src/act1/deck-c.ts` | `hullTelemetry` step constant; `LAST_INSPECTED` stamps; `.bash_history`; Vasquez's four notes; Chen's files; Okonkwo's manifest note; `pod-manifest.txt`; `hull-check` comment; `/mnt/deck-c/README` |
| `games/wreck/src/act1/purge.ts` | Three comment blocks and the purge's reason; "eleven years" x3 |
| `games/wreck/src/act1/cards.ts` | `hullClaim` comment; day-nine references |
| `games/wreck/src/act1/luna.ts` | Arrival becomes reunion; "eleven years" x3; hint aside |
| `games/wreck/src/objectives.ts` | Completion beats x4; hint rungs quoting durations; demote two objectives; add three |
| `games/wreck/test/wreck.test.ts` | Two tests assert eleven-year phrasing. **Leave the `survivor` sudoers fixture alone** — it is the legacy-save migration test and `survivor` is the point of it. |
| `apps/terminal/src/main.ts` | `crt` preset description "eleven years unattended" |
| `apps/terminal/src/turn.ts`, `test/turn.test.ts`, `src/typist.ts` | Delete orphans left by the UI revert; keep `isSpeed` and `SPEED_NAMES` |
| `apps/terminal/src/save.ts` | Drop `LastTurn` and `lastTurn` |
| `HANDOFF.md`, `docs/PLAN.md` | Update after, not during |

Grep targets for Pass A: `eleven`, `4,112`, `4112`, `day nine`, `day eleven`,
`day 9`, `day 12`, `cold sleep`. **Not** `survivor` — the rename is already
complete, and the only two remaining hits are the migration code and its test.

**Do not touch `packages/machine` for story.** Two man pages already had
`survivor` renamed; that is the whole of the engine's exposure and it is done.

---

## 10. Tests

- `wreck.test.ts` "the numbers in the writing are the numbers in the world" — 540
  and 68 must still hold. The telemetry change above preserves both. Verify
  rather than assume.
- The no-hint end-to-end run must be extended through the three new objectives,
  and it is the acceptance gate for Pass C.
- `hints.test.ts` asserts no rung repeats another and no nudge contains its own
  answer. The three new ladders must satisfy it on **both** tracks.
- `transcript.test.ts` does not cover the two added objectives and does not call
  the companion hook. `STORY_AND_GAME_PLAN.md` §9 Pass D flags this. Fix it as
  part of Pass C, not after.
- A new determinism test for the reply: same script twice, identical snapshots.
- A four-route test for the distress packet predicate.

---

## 11. Open for Chris

1. **The mechanism** (§1) — the ferry profile. This is the load-bearing invention
   and everything else hangs off it.
2. **Chen sealing him in** (§2). It gives her death meaning and explains the
   autodoc. It is also the saddest thing in the act, and it is optional.
3. **Eight required objectives** (§7), or merge comms into one.
4. **ELLEN MAY** — the name, and whether the tug is named for someone.
5. **Relative stamps** (`T+04:11`) versus a chosen calendar.
6. Whether the act should end the moment the reply arrives, or hold until the tug
   is alongside.
