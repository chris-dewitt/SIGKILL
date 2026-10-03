import type { CommandSpec, NetHost, ShellContext } from '@sigkill/machine';

/**
 * What is listening, and where it is listening.
 *
 * The second question is the one worth the package. "Is the service running"
 * is answered by `systemctl` and is almost never the problem; "is it listening
 * on an address I can reach from here" is answered by nothing else, and is the
 * difference between a service that is broken and a service that is fine and
 * bound to 127.0.0.1.
 *
 * That failure is worth describing because of how it presents. The unit is
 * active. The journal says it started cleanly. The port is open — on the box.
 * From anywhere else the connection is refused, with the same message a port
 * nobody opened would give. Nothing except this command distinguishes them.
 *
 * **No Recv-Q or Send-Q.** The real tool prints them and this one does not,
 * because this engine has no queues and filling two columns with plausible
 * zeroes would be the output lying. A column that is always the same number is
 * not data, and a player who learns to read it here would be learning to read
 * something that is not there.
 */

/** The host as the network sees it, which is where ports live. */
function self(ctx: ShellContext): NetHost | undefined {
  return ctx.network?.resolve(ctx.hostname);
}

interface Socket {
  port: number;
  banner: string;
  address: string;
}

function listening(host: NetHost): Socket[] {
  return [...host.ports.entries()]
    .map(([port, banner]) => ({
      port,
      banner,
      address: host.loopback.has(port) ? '127.0.0.1' : '0.0.0.0',
    }))
    .sort((a, b) => a.port - b.port);
}

export function socketCommands(): CommandSpec[] {
  return [
    {
      name: 'ss',
      summary: 'show the sockets this machine is listening on',
      manual:
        'ss [-ltn]\n' +
        '  -l   listening sockets\n' +
        '  -t   TCP\n' +
        '  -n   numeric: do not turn ports into service names\n' +
        '\n' +
        'The Local Address column is the one to read. 0.0.0.0 means every\n' +
        'address, so anything that can route to this machine can connect.\n' +
        '127.0.0.1 means this machine only: the service is running, the port\n' +
        'is open, and a connection from anywhere else is refused in exactly\n' +
        'the same words a closed port uses.\n' +
        '\n' +
        'Without -l there is nothing to show, because this machine keeps no\n' +
        'established connections between commands.\n' +
        '\n' +
        'Recv-Q and Send-Q are not printed. There are no queues here, and two\n' +
        'columns of zeroes would be a measurement of nothing.',
      plain:
        'Shows which doors this machine has open:\n' +
        '  ss -ltn\n' +
        'Look at the address next to the port. 0.0.0.0 means anyone who can\n' +
        'reach this machine can use it. 127.0.0.1 means only this machine\n' +
        'can -- which is why something can be running and still refuse you.',
      run: (ctx, argv, io) => {
        const host = self(ctx);
        if (!host) {
          io.err('ss: this machine has no network interface\n');
          return 1;
        }
        const flags = argv.slice(1).join('');
        const rows = flags.includes('l') ? listening(host) : [];

        io.out(`${'State'.padEnd(8)}${'Local Address:Port'.padEnd(22)}Service\n`);
        for (const socket of rows) {
          io.out(
            `${'LISTEN'.padEnd(8)}${`${socket.address}:${socket.port}`.padEnd(22)}${socket.banner}\n`,
          );
        }
        return 0;
      },
    },

    {
      name: 'netstat',
      summary: 'show listening sockets, the older way',
      manual:
        'netstat [-ltn]\n' +
        '\n' +
        'The same question ss answers, in the tool that came first. Learn ss;\n' +
        'this is here because every runbook written before about 2015 says\n' +
        'netstat and somebody will type it.\n' +
        '\n' +
        'The Local Address column means what it means under ss: 0.0.0.0 is\n' +
        'every address, 127.0.0.1 is this machine and nobody else.',
      plain:
        'An older command that shows the same thing as ss:\n' +
        '  netstat -ltn\n' +
        'If you have read an old guide, this is the name it will use.',
      run: (ctx, argv, io) => {
        const host = self(ctx);
        if (!host) {
          io.err('netstat: this machine has no network interface\n');
          return 1;
        }
        const flags = argv.slice(1).join('');
        const rows = flags.includes('l') ? listening(host) : [];

        io.out('Active Internet connections (only servers)\n');
        io.out(`${'Proto'.padEnd(6)}${'Local Address'.padEnd(22)}${'State'.padEnd(8)}Service\n`);
        for (const socket of rows) {
          io.out(
            `${'tcp'.padEnd(6)}${`${socket.address}:${socket.port}`.padEnd(22)}` +
              `${'LISTEN'.padEnd(8)}${socket.banner}\n`,
          );
        }
        return 0;
      },
    },
  ];
}
