import { ROOT_USER, type Vfs } from '@sigkill/machine';

export const PROJECTS = '/home/dewitt/projects';
export const REPORT = `${PROJECTS}/adapter/report.txt`;

/** Seed once on a new game. Player work is ordinary VFS state, including saves. */
export function seedProjects(vfs: Vfs): void {
  const put = (path: string, lines: string[], executable = false): void => {
    const dir = path.slice(0, path.lastIndexOf('/'));
    vfs.mkdirp(dir, ROOT_USER);
    vfs.chown(dir, 1000, 1000, ROOT_USER);
    vfs.writeText(path, lines.join('\n') + '\n', ROOT_USER);
    vfs.chown(path, 1000, 1000, ROOT_USER);
    vfs.chmod(path, executable ? 0o755 : 0o644, ROOT_USER);
  };
  put(`${PROJECTS}/README`, [
    'THE THINGS WE WERE GOING TO FINISH', '',
    'Doc -- I copied the prototypes into your account. Break your copies.',
    'Keep notes. You earned the desk; you do not have to keep earning it.',
    '                                                     -- Vasquez', '',
    'adapter/  The Universal Bullshit Adapter. Start here; it almost works.',
    'enough/   The Enough Machine. Our budget has philosophical problems.',
    'shoe/     The Other Shoe. Do not connect it to the toaster again.', '',
    'These are side projects. The ship can be repaired without finishing them.',
    'LUNA has opinions. Once she is around, try: luna projects',
  ]);
  put(`${PROJECTS}/adapter/README`, [
    'UNIVERSAL BULLSHIT ADAPTER -- prototype 0.0.3', '',
    'Compare the promise with the bill. We have not automated the outrage.',
    'The supplier calls its allocation 100 percent research support.',
    'ledger.csv records where the money actually went.', '',
    'TASK: make report.txt contain just the RESEARCH records.',
    'Keep the records intact. The header and other categories are not evidence',
    'of money reaching research. There should be two records.', '',
    'inspect:  cat ledger.csv',
    'inspect:  cat audit.sh',
    'run:      ./audit.sh',
    'check:    cat report.txt', '',
    'The script is executable, but its filter is wrong. Fix it with an editor,',
    'or build your own pipeline. man grep explains searching; > saves output.',
    'luna adapter will check the result. luna adapter hint gives the repair.',
  ]);
  put(`${PROJECTS}/adapter/ledger.csv`, [
    'id,category,credits,description',
    '01,ADMIN,7000,research support administration',
    '02,RESEARCH,120,sensor parts',
    '03,COMPLIANCE,2400,research support certification',
    '04,RESEARCH,80,lab consumables',
    '05,BRANDING,5000,research support awareness campaign',
  ]);
  put(`${PROJECTS}/adapter/audit.sh`, [
    '#!/bin/sh',
    '# Searches descriptions as well as categories. That is the bug. -- V',
    `grep -i research ${PROJECTS}/adapter/ledger.csv > ${REPORT}`,
  ], true);
  put(`${PROJECTS}/enough/README`, [
    'THE ENOUGH MACHINE', '',
    'Question: can everyone aboard eat, rest, work, and have time to be alive?',
    'First result: yes.',
    'Second result, after including the grant reporting workload: absolutely not.', '',
    'Chen says our model assumes paperwork does not require a human being.',
    'Okonkwo says this is also the model used by the people sending it.', '',
    'inputs.csv is a sketch, not a proof. Hours belong to people, not budgets.',
    'We still need a model that handles shared work without counting it twice.',
  ]);
  put(`${PROJECTS}/enough/inputs.csv`, [
    'task,hours_per_week', 'food,28', 'maintenance,35', 'research,100',
    'grant_reporting,96', 'explaining_previous_grant_report,24',
  ]);
  put(`${PROJECTS}/shoe/README`, [
    'THE OTHER SHOE', '',
    'Three minutes inside someone else\'s ordinary experience.',
    'We thought this might end cruelty. Trial one made Bowen want a sandwich.',
    'Chen: that WAS my ordinary experience. I had missed lunch.', '',
    'Consent is specific to each recording. A file existing is not permission.',
    'The only approved public demonstration is demo.txt. Hardware remains offline.',
  ]);
  put(`${PROJECTS}/shoe/demo.txt`, [
    'PUBLIC DEMONSTRATION -- voluntarily recorded by Vasquez', '',
    '00:00 Someone has borrowed my screwdriver.',
    '00:31 I own seven screwdrivers.',
    '01:08 Someone has borrowed my seven screwdrivers.',
    '02:54 Found them in my pocket. Request withdrawal from public demonstration.',
    '03:00 Request withdrawn. Doc laughed. Keep it.',
  ]);
  put(`${PROJECTS}/grant-clause.txt`, [
    'RESEARCH PATRON AGREEMENT, ADDENDUM 12', '',
    'The patron requires quarterly photographs of the researchers\' feet.',
    'No requirement specifies bare feet, resolution, or which quarter.', '',
    'Okonkwo: attached one photograph of four socks. Funding renewed.',
    'Vasquez: please stop calling our benefactor the sole provider in reports.',
    'LUNA: Is this peer review? Nobody will explain peer review to me either.',
  ]);
}
