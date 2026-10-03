import { subnetOf } from './network.js';

/**
 * Packets that never arrive, and the difference between the two ways that
 * happens.
 *
 * This is in the engine for the same reason resolution is: `reach()` decides
 * what every connecting command says, and `packages/machine` depends on
 * nothing. `@sigkill/net` owns `iptables`, which is the instrument.
 *
 * The distinction worth the whole file:
 *
 *   REJECT  something answered, and the answer was no.  Connection refused.
 *   DROP    nothing answered at all.                    Connection timed out.
 *
 * An operator who knows that reads a failure and already knows half the
 * answer. `refused` means a machine is there and nothing is listening, or a
 * rule said no out loud. A timeout means the packet went into something that
 * did not reply -- a drop rule, a device in the middle, a host that is gone --
 * and the next question is a different question entirely.
 *
 * The engine models the INPUT chain and nothing else. There is no forwarding
 * chain, no NAT, no connection tracking and no output filtering, because
 * nothing here needs them and a ruleset with five empty chains in it teaches
 * that the chains are decoration.
 */

export type Action = 'ACCEPT' | 'DROP' | 'REJECT';

export interface Rule {
  readonly action: Action;
  /** TCP destination port. Absent matches every port. */
  readonly port?: number;
  /**
   * Source, as an address (`10.0.1.10`) or a /24 (`10.0.1.0/24`).
   *
   * Absent matches every source, which is what a rule with no `-s` means.
   */
  readonly source?: string;
}

export interface Firewall {
  /** What happens to a packet no rule matched. */
  readonly policy: Action;
  /** In order. The first match decides, as it does in the real chain. */
  readonly rules: readonly Rule[];
}

export const OPEN: Firewall = { policy: 'ACCEPT', rules: [] };

/** Does a rule's source clause cover this address? */
function matchesSource(source: string | undefined, from: string | undefined): boolean {
  if (source === undefined) return true;
  // Without a source address there is nothing to compare, so a rule that
  // narrows by source cannot match. That only happens when the engine does not
  // know who is calling, and refusing to guess is the safe way round.
  if (from === undefined) return false;
  if (source.endsWith('/24')) return subnetOf(source.slice(0, -3)) === subnetOf(from);
  return source === from;
}

/**
 * What the chain does with one packet.
 *
 * No firewall at all is `ACCEPT`, which is why every adventure written before
 * this one is unaffected: a host nobody gave rules to filters nothing.
 */
export function verdict(firewall: Firewall | undefined, port: number, from?: string): Action {
  if (!firewall) return 'ACCEPT';
  for (const rule of firewall.rules) {
    if (rule.port !== undefined && rule.port !== port) continue;
    if (!matchesSource(rule.source, from)) continue;
    return rule.action;
  }
  return firewall.policy;
}

/** One rule, in the words `iptables -S` prints it. */
export function ruleSpec(rule: Rule): string {
  const parts = ['-A INPUT'];
  if (rule.source) parts.push(`-s ${rule.source}`);
  parts.push('-p tcp');
  if (rule.port !== undefined) parts.push(`--dport ${rule.port}`);
  parts.push(`-j ${rule.action}`);
  return parts.join(' ');
}
