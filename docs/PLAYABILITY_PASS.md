# Games 1–7: playability pass

This pass makes the player reach the terminal sooner and gives progress a
short human response. Longer technical explanations remain in inspectable
files, manuals and hints. Optional conversations let the player ask for
company without paying a hint penalty.

| Game | Pass |
| --- | --- |
| The Wreck | Shorter emergency briefing, LUNA arrival, process reactions, milestones and ending; retained title art, ship schematic and optional investigations. |
| The Archive | Merrick's briefing and SQL discoveries shortened; optional conversation and progress asides. |
| The Harness | Shorter Python/debugging milestones, optional LUNA conversation and quieter room identity. |
| The Fork | Shorter Git discoveries; kept Pell absent, the provenance question unresolved, and the conditional history ending. |
| The Containment | Shorter evaluation beats; preserved the distinction between confidence and calibration and avoided revealing the later result in the opening. |
| The Deposit | Added responses to the nine required operations milestones; shorter opening/ending, preserved the independent clean-hands ledger. |
| The Pipeline | New playable data-engineering adventure, nine required objectives, save/restore, chooser entry, conversations and its own room tone. |

## Sound and interaction

All seven rooms have synthesised ambience. Repairs, connections, evidence
and messages have distinct cues. The chooser is silent. Existing oscillator
frequencies now follow changing world state. Backgrounding the app suspends
sound; typing clicks follow actual text edits rather than cursor movement.

`sound effects 70` and `sound ambience 50` independently control volume and
persist on the device. `sound off` remains available. No audio downloads,
network synthesis, licensed music or telemetry were introduced.

Games 2–7 accept `talk`, `talk work` and the listed optional topics. LUNA also
accepts `luna`. Brief asides follow changes in objective state, wait through
quiet turns, and remember previous appearances across saves. The Wreck
retains its existing richer `luna` command.

## Game seven: The Pipeline

Merrick's intake has repeated deliveries, two schema versions, one malformed
row and a late event. The work is to preserve raw evidence, quarantine bad
rows, normalize columns, deduplicate, test replay safety, backfill late data,
reconcile per-claim event counts, publish and leave a reproducible handover.

Every objective has three executable routes, two near misses and a complete
hint ladder. `rehearse /home/dewitt/pipe.sh` runs the player's shell recipe on
isolated copies with normal, repeated and late deliveries. Its protected
receipt is bound to the tested recipe; changing the script invalidates it.
`delivery` makes the authored late batch available. No real clock or network
is involved. File contracts are listed in `~/README`.

The small fixture deliberately uses simple comma-separated fields without
quoting. `cut` is suitable for that format, not a general CSV parser. These
lessons cover local batch processing, not distributed exactly-once delivery.
Publishing checks the export and checkpoint; it does not claim that every
accepted route implements atomic publication. The harness checks behavior on
the authored fixtures, not correctness for every possible future input.

## Verification and remaining scope

The dependency-free route harness passes all 27 Pipeline solutions and 18
near misses. The bottom hints complete all nine objectives, including after
save/restore. Added regression tests cover rehearsal isolation, protected
receipts, recipe changes, companion persistence and oscillator retuning.
The full typecheck, test suite and production build are required in CI.

Real-device listening and soft-keyboard comfort still need human playtesting.
This pass does not implement the proposed game-five curriculum expansion,
expand the Archive's SQL curriculum, or add music. The existing first-six
puzzle predicates and routes are retained. Game seven's cost gate has not
been measured against full Git history in this reconstructed workspace.
