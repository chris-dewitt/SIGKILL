import type { MachineSnapshot } from '@sigkill/machine';
import type { QuestSnapshot } from '@sigkill/quest';

export const SAVE_KEY = 'sigkill:wreck:save';

export interface LastTurn {
  command: string;
  output: string;
  error: string;
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
