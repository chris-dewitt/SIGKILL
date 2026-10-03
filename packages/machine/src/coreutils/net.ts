import * as p from '../vfs/path.js';
import { ROOT_USER } from '../vfs/vfs.js';
import { run, type CommandSpec, type ShellContext } from '../shell/exec.js';
import { lookup, reach, type Reach, type Resolution } from '../net/resolver.js';
import { emit, parseArgs, usage } from './helpers.js';

/** Split `[user@]host` into its parts. */
function splitTarget(target: string): { user?: string; host: string } {
  const at = target.indexOf('@');
  if (at < 0) return { host: target };
  return { user: target.slice(0, at), host: target.slice(at + 1) };
}

/** Split `host:/path` into its parts, leaving a bare path local. */
function splitRemotePath(spec: string): { host?: string; path: string } {
  const colon = spec.indexOf(':');
  // A Windows-style drive letter is not a thing here, so any colon is a host.
  if (colon < 0) return { path: spec };
  return { host: spec.slice(0, colon), path: spec.slice(colon + 1) };
}

function requireNetwork(ctx: ShellContext, tool: string, io: { err(t: string): void }): boolean {
  if (ctx.network) return true;
  io.err(`${tool}: this machine has no network interface\n`);
  return false;
}

/**
 * Resolve a name from the point of view of the machine running the command.
 *
 * `ctx.vfs` and `ctx.user`, not the network's map alone: `/etc/hosts` belongs
 * to the host doing the asking, so a command run over ssh reads the remote
 * machine's file and never the one the player edited at home.
 */
const resolveFrom = (ctx: ShellContext, nameOrIp: string): Resolution =>
  lookup(ctx.network!, ctx.vfs, ctx.user, nameOrIp, ctx.hostname);

/**
 * The same three failures, in the same words, for every tool here.
 *
 * `ctx.hostname` goes with the question because a service bound to loopback
 * answers its own machine and refuses every other, and the engine cannot tell
 * those apart without knowing who is asking.
 */
const reachFrom = (ctx: ShellContext, nameOrIp: string, port: number): Reach =>
  reach(resolveFrom(ctx, nameOrIp), port, ctx.hostname);

