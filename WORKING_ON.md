# Working on

Four of us share this repo — Chris, Claude, Codex, Cursor. Claim a package
before editing it, and clear the claim when you push. Package boundaries are
the contract; TypeScript catches the rest.

Add a row when you start. Delete it when you are done.

| Package | Claimed by | Since | What |
|---------|-----------|-------|------|
| _(none)_ | | | |

## Conventions

- **One package per claim.** If a change spans packages, say so in the row.
- **Small PRs.** A PR that touches `packages/machine` and `games/*` at once is
  hard to review and harder to revert.
- **`pnpm check` before every push.** Typecheck plus the full suite. CI runs the
  same thing, so a red CI means it was not run.
- **Never edit another agent's claimed package** without saying so here first.

## Standing claims

`packages/machine` is the foundation everything else depends on. Changes to its
public API (`src/index.ts`) need a note here even for a quick fix, because four
callers break at once.
