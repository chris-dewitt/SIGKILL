# SIGKILL

> *Signal 9. You cannot catch it, you cannot block it, and it does not wait for you to save your work.*

A series of terminal survival adventures that teach real backend and ML
infrastructure engineering — Linux, Python, SQL, Git, distributed systems, and
the machinery underneath large language models.

Phone-first. Fully offline. Paid once per game. **No ads, no accounts, no telemetry.**

---

## The premise

You wake on a dead ship with nine hours of oxygen and one flickering terminal.
Everything you type is real: a real shell parser, real POSIX permissions, a real
Python interpreter, a real SQLite database, real Git history. The commands you
learn are the abilities that open the next door.

Thirteen of these, each a different disaster, each a different pillar of the
craft.

| # | Title | Teaches |
|---|-------|---------|
| 01 | **The Wreck** | Linux & bash — filesystem, permissions, processes, pipes, logs, cron, SSH |
| 02 | **The Archive** | SQL & data — queries, joins, indexes, transactions, schema design |
| 03 | **The Cluster** | HPC & cloud — SSH, Docker, systemd, SLURM, distributed training |
| 04 | **The Containment** | LLM & AI — tokenization, attention, embeddings, RAG, prompt injection |

Nine more are sketched in [docs/PLAN.md](docs/PLAN.md).

Every adventure ships two tracks over the same puzzles: **Cadet** for players who
have never opened a terminal, **Operator** for players who have and want the
real thing.

---

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

`--host` is on, so a phone on the same wifi can open
`http://<your-machine-ip>:5173` and play it with a real soft keyboard. That is
the only test that counts.

```bash
pnpm check        # typecheck + the full test suite
pnpm test         # tests only
pnpm build        # production bundle
```

---

## The Machine

Every one of the thirteen games runs on one deterministic virtual computer.

```
packages/machine/    VFS, shell parser, coreutils, virtual clock
packages/crt/        Phosphor renderer
apps/terminal/       Playable terminal; becomes the Capacitor app
games/wreck/         Adventure 1 content
```

What is in and tested today:

- **VFS** — inodes, POSIX permissions with real uid/gid checks, symlinks with
  loop detection, `ENOENT`/`EACCES`/`EISDIR`/`ELOOP` and friends. Snapshots
  round-trip exactly, which is what a save file is.
- **Shell** — quoting, globbing, pipes, `&&`/`||`/`;`, redirection, subshells,
  variable expansion, `$?`, command substitution (`$(...)` and backticks),
  per-command assignments, real exit codes.
- **Processes and services** — a process table, systemd-style unit files read
  from the filesystem, and `sudo` gated by `/etc/sudoers`. `systemctl enable`
  creates a real symlink in `multi-user.target.wants`, exactly as on a real
  system, so `ls -l` shows it and it survives a snapshot for free.
- **Coreutils** — `ls cat cd pwd echo grep head tail wc sort uniq cut tr sed
  find mkdir rmdir rm cp mv touch ln chmod stat ps kill systemctl sudo whoami
  id env export unset which man help clear exit true false hostname`.

Two properties are load-bearing and never traded away:

**Deterministic.** No wall-clock time, no unseeded randomness, no host I/O.
The same input always produces the same filesystem, so every puzzle solution is
replayed headlessly in CI.

**Solution-agnostic.** Puzzle goals assert on world *state*, never on what the
player typed. `sed`, a Python one-liner, or a text editor all pass — including
routes nobody anticipated.

A unit refuses to start when its configuration is invalid, and the reason
lands in `systemctl status` — which is how a systems concept becomes a puzzle
without anything being faked:

```
$ sudo systemctl start scrubber
Job for scrubber.service failed: O2_TARGET=16 outside breathable range 19-23
See 'systemctl status scrubber' for details.
```

The whole Machine is 18 kB gzipped.

---

## Security posture

A game that runs player-authored code has real attack surface, so the rules are
written down rather than assumed. Player Python runs only inside Pyodide in a
Web Worker. The host context never calls `eval` on player input. Content packs
are data, never remote modules. No third-party SDKs. Saves are local; nothing
is collected.

Full detail in [CLAUDE.md](CLAUDE.md) and [docs/PLAN.md](docs/PLAN.md).

---

## Licence

Apache 2.0. See [LICENSE](LICENSE).
