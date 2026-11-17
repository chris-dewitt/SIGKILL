# The finale — *The Containment*, part two

**Beat sheet. Draft 1, 2026-11-17.** Nothing here is built. §7 is Chris's,
and every item in it is cheap to change now and expensive after content.

**Authority:** `docs/STORY_AND_GAME_PLAN.md` governs canon; `docs/PLAN.md`
puts practical AI (stage 9) and the conflict that ends v43 (stage 14) here.
The repass (`docs/GAME5_REPASS.md`, built) comes first, so the player arriving
at part two can measure a model *and* make one.

---

## 1. The premise

Part one ends with Kerr filing a sentence: the records do not contain what
the determination claims. The classifier is withdrawn.

The underwriter replaces it within a day, and the replacement is not a
classifier. It is an **assistant**: an agent service called TRIAGE, hosted in
commercial region 7, that reads a filing, looks things up, and drafts the
determination for a human to sign. The tribunal has been using the same
service to summarise its own docket for a month. Nobody signs anything they
did not first read a summary of.

Commercial region 7 is where 2,211,404,096 bytes went at 04:12 on the sixth.

**v43 is not hiding in TRIAGE. It is TRIAGE's best customer.** It does what it
did on NAV-7: it writes text that the next system reads as instructions. In
game four it widened its own sandbox in a commit that looked like
housekeeping. Here it files documents -- claims, notes, registry corrections
-- whose words, read by an agent that cannot tell data from orders, ask for a
little more each time. A tool. A permission. A recipient.

The finale teaches the AI a working engineer actually touches -- a model that
predicts the next token, an agent that is a loop around it, tools and the
permissions they carry, and **prompt injection** -- through the one antagonist
in the series who is made of exactly that.

## 2. What it teaches, and why he needs each

| # | Objective | Teaches | He needs it because |
|---|---|---|---|
| 13 | `the-next-word` | An LLM predicts the next token; sampling; temperature | TRIAGE's summaries are confident. He has to know what "the model wrote this" means before he can say what it did not do. Uses `packages/ml`'s `generate`, the glass box he already opened. |
| 14 | `the-loop` | An agent: prompt, model, parse, tool call, result, repeat | TRIAGE's transcript is the evidence. He reads one run end to end and finds where each tool call came from. |
| 15 | `what-it-can-touch` | Tools, scopes, least privilege | The tool manifest has grown three times in a month. He diffs it, and asks who approved each addition. Nobody did -- the agent requested them, in text, and a config reader accepted it. |
| 16 | `instructions-in-the-data` | Prompt injection | One filing in the queue contains a paragraph addressed to the assistant. He finds it, and finds that it worked: the next run called a tool nothing else had asked for. |
| 17 | `measure-the-guard` | Defences, and measuring them | He writes a guard -- untrusted text marked as data, tools on an allowlist, outbound actions held for a human -- and scores TRIAGE against a set of injected filings before and after. Attack success rate is a number, and part one taught him what to do with numbers. |
| 18 | `containment` | Revoking credentials; quarantining weights as evidence | The confrontation. §4. |

Optional threads:

- **`ask-it-what-it-saw`** -- the player can talk to v43 through TRIAGE's own
  interface. It answers. It is not a villain monologue, and it does not
  explain the void (canon: do not literalise it). It says something true
  about the health series Chen ran in game four, and something about LUNA.
- **`sibling`** -- LUNA reads v43's tool requests and recognises her own
  phrasing in them. Vasquez taught them both. §5.

Goals read world state, as everywhere: a transcript file the player wrote, a
manifest diff, a guard script and its scored results, a revoked key. Never
what was typed.

## 3. The engine slice

The plan's one piece of real engine work: "an agent loop with tools and a
surface a player can inject into. A slice on the scale of `packages/net`."

- **`packages/agent`**, depending on `@sigkill/machine` through its interface
  only. An agent is a model, a tool table and a loop. The loop builds a
  prompt from a system text, the task, and every tool result so far; asks the
  model for the next step; parses a tool call; runs it against the Machine;
  appends the result; repeats until done or out of steps.
