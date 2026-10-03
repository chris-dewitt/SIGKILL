import {
  HOSTS_FILE,
  isAddress,
  lookup,
  readHosts,
  type CommandSpec,
  type Network,
  type ShellContext,
} from '@sigkill/machine';

/**
 * The tools you reach for when resolution is the thing that is wrong.
 *
 * And the split that makes them worth having: **`dig` and `host` ask DNS.
 * `getent` asks the resolver.** On a real machine those are different
 * questions, and a player who has not met the difference will spend an hour
 * proving the DNS record is correct while the program in front of them
 * connects somewhere else entirely.
 *
 * That is not a trick. It is the single most common way a name breaks on a box
 * somebody has been maintaining for years: a line was put in `/etc/hosts` to
 * get through an afternoon, the afternoon ended, and every tool anybody checks
 * with reads straight past it.
 *
 * `packages/machine` owns resolution because `ssh`, `curl`, `scp`, `nc` and
 * `ping` all resolve and that package depends on nothing. This one owns the
 * instruments.
 */

/** The fiction's resolver address. One nameserver, and it is the network. */
const NAMESERVER = '10.0.0.53';

const TTL = 3600;

function requireNetwork(ctx: ShellContext, tool: string, io: { err(t: string): void }): boolean {
  if (ctx.network) return true;
  io.err(`${tool}: this machine has no network interface\n`);
  return false;
}

/**
 * DNS, and only DNS.
 *
 * Deliberately not `lookup()`: these tools go straight to the nameserver, so
 * they cannot see a hosts file and must not. Everything interesting this
 * package can teach comes from that being true.
 */
function queryDns(net: Network, name: string): string | undefined {
  if (isAddress(name)) return net.list().find((h) => h.ip === name)?.ip;
  return net.resolve(name)?.ip;
}

/** Reverse: an address back to the name the network knows it by. */
function reverseDns(net: Network, ip: string): string | undefined {
  return net.list().find((host) => host.ip === ip)?.hostname;
}

