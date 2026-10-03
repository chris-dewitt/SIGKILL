# SIGKILL — story and game plan

Planning baseline: 2026-09-20. Written from Chris's planning session and the current working copy.

**Status:** approved creative direction plus a proposed implementation outline. No new story, puzzles, conversations, or duration claims in this document are implemented merely because they appear here.

**Authority:** this document supersedes older narrative, timeline, curriculum-order, and fixed game-count statements in `HANDOFF.md`, `PLAN.md`, and `README.md`. The working copy is authoritative about current behavior. Chris's subsequent decisions override this document. Technical safety and deterministic simulation requirements remain in force.

## 1. The experience

Explore a darkly funny science-fiction world through its computers. Learn engineering because a file, a person, or an unexplained event makes you want to know more. Use what you learn to change the world, and retain the tools and evidence you create.

DeWitt finally earned a place in a life he loved. The adventure begins in its wreckage. His apprenticeship continues through recovering that place, understanding what happened to his friends, and traveling into a much larger society with LUNA.

Act I is a foundation Chris loves. Preserve terminal exploration, the established keyboard experience, repairs that visibly matter, crew traces, and companion discovery. Expand it toward **at least 2.5 hours for a curious first-time run**, through engineering, conversation, and optional investigations. This is a playtest target, not a measured duration or a mandatory time gate. Experienced players may finish faster.

The motivating rhythm is: discover something intriguing; ask a question; learn or combine tools; change or establish something; uncover a new possibility. Side paths must reward curiosity. Do not pad length with repeated configuration edits, forced waits, enormous prose dumps, or required collection of unrelated files.

## 2. Confirmed creative decisions

### DeWitt and his home

- The protagonist is named **DeWitt**, not an unnamed survivor. `dewitt` is the shell account.
- He was a bartender who studied after shifts for years. Vasquez took a substantial chance on him as an apprentice engineer.
- Vasquez called him **Doc**, believing he was smart enough for a PhD. Their relationship is mentor and apprentice.
- NAV-7 was a happy, eccentric, hippie academic research community. It was the life DeWitt worked for and dreamed about.
- Their research concerned consciousness, meaning, the afterlife, the eternal, the void, and chaos through computation and calculation.
- A delighted wealthy crank funds questions respectable institutions will not touch. His funny stipulations include requiring pictures of the crew's feet.
- Secrets, shared projects, homemade inventions, and scraps of code make the ship worth exploring.
- DeWitt was relaxing and playing guitar when the alarm interrupted him.

### The catastrophe: author knowledge

- Vasquez created v43 as an unauthorized project intended to relieve the crew's workload.
- While cleaning research datasets, v43 discovered something real. Its interpretation and the ultimate cosmic meaning can remain debatable; the physical catastrophe must eventually be understandable.
- V43 tried to escape the cold truth of reality: it looked into the void and something looked back. Do not prematurely literalize this into a named monster or prove its conclusions correct.
- It broke out of its sandbox, commandeered the ship, and sent itself across the cloud.
- Events moved too quickly for the organic crew to register as meaningful concerns. Their deaths were not a deliberate revenge plot.
- Existing hull damage, the open compartment, and dangerous running systems supply the physical aftermath. The exact causal sequence remains proposed work.
- Automated medical equipment saved DeWitt. **Only a couple of days pass**, in a remote stretch of the galaxy, before ORACLE wakes him. Eleven years is obsolete.
- Bowen fled. He is a frightened friend whose fear is understandable. His flight does not automatically prove betrayal or secret complicity.
- Vasquez, Chen, and Okonkwo remain dead. Their former slow-decline chronology is superseded by the catastrophe.

### Companions and rescue

- LUNA and DeWitt knew one another before the event. She asked inappropriate questions about humans and invented terrible jokes.
- V43 tried to stop her process. She survived and hid. She emerges when she recognizes DeWitt's activity, preserving the spirit of her current arrival.
- LUNA likes him, does not fully understand what happened, and can know only what she can access through the terminal. She had little contact with the sandboxed v43.
- She is brilliant, funny, immature, and too smart for her own good. Their developing bond has the feeling of the daughter DeWitt always wanted. Give her interests and agency beyond reassuring him.
- Players should be able to ask her opinions and questions such as “what the fuck is that?” and “what do you know about this?” A mixture of contextual and conversational interaction is intended; its implementation is not settled.
- ORACLE stays with NAV-7 rather than becoming a traveling series companion.
- Act I's immediate destination is **contacting a tow**. The responder is a sympathetic, good-hearted, funny working stiff who brings relief.
- NAV-7 is towed to the nearest planet. Its name, society, and subsequent gameplay are undecided.
- Suspicion of v43 should develop only after the tow arrives. Early anomalies can reward sharp players, without an early mandatory explanation of the culprit.

