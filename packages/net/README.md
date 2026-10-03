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

## Where this machine is, and where its packets go

| Command | What it asks |
|---------|--------------|
| `ip addr` | every address this machine answers to |
| `ip route` | the subnet it reaches directly, and the gateway for everything else |

Every subnet is a /24. Routing is one hop: within a /24 hosts reach each other
directly, and across one they need a box with a leg in both that is up *and*
forwarding. Those are three separate things that can be wrong and all three
come out as `No route to host`, which is correct and is why the route table is
worth reading.

A box with two addresses is one host with two legs, which is what a router is.
`Network.routed` says what the model will not do: no multi-hop, no metrics, no
asymmetric routes. A route table nobody can read is not a thing to teach with.

## What is dropping the packet

| Command | What it asks |
|---------|--------------|
| `iptables -L`, `-S` | the INPUT chain, and its policy |
| `iptables -A/-I/-D INPUT … -j ACTION` | change it (root only) |
| `iptables -P INPUT ACTION` | what happens to everything no rule matched |

The distinction worth the whole thing:

```
REJECT   something answered, and the answer was no    Connection refused
DROP     nothing answered at all                      Connection timed out
```

A refusal is instant; a drop makes the other end wait and then give up, and
this engine charges the player that wait, because the wait *is* the symptom. A
dropped port also looks exactly the same whether or not anything is listening
behind it, which is why a firewall is diagnosed by reading the rules rather
than by poking the port.

Only the INPUT chain, only TCP, no NAT, no connection tracking, no `-m`
anything. An unknown flag is refused rather than accepted and ignored: an
interface that takes a flag it does not honour is worse than one that says no.

TLS last or never.