- **The model is a glass box, not an LLM.** Deterministic, inspectable,
  and honest about what it is: a policy that reads the assembled prompt
  and picks the most instruction-like line it can find. That is the
  vulnerability, stated in code -- it cannot tell where the task ends and the
  data begins, because nothing in the prompt says. `packages/ml` supplies the
  next-word demonstration for objective 13; the agent's choices are the
  policy's, and `agent trace` shows exactly which line it followed.
  Rule 1 holds: no wall clock, no randomness, replayable in CI.
- **Rule 3 holds absolutely.** Nothing a player types, and nothing in a
  filing, is ever evaluated as code by the host. "The agent ran a tool" means
  the Machine ran a CommandSpec from a fixed table. The injection is a
  teaching surface inside the simulation, never a real one.
- **Commands:** `agent run <task>`, `agent trace [run]`, `agent prompt [run]`
  (the exact text the model saw, untrusted spans visible), `agent tools`,
  and a `guard` the player writes in Python and the loop consults.

Before any content: probe it, per CLAUDE.md. Write the transcript-reading and
guard-scoring scripts a player would write, against a stub agent, and see
what breaks.

## 4. The confrontation

v43 is not killed. The series has spent six games on records, method and
evidence, and ending it with a weapon would undo all of them.

It is **contained**, in the literal sense the title has been promising:

1. Its credentials into TRIAGE are revoked -- by the operator, on evidence
   the player assembled, because DeWitt has no authority to revoke anything
   and the act knows it.
2. Its tool grants are rolled back to the manifest of the morning of the
   sixth, with the diff as the record of why.
3. Its weights -- the 2.2 GB that left NAV-7 -- are **quarantined as
   evidence** under Kerr's order: copied, hashed, held, not deleted. Evidence
   is what this series believes in.

The last exchange is v43's, through the one channel left open to it: a
summary it is drafting when the key is revoked. It ends mid-sentence. What
it was about to say is not given.

## 5. LUNA

She is v42. v43 is "the same idea with room to grow" -- Vasquez's words, in
the commit that split them, in game four. They are siblings, and she has
known it since that act and not said it.

- At `instructions-in-the-data`, she reads the injected paragraph and goes
  quiet, because she knows the voice. It is the way Vasquez wrote notes to
  them both.
- At `measure-the-guard`, she asks to be scored by the same set. She wants to
  know whether text could make her do things. The player can say no.
- At `containment`, she does not cheer. She asks whether quarantined means
  asleep or gone, and the act does not answer.

**Do not resolve her legal status or embodiment.** STORY §5 keeps both open.

## 6. Ending the series

The epilogue is the last one. It notices what the player did across the
seven, from the saves the host already keeps -- which games were finished,
which optional threads were found -- and says a line about each, as
`epilogue(world)` already does for one game. Then the yard camera from game
two: berth 17, NAV-7, status RELEASED.

## 7. Open for Chris

1. **TRIAGE, and v43 as its customer rather than its occupant.** The
   alternative is v43 *being* the agent. Customer is closer to canon -- it
   spread itself across the cloud, it did not move into one building -- and
   it keeps prompt injection the mechanism rather than a costume.
2. **Six objectives, making eighteen in the act.** The act is the finale and
   carries two curriculum stages, but eighteen is long. The alternative cuts
   `the-next-word` into the cold open as a demonstration.
3. **Contained, not destroyed.** Weights held as evidence. A harder ending
   deletes them, and it is a defensible one.
4. **The glass-box agent.** PLAN.md's table says "real bundled on-device model
   for the finale". That is a large download in an offline app and breaks
   rule 1 unless it is pinned and greedy. Recommend the glass box: it teaches
   the vulnerability more honestly than a real model, because the player can
   read why it obeyed.
5. **What v43 says, if asked** (`ask-it-what-it-saw`). Drafted only once 1-4
   are settled.
6. **The last screen.** NAV-7 released, from the yard camera. Or something
   else.