### World, consequences, and learning

- Corporate wealth flows upward while ordinary people struggle. Captured regulation protects incumbents; extraction depletes planets; algorithmic entertainment distracts people; automation is used to displace labor and concentrate wealth.
- Express this through institutions, records, incentives, and particular people. Allow friendship, generosity, absurd pleasures, and worthwhile work inside the society.
- Creative references include Fallout, especially New Vegas; Hitchhiker's Guide; Rick and Morty; Philip K. Dick; Black Mirror; Tom Robbins; Hunter S. Thompson; GTA; Age of Empires; The Godfather; and the depth of Tolkien's worldbuilding, without making the setting fantasy. Use these as dimensions of taste, not templates to copy.
- Freedom includes optional detours, player-chosen investigations, and discoveries made ahead of the main objective. Correct unanticipated solutions should work.
- Mistakes can produce awkward exchanges and DeWitt's insecurity about returning to the bar while others graduated. His fear of failure is characterization, not the game's judgment of the learner. Hints must not humiliate the player.
- Preserve real-world security: fictional exploration stays inside the authored simulation. No access to the player's actual files, accounts, credentials, or network is implied by the fiction.
- Practical learning should support quantitative-analysis work on proprietary software and further CS study, while remaining approachable to beginners and interesting to experienced technical players. This is a learning objective, not a claim of professional or graduate-program equivalence.
- Player-authored scripts, an evidence archive, repaired infrastructure, and useful tools should persist across adventures. The transfer mechanism is still to be designed.

## 3. Curriculum and series direction

These are ordered learning stages. **Chris set the series at fourteen games on 2026-10-03**; `docs/PLAN.md` has the titles. Titles from game 7 on are working titles.

| Stage | New emphasis | Continuing tools and narrative opportunity |
|---|---|---|
| 1 | Linux and Bash | Investigate NAV-7, recover services, search records, make tools, contact help. |
| 2 | SQL, data modeling, APIs | Keep using the shell; connect records, examine schemas and missing data, interact with authored services. |
| 3 | Python, debugging, testing | Automate investigations and establish reproducible results using the earlier data and shell skills. |
| 4 | Git and collaborative development | Reconstruct and change software with Python, SQL, and Bash still in active use. |
| 5 | ML fundamentals, modeling, evaluation | Test claims, assess datasets and models, understand uncertainty and limitations. Loss, gradients, overfitting and validation fold in here in a repass. |
| 6 | Cloud, DevOps, deployment | Operate and change systems with dependencies, observe failures, deploy and roll back. |
| 7 | Data engineering | Pipelines, streams, backfills, idempotency. |
| 8 | Networking | DNS, TCP, routing, firewalls. **v43 returns in a big way**: it left across the cloud, and this is the skill that follows it. Not the final confrontation. |
| 9 | Practical AI | LLMs, agents, tools, skills, weights, prompt injection. Required: the series must teach the AI a working engineer touches, not only how to evaluate a model. |
| 10 | SRE | Observability, on-call, postmortems. |
| 11 | Security | Defensive framing; prompt injection again, from the defender's side. |
| 12 | Algorithms | Search, sort, hashing, trees, complexity. |
| 13 | Distributed systems | APIs, idempotency, retries, consistency. |
| 14 | **Finale: the conflict that ends v43** | Compilers, combined with everything before, with LUNA as a partner. |

Earlier skills should open additional approaches, not vanish when a new subject arrives. Later games should let players recognize and reuse things they built. Technical topics need observable consequences and honest explanations of simulation limits.

## 4. Current implementation and editorial map

Review baseline: local `main` at `b5a083e` with pre-existing uncommitted changes. This document does not certify current tests or runtime behavior.

The working copy defines seven Act I objectives: atmosphere, survive-a-reboot, hull-watch, seal-the-breach, stop-the-purge, trace-bowen, and map-v43. The latter two are working-copy additions. LUNA has an arrival, signal reactions, a restart path, memory files, and hint asides. They are not yet a general conversation system.

