import type { User } from '../vfs/types.js';
import type { Vfs } from '../vfs/vfs.js';
import type { NetHost, Network } from './network.js';

/**
 * Turning a name into an address, as two sources rather than one map.
 *
 * `Network.resolve()` answered both halves of the question at once -- does
 * this name exist, and is anything answering at it -- which made every failure
 * the same failure. That was recorded as a boundary in `probe-net.test.ts`:
 * there was nothing to read, nothing to edit, and nothing to get wrong, so
 * there was nothing to teach.
 *
 * This splits it. A name is resolved to an *address* first, by `/etc/hosts` if
 * the machine has one and by the network's own map if it does not -- the same
 * order `hosts: files dns` gives on a real box, and the reason a stale line in
 * that file beats a correct DNS record. Only then is the address asked whether
 * anything is there.
 *
 * Which means the engine can now express the failure that matters most and
 * could not be expressed before: **the name resolved and the address is
 * wrong.** A host nobody knows, a host that is off, and a host that is simply
 * not where the file says it is are three different sentences, and telling
 * them apart is the first diagnostic move in operations.
 *
 * The file belongs to the machine doing the resolving, not to the player. A
 * hosts file on the bastion does not follow them over ssh, because the first
 * thing anybody learns about a hosts file is that the box they have been paged
 * about does not have theirs.
 */

export const HOSTS_FILE = '/etc/hosts';

/**
 * Where an answer came from.
 *
 * `dns` is the network's own map. `loopback` is the machine itself, which
 * every machine knows about without being told and no file is required to
 * state.
 */
export type Via = 'hosts' | 'dns' | 'loopback';

export type Resolution =
  /** A name, an address, and something answering at it. */
  | { readonly kind: 'host'; readonly host: NetHost; readonly ip: string; readonly via: Via }
  /**
   * A name and an address, and nothing at that address.
   *
   * The resolution worked. The connection is what will fail, and every tool
   * must say so in those words -- this is the state that makes a hosts file
   * worth having in the engine.
   */
  | { readonly kind: 'address'; readonly ip: string; readonly via: Via }
  /** Nothing anywhere knows this name. */
  | { readonly kind: 'unknown' };

export interface HostsEntry {
  readonly ip: string;
  /** Canonical name first, then aliases, exactly as the line has them. */
  readonly names: readonly string[];
}

const DOTTED_QUAD = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The whole 127/8 block is this machine, as it is on any machine. */
const LOOPBACK = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Is this already an address, rather than something to look up? */
export const isAddress = (text: string): boolean => DOTTED_QUAD.test(text);

/**
 * Parse a hosts file.
 *
 * Deliberately forgiving in the ways the real one is -- any run of whitespace
 * separates, `#` starts a comment anywhere on the line, blank lines are
 * nothing -- and deliberately unforgiving in the way the real one is too: a
 * line whose first field is not an address is not an entry, so a player who
 * writes `api01 10.0.1.10` the wrong way round gets no resolution rather than
 * a helpful correction. Being quietly fixed up is how you fail to learn what
 * the file is.
 */
export function parseHosts(text: string): HostsEntry[] {
  const entries: HostsEntry[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0] ?? '';
    const fields = line.trim().split(/\s+/).filter((f) => f.length > 0);
    const [ip, ...names] = fields;
    if (ip === undefined || names.length === 0 || !isAddress(ip)) continue;
    entries.push({ ip, names });
  }
  return entries;
}

/**
 * Read the machine's hosts file, or nothing at all.
 *
 * Read as the calling user, because resolution happens in the process asking
 * the question -- a hosts file nobody can read is a hosts file that does not
 * answer, and the lookup falls through to the next source exactly as it would
 * on a real machine. Absent and unreadable are therefore the same thing here,
 * which is both simpler and true.
 */
export function readHosts(vfs: Vfs, user: User): HostsEntry[] {
  try {
    return parseHosts(vfs.readText(HOSTS_FILE, user));
  } catch {
    return [];
  }
}

/**
 * Resolve a name or an address from one machine's point of view.
 *
 * An address is never looked up: `curl http://10.0.1.10/` asks that address
 * whether anything is there, and a hosts file has nothing to say about it.
 */
export function lookup(
  net: Network,
  vfs: Vfs,
  user: User,
  nameOrIp: string,
  /** The machine asking, so that 127.0.0.1 and `localhost` mean something. */
  self?: string,
): Resolution {
  const here = self === undefined ? undefined : net.resolve(self);

  const at = (ip: string, via: Via): Resolution => {
    /*
     * 127.0.0.1 is whoever is asking.
     *
     * Not a host on the network and never routed to one: the loopback address
     * is the machine itself, which is why a service bound to it can be reached
     * from the box and from nowhere else. Without this the engine had no way
     * to express the connection that is supposed to succeed.
     */
    if (LOOPBACK.test(ip) && here) return { kind: 'host', host: here, ip, via: 'loopback' };
    const host = net.list().find((candidate) => candidate.ip === ip);
    return host ? { kind: 'host', host, ip, via } : { kind: 'address', ip, via };
  };

  if (isAddress(nameOrIp)) return at(nameOrIp, 'dns');

  for (const entry of readHosts(vfs, user)) {
    if (entry.names.includes(nameOrIp)) return at(entry.ip, 'hosts');
  }

  /*
   * `localhost`, with or without a hosts file.
   *
   * Every machine in this engine answers to it, because every machine outside
   * this engine does -- and a player typing `curl http://localhost/health` on
   * the box they are standing on should not have to be taught that this
   * particular computer is missing a line most computers have. A hosts file
   * that says otherwise is consulted first and wins, as above.
   */
  if (nameOrIp === 'localhost' && here) {
    return { kind: 'host', host: here, ip: '127.0.0.1', via: 'loopback' };
  }

  // Nothing in the file, so ask the network -- which is this engine's DNS, and
  // is the only source the first five adventures have ever had.
  const host = net.resolve(nameOrIp);
  return host ? { kind: 'host', host, ip: host.ip, via: 'dns' } : { kind: 'unknown' };
}

/**
 * The reachability of a resolution, as the three sentences a tool must say.
 *
 * Kept here rather than in each command so `ssh`, `curl`, `scp` and `nc`
 * cannot drift apart about what went wrong -- which they had, before this:
 * three of them named the failure and `scp` called every one of them "Could
 * not reach host".
 */
export type Reach =
  | { readonly kind: 'ok'; readonly host: NetHost }
  | { readonly kind: 'unknown-host' }
  | { readonly kind: 'no-route'; readonly ip: string }
  | { readonly kind: 'refused'; readonly host: NetHost };

export function reach(resolution: Resolution, port: number, from?: string): Reach {
  if (resolution.kind === 'unknown') return { kind: 'unknown-host' };
  // An address with nothing at it and a host that is powered off are the same
  // packet going nowhere, and the real tools say the same thing about both.
  if (resolution.kind === 'address') return { kind: 'no-route', ip: resolution.ip };
  if (!resolution.host.up) return { kind: 'no-route', ip: resolution.ip };
  if (!resolution.host.ports.has(port)) return { kind: 'refused', host: resolution.host };
  /*
   * Listening, and not to you.
   *
   * A port bound to 127.0.0.1 answers its own machine and refuses every other,
   * with exactly the same message a closed port gives -- which is the whole
   * difficulty of the thing. `from` is the hostname of the machine making the
   * connection, so a command running on the host itself gets through.
   */
  if (resolution.host.loopback.has(port) && from !== resolution.host.hostname) {
    return { kind: 'refused', host: resolution.host };
  }
  return { kind: 'ok', host: resolution.host };
}
