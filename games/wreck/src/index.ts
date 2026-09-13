/**
 * Adventure 01 — The Wreck. Linux and bash.
 *
 * The world seed and the Act I objectives live here. What is still to come in
 * Phase 3 is the rest of the acts, the authored snapshots that replace
 * `bootWreck`'s hand-built filesystem, and the full ORACLE dialogue bank.
 */
export { bootWreck, COLD_OPEN, EPILOGUE } from './world.js';
export type { Wreck, WreckOptions } from './world.js';
export { WRECK_OBJECTIVES, oxygenTarget } from './objectives.js';

export const ADVENTURE = 'wreck' as const;
