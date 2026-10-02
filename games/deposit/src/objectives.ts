import type { Objective, World } from '@sigkill/quest';
import type { Machine } from '@sigkill/machine';

/** The host a goal is asking about. Every objective in this act needs one. */
export const host = (w: World, name: string): Machine | undefined =>
  w.network?.resolve(name)?.machine;

export const DEPOSIT_TITLE = 'The Deposit';

/** Authored next. The floor is proved first. */
export const DEPOSIT_OBJECTIVES: Objective[] = [];
