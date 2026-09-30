import { ROOT_USER, type User, type Vfs } from '@sigkill/machine';
import { buildDataset, labelsCsv, testCsv, trainCsv, type Dataset } from './dataset.js';
import { VOCAB } from '../glassbox.js';

/**
 * The hearing annexe, three weeks after the deposit office.
 *
 * Kerr is present in this act rather than corresponding. She got him the
 * disclosure, she is the reason it is bounded, and she will not help him
 * interpret any of it -- which she says out loud, because the one thing she
 * has taught him across two games is that the interpretation is the part
 * somebody can be wrong about.
 *
 * Oduya answers once, in writing. She is the vendor's evaluation engineer and
 * she is not a villain: a competent person, a correct computation, and no time.
 * Her reply is seeded on disk from the start rather than arriving as a reward,
 * because an act that withholds the other person's account until you have
 * earned it is an act that thinks the other person is a prize.
 */

export const HOME = '/home/dewitt';
export const FINDINGS = `${HOME}/findings`;
export const DISCLOSURE = '/srv/disclosure';
export const MODEL_DIR = `${DISCLOSURE}/occupancy-v4`;

export const PEOPLE = { root: 0, dewitt: 1000 } as const;

const lines = (...rows: readonly string[]): string => `${rows.join('\n')}\n`;

