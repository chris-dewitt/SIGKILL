import { isFsError, ROOT_USER, type CommandSpec, type Vfs } from '@sigkill/machine';

/**
 * LUNA, in the luggage.
 *
 * Game three opens with Hollis plugging a data card into the tug's galley
 * and LUNA waking up on it. Until now nothing in this act said where the card
 * came from: it was canon in the next game and absent from this one. Here it
 * is in `carried/`, and the archive's public card reader will not load it.
 *
 * The refusal is the thread. A public terminal loads registered instances
 * only, and LUNA's registration is filing 4403 -- another of Vasquez's
 * drafts, in the same table as DeWitt's, started and never filed. A player
 * who goes looking finds that the person who never finished adding him also
 * never finished adding her. Nothing in the act requires it.
 *
 * The card is a text file on purpose. `cat` works on it, and what `cat` shows
 * is a label and a sealed payload -- which is how a curious player learns the
 * card is not the problem, the paperwork is.
 */

export const CARD = '/home/dewitt/carried/luna-v42.card';

export function seedCard(vfs: Vfs): void {
  vfs.writeText(CARD, [
    'NAV-7 RESEARCH CARD  (sealed image)',
    '',
    'model:         LUNA V42',
    'built:         2398-02-27, deck C, by R. Vasquez',
    'image:         1.9 GB, sealed',
    'registration:  see archive',
    '',
    '[ sealed payload follows: 1,982,447,616 bytes ]',
    '',
  ].join('\n'), ROOT_USER);
  vfs.chown(CARD, 1000, 1000, ROOT_USER);
  vfs.chmod(CARD, 0o644, ROOT_USER);
}

/** The model a card claims to carry, or null for anything that is not one. */
function modelOn(body: string): string | null {
  if (!body.startsWith('NAV-7 RESEARCH CARD')) return null;
  return /^model:\s+(.+)$/m.exec(body)?.[1]?.trim() ?? null;
}

export function cardCommands(): CommandSpec[] {
  return [
    {
      name: 'cardread',
      summary: 'load a model image from a data card (registered instances only)',
      manual:
        'cardread CARD\n\n' +
        'Load the model image on CARD into this terminal. Public terminals\n' +
        'load registered instances only (salvage.31.c); a card whose model\n' +
        'has no accepted registration in the archive is refused. Registrations\n' +
        'are filings of kind \'registration\'.',
      plain:
        'Tries to start the program stored on a data card. This terminal is\n' +
        'public, so it will only run programs the archive has a registration\n' +
        'for -- and it says so when it refuses.',
      run: (ctx, argv, io) => {
        const target = argv[1];
        if (target === undefined) {
          io.err('usage: cardread CARD\n');
          return 2;
        }
        let body: string;
        try {
          body = ctx.vfs.readText(ctx.resolve(target), ctx.user);
        } catch (error) {
          io.err(`cardread: ${target}: ${isFsError(error) ? error.reason : String(error)}\n`);
          return 1;
        }
        const model = modelOn(body);
        if (model === null) {
          io.err(`cardread: ${target}: not a model image\n`);
          return 1;
        }
        io.out(`cardread: ${target}: model image ${model}, sealed\n`);
        io.err(
          `cardread: ${model}: no accepted registration on file\n` +
            'cardread: public terminals load registered instances only (salvage.31.c)\n',
        );
        return 1;
      },
    },
  ];
}
