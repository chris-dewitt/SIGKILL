import type { MachineSnapshot } from '@sigkill/machine';
import type { QuestSnapshot } from '@sigkill/quest';

/**
 * One save slot per adventure, and a note of which one you were in.
 *
 * It used to be a single key, `sigkill:wreck:save`, because there was a single
 * game. Three exist now, and a shared slot would mean starting The Archive
 * silently destroyed a Wreck run in progress -- the worst kind of data loss,
 * because the player caused it by being curious.
 *
 * The old key is still read, once, and migrated. Somebody is mid-act in a
 * browser right now and a rename is not a reason to take that away from them.
 */
const PREFIX = 'sigkill';
const LEGACY_KEY = 'sigkill:wreck:save';

/** Which adventure the app should open. */
export const LAST_PLAYED_KEY = `${PREFIX}:last`;

export const saveKey = (adventure: string): string => `${PREFIX}:${adventure}:save`;

export interface LastTurn {
  command: string;
  output: string;
  error: string;
  /**
   * The output's columns are load-bearing, so the strip must clip it rather
   * than wrap it.
   *
   * Taken from the command's own declaration, not guessed from the text. The
   * guess was "does it contain a newline", which made every `cat` of a note
   * and every manual page a drawing -- and a drawing is not wrapped, so a
   * phone showed the left two thirds of each line and hid the rest.
   */
  art?: boolean;
}

export interface AdventureSave {
  version: 1;
  machine: MachineSnapshot;
  quest: QuestSnapshot;
  actEnded: boolean;
  history: string[];
  lastTurn?: LastTurn;
}

/** Kept for the tests and the console; `AdventureSave` is the name now. */
export type WreckSave = AdventureSave;

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;
type Remover = Pick<Storage, 'removeItem'>;

function parse(raw: string | null): AdventureSave | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AdventureSave;
    if (parsed.version !== 1 || parsed.machine === undefined || parsed.quest === undefined) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readSave(
  adventure = 'wreck',
  storage: Reader = window.localStorage,
): AdventureSave | null {
  try {
    const own = parse(storage.getItem(saveKey(adventure)));
    if (own) return own;
    // The single-key era. Only The Wreck can have written it.
    return adventure === 'wreck' ? parse(storage.getItem(LEGACY_KEY)) : null;
  } catch {
    return null;
  }
}

export function writeSave(
  adventure: string,
  save: AdventureSave,
  storage: Writer = window.localStorage,
): void {
  storage.setItem(saveKey(adventure), JSON.stringify(save));
}

export function clearSave(adventure: string, storage: Remover = window.localStorage): void {
  storage.removeItem(saveKey(adventure));
  if (adventure === 'wreck') storage.removeItem(LEGACY_KEY);
}

/** Which adventure to open, if the player has opened one before. */
export function readLastPlayed(storage: Reader = window.localStorage): string | null {
  try {
    const id = storage.getItem(LAST_PLAYED_KEY);
    if (id) return id;
    // A returning player from before the chooser existed was playing The Wreck.
    return storage.getItem(LEGACY_KEY) ? 'wreck' : null;
  } catch {
    return null;
  }
}

export function writeLastPlayed(adventure: string, storage: Writer = window.localStorage): void {
  try {
    storage.setItem(LAST_PLAYED_KEY, adventure);
  } catch {
    // Private window. The choice holds for this session only.
  }
}

/** Every adventure with a run in progress, for the chooser to mark. */
export function savedAdventures(
  ids: readonly string[],
  storage: Reader = window.localStorage,
): Set<string> {
  const found = new Set<string>();
  for (const id of ids) {
    if (readSave(id, storage) !== null) found.add(id);
  }
  return found;
}
