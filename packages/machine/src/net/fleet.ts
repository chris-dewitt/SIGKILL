import { Machine, type MachineOptions, type MachineSnapshot } from '../machine.js';
import type { Firewall } from './firewall.js';
import { Network, type NetHost, type Session } from './network.js';

/**
 * Saving a world that is more than one machine.
 *
 * `MachineSnapshot` is a correct snapshot of one machine and was all any
 * adventure needed until game six, where the work happens on hosts that are
 * not the one the player is sitting at. A save that keeps only the local
 * machine loses every rollback, every restarted service and every edited unit
 * file, while the questbook -- stored separately -- goes on reporting the
 * objectives as met. The game would be lying to the player about their own
 * progress, which is the worst thing a save can do.
 *
 * This lives in its own module rather than on `Network` because restoring
 * needs the `Machine` *class*, and `machine.ts` already imports this
 * directory's types. A leaf that imports both sides is cheaper than a cycle.
 *
 * What a snapshot carries is data. What it cannot carry -- the adventure's
 * commands, a host's HTTP handler, a service precondition -- is supplied again
 * on restore by the caller, exactly as `Machine.restore` already requires for
 * a single machine.
 */

export interface HostSnapshot {
  hostname: string;
  ip: string;
  /** Every address, primary first. Absent in saves written before interfaces existed. */
  ips?: string[];
  /** Forwards between its subnets. */
  router?: boolean;
  /** The INPUT chain, when the host has one. */
  firewall?: Firewall;
  /** Port to banner. An array because a Map is not JSON. */
  ports: [number, string][];
  /** Of those, the ones bound to loopback. Absent in saves written before it existed. */
  loopback?: number[];
  accounts: [string, { uid: number; gid: number }][];
  up: boolean;
  machine: MachineSnapshot;
}

export interface FleetSnapshot {
  version: 1;
  hosts: HostSnapshot[];
  /**
   * Where the player was standing, as hostnames, outermost first.
   *
   * Saved because it is observable: the prompt says which host you are on, and
   * a save that drops it puts somebody back somewhere else with no event to
   * explain the change.
   */
  session: string[];
}

export interface Fleet {
  network: Network;
  session: Session;
  /** Every machine on the network, by hostname. */
  machines: Map<string, Machine>;
}

/**
 * What the caller has to put back.
 *
 * Called once per host, before that host's machine is built, so an adventure
 * can give each one its own commands and its own HTTP handler.
 */
export type WireHost = (hostname: string) => {
  options?: Omit<MachineOptions, 'network' | 'session' | 'snapshot'>;
  http?: NetHost['http'];
};

export function snapshotFleet(network: Network, session: Session): FleetSnapshot {
  return {
    version: 1,
    hosts: network.list().map((host) => ({
      hostname: host.hostname,
      ip: host.ip,
      ips: [...host.addresses],
      router: host.router,
      ...(host.firewall ? { firewall: host.firewall } : {}),
      ports: [...host.ports.entries()],
      loopback: [...host.loopback],
      accounts: [...host.accounts.entries()],
      up: host.up,
      machine: host.machine.snapshot(),
    })),
    session: session.stack.map((machine) => machine.shell.hostname),
  };
}

export function restoreFleet(snap: FleetSnapshot, wire: WireHost): Fleet {
  const network = new Network();
  // One session object, shared by every machine on the network, or `ssh` on
  // one host pushes onto a stack the others cannot see.
  const session: Session = { stack: [] };
  const machines = new Map<string, Machine>();

  for (const host of snap.hosts) {
    const { options, http } = wire(host.hostname);
    const machine = Machine.restore(host.machine, {
      ...options,
      hostname: host.hostname,
      network,
      session,
    });
    machines.set(host.hostname, machine);
    network.add({
      hostname: host.hostname,
      ip: host.ip,
      // The primary is already `ip`, so only the rest go back as extras.
      ips: (host.ips ?? [host.ip]).slice(1),
      router: host.router ?? false,
      ...(host.firewall ? { firewall: host.firewall } : {}),
      machine,
      ports: Object.fromEntries(host.ports),
      loopback: host.loopback ?? [],
      accounts: Object.fromEntries(host.accounts),
      up: host.up,
      ...(http ? { http } : {}),
    });
  }

  /*
   * Put the player back where they were standing.
   *
   * A hostname in the stack that is no longer on the network is dropped rather
   * than restored as a hole: a save from a version of the adventure with a
   * host that has since been removed should put somebody back at the bastion,
   * not into undefined.
   */
  for (const hostname of snap.session) {
    const machine = machines.get(hostname);
    if (machine) session.stack.push(machine);
  }

  return { network, session, machines };
}