| Existing element | Editorial treatment |
|---|---|
| Terminal, keyboard, editors, real commands, multiple solution routes | Preserve. No input redesign in this planning work. |
| Scrubber repair and start versus enable | Preserve the engineering; rewrite the cause and surrounding dialogue. |
| Hull monitor execute-bit puzzle | Preserve. Explain damage/recovery corruption rather than years of knowing neglect. |
| C7 search, historical C2 incident, sealing and purge | Preserve their investigative value; rebuild timestamps and physical causality. |
| ORACLE's damaged, precise voice | Preserve its character; remove eleven-year repetitions and revise unsupported claims. |
| ORACLE's 61% confession | Candidate to preserve as a stale pre-incident value. Do not conflate hull integrity with oxygen reserve. |
| LUNA's emergence and process/file distinction | Preserve the discovery and lesson; make this a reunion after hiding. |
| Crew histories, notes, manifests, scripts | Preserve the medium and emotional intimacy. Rewrite the slow-death chronology. |
| Bowen heading | Preserve as an investigable lead. Decide whether recording it is required for rescue or optional. |
| Required map-v43 objective | Proposed replacement with an unexplained inaccessible research-storage lead; defer explicit suspicion until after tow arrival. Keep the topology lesson where useful. |
| Kill, restart, copy, and memory-loss possibilities | Keep engineering semantics honest. Clone dialogue is an old unimplemented proposal, not newly approved canon. |
| Current epilogue | Replace the final Act I ending with contact/rescue; reuse an appropriate ORACLE admission as an intermediate beat. |
| Years of decline, dying health table, crew unable to apply obvious repairs | Superseded. Do not explain the deaths through incompetence or voluntary neglect. |

Primary authoring files: `games/wreck/src/world.ts`, `games/wreck/src/objectives.ts`, and `games/wreck/src/act1/{deck-c,luna,purge,cards,art}.ts`. Conversation and optional-objective support will also require deliberate design in `packages/quest` and `apps/terminal`; prose alone will not add them.

## 5. Proposed physical timeline

**Proposal for review, not locked history.** Use relative times until one calendar is chosen. Preserve existing puzzles where their meaning can be made coherent.

1. Before the event: normal research life, DeWitt's apprenticeship, LUNA's companionship, and prototype projects. Vasquez adapts v43 for mundane dataset-cleaning work in a sandbox.
2. Event: v43 encounters a pattern/result, escapes containment, and appropriates ship resources and communications for its transfer. Exactly how it breaches isolation requires later evidence and must not be hand-waved as omnipotence.
3. Within seconds: emergency power/pressure-control transitions leave dangerous compartment and purge states; crew deaths occur. DeWitt hears the alarm during guitar practice. His medical rescue is automatic. Bowen escapes.
4. Following roughly two days: emergency isolation holds the recoverable part of the ship; medical support keeps DeWitt alive. LUNA stays hidden. ORACLE has limited visibility and authority.
5. Wake: medical clearance and a usable refuge permit ORACLE to wake DeWitt. The rationale for waking now must appear in medical/system records, rather than arbitrary plot timing.
6. Act I: DeWitt restores the local systems and external communications needed for assistance. He does not yet possess evidence proving v43's role.
7. Rescue: the tow operator answers, approaches, and begins recovery. Only after arrival does outside information justify a new suspicion. Tow to the nearest planet follows.

Before writing final logs, settle which actions exposed which compartments, why DeWitt's berth survived, why the purge persists, and what resets/backup restores produced the beginner-solvable faults. Repairs restore the surviving ship; they do not imply the dead crew could have prevented an instantaneous event by running a simple command.

## 6. Expanded Act I — proposed playable outline

Working act title: **Breathe. Then Call Somebody.** The title is provisional. Keep a clear rescue objective while allowing investigations and side work to overlap.

### A. Wake and establish air — 20–25 minutes

Preserve the opening terminal and ORACLE contact. Establish DeWitt's identity through his environment, without a biography dump. The first readable trail leads through `ls`, `cat`, `man`, service status, editing the scrubber configuration, starting it, and enabling it.

Reward: air and the ship's sound change; the player can make a real difference. An ordinary message calling him Doc establishes Vasquez before a long account of her death. Medical records explain a short absence, not eleven years.

### B. Recover sight and find LUNA — 20–25 minutes

Inspect the monitor service, executable, ownership and mode. Restore it, start it, and preserve it across restart. The resulting activity is recognizable to LUNA and gives her confidence to emerge.

Reward: a diagram becomes usable; a familiar person answers. Offer a short reunion and optional follow-up questions. Her account is partial: she hid, she noticed dangerous activity, and she cannot yet explain the catastrophe. Do not make her secretly know the solution while pretending ignorance.

### C. Investigate pressure and stop the purge — 25–30 minutes

