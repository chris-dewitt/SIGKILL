import { subnetOf, type CommandSpec, type NetHost, type ShellContext } from '@sigkill/machine';

/**
 * Which addresses this machine has, and where its packets go.
 *
 * The two questions `ss` cannot answer. `ss` says a service is listening on
 * 0.0.0.0; it does not say whether the address somebody is trying to reach
 * belongs to this machine at all, and it says nothing whatever about why a
 * host two subnets away is unreachable.
 *
 * Both answers are short here because the model is small on purpose: every
 * subnet is a /24, routing is one hop, and a box with a leg in two subnets is
 * one host with two addresses, which is what a router actually is. What the
 * model will not do is printed nowhere and documented in `Network.routed` --
 * no metrics, no multi-hop, no asymmetric routes. A route table that cannot be
 * read is not a thing to teach with.
 */

function self(ctx: ShellContext): NetHost | undefined {
  return ctx.network?.resolve(ctx.hostname);
}

/** eth0, eth1, … in the order the host declares its addresses. */
const device = (index: number): string => `eth${index}`;

function addrLines(host: NetHost): string[] {
  const rows = [
    '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536',
    '    inet 127.0.0.1/8 scope host lo',
  ];
  for (const [index, address] of host.addresses.entries()) {
    const dev = device(index);
    rows.push(`${index + 2}: ${dev}: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500`);
    rows.push(`    inet ${address}/24 brd ${subnetOf(address)}.255 scope global ${dev}`);
  }
  return rows;
}

function routeLines(ctx: ShellContext, host: NetHost): string[] {
  const rows: string[] = [];
  const gateway = ctx.network?.gatewayFor(host);
  if (gateway) {
    // Which of this host's legs the gateway is on decides the device, and a
    // default route out of the wrong interface is a thing people ship.
    const index = host.addresses.findIndex((a) => subnetOf(a) === subnetOf(gateway));
    rows.push(`default via ${gateway} dev ${device(Math.max(0, index))}`);
  }
  for (const [index, address] of host.addresses.entries()) {
    rows.push(`${subnetOf(address)}.0/24 dev ${device(index)} proto kernel scope link src ${address}`);
  }
  return rows;
}

export function interfaceCommands(): CommandSpec[] {
  return [
    {
      name: 'ip',
      summary: 'show this machine’s addresses and routes',
      manual:
        'ip addr        every address this machine answers to\n' +
        'ip route       where its packets go\n' +
        '\n' +
        'Both can be shortened: ip a, ip r.\n' +
        '\n' +
        'An address of 10.0.1.20/24 means this machine is 10.0.1.20 and\n' +
        'reaches 10.0.1.0 to 10.0.1.255 directly. Anything outside that range\n' +
        'goes to the default route, and if there is no default route it goes\n' +
        'nowhere -- which looks exactly like the other machine being down.\n' +
        '\n' +
        'A host with two addresses has a leg in two subnets. That is what a\n' +
        'router is, and it only forwards if somebody turned forwarding on.',
      plain:
        'Shows what address this machine has, and where it sends traffic that\n' +
        'is not local:\n' +
        '  ip addr\n' +
        '  ip route\n' +
        'The /24 at the end of an address is the range it can reach without\n' +
        'help. Everything else needs the default route.',
      run: (ctx, argv, io) => {
        const host = self(ctx);
        if (!host) {
          io.err('ip: this machine has no network interface\n');
          return 1;
        }

        const object = argv[1] ?? '';
        const rows = object.startsWith('a')
          ? addrLines(host)
          : object.startsWith('r')
            ? routeLines(ctx, host)
            : undefined;

        if (!rows) {
          io.err('usage: ip addr | ip route\n');
          return 1;
        }
        for (const row of rows) io.out(`${row}\n`);
        return 0;
      },
    },
  ];
}
