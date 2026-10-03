import type { Machine } from '../machine.js';
import type { Firewall } from './firewall.js';

export interface HttpResponse {
  status: number;
  body: string;
  contentType?: string;
}

/** The /24 an address sits in. Every subnet here is a /24; see `routed`. */
export const subnetOf = (ip: string): string => ip.split('.').slice(0, 3).join('.');

export interface NetHost {
  hostname: string;
  /** The primary address. `addresses[0]`, kept as a field because everything reads it. */
  ip: string;
  /**
   * Every address this host answers to, primary first.
   *
   * More than one means more than one interface, which in practice means a
   * router: a box with a leg in two subnets is what joining two subnets looks
   * like, and modelling it as one host with two addresses is both simpler and
   * truer than inventing a link layer.
   */
  addresses: string[];
  /**
   * The INPUT chain, when somebody has given this host one.
   *
   * Absent means no filtering at all, which is what every adventure before
   * this had and must keep having. Mutable because `iptables` edits it.
   */
  firewall?: Firewall;
  /**
   * Does this host forward between the subnets it is on?
   *
   * An address in two subnets does not by itself make a router -- forwarding
   * is a thing somebody turned on, and a box that has both legs and is not
   * forwarding is a real and maddening failure.
   */
  router: boolean;
  /** The host *is* a Machine. That is what makes ssh real rather than scripted. */
  machine: Machine;
  /** Open ports, port -> service banner. A closed port is simply absent. */
  ports: Map<number, string>;
  /**
   * Of those ports, the ones bound to 127.0.0.1 rather than every address.
   *
   * A service listening on loopback answers on its own machine and refuses
   * everybody else, while `systemctl` reports it active and the log shows it
   * started cleanly. It is one of the most common ways a working service looks
   * like a broken one, and it cannot be diagnosed by asking whether the
   * service is running -- only by asking what it is listening on, which is
   * what `ss` is for.
   *
   * A port absent from this set is bound to 0.0.0.0, which is the ordinary
   * case and why this is a set of exceptions rather than a field per port.
   */
  loopback: Set<number>;
  /** Accounts that may log in over ssh, by name. */
  accounts: Map<string, { uid: number; gid: number }>;
  /** Powered on and on the network. */
  up: boolean;
  /**
   * Optional dynamic HTTP handler.
   *
   * Without one, an open port 80 or 8080 serves files from /srv/http on the
   * host's own filesystem — so "put up a web server" is a filesystem task,
   * which is both truer and more useful than a special case.
   */
  http?: (path: string, host: NetHost) => HttpResponse;
}

export interface HostOptions {
  hostname: string;
  ip: string;
  /** Extra addresses beyond `ip`. See `NetHost.addresses`. */
  ips?: readonly string[];
  /** Forwards between its subnets. See `NetHost.router`. */
  router?: boolean;
  /** The INPUT chain. See `NetHost.firewall`. */
  firewall?: Firewall;
  machine: Machine;
  ports?: Record<number, string>;
  /** Ports bound to 127.0.0.1 only. See `NetHost.loopback`. */
  loopback?: readonly number[];
  accounts?: Record<string, { uid: number; gid: number }>;
  up?: boolean;
  http?: NetHost['http'];
}

/**
 * A small internet.
 *
 * Every host is a full Machine with its own filesystem, processes and
 * services, so `ssh node01 'systemctl status slurmd'` is doing exactly what
 * it appears to be doing. Nothing about a remote host is special-cased.
 */
export class Network {
  private hosts = new Map<string, NetHost>();

  add(opts: HostOptions): NetHost {
    const host: NetHost = {
      hostname: opts.hostname,
      ip: opts.ip,
      addresses: [opts.ip, ...(opts.ips ?? [])],
      router: opts.router ?? false,
      ...(opts.firewall ? { firewall: opts.firewall } : {}),
      machine: opts.machine,
      ports: new Map(Object.entries(opts.ports ?? {}).map(([p, b]) => [Number(p), b])),
      loopback: new Set(opts.loopback ?? []),
      accounts: new Map(Object.entries(opts.accounts ?? {})),
      up: opts.up ?? true,
      ...(opts.http ? { http: opts.http } : {}),
    };
    this.hosts.set(host.hostname, host);
    return host;
  }

  /**
   * Resolve by hostname or by any address this host answers to.
   *
   * This is the network's own map -- the engine's DNS. `src/net/resolver.ts`
   * is what the commands actually call, because a machine's `/etc/hosts` is
   * consulted before this is.
   */
  resolve(nameOrIp: string): NetHost | undefined {
    const byName = this.hosts.get(nameOrIp);
    if (byName) return byName;
    for (const host of this.hosts.values()) {
      if (host.addresses.includes(nameOrIp)) return host;
    }
    return undefined;
  }

  /**
   * Can a packet from one host get to an address?
   *
   * Two subnets, one hop, and that is the whole of routing here. Within a /24
   * hosts reach each other directly. Across one they need a box with a leg in
   * both that is up and is forwarding -- three separate things that can be
   * wrong, which is the reason this is modelled at all.
   *
   * No multi-hop, no metrics, no asymmetric routes. A second hop needs a
   * topology nobody can see from inside the game, and a route table that
   * cannot be read is not a thing to teach with.
   */
  routed(from: NetHost | undefined, to: string): boolean {
    // A machine the network has never heard of reaches everything, which is
    // how every adventure before this behaved and must keep behaving.
    if (!from) return true;
    const target = subnetOf(to);
    if (from.addresses.some((address) => subnetOf(address) === target)) return true;

    return this.list().some(
      (host) =>
        host.router &&
        host.up &&
        host.addresses.some((a) => subnetOf(a) === target) &&
        host.addresses.some((a) => from.addresses.some((mine) => subnetOf(a) === subnetOf(mine))),
    );
  }

  /** The gateway this host sends off-subnet traffic to, if it has one. */
  gatewayFor(host: NetHost): string | undefined {
    for (const candidate of this.list()) {
      if (!candidate.router || candidate === host) continue;
      const shared = candidate.addresses.find((a) =>
        host.addresses.some((mine) => subnetOf(a) === subnetOf(mine)),
      );
      if (shared) return shared;
    }
    return undefined;
  }

  list(): NetHost[] {
    return [...this.hosts.values()].sort((a, b) => a.hostname.localeCompare(b.hostname));
  }

  has(nameOrIp: string): boolean {
    return this.resolve(nameOrIp) !== undefined;
  }

  setUp(hostname: string, up: boolean): void {
    const host = this.hosts.get(hostname);
    if (host) host.up = up;
  }

  /** Serve a path from a host, either dynamically or from /srv/http. */
  serve(host: NetHost, path: string): HttpResponse {
    if (host.http) return host.http(path, host);

    const clean = path.split('?')[0] ?? '/';
    const file = clean.endsWith('/') ? `${clean}index.html` : clean;
    const full = `/srv/http${file}`;

    try {
      const body = host.machine.vfs.readText(full, { uid: 0, gid: 0, name: 'root' });
      return { status: 200, body, contentType: guessType(full) };
    } catch {
      return { status: 404, body: '404 Not Found\n', contentType: 'text/plain' };
    }
  }
}

function guessType(path: string): string {
  if (path.endsWith('.html') || path.endsWith('.htm')) return 'text/html';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.js')) return 'text/javascript';
  return 'text/plain';
}

/** Where the player currently is. `ssh` pushes, `exit` pops. */
export interface Session {
  /** Machines the player has hopped through. Empty means the local machine. */
  stack: Machine[];
}