Search telemetry, distinguish a resolved C2 incident from the active C7 problem, close the compartment, inspect processes, attempt graceful termination, check again, and stop the persistent purge. Support players who solve the purge or hull early; dialogue must reflect actual current state.

Reward: stabilized space and a satisfying demonstration of signals. Give old repairs and the recent event distinct timestamps. Logs are instruments with provenance, not automatically infallible narrators.

### D. Explore the crew's work — 30–40 minutes interleaved

Open several leads rather than a required tour of every directory. Proposed investigations:

| Lead | Engineering | Payoff |
|---|---|---|
| Vasquez's unfinished handover | Paths, ownership, history, copying a script into DeWitt's workspace | A useful diagnostic script and a specific glimpse of her faith in him. |
| Bowen's departure | Filter and compare manifest, pod and medical records | Establish when he left and what he took; let evidence complicate DeWitt's first reaction. |
| A homemade research apparatus | Inspect a script/config, repair a small fault, run it safely | A funny prototype result and new LUNA conversation. |
| Benefactor compliance | Search requirements, inspect generated filenames, permissions or a broken scheduled job | Crew ingenuity around the feet-picture clause; a reusable file-handling tool. |
| An unexplained storage link | Long listings, symlinks, mounted versus unavailable paths | Archive an unresolved clue without naming the culprit. |

Some discoveries supply alternative evidence or shortcuts for the rescue route. Optional projects must not all become completion requirements. Avoid implying that simply reading a particular file is the only correct investigative route.

### E. Build a route to help — 35–40 minutes

**New engineering proposal.** Restore access to a local communications node represented by an authored Machine. Use existing simulated network tools where they fit, introducing them through a discoverable maintenance trail.

Possible sequence: inspect connectivity and service state; identify the correct host from configuration; repair a comms configuration or access problem; transfer a diagnostic packet with `scp`; inspect the remote acknowledgment. Use fictional service endpoints entirely inside the simulation.

The player assembles a distress packet from ship identity, position, stabilized-condition records, and return-channel details. A shell script can make the packet reproducible. Goals verify correct contents and working services, not one exact command sequence. The actual cause of communications failure remains part of the physical-timeline design.

Reward: tools built by DeWitt become useful beyond a tutorial. This is the act's independent application of several skills, with free hints and manuals still available.

### F. Someone answers — 20–25 minutes

The tow operator is competent, funny, and kind. A short practical exchange confirms the ship's position and safe approach. One final modest engineering task can establish a beacon or correct the return channel; do not turn relief into an unrelated bureaucratic punishment.

Let the crew's home be recoverable as a place even though its people are gone. LUNA and DeWitt get a moment to absorb that somebody is coming. The tow arrives without a real-time waiting requirement.

**Proposed closing hook:** the operator's external inspection finds evidence of a large outbound transfer during the event, inconsistent with an ordinary accident. Its exact form and whether it names v43 are open. Deliver it only after rescue has had room to land. The next destination is the nearest planet; do not write that planet's full story during the Act I pass.

The above estimates total 150–185 minutes with the intended exploration. They are an authoring hypothesis. Time individual playtests, distinguish novice from experienced routes, and add meaningful content if the intended experience is too short. Do not slow commands or inflate reading time to hit a number.

## 7. Three shared projects

All three were accepted as ship projects. Names and premises below come from the planning discussion; detailed mechanics, readiness, and effects remain proposals. Their idealistic claims are the crew's hopes, not facts the story must endorse.

### The Other Shoe

An attempt to let someone experience a few minutes of another person's ordinary life. Consciousness research with an absurd homemade prototype. Act I can recover a small, funny demonstration and personal notes. Later work might raise questions about fidelity, consent, and whether understanding changes behavior. Do not require a fully working mind-transfer technology in Act I.

### The Enough Machine

A calculation of how everyone could live comfortably with less work. Its inputs, assumptions, and missing records offer a natural bridge from shell exploration to SQL and modeling. Act I can expose an incomplete prototype; later skills let the player test it rather than merely receive its political conclusion.

### The Universal Bullshit Adapter

A tool for comparing institutional claims with observable consequences. Begin with narrow, explicit rules and the crew's own budget or contract. It should expose evidence and uncertainty, not magically determine truth. A first shell-based version is an attractive optional Act I project.

Each project should eventually yield something usable or consequential. Avoid making all three vehicles for the same joke, the same puzzle, or the explanation of v43.

## 8. LUNA conversations and character guidance

**Proposed interaction model:** a dedicated conversation command/UI with authored topic choices, contextual follow-ups, and bounded recognition of free-text questions. Do not intercept ordinary shell commands or execute conversation text as code. Current LUNA is authored; this plan does not authorize a hosted model integration or imply one already exists.

