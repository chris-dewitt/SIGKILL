# @sigkill/net

The tools that make name resolution something you can look at.

`packages/machine` owns resolution itself — `/etc/hosts` first, then the
network's own map, which is this engine's DNS. That has to be in the engine,
because `ssh`, `curl`, `scp`, `nc` and `ping` all resolve and `packages/machine`
has no dependencies.

This package is the other half: the commands an operator runs when resolution
is the thing that is wrong.

| Command | What it asks |
|---------|--------------|
| `dig` | DNS, directly. Never reads `/etc/hosts`. |
| `host` | the same question, in one line |
| `getent hosts` | what an *application* gets — the file, then DNS |

That split is the package's whole point and the reason it is worth having. On a
real machine `dig` talking to DNS while `curl` talks to the resolver is how a
stale line in `/etc/hosts` survives for months: every tool anybody reaches for
to check says the right answer, and the only thing that disagrees is the
program that is actually failing.

```
$ dig api01 +short
10.0.1.10
$ getent hosts api01
10.0.9.99       api01
```

## What is listening, and where

| Command | What it asks |
|---------|--------------|
| `ss -ltn` | which ports this machine is listening on, and on which address |
| `netstat -ltn` | the same, in the tool every pre-2015 runbook names |

The address column is the lesson. `0.0.0.0` is every address; `127.0.0.1` is
this machine and nobody else — the service is running, the unit is active, the
journal is clean, and every connection from anywhere else is refused in exactly
the words a closed port uses. Nothing but `ss` tells those two apart.

Neither prints Recv-Q or Send-Q. There are no queues in this engine, and two
columns of plausible zeroes would be a measurement of nothing.

Still to come, in the order a game would want them: `ip addr` and `ip route`,
then a firewall. TLS last or never.
