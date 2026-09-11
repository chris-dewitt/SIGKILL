import * as p from '../vfs/path.js';
import { ROOT_USER } from '../vfs/vfs.js';
import { run, type CommandSpec, type ShellContext } from '../shell/exec.js';
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
      const host = ctx.network!.resolve(target);

      if (!host) {
        io.err(`ping: ${target}: Name or service not known\n`);
        return 2;
      }

      io.out(`PING ${host.hostname} (${host.ip}) 56(84) bytes of data.\n`);

      if (!host.up) {
        // Each probe still costs time; that is how a player feels a dead host.
        await ctx.advance(count * 1000);
        emit(io, [
          '',
          `--- ${host.hostname} ping statistics ---`,
          `${count} packets transmitted, 0 received, 100% packet loss`,
        ]);
        return 1;
      }

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
        `--- ${host.hostname} ping statistics ---`,
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
      const host = ctx.network!.resolve(hostname);

      if (!host) {
        io.err(`ssh: Could not resolve hostname ${hostname}: Name or service not known\n`);
        return 255;
      }
      if (!host.up) {
        io.err(`ssh: connect to host ${hostname} port 22: No route to host\n`);
        return 255;
      }
      if (!host.ports.has(22)) {
        io.err(`ssh: connect to host ${hostname} port 22: Connection refused\n`);
        return 255;
      }

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

      const endpoint = (spec: { host?: string; path: string }): { vfs: typeof ctx.vfs; path: string } | undefined => {
        if (!spec.host) return { vfs: ctx.vfs, path: ctx.resolve(spec.path) };
        const { host: hostname } = splitTarget(spec.host);
        const host = ctx.network!.resolve(hostname);
        if (!host || !host.up || !host.ports.has(22)) return undefined;
        return { vfs: host.machine.vfs, path: spec.path };
      };

      const from = endpoint(source);
      const to = endpoint(target);
      if (!from) {
        io.err(`scp: ${operands[0]}: Could not reach host\n`);
        return 1;
      }
      if (!to) {
        io.err(`scp: ${operands[1]}: Could not reach host\n`);
        return 1;
      }

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
      'Only http:// is implemented. A host serves /srv/http unless it has a\n' +
      'handler of its own.',
    plain:
      'Fetches a page or a file from a machine over the network and prints\n' +
      'what comes back:\n' +
      '  curl http://gateway/status',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      const url = operands[0];
      if (!url) return usage(io, 'usage: curl [-sI] URL');
      if (!requireNetwork(ctx, 'curl', io)) return 2;

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

      const host = ctx.network!.resolve(hostname);
      if (!host || !host.up) {
        io.err(`curl: (6) Could not resolve host: ${hostname}\n`);
        return 6;
      }

      const port = Number(portText ?? 80);
      if (!host.ports.has(port)) {
        io.err(`curl: (7) Failed to connect to ${hostname} port ${port}: Connection refused\n`);
        return 7;
      }

      const response = ctx.network!.serve(host, path);

      if (flags.has('-I')) {
        emit(io, [
          `HTTP/1.1 ${response.status} ${response.status === 200 ? 'OK' : 'Not Found'}`,
          `Content-Type: ${response.contentType ?? 'text/plain'}`,
          `Content-Length: ${response.body.length}`,
        ]);
        return 0;
      }

      io.out(response.body);
      if (response.status >= 400 && !flags.has('-s')) {
        io.err(`curl: (22) The requested URL returned error: ${response.status}\n`);
        return 22;
      }
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
      const host = ctx.network!.resolve(hostname!);

      if (!host || !host.up) {
        io.err(`nc: getaddrinfo for host "${hostname}" port ${port}: Name or service not known\n`);
        return 1;
      }
      const banner = host.ports.get(port);
      if (banner === undefined) {
        io.err(`nc: connect to ${hostname} port ${port} (tcp) failed: Connection refused\n`);
        return 1;
      }
      io.err(`Connection to ${hostname} ${port} port [tcp/*] succeeded!\n`);
      io.out(`${banner}\n`);
      return 0;
    },
  },
];
