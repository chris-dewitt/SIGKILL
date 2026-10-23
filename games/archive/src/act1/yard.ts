import { ROOT_USER, type CommandSpec, type Vfs } from '@sigkill/machine';
import { frame } from '@sigkill/ascii';

/**
 * The bonded yard, through the archive's own camera.
 *
 * NAV-7 sits in berth 17 for the whole act, three hundred metres from the
 * counter, and DeWitt cannot board it while the claim is open. That is the
 * stake, and a stake you can look at is worth a paragraph of saying so. The
 * picture reads the berth's status from the yard's own file, which the story
 * moves on as the claim does -- so the camera is the place's condition, the
 * same rule the rest of the screen keeps.
 */

export const BERTH_STATUS = '/srv/yard/berth-17';

/** Statuses the yard file can hold, in the order the act moves through them. */
export const BERTH = {
  bonded: 'BONDED  salvage.22.b',
  hearing: 'HELD  hearing Thursday',
  stay: 'STAY  evidence on file',
} as const;

export function seedYard(vfs: Vfs): void {
  vfs.mkdirp('/srv/yard', ROOT_USER);
  vfs.writeText(BERTH_STATUS, `${BERTH.bonded}\n`, ROOT_USER);
  vfs.chmod(BERTH_STATUS, 0o644, ROOT_USER);
}

export function berthStatus(vfs: Vfs): string {
  try {
    return vfs.readText(BERTH_STATUS, ROOT_USER).trim() || BERTH.bonded;
  } catch {
    return BERTH.bonded;
  }
}

/**
 * Four rows of the yard, berth 17 among them.
 *
 * Fixed rather than generated: the same yard every time, with its gaps where
 * ships have been released. Thirty columns inside the frame, so the whole
 * thing fits a portrait phone with room to spare.
 */
const ROWS = [
  '░ ░ ░   ░ ░ ░ ░ ░   ░ ░ ░ ░ ░',
  '░ ░ ░ ░ ░ ░   ░ ░ ░ ░ ░   ░ ░',
  '░   ░ ░ ░ ░ ░ ▓ ░ ░ ░ ░ ░ ░ ░',
  '░ ░ ░ ░   ░ ░ ░ ░ ░ ░   ░ ░ ░',
];

export function yardArt(vfs: Vfs): string[] {
  return [
    ...frame(ROWS, { style: 'light', title: 'YARD 3  CAM 2' }),
    '  ▓ BERTH 17   KV-1140  NAV-7',
    `    ${berthStatus(vfs)}`,
    '  412 vessels held',
  ];
}

export function yardCommands(): CommandSpec[] {
  return [
    {
      name: 'yard',
      summary: 'the bonded yard camera: where NAV-7 is held',
      preformatted: true,
      manual:
        'yard\n\n' +
        'Show the bonded-yard camera feed, with the status of berth 17 as\n' +
        `the yard records it in ${BERTH_STATUS}. Public, like the archive.`,
      plain:
        'Shows the bonded yard where NAV-7 is held, and what the yard\n' +
        'currently says about her. It changes as the claim does.',
      // Preformatted, so the shell sends it to the art sink and a phone clips
      // the picture rather than re-wrapping it.
      run: (ctx, _argv, io) => {
        io.out(`${yardArt(ctx.vfs).join('\n')}\n`);
        return 0;
      },
    },
  ];
}