export const netCommands: CommandSpec[] = [
  {
    name: 'ping',
    summary: 'test whether a host is reachable',
    manual:
      'Send probes to a host and report whether it answers.\n' +
      '  -c N   stop after N probes (default 4)',
    plain:
      'Asks a machine whether it is there. If you get replies it is up and\n' +
      'you can reach it; if you get nothing, either it is off or the path to\n' +
      'it is broken.',
    run: async (ctx, argv, io) => {
      const { values, operands } = parseArgs(argv, { valued: ['-c'] });
      const target = operands[0];
      if (!target) return usage(io, 'usage: ping [-c count] host');
      if (!requireNetwork(ctx, 'ping', io)) return 1;

      const count = Math.max(1, Math.min(10, Number(values.get('-c') ?? 4)));
      const resolution = resolveFrom(ctx, target);

      if (resolution.kind === 'unknown') {
        io.err(`ping: ${target}: Name or service not known\n`);
        return 2;
      }

      /*
       * The address came back; whether anything is at it is the next question.
       *
       * A name pointed at an empty address pings that address and hears
       * nothing, and printing the address it actually used is what lets
       * somebody notice it is not the address they expected.
       */
      io.out(`PING ${target} (${resolution.ip}) 56(84) bytes of data.\n`);

      if (resolution.kind === 'address' || !resolution.host.up) {
        // Each probe still costs time; that is how a player feels a dead host.
        await ctx.advance(count * 1000);
        emit(io, [
          '',
          `--- ${target} ping statistics ---`,
          `${count} packets transmitted, 0 received, 100% packet loss`,
        ]);
        return 1;
      }

      const host = resolution.host;
      const rows: string[] = [];
      for (let i = 0; i < count; i++) {
        // Deterministic latency derived from the address, not from a clock.
        const rtt = 0.4 + (host.ip.split('.').reduce((a, b) => a + Number(b), 0) % 30) / 10;
        rows.push(
          `64 bytes from ${host.hostname} (${host.ip}): icmp_seq=${i + 1} ttl=64 time=${rtt.toFixed(1)} ms`,
        );
        await ctx.advance(1000);
      }
      emit(io, [
        ...rows,
        '',
        `--- ${target} ping statistics ---`,
        `${count} packets transmitted, ${count} received, 0% packet loss`,
      ]);
      return 0;
    },
  },

  {
    name: 'ssh',
    summary: 'run a command on another machine, or log into it',
    manual:
      'Connect to a host.\n' +
      '  ssh [user@]host           open a session; `exit` returns here\n' +
      '  ssh [user@]host COMMAND   run one command there and come back\n' +
      'Port 22 must be open and the account must exist on the remote host.',
    plain:
      'Logs you into another machine over the network.\n' +
      '  ssh node01              you are now typing on node01; exit comes back\n' +
      "  ssh node01 'ls /data'   run one command there without moving\n" +
      'Your prompt changes to show which machine you are on. Watch it.',
    run: async (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      const target = operands[0];
      if (!target) return usage(io, 'usage: ssh [user@]host [command]');
      if (!requireNetwork(ctx, 'ssh', io)) return 255;

      const { user, host: hostname } = splitTarget(target);
      const reached = reachFrom(ctx, hostname, 22);

      if (reached.kind === 'unknown-host') {
        io.err(`ssh: Could not resolve hostname ${hostname}: Name or service not known\n`);
        return 255;
      }
      if (reached.kind === 'no-route') {
        io.err(`ssh: connect to host ${hostname} port 22: No route to host\n`);
        return 255;
      }
      if (reached.kind === 'refused') {
        io.err(`ssh: connect to host ${hostname} port 22: Connection refused\n`);
        return 255;
      }
      const host = reached.host;

      const login = user ?? ctx.user.name;
      const account = host.accounts.get(login);
      if (!account) {
        io.err(`${login}@${hostname}: Permission denied (publickey).\n`);
        return 255;
      }

      const remote = host.machine;
      remote.shell.user = { uid: account.uid, gid: account.gid, name: login };

      // One command: run it there, report here, stay where we are.
      const command = operands.slice(1).join(' ');
      if (command.length > 0) {
        const result = await run(remote.shell, command);
        io.out(result.stdout);
        io.err(result.stderr);
        return result.code;
      }

      // No command: move the session. `exit` on the remote pops back.
      if (!ctx.session) {
        io.err('ssh: interactive sessions are not available here\n');
        return 255;
      }
      ctx.session.stack.push(remote);
      io.out(`Last login: never\n`);
      return 0;
    },
  },

  {
    name: 'scp',
    summary: 'copy a file to or from another machine',
    manual:
      'Copy between hosts.\n' +
      '  scp local [user@]host:remote\n' +
      '  scp [user@]host:remote local',
    plain:
      'Copies a file between this machine and another one. Put host: in\n' +
      'front of the side that is remote:\n' +
      '  scp notes.txt node01:/tmp/notes.txt',
    run: (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      if (operands.length < 2) return usage(io, 'usage: scp source target');
      if (!requireNetwork(ctx, 'scp', io)) return 1;

      const source = splitRemotePath(operands[0]!);
      const target = splitRemotePath(operands[1]!);

      if (source.host && target.host) {
        return usage(io, 'scp: copying between two remote hosts is not supported');
      }

      /*
       * Which of the three went wrong, in the same words ssh uses.
       *
       * This said `Could not reach host` for every failure, including a name
       * that does not exist -- so the one tool a player reaches for after a
       * failed deploy was the one tool that would not tell them where to look.
       */
      type End = { vfs: typeof ctx.vfs; path: string };
      const endpoint = (spec: { host?: string; path: string }): End | string => {
        if (!spec.host) return { vfs: ctx.vfs, path: ctx.resolve(spec.path) };
        const { host: hostname } = splitTarget(spec.host);
        const reached = reachFrom(ctx, hostname, 22);
        if (reached.kind === 'unknown-host') {
          return `ssh: Could not resolve hostname ${hostname}: Name or service not known`;
        }
        if (reached.kind === 'no-route') {
          return `ssh: connect to host ${hostname} port 22: No route to host`;
        }
        if (reached.kind === 'refused') {
          return `ssh: connect to host ${hostname} port 22: Connection refused`;
        }
        return { vfs: reached.host.machine.vfs, path: spec.path };
      };

      const from = endpoint(source);
      const to = endpoint(target);
      // scp's own failures come out of the ssh it is built on, which is why
      // the wording is ssh's and the second line is scp's.
      const unreachable = typeof from === 'string' ? from : typeof to === 'string' ? to : undefined;
      if (unreachable !== undefined) {
        io.err(`${unreachable}\n`);
        io.err('scp: lost connection\n');
        return 1;
      }
      if (typeof from === 'string' || typeof to === 'string') return 1;

      try {
        const bytes = from.vfs.read(from.path, source.host ? ROOT_USER : ctx.user);
        // A remote target that is an existing directory takes the basename,
        // as scp does.
        let destination = to.path;
        if (to.vfs.exists(destination, ROOT_USER) && to.vfs.stat(destination, ROOT_USER).kind === 'dir') {
          destination = p.join(destination, p.basename(from.path));
        }
        to.vfs.write(destination, bytes, target.host ? ROOT_USER : ctx.user);
        io.out(`${p.basename(from.path)}  100%  ${bytes.length}\n`);
        return 0;
      } catch (e) {
        io.err(`scp: ${e instanceof Error && 'reason' in e ? (e as { reason: string }).reason : String(e)}\n`);
        return 1;
      }
    },
  },

  {
    name: 'curl',
    summary: 'fetch a URL',
    manual:
      'Transfer a URL.\n' +
      '  -s   silent; no progress or error chatter\n' +
      '  -I   headers only\n' +
      '  -o   write the body to a file instead of stdout\n' +
      '  -f   fail on an HTTP error: no body, exit 22\n' +
      'Without -f, an HTTP error is still a successful transfer and curl\n' +
      'exits 0 -- the error page is the body. That catches people out and it\n' +
      'is what the real tool does.\n' +
      'Only http:// is implemented. A host serves /srv/http unless it has a\n' +
      'handler of its own.',
    plain:
      'Fetches a page or a file from a machine over the network and prints\n' +
      'what comes back:\n' +
      '  curl http://gateway/status\n' +
      'A 404 still counts as a successful fetch unless you pass -f. Checking\n' +
      'that something is healthy means checking what came back, not just that\n' +
      'curl was happy.',
    run: (ctx, argv, io) => {
      const { flags, values, operands } = parseArgs(argv, {
        flags: ['-s', '--silent', '-I', '--head', '-f', '--fail'],
        valued: ['-o', '--output'],
      });
      const url = operands[0];
      if (!url) return usage(io, 'usage: curl [-sIf] [-o FILE] URL');
      if (!requireNetwork(ctx, 'curl', io)) return 2;
      const silent = flags.has('-s') || flags.has('--silent');
      const headersOnly = flags.has('-I') || flags.has('--head');
      const failFast = flags.has('-f') || flags.has('--fail');
      const outFile = values.get('-o') ?? values.get('--output');

      const parsed = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/[^\s]*)?$/.exec(url);
      if (!parsed) {
        io.err(`curl: (3) URL rejected: Bad hostname\n`);
        return 3;
      }
      const [, scheme = 'http', hostname = '', portText, path = '/'] = parsed;
      if (scheme === 'https') {
        io.err(`curl: (60) SSL certificate problem: no trust store on this machine\n`);
        return 60;
      }

      /*
       * Three different failures, three different answers.
       *
       * A host that is powered off still has a name, so reporting it as a
       * name-resolution failure teaches the wrong first question when
       * something stops answering. `ssh` already distinguishes these; curl
       * collapsed the first two and said DNS for all of them.
       */
      const port = Number(portText ?? 80);
      const reached = reachFrom(ctx, hostname, port);
      if (reached.kind === 'unknown-host') {
        io.err(`curl: (6) Could not resolve host: ${hostname}\n`);
        return 6;
      }
      if (reached.kind === 'no-route') {
        io.err(`curl: (7) Failed to connect to ${hostname} port ${port}: No route to host\n`);
        return 7;
      }
      if (reached.kind === 'refused') {
        io.err(`curl: (7) Failed to connect to ${hostname} port ${port}: Connection refused\n`);
        return 7;
      }

      const response = ctx.network!.serve(reached.host, path);
      const statusText = response.status === 200 ? 'OK' : 'Not Found';

      if (headersOnly) {
        emit(io, [
          `HTTP/1.1 ${response.status} ${statusText}`,
          `Content-Type: ${response.contentType ?? 'text/plain'}`,
          `Content-Length: ${response.body.length}`,
        ]);
        return 0;
      }

      /*
       * The gotcha this exists to teach.
       *
       * An HTTP error is a *successful transfer*: the server was reached and
       * it answered. curl exits 0 and hands you the error page, which is how
       * a health check that only looks at the exit status passes while the
       * service is returning 500 to everybody. `-f` is how you ask for the
       * other behaviour, and it throws the body away so the error page cannot
       * end up in the file or the pipe.
       */
      if (failFast && response.status >= 400) {
        if (!silent) {
          io.err(`curl: (22) The requested URL returned error: ${response.status}\n`);
        }
        return 22;
      }

      if (outFile !== undefined) {
        try {
          ctx.vfs.writeText(ctx.resolve(outFile), response.body, ctx.user);
        } catch {
          io.err(`curl: (23) Failure writing output to destination\n`);
          return 23;
        }
        return 0;
      }

      io.out(response.body);
      return 0;
    },
  },

  {
    name: 'nc',
    summary: 'check whether a port is open',
    manual:
      'Probe a TCP port.\n' +
      '  -z   scan only, do not send data\n' +
      '  -v   report the outcome',
    plain:
      'Checks whether a machine is listening on a given port:\n' +
      '  nc -zv gateway 22\n' +
      'Useful when ssh or curl fails and you want to know whether anything\n' +
      'is answering at all.',
    run: (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      if (operands.length < 2) return usage(io, 'usage: nc [-zv] host port');
      if (!requireNetwork(ctx, 'nc', io)) return 1;

      const [hostname, portText] = operands;
      const port = Number(portText);
      const reached = reachFrom(ctx, hostname!, port);

      // As with curl: a host that is off is not a host that does not exist,
      // and telling a player otherwise sends them to look at DNS.
      if (reached.kind === 'unknown-host') {
        io.err(`nc: getaddrinfo for host "${hostname}" port ${port}: Name or service not known\n`);
        return 1;
      }
      if (reached.kind === 'no-route') {
        io.err(`nc: connect to ${hostname} port ${port} (tcp) failed: No route to host\n`);
        return 1;
      }
      if (reached.kind === 'refused') {
        io.err(`nc: connect to ${hostname} port ${port} (tcp) failed: Connection refused\n`);
        return 1;
      }
      io.err(`Connection to ${hostname} ${port} port [tcp/*] succeeded!\n`);
      io.out(`${reached.host.ports.get(port)}\n`);
      return 0;
    },
  },
];
