import {
  OPEN,
  ruleSpec,
  type Action,
  type CommandSpec,
  type Firewall,
  type NetHost,
  type Rule,
  type ShellContext,
} from '@sigkill/machine';

/**
 * The rules, as the thing an operator actually types.
 *
 * `packages/machine` decides what a dropped packet does, because `reach()` is
 * what every connecting command goes through. This is the chain you can read
 * and change, which is the half that makes it a puzzle rather than a wall.
 *
 * Only the INPUT chain and only what fits on it: a policy, an action, a TCP
 * port and a source. No NAT, no forwarding chain, no connection tracking, no
 * `-m` anything. The real tool's surface is enormous and nine tenths of it
 * would be decoration here — and an interface that accepts a flag it does not
 * honour is worse than one that refuses it, so unknown flags are refused.
 *
 * Editing needs root, as it does on a real machine, which is also what makes
 * `sudo` mean something on the floor where this matters.
 */

function self(ctx: ShellContext): NetHost | undefined {
  return ctx.network?.resolve(ctx.hostname);
}

const chainOf = (host: NetHost): Firewall => host.firewall ?? OPEN;

const ACTIONS: readonly Action[] = ['ACCEPT', 'DROP', 'REJECT'];
const isAction = (text: string): text is Action => (ACTIONS as readonly string[]).includes(text);

interface Parsed {
  rule: Rule;
  /** Where in the chain: `-A` appends, `-I` goes first. */
  position: 'append' | 'insert';
}

/** Parse the rule flags of one `iptables -A/-I/-D INPUT …` line. */
function parseRule(args: string[], position: Parsed['position']): Parsed | string {
  let port: number | undefined;
  let source: string | undefined;
  let action: Action | undefined;
  let protocol = 'tcp';

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case '-p':
        if (!value) return 'iptables: option "-p" requires an argument';
        protocol = value;
        i++;
        break;
      case '--dport':
        if (!value || Number.isNaN(Number(value))) return 'iptables: --dport needs a port number';
        port = Number(value);
        i++;
        break;
      case '-s':
        if (!value) return 'iptables: option "-s" requires an argument';
        source = value;
        i++;
        break;
      case '-j':
        if (!value || !isAction(value)) return `iptables: unknown target "${value ?? ''}"`;
        action = value;
        i++;
        break;
      default:
        return `iptables: unknown option "${flag ?? ''}"`;
    }
  }

  if (protocol !== 'tcp') return 'iptables: only -p tcp is modelled on this machine';
  if (!action) return 'iptables: a rule needs -j ACCEPT, -j DROP or -j REJECT';
  return {
    rule: { action, ...(port === undefined ? {} : { port }), ...(source ? { source } : {}) },
    position,
  };
}

const same = (a: Rule, b: Rule): boolean =>
  a.action === b.action && a.port === b.port && a.source === b.source;

export function firewallCommands(): CommandSpec[] {
  return [
    {
      name: 'iptables',
      summary: 'read and change the packet filter',
      manual:
        'iptables -L [-n]                     list the INPUT chain\n' +
        'iptables -S                          list it as the commands that built it\n' +
        'iptables -A INPUT  ... -j ACTION     add a rule at the end\n' +
        'iptables -I INPUT  ... -j ACTION     add a rule at the front\n' +
        'iptables -D INPUT  ... -j ACTION     delete the rule that matches\n' +
        'iptables -P INPUT ACTION             set what happens to everything else\n' +
        '\n' +
        'A rule may narrow by port and by source:\n' +
        '  -p tcp --dport 5432       that port\n' +
        '  -s 10.0.1.0/24            from that subnet\n' +
        '  -s 10.0.1.10              from that address\n' +
        '\n' +
        'The first rule that matches decides; the policy applies to anything no\n' +
        'rule matched. ACCEPT lets the packet through, REJECT answers no, and\n' +
        'DROP says nothing at all -- which is the difference between a\n' +
        'connection that is refused immediately and one that hangs and then\n' +
        'times out.\n' +
        '\n' +
        'Only the INPUT chain and only TCP. Changing it needs root.',
      plain:
        'Shows and changes the rules about what traffic this machine accepts:\n' +
        '  iptables -L\n' +
        '  sudo iptables -A INPUT -p tcp --dport 5432 -j ACCEPT\n' +
        '\n' +
        'DROP and REJECT both stop traffic, but they fail differently: REJECT\n' +
        'answers "no" straight away, DROP says nothing and the other end waits\n' +
        'until it gives up. If something hangs, suspect a DROP.',
      run: (ctx, argv, io) => {
        const host = self(ctx);
        if (!host) {
          io.err('iptables: this machine has no network interface\n');
          return 1;
        }
        const args = argv.slice(1);
        const command = args[0] ?? '-L';
        const chain = chainOf(host);

        if (command === '-L' || command === '--list') {
          io.out(`Chain INPUT (policy ${chain.policy})\n`);
          io.out(`${'target'.padEnd(8)}${'prot'.padEnd(6)}${'source'.padEnd(18)}destination\n`);
          for (const rule of chain.rules) {
            const where = rule.port === undefined ? 'anywhere' : `tcp dpt:${rule.port}`;
            io.out(
              `${rule.action.padEnd(8)}${'tcp'.padEnd(6)}${(rule.source ?? 'anywhere').padEnd(18)}${where}\n`,
            );
          }
          return 0;
        }

        if (command === '-S') {
          io.out(`-P INPUT ${chain.policy}\n`);
          for (const rule of chain.rules) io.out(`${ruleSpec(rule)}\n`);
          return 0;
        }

        // Everything below changes the chain.
        if (ctx.user.uid !== 0) {
          io.err('iptables: Permission denied (you must be root)\n');
          return 4;
        }

        if (command === '-P') {
          const [, target, action] = args;
          if (target !== 'INPUT') {
            io.err('iptables: only the INPUT chain exists on this machine\n');
            return 2;
          }
          if (!action || !isAction(action)) {
            io.err('iptables: the policy must be ACCEPT, DROP or REJECT\n');
            return 2;
          }
          host.firewall = { policy: action, rules: [...chain.rules] };
          return 0;
        }

        if (command === '-A' || command === '-I' || command === '-D') {
          if (args[1] !== 'INPUT') {
            io.err('iptables: only the INPUT chain exists on this machine\n');
            return 2;
          }
          const parsed = parseRule(args.slice(2), command === '-I' ? 'insert' : 'append');
          if (typeof parsed === 'string') {
            io.err(`${parsed}\n`);
            return 2;
          }

          if (command === '-D') {
            const index = chain.rules.findIndex((rule) => same(rule, parsed.rule));
            if (index < 0) {
              io.err('iptables: Bad rule (does a matching rule exist in that chain?)\n');
              return 1;
            }
            host.firewall = {
              policy: chain.policy,
              rules: chain.rules.filter((_, at) => at !== index),
            };
            return 0;
          }

          host.firewall = {
            policy: chain.policy,
            rules:
              parsed.position === 'insert'
                ? [parsed.rule, ...chain.rules]
                : [...chain.rules, parsed.rule],
          };
          return 0;
        }

        io.err(`iptables: unknown command "${command}"\n`);
        return 2;
      },
    },
  ];
}
