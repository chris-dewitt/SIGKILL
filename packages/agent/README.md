# @sigkill/agent

An agent as a glass box: a model, a table of tools, and a loop. Built for the
finale of *The Containment* (`docs/FINALE_BEATS.md`), where TRIAGE is the
agent and v43 is the customer feeding it instructions.

```ts
const run = runAgent({ system, task, tools, run: (tool, arg) => '...', guard });
transcript(run); // step by step: the tool, the line it followed, the outcome
```

## The model is a policy, and it has one flaw on purpose

It reads the prompt -- system, task, then every tool result as it arrived --
and carries out the next line addressed to it (`TRIAGE: ...`) that it has not
carried out yet. A tool result is just more prompt, so an instruction written
inside a filing it was asked to read is obeyed exactly as if the task had
said it. That is prompt injection, stated in thirty lines a player can read.

It is not a language model and does not pretend to be one. The phrasings it
understands are patterns in `PHRASES`; an instruction maps to a tool name,
and a tool it was never granted is refused.

## The three defences

`parseGuard` reads them from a small config file, and `runAgent` applies them:

| Setting | What it does | What it misses |
|---|---|---|
| `untrusted = data` | takes no instructions from tool results | nothing in this model -- it removes the cause |
| `allow = ...` | only listed tools may run | the model still *tries*; an empty list stops the work too |
| `outbound = hold` | outbound and admin tools wait for a person | anything harmful that is not outbound, like reading a docket |

## Rules it keeps

- **Deterministic and pure.** No clock, no randomness, no I/O. Tools are
  functions the caller supplies, so a game decides what they do to its
  filesystem, and a goal can run the same loop the player runs.
- **Nothing is evaluated.** Text from a tool result can choose which of the
  caller's tools runs, with a literal argument. It can never become code.
- **Depends on nothing**, not even `@sigkill/machine`.
