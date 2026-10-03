import type { Machine } from '../machine.js';

export interface HttpResponse {
  status: number;
  body: string;
  contentType?: string;
}

export interface NetHost {
  hostname: string;
  ip: string;
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

  /** Resolve by hostname or by address — this is the whole of DNS for now. */
  resolve(nameOrIp: string): NetHost | undefined {
    const byName = this.hosts.get(nameOrIp);
    if (byName) return byName;
    for (const host of this.hosts.values()) {
      if (host.ip === nameOrIp) return host;
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