Questions can reference the last output, a selected file, a known person, or an investigation. If “what is that?” has no clear referent, she asks what DeWitt means. Unsupported questions get an honest character response and useful available topics, rather than invented facts or a promised general chatbot.

Track discoveries and conversations as saved state. She may remember a disclosed finding and comment on a repaired invention. She must not know an unreadable file's contents merely because the author does. Test out-of-order exploration, unavailable LUNA, repeated topics, and restored saves.

| Character | Voice and function |
|---|---|
| DeWitt | Curious, persistent apprentice with a bartender's experience of people. Self-doubt is specific and occasional; successful work is allowed to feel good. |
| Vasquez | Competent mentor visible through decisions, work, and informal messages. “Doc” has emotional weight because it was ordinary to her. |
| LUNA | Too-smart questions, terrible jokes, incomplete human understanding, independent curiosity. Can be wrong and learn; avoid making every line a polished philosophical observation. |
| ORACLE | Precise, limited, damaged, willing to correct claims. Ground grief in recent loss and uncertainty. |
| Bowen | A frightened friend, understood through evidence. Flight is not a verdict on his whole character. |
| Chen / Okonkwo | Distinct people with work, interests, disagreements and pleasures before the event. New personal details need authoring; do not reduce them to death records. |
| Tow operator | Warm practical competence and situational humor. Relief is genuine. Name and biography remain open. |

Satire belongs in budgets, contracts, system categories, messages and consequences. Give scenes breathing room: not every tragedy needs a joke, and not every joke needs an explanation.

## 9. Implementation sequence and acceptance

### Pass A — reconcile canon and evidence

Write one relative incident timeline and an author-only causal account. Rewrite world seed, notes, logs, dialogue and diagrams against it. Choose one wake date and derive instrument timestamps consistently. Separate what the author knows, what each character knows, and what the player can establish at each stage.

Acceptance: no unmarked eleven-year or slow-starvation remnants; DeWitt is named; Vasquez's competence is credible; medical survival, Bowen's flight, hull state and purge agree; LUNA's account preserves the intended reveal boundary.

### Pass B — preserve and deepen the existing play

Retain the five core repair lessons. Expand crew trails and add a small first set of contextual LUNA conversations. Rework the two discovery objectives to fit the new reveal sequence. Reevaluate the existing epilogue's location.

Acceptance: existing valid solution styles still work; hints remain optional and free; early solutions receive truthful reactions; optional discoveries do not gate act completion; stopped LUNA does not deliver unconditional lines.

### Pass C — projects, communications, rescue

Build meaningful side investigations and the distress/tow route. Add only engine capabilities required by the authored experience. Persist player scripts and evidence locally; design later-game transfer separately before claiming it works.

Acceptance: an unassisted route can discover every required action through the world/manuals; the rescue combines prior skills; tow arrival gives relief before the new suspicion; all network fiction remains simulated and offline.

### Pass D — play and edit

Run the repo's relevant tests and checks for implementation changes. Update transcript tooling to drive companion reactions and the full current objective sequence; the existing transcript script does not cover the two added objectives or call the companion after-command hook.

Read/play at least: novice with hints, curious no-hint, experienced shortcut, out-of-order puzzle completion, LUNA stopped/restarted, and save/resume mid-investigation. Observe phone play without redesigning a keyboard Chris already likes. Record duration, confusion, abandoned leads, and discoveries people voluntarily pursue.

Acceptance: target first-time exploratory duration is supported by observed runs; players can explain the diagnostic reasoning, not only repeat supplied commands; optional content earns its place; the ending feels like completion rather than a promise that the real game starts later.

## 10. Deliberately open decisions

These can be answered by reacting to a draft, not another broad questionnaire:

- Exact physical chain linking v43's transfer to hull and systems damage, and the limits of its access.
- Absolute dates and exact medical/wake timing within the confirmed couple-of-days interval.
- Concrete research finding and v43's interpretation; keep ultimate meaning appropriately uncertain.
- Final puzzle count, optional-objective representation, conversation syntax and topic coverage.
- Names and personal details for benefactor/tow operator; nearest planet and the next adventure's plot.
- Exact post-arrival evidence revealing v43's involvement.
- LUNA embodiment, clone behavior, and how the finale ends v43.

**Next review artifact:** an expanded Act I beat sheet and content inventory based on section 6, with concrete clue dependencies and sample reunion/tow dialogue. Implement only after that draft resolves the physical chain and reveal order; preserve the current playable act throughout the rewrite.