export function seedAnnexe(vfs: Vfs, user: User): Dataset {
  const data = buildDataset();

  for (const dir of [HOME, FINDINGS, DISCLOSURE, MODEL_DIR]) vfs.mkdirp(dir, user);

  vfs.mkdirp('/etc', user);
  vfs.writeText(
    '/etc/passwd',
    lines(
      'root:x:0:0:root:/root:/bin/sh',
      `dewitt:x:${PEOPLE.dewitt}:${PEOPLE.dewitt}:C. DeWitt, disclosure:/home/dewitt:/bin/sh`,
    ),
    user,
  );

  // ------------------------------------------------------------ the evidence
  vfs.writeText(`${DISCLOSURE}/train.csv`, trainCsv(data), user);
  vfs.writeText(`${DISCLOSURE}/test.csv`, testCsv(data), user);
  vfs.writeText(`${DISCLOSURE}/labels.csv`, labelsCsv(data), user);
  vfs.writeText(`${MODEL_DIR}/vocab.txt`, lines(...VOCAB), user);

  vfs.writeText(
    `${DISCLOSURE}/report.md`,
    lines(
      '# occupancy-v4 — evaluation report',
      '',
      'Tessaly Analytics, prepared for the underwriter. 2394.',
      '',
      '## Method',
      '',
      'Two thousand transit filings, labelled by outcome. Five hundred held',
      'back for evaluation. The split was supplied with the dataset.',
      '',
      '## Result',
      '',
      '    accuracy   99.2%   (496 / 500)',
      '',
      'The model is suitable for triage. An abandoned determination is',
      'sufficient basis for a salvage claim under the transit code.',
      '',
      '## Notes',
      '',
      'No per-class figures are reported. The class distribution of the',
      'evaluation set reflects the operating distribution, so overall',
      'accuracy is the operationally relevant measure.',
      '',
      '                                          — R. Oduya, evaluation',
      '',
    ),
    user,
  );

  vfs.writeText(
    `${HOME}/KERR`,
    lines(
      'From: A. Kerr, adjuster',
      'To:   C. DeWitt',
      'Re:   disclosure, occupancy-v4',
      '',
      'Mr DeWitt,',
      '',
      'I got you this. It is bounded: the model, its vocabulary, the two',
      'splits, the scored output and the vendor report. Not the source, not',
      'the contract, not the underwriter\'s correspondence.',
      '',
      'The tow rests on one determination made by that model on the morning',
      'of the sixth. Three filings quote its accuracy at 99.2% and not one of',
      'them says what that number was measured against.',
      '',
      'I am not going to help you interpret any of this, and I want to be',
      'clear that is not unkindness. The interpretation is the part somebody',
      'can be wrong about, and if I hand you mine you will carry it into a',
      'hearing as though it were a measurement.',
      '',
      'What I will tell you is what I told you in the deposit office, because',
      'it has not changed: tell me what it SAYS, and tell me where.',
      '',
      'One more thing, and then I am done being helpful.',
      '',
      'A number can be correct and useless at the same time. Those are not',
      'in tension and a tribunal will not understand why until somebody',
      'shows them. That is the whole of my advice.',
      '',
      '                                                            -- A. Kerr',
      '',
    ),
    user,
  );

  vfs.writeText(
    `${DISCLOSURE}/ODUYA`,
    lines(
      'Written answer of R. Oduya, evaluation engineer, Tessaly Analytics.',
      'Provided under disclosure. One question was put; this is the whole',
      'of the reply.',
      '',
      'Q: How was the 99.2% figure produced?',
      '',
      'I ran the harness we were given. The split came with the dataset. I',
      'did not write the dedup step and I did not know there wasn\'t one.',
      '',
      'If you are asking whether I checked for overlap between the two',
      'files: no. I check that now. I did not check it then.',
      '',
      'I want to say something else, and my employer has not seen this.',
      '',
      'I have known how to check that for nine years. I did not check it',
      'because the number came back high and I had four other models to',
      'score that week. That is the entire reason. There is not a better one',
      'underneath it.',
      '',
      'If you re-run it on a split with the overlap removed, and you balance',
      'the classes, I expect you will get something in the low sixties, and',
      'on crewed vessels specifically I expect you will get almost nothing.',
      'I would rather you heard that from me than found it.',
      '',
      'I am going to put this in writing to my employer regardless of what',
      'the tribunal does.',
      '',
      '                                                          -- R. Oduya',
      '',
    ),
    user,
  );

  vfs.writeText(
    `${DISCLOSURE}/NAV7.row`,
    lines(
      '# The filing submitted for NAV-7, 2398-06-06 08:14. The row the',
      '# determination was made from. This is all of it.',
      '',
      'id,filing,grant,transits,days_since_filing',
      `${data.nav7.id},${data.nav7.filing},${data.nav7.grant},${data.nav7.transits},${data.nav7.lastFiling}`,
      '',
      '# There is no field for how many people are aboard.',
      '',
    ),
    user,
  );

  vfs.writeText(
    `${HOME}/README`,
    lines(
      'Hearing annexe, disclosure terminal. Signed in as dewitt.',
      '',
      `  ${HOME}/KERR                what she will and will not do`,
      `  ${DISCLOSURE}/report.md     the vendor's own evaluation`,
      `  ${DISCLOSURE}/ODUYA         her written answer`,
      `  ${DISCLOSURE}/NAV7.row      the row the tow rests on`,
      `  ${DISCLOSURE}/train.csv     2000 filings`,
      `  ${DISCLOSURE}/test.csv      500 held back`,
      `  ${DISCLOSURE}/labels.csv    what the model said about each one`,
      `  ${FINDINGS}/           put what you establish in here`,
      '',
      'The model itself is a command:',
      '',
      '  model card        what it claims about itself',
      '  model vocab       every token it knows',
      '  model tokens ...  what it actually receives',
      '  model classify ...  its answer',
      '  model attention ...  where it looked',
      '',
      'python3 is here. You will need it.',
      '',
      'Type  objectives  for what you are trying to establish.',
      'Type  hint  when you are stuck.',
      '',
    ),
    user,
  );

  return data;
}

/** Hand the annexe's writable parts to DeWitt. */
export function ownEverything(vfs: Vfs, uid: number, gid: number): void {
  const chown = (path: string): void => {
    try {
      vfs.chown(path, uid, gid, ROOT_USER);
    } catch {
      // Not ours to hand over.
    }
    let kind: string;
    try {
      kind = vfs.lstat(path, ROOT_USER).kind;
    } catch {
      return;
    }
    if (kind !== 'dir') return;
    for (const name of vfs.readdir(path, ROOT_USER)) {
      chown(`${path}/${name}`.replace(/\/+/g, '/'));
    }
  };
  chown(HOME);
}
