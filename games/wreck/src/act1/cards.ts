import type { Vfs } from '@sigkill/machine';
import { asArt, type BeatLine } from '@sigkill/quest';
import { SAFE_COLS, blockWord, centre, frame, stack } from '@sigkill/ascii';
import { readCompartment } from './art.js';

/**
 * The three set pieces, at the three moments an act turns.
 *
 * Deliberately rare. ORACLE's face on every objective would be wallpaper
 * inside ten minutes; three appearances an act is scarce enough that each one
 * is an event. The division of labour between the styles is by *job*, not
 * taste: typography is a logo, the schematic is the ship's condition, and the
 * face is the character. Using the face to report a hull percentage, or the
 * schematic to carry an emotional beat, is how a visual language turns to mush.
 */

/** The width the faces are drawn in, inside their bezel. */
const SCREEN = 12;

/** Centre a string in the monitor's screen, spaces on both sides. */
function inScreen(s: string): string {
  const slack = Math.max(0, SCREEN - s.length);
  return ' '.repeat(Math.floor(slack / 2)) + s + ' '.repeat(Math.ceil(slack / 2));
}

/**
 * ORACLE, as the screen it actually is.
 *
 * Eyes and mouth are the only things that change, which is the whole trick of
 * a cartoon: two features carrying every state, so the reader recognises the
 * character before they read the caption.
 */
function face(eyes: string, mouth: string): string[] {
  const monitor = stack([
    frame([inScreen(''), inScreen(eyes), inScreen(''), inScreen(mouth)], {
      style: 'heavy',
      padding: 2,
    }),
    centre(['▀▀▀▀▄▄▄▄▄▄▀▀▀▀'], SCREEN + 6),
  ]);
  // Centred in the safe width, like the title card and the schematic. A face
  // flush against the left margin while everything around it is centred reads
  // as a layout accident rather than a choice.
  return centre(monitor, SAFE_COLS);
}

/** Eleven years of reading the same four hundred lines. Eyes nearly shut. */
export const ORACLE_DORMANT = face('▁▁    ▁▁', '▁▁▁▁▁▁');
/** Awake, and being careful about how much it expects. */
export const ORACLE_AWAKE = face('██    ██', '▄▄▄▄▄▄');
/** It has just found out it has been wrong about the hull since day nine. */
export const ORACLE_ALARMED = face('▓▓    ▓▓', '▀▀▀▀▀▀');
/**
 * Owning up, at the end, with the crisis already over.
 *
 * Not the alarmed face: by the epilogue nothing is on fire and reusing alarm
 * for a confession flattens both. Eyes lowered, mouth level.
 */
export const ORACLE_CANDID = face('▄▄    ▄▄', '▀▀▀▀▀▀');

/**
 * The name, once, at the top.
 *
 * The only place typography is allowed. A logo that reappears mid-act stops
 * being a title and starts being a watermark.
 */
export function titleCard(): string[] {
  return stack([
    centre(blockWord('SIGKILL'), SAFE_COLS),
    centre(['───────  I.  THE WRECK  ───────'], SAFE_COLS),
  ], 1);
}

export interface ShipState {
  /**
   * The hull figure ORACLE recites.
   *
   * Deliberately a literal and deliberately not measured. This is the number
   * Vasquez wrote on a clipboard on day nine, and the epilogue is *about*
   * ORACLE having repeated it for eleven years because the thing that would
   * have corrected it would not start. Computing it would ruin the reveal.
   */
  hullClaim: string;
  reserve: string;
  aboard: number;
}

/**
 * The ship, drawn, with its condition under it.
 *
 * The sealed count *is* measured -- it comes from the same files `deck` reads
 * -- so the two drawings can never disagree about how many compartments are
 * holding. Only the hull percentage is hearsay, which is the point.
 */
export function shipSchematic(vfs: Vfs, state: ShipState): string[] {
  const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'];
  const sealed = ids.filter((id) => readCompartment(vfs, id).sealed).length;

  // The breach marker is drawn from the same files, so the hull on the ship
  // closes up when the player closes it. A schematic still showing damage
  // after the fix would be the drawing calling them a liar.
  const breach = sealed === ids.length ? '███' : '░░░';

  return frame([
    '   ▄▄▄                       ',
    ' ▄█████▄▄▄▄▄▄▄▄▄▄▄▄          ',
    '████████████████████▄▄       ',
    ' ▀█████▀▀▀▀▀▀▀▀▀▀▀▀█████▄    ',
    `   ▀▀▀   ${breach}      ▀▀▀▀▀▀▀    `,
    '          ▲ deck C           ',
    '                             ',
    ` hull ${state.hullClaim.padEnd(6)} · ${sealed} of 9 sealed`,
    ` O2 ${state.reserve.padEnd(8)} · ${state.aboard} of 40 aboard`,
  ], { style: 'double', cols: SAFE_COLS });
}

/** Read `/etc/hull` and say whether every compartment is holding. */
export function allSealed(vfs: Vfs): boolean {
  return ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'].every(
    (id) => readCompartment(vfs, id).sealed,
  );
}

/** Wrap art rows as preformatted beat lines. Re-exported so content files need one import. */
export function art(rows: readonly string[]): BeatLine[] {
  return asArt(rows);
}
