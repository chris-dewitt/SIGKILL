import {
  Machine,
  Network,
  ROOT_USER,
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
  type AdventureSnapshot,
  type BeatLine,
  type QuestSnapshot,
  type World,
} from '@sigkill/quest';
import { DEPOSIT_ART, DEPOSIT_OBJECTIVES } from './objectives.js';
import { ACCESS_LOG, storeCommands } from './store.js';
import {
  HOME,
  HOSTS,
  LEDGER,
  PEOPLE,
  indexHandler,
  ledgerHandler,
  ownWorkspace,
  seedFloor,
  seedLedger,
} from './act1/floor.js';

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
 * assistant's tooling. It is the same rule that keeps LUNA off them, written
 * down on those hosts in /etc/deposit/policy and on this one in
 * /etc/luna/scope.
 *
 * `deposit` goes the other way, and only onto vault01. The store's retrieval
 * tool lives on the store, because that is the only place it could: it reads
 * material nobody else can open and writes the access record as it does. A
 * copy of it on the bastion would be a copy with nothing to read.
 */
function hostOptions(hostname: string, questbook: Questbook, track: Track) {
  if (hostname === 'bastion') return { track, commands: depositCommands(questbook) };
  if (hostname === 'vault01') return { track, commands: storeCommands() };
  return { track };
}

function handlerFor(hostname: string) {
  if (hostname === 'index01') return indexHandler;
  if (hostname === LEDGER.hostname) return ledgerHandler;
  return undefined;
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
    const machine = floor.machines.get(host.hostname);
    if (!machine) throw new Error(`The Deposit: no machine seeded for ${host.hostname}.`);
    const http = handlerFor(host.hostname);
    network.add({
      hostname: host.hostname,
      ip: host.ip,
      machine,
      ports: { ...host.ports },
      accounts: { ...host.accounts },
      // A host with `up: false` is powered off, which is a different failure
      // from a name that does not resolve -- and telling those apart is an
      // objective.
      up: 'up' in host ? host.up : true,
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

  /*
   * A save from before the ledger existed.
   *
   * Without it the store refuses every read, forever, so one is put back,
   * holding what vault01's record says now. That copy may already have been
   * trimmed, and nothing can tell after the fact -- which is the case for
   * shipping the record off the box in the first place.
   */
  if (!fleet.network.resolve(LEDGER.hostname)) {
    const ledger = new Machine({
      hostname: LEDGER.hostname,
      epoch: FLOOR_MS,
      network: fleet.network,
      session: fleet.session,
      track,
    });
    let record: string | undefined;
    try {
      record = fleet.machines.get('vault01')?.vfs.readText(ACCESS_LOG, ROOT_USER);
    } catch {
      record = undefined;
    }
    seedLedger(ledger, record);
    fleet.network.add({
      hostname: LEDGER.hostname,
      ip: LEDGER.ip,
      machine: ledger,
      ports: { ...LEDGER.ports },
      accounts: {},
      http: ledgerHandler,
    });
  }

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
 * The save, in the shape the host writes.
 *
 * `machine` is the bastion, because the host's save format has required one
 * since there was one game and a save without it is rejected as corrupt by
 * every build already in somebody's browser. `fleet` is the authoritative
 * copy and contains the bastion too; `restore` below prefers it and ignores
 * `machine` whenever it is there.
 *
 * The duplication is a few kilobytes and buys backward compatibility in both
 * directions, which is worth more than the bytes.
 */
export function saveDeposit(deposit: Deposit): AdventureSnapshot {
  return {
    machine: deposit.machine.snapshot(),
    quest: deposit.questbook.snapshot(),
    fleet: snapshotFleet(deposit.network, deposit.session),
  };
}

/**
 * Bring a run back from a host save.
 *
 * A save with no fleet in it cannot be restored and must not be half-restored:
 * the bastion alone would come back with the player's own notes intact and
 * every service they fixed on the other three hosts undone, while the
 * questbook went on reporting those objectives as met. Refusing is the honest
 * failure, and the host already handles it -- it falls back to a fresh run and
 * says the save could not be opened.
 */
export function restoreDepositSave(
  snap: AdventureSnapshot,
  opts: DepositOptions = {},
): Deposit {
  if (!snap.fleet) {
    throw new Error('The Deposit: a save with no fleet in it, from a build before the floor.');
  }
  return restoreDeposit({ fleet: snap.fleet, quest: snap.quest }, opts);
}

/**
 * The morning, as it arrives.
 *
 * Pell says his piece and goes. Nothing in it is a lie and none of it is
 * useful, which is what a handover from somebody who kept a system alive
 * without ever understanding it sounds like.
 */
export function coldOpen(): BeatLine[] {
  return [
    ...DEPOSIT_ART,
    "",
    "  PELL DEPOSIT OFFICE — MACHINE FLOOR",
    "",
    "PELL: Four machines. I kept them up by restarting things. Nobody wrote down why.",
    "PELL: The check is green. The tribunal cannot get its manifest. Both facts are on your desk.",
    "PELL: cat ~/PELL, then cat ~/REQUEST. I am out at eight.",
    "PELL: Some of that evidence is yours. You have root. Make it available. Do not make it convenient.",
    "LUNA: He has gone.",
    "LUNA: I stay on this machine. Come back and tell me what you find.",
    "  ssh vault01 / index01 / relay01",
    "  objectives: your work     hint: help",
    "",
    "  talk: ask LUNA about the work or the world",
  ];
}

/**
 * What the floor looks like on the way out.
 *
 * The optional objectives change it, because they are the only two things in
 * the act nobody asked him for -- and an ending that cannot see what the
 * player chose to do is an ending that tells everybody the same story.
 */
export function epilogue(world?: World): BeatLine[] {
  const done = (id: string): boolean =>
    world !== undefined && (DEPOSIT_OBJECTIVES.find((o) => o.id === id)?.done(world) ?? false);

  return [
    'PELL: Came back for my cup. Stayed to read your handover.',
    'PELL: The floor wants somebody permanent. I said you had written its only instructions.',
    ...(done('clean-hands') ? [
      'LUNA: The tribunal read your matter. Your account never read it at all. The record can prove it.',
    ] : ['LUNA: Your matter is still on vault01. The tribunal will get to it when it sits.']),
    ...(done('where-she-cannot-go') ? ['LUNA: Thank you for coming back to tell me.'] : []),
    'PELL: Upstairs are three deliveries that all swear they are the same delivery. Start there tomorrow.',
    '', '  THE DEPOSIT — COMPLETE',
    '  Keep exploring, or type games for The Pipeline.', '',
  ];
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

