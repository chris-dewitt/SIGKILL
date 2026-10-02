import {
  Machine,
  Network,
  restoreFleet,
  snapshotFleet,
  type FleetSnapshot,
  type Session,
  type Track,
} from '@sigkill/machine';
import { editorCommands } from '@sigkill/editor';
import {
  Questbook,
  questCommands,
  type QuestSnapshot,
  type World,
} from '@sigkill/quest';
import { DEPOSIT_OBJECTIVES } from './objectives.js';
import { HOME, HOSTS, PEOPLE, indexHandler, ownWorkspace, seedFloor } from './act1/floor.js';

/**
 * Game six: The Deposit.
 *
 * The first adventure that is more than one machine, and the first in which
 * DeWitt is responsible for something staying up rather than for working out
 * what was true. Five games of establishing facts; this is the one where the
 * facts are other people's and his job is that they remain retrievable.
 *
 * The antagonist is an infrastructure nobody wrote down, which is the honest
 * antagonist of every operations job there has ever been. Nothing on this
 * floor was sabotaged and nobody was negligent: a datastore died, left a lock,
 * and the check that watched it asked the only question it knew how to ask.
 */

/** The morning Pell hands it over. */
export const FLOOR_MS = Date.UTC(2398, 6, 14, 7, 30);

export interface DepositOptions {
  track?: Track;
}

export interface Deposit {
  /** The machine the player types at. The others are reached over ssh. */
  machine: Machine;
  questbook: Questbook;
  network: Network;
  session: Session;
}

export interface DepositSnapshot {
  fleet: FleetSnapshot;
  quest: QuestSnapshot;
}

export function depositCommands(questbook: Questbook) {
  return [...questCommands(questbook, { speaker: 'LUNA' }), ...editorCommands()];
}

/**
 * What each host gets.
 *
 * Only the bastion carries the quest commands and the editor. The deposit
 * hosts get neither, which is not a shortcut: `objectives` is something
 * DeWitt's own terminal does, and a machine holding evidence does not run the
 * assistant's tooling. It is the same rule that keeps LUNA off them.
 */
function hostOptions(hostname: string, questbook: Questbook, track: Track) {
  return hostname === 'bastion'
    ? { track, commands: depositCommands(questbook) }
    : { track };
}

function handlerFor(hostname: string) {
  return hostname === 'index01' ? indexHandler : undefined;
}

export function bootDeposit(opts: DepositOptions = {}): Deposit {
  const track = opts.track ?? 'operator';
  const questbook = new Questbook(DEPOSIT_OBJECTIVES, { track });
  const network = new Network();
  const session: Session = { stack: [] };

  const floor = seedFloor((hostname) =>
    new Machine({
      hostname,
      epoch: FLOOR_MS,
      network,
      session,
      ...hostOptions(hostname, questbook, track),
    }),
  );

  for (const host of HOSTS) {
    const machine =
      host.hostname === 'bastion'
        ? floor.bastion
        : host.hostname === 'vault01'
          ? floor.vault
          : host.hostname === 'index01'
            ? floor.index
            : floor.relay;
    const http = handlerFor(host.hostname);
    network.add({
      hostname: host.hostname,
      ip: host.ip,
      machine,
      ports: { ...host.ports },
      accounts: { ...host.accounts },
      ...(http ? { http } : {}),
    });
  }

  floor.bastion.shell.cwd = HOME;
  return { machine: floor.bastion, questbook, network, session };
}

export function restoreDeposit(snap: DepositSnapshot, opts: DepositOptions = {}): Deposit {
  const track = opts.track ?? 'operator';
  const questbook = new Questbook(DEPOSIT_OBJECTIVES, { track });
  questbook.restore(snap.quest);

  const fleet = restoreFleet(snap.fleet, (hostname) => {
    const http = handlerFor(hostname);
    return {
      options: { epoch: FLOOR_MS, ...hostOptions(hostname, questbook, track) },
      ...(http ? { http } : {}),
    };
  });

  const bastion = fleet.machines.get('bastion');
  if (!bastion) throw new Error('The Deposit: a save with no bastion in it.');

  return {
    machine: bastion,
    questbook,
    network: fleet.network,
    session: fleet.session,
  };
}

export function snapshotDeposit(deposit: Deposit): DepositSnapshot {
  return {
    fleet: snapshotFleet(deposit.network, deposit.session),
    quest: deposit.questbook.snapshot(),
  };
}

/**
 * The world an objective looks at.
 *
 * The bastion, plus the network -- which is how a goal reaches the three hosts
 * where nearly everything in this act actually happens.
 */
export function worldOf(deposit: Deposit): World {
  return deposit.machine;
}

export { ownWorkspace, PEOPLE };
