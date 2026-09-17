import type { MachineSnapshot } from '@sigkill/machine';
import type { QuestSnapshot } from '@sigkill/quest';

export const SAVE_KEY = 'sigkill:wreck:save';

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

export interface WreckSave {
  version: 1;
  machine: MachineSnapshot;
  quest: QuestSnapshot;
  actEnded: boolean;
  history: string[];
  lastTurn?: LastTurn;
}

export function readSave(storage: Pick<Storage, 'getItem'> = window.localStorage): WreckSave | null {
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WreckSave;
    if (parsed.version !== 1 || parsed.machine === undefined || parsed.quest === undefined) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSave(
  save: WreckSave,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): void {
  storage.setItem(SAVE_KEY, JSON.stringify(save));
}

export function clearSave(storage: Pick<Storage, 'removeItem'> = window.localStorage): void {
  storage.removeItem(SAVE_KEY);
}
