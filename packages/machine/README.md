# @sigkill/machine

A deterministic virtual computer. Every SIGKILL adventure runs on one.

Zero runtime dependencies. Runs in Node and in a browser. 21 kB gzipped,
57 commands.

```ts
import { Machine, ROOT_USER } from '@sigkill/machine';

const m = new Machine({ hostname: 'nav7' });
m.vfs.mkdirp('/etc', ROOT_USER);
m.vfs.writeText('/etc/motd', 'all hands lost\n', ROOT_USER);

await m.exec('grep hands /etc/motd');   // { stdout: 'all hands lost\n', code: 0 }
```

## What it contains

| Area | What works |
|------|-----------|
| **Filesystem** | inodes, POSIX permissions against real uid/gid, symlinks with loop detection, errno-shaped failures, exact snapshot round-trip |
| **Shell** | quoting, globbing, pipes, `&&`/`\|\|`/`;`, redirection, subshells, parameter expansion, `$?`, command substitution, `&` background lists |
| **Coreutils** | `ls cat cd pwd echo grep head tail wc sort uniq cut tr sed find mkdir rmdir rm cp mv touch ln chmod stat` |
| **Processes** | process table, `ps`, `kill`, systemd units, `systemctl`, `sudo` via `/etc/sudoers` |
| **Jobs & time** | virtual clock, `sleep`, `jobs`, `wait`, `cron` with a real `/etc/crontab` |
| **Network** | `ssh` (command or session), `scp`, `curl`, `nc`, `ping` — every host is another Machine |
| **Python** | via an interface; `@sigkill/python` supplies Pyodide |

## The two properties everything rests on

**Deterministic.** No `Date.now()`, no `Math.random()`, no host I/O. Time
moves only through `tick(ms)`. Identical input produces byte-identical
snapshots, which is what lets every puzzle be replayed headlessly in CI.

**Snapshottable.** `m.snapshot()` captures filesystem, processes, services,
jobs, environment and clock. `Machine.restore(snap)` brings it back exactly.
A save file is a Machine snapshot and nothing else.

## Key types

```ts
class Machine {
  readonly vfs: Vfs;
  readonly procs: ProcessTable;
  readonly services: ServiceManager;
  readonly jobs: JobTable;
  readonly shell: ShellContext;
  python: PythonRuntime | undefined;

  exec(input: string): Promise<RunResult & { cleared: boolean }>;
  tick(ms: number): Promise<void>;
  setPrecondition(unit: string, check: Precondition): void;
  snapshot(): MachineSnapshot;
  static restore(snap: MachineSnapshot, opts?: MachineOptions): Machine;
  get prompt(): string;
  get active(): Machine;   // follows ssh
}
```

A `CommandSpec` is the unit of extension:

```ts
{
  name: 'df',
  summary: 'report filesystem usage',
  manual: 'Show used and available space.',   // Operators
  plain:  'Shows how much room is left.',      // Cadets
  run: (ctx, argv, io) => { io.out('...'); return 0; },
}
```

`ctx` carries everything a command may touch — `vfs`, `user`, `cwd`, `env`,
`procs`, `services`, `jobs`, `network`, `session`, `clock`, `advance`.
Commands read and write the VFS **as `ctx.user`**; they never check
permissions by hand.

## Before you change anything

- [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) — the map, and a
  full trace of one command from keypress to changed filesystem
- [../../docs/DECISIONS.md](../../docs/DECISIONS.md) — why it is like this
- [../../docs/TESTING.md](../../docs/TESTING.md) — the determinism harness and
  the goal-predicate pattern

```bash
pnpm --filter @sigkill/machine test
```