export function dnsCommands(): CommandSpec[] {
  return [
    {
      name: 'dig',
      summary: 'ask the nameserver about a name',
      manual:
        'Query DNS.\n' +
        '  dig NAME          the full answer\n' +
        '  dig NAME +short   the address alone\n' +
        '  dig -x ADDRESS    the name that address is known by\n' +
        '\n' +
        'dig talks to the nameserver and nothing else. It does not read\n' +
        '/etc/hosts, so it is not an answer to "why is this program\n' +
        'connecting to the wrong machine" -- getent hosts is.\n' +
        '\n' +
        'It exits 0 when the server answered, including when the answer is\n' +
        'NXDOMAIN. `dig name +short && echo ok` prints ok for a name that does\n' +
        'not exist.',
      plain:
        'Asks the name server what address a name points at.\n' +
        '  dig api01 +short\n' +
        'It asks the server directly, so it will not show you anything local\n' +
        'that is overriding the answer. For that, use:  getent hosts api01',
      run: (ctx, argv, io) => {
        if (!requireNetwork(ctx, 'dig', io)) return 1;
        const args = argv.slice(1);
        const short = args.includes('+short');
        const reverse = args.includes('-x');
        const name = args.find((a) => !a.startsWith('+') && !a.startsWith('-'));
        if (name === undefined) {
          io.err('usage: dig [-x] NAME [+short]\n');
          return 1;
        }

        const net = ctx.network!;
        if (reverse) {
          const found = reverseDns(net, name);
          if (short) {
            if (found) io.out(`${found}.\n`);
            return 0;
          }
          io.out(`\n; <<>> DiG 9.18 <<>> -x ${name}\n`);
          io.out(
            `;; ->>HEADER<<- opcode: QUERY, status: ${found ? 'NOERROR' : 'NXDOMAIN'}, id: 1\n\n`,
          );
          io.out(';; QUESTION SECTION:\n');
          io.out(`;${name}.\t\t\tIN\tPTR\n\n`);
          if (found) {
            io.out(';; ANSWER SECTION:\n');
            io.out(`${name}.\t${TTL}\tIN\tPTR\t${found}.\n\n`);
          }
          io.out(`;; SERVER: ${NAMESERVER}#53\n`);
          return 0;
        }

        const answer = queryDns(net, name);
        if (short) {
          // Nothing at all for a name that does not exist, and still exit 0.
          if (answer) io.out(`${answer}\n`);
          return 0;
        }

        io.out(`\n; <<>> DiG 9.18 <<>> ${name}\n`);
        io.out(
          `;; ->>HEADER<<- opcode: QUERY, status: ${answer ? 'NOERROR' : 'NXDOMAIN'}, id: 1\n\n`,
        );
        io.out(';; QUESTION SECTION:\n');
        io.out(`;${name}.\t\t\tIN\tA\n\n`);
        if (answer) {
          io.out(';; ANSWER SECTION:\n');
          io.out(`${name}.\t${TTL}\tIN\tA\t${answer}\n\n`);
        }
        io.out(`;; SERVER: ${NAMESERVER}#53\n`);
        return 0;
      },
    },

    {
      name: 'host',
      summary: 'look a name up in DNS, in one line',
      manual:
        'host NAME       the address for a name\n' +
        'host ADDRESS    the name for an address\n' +
        '\n' +
        'The same question dig asks, with none of the ceremony. Like dig, it\n' +
        'reads no local file.\n' +
        '\n' +
        'Unlike dig it exits 1 when the name is not found, which makes it the\n' +
        'one of the two that is safe to put in a script.',
      plain:
        'Asks the name server for the address of a name, and says the answer\n' +
        'in one line:\n' +
        '  host api01\n' +
        'If the name does not exist it says so and fails, which dig does not.',
      run: (ctx, argv, io) => {
        if (!requireNetwork(ctx, 'host', io)) return 1;
        const name = argv[1];
        if (name === undefined) {
          io.err('usage: host NAME\n');
          return 1;
        }

        const net = ctx.network!;
        if (isAddress(name)) {
          const found = reverseDns(net, name);
          if (!found) {
            io.err(`Host ${name} not found: 3(NXDOMAIN)\n`);
            return 1;
          }
          io.out(`${name}.in-addr.arpa domain name pointer ${found}.\n`);
          return 0;
        }

        const answer = queryDns(net, name);
        if (!answer) {
          io.err(`Host ${name} not found: 3(NXDOMAIN)\n`);
          return 1;
        }
        io.out(`${name} has address ${answer}\n`);
        return 0;
      },
    },

    {
      name: 'getent',
      summary: 'ask the resolver what a program would actually get',
      manual:
        'getent hosts [NAME]\n' +
        '\n' +
        'Look a name up the way an ordinary program does: /etc/hosts first,\n' +
        'then DNS. This is the answer ssh, curl and everything else will act\n' +
        'on, which is what makes it different from dig.\n' +
        '\n' +
        'With no NAME it lists what it can enumerate, which is the hosts file.\n' +
        'DNS cannot be listed, only asked.\n' +
        '\n' +
        'Exits 2 when the name is not found.',
      plain:
        'Looks up a name the same way a normal program does -- the local file\n' +
        'first, then the name server:\n' +
        '  getent hosts api01\n' +
        'If this and dig disagree, the local file is the reason, and this one\n' +
        'is the answer your program is using.',
      run: (ctx, argv, io) => {
        const database = argv[1];
        if (database === undefined) {
          io.err('usage: getent hosts [NAME]\n');
          return 1;
        }
        if (database !== 'hosts') {
          io.err(`getent: Unknown database: ${database}\n`);
          return 2;
        }
        if (!requireNetwork(ctx, 'getent', io)) return 1;

        const key = argv[2];
        if (key === undefined) {
          /*
           * Everything it can enumerate, which is the file and not DNS.
           *
           * A resolver answers questions; it does not hand over a list. An
           * empty answer here means an empty hosts file, never an empty
           * network, and the manual says so.
           */
          for (const entry of readHosts(ctx.vfs, ctx.user)) {
            io.out(`${entry.ip.padEnd(15)} ${entry.names.join(' ')}\n`);
          }
          return 0;
        }

        const resolution = lookup(ctx.network!, ctx.vfs, ctx.user, key);
        if (resolution.kind === 'unknown') return 2;
        // The canonical name as the source gave it: the file's first name for
        // the entry, or the network's own hostname.
        const names =
          resolution.via === 'hosts'
            ? (readHosts(ctx.vfs, ctx.user).find((e) => e.names.includes(key))?.names ?? [key])
            : [resolution.kind === 'host' ? resolution.host.hostname : key];
        io.out(`${resolution.ip.padEnd(15)} ${names.join(' ')}\n`);
        return 0;
      },
    },
  ];
}

export { HOSTS_FILE };
