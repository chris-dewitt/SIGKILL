import { beforeAll, describe, expect, it } from 'vitest';
import { Machine, ROOT_USER } from '@sigkill/machine';
import { NodePythonRuntime } from '@sigkill/python/node';
import { glassBoxCommands } from '../src/glassbox.js';
import {
  DISCLOSURE,
  FINDINGS,
  HOME,
  PEOPLE,
  ownEverything,
  seedAnnexe,
} from '../src/act1/annexe.js';

const python = new NodePythonRuntime();
beforeAll(async () => {
  await python.ready();
}, 180_000);

function annexe() {
  const m = new Machine({
    hostname: 'annexe',
    epoch: Date.UTC(2398, 6, 10, 9, 0),
    python,
    commands: glassBoxCommands(),
  });
  const data = seedAnnexe(m.vfs, ROOT_USER);
  ownEverything(m.vfs, PEOPLE.dewitt, PEOPLE.dewitt);
  m.shell.cwd = HOME;
  m.shell.env['PWD'] = HOME;
  return { m, data };
}

const out = async (m: Machine, cmd: string): Promise<string> => {
  const r = await m.exec(cmd);
  return r.stdout + r.stderr;
};

describe('the annexe', () => {
  it('has the disclosure Kerr describes, and nothing she says it excludes', async () => {
    const { m } = annexe();
    const listed = await out(m, `ls ${DISCLOSURE}`);
    for (const file of ['train.csv', 'test.csv', 'labels.csv', 'report.md', 'ODUYA', 'NAV7.row']) {
      expect(listed, file).toContain(file);
    }
    // Bounded: no source, no contract, no underwriter correspondence.
    expect(listed).not.toMatch(/source|contract|underwriter/i);
  });

  it('has Kerr decline to interpret it, which is the point of her', async () => {
    const { m } = annexe();
    const letter = await out(m, 'cat ~/KERR');
    expect(letter).toMatch(/not going to help you interpret/i);
    expect(letter).toMatch(/correct and useless at the same time/i);
  });

  it('has the vendor report quote a number and not say what it measured', async () => {
    const { m } = annexe();
    const report = await out(m, `cat ${DISCLOSURE}/report.md`);
    expect(report).toContain('99.2%');
    expect(report).toMatch(/No per-class figures are reported/);
  });

  it("has Oduya's answer on disk from the start, not held back as a reward", async () => {
    const { m } = annexe();
    const answer = await out(m, `cat ${DISCLOSURE}/ODUYA`);
    expect(answer).toMatch(/I did not check it/);
    // "in the sixties" rather than a figure: the balanced score is 66.7,
    // and Oduya guessing a precise number the data does not produce would be
    // the prose drifting from the arithmetic.
    expect(answer).toMatch(/in the sixties/);
    // She concedes and it resolves nothing: the tribunal still has to decide.
    expect(answer).not.toMatch(/the tow is|therefore unlawful|case closed/i);
  });

  it("has NAV-7's row say, in a comment, that it cannot say who was aboard", async () => {
    const { m } = annexe();
    const row = await out(m, `cat ${DISCLOSURE}/NAV7.row`);
    expect(row).toContain('PRIV-7');
    expect(row).toMatch(/no field for how many people are aboard/);
  });

  /*
   * The act's central mechanic, end to end.
   *
   * Objectives four through nine are each the player writing a few lines of
   * Python against these files. If the home directory is not genuinely theirs
   * the redirect fails with "Permission denied" and every one of those
   * objectives is unplayable -- which is exactly what happened the first time
   * this was run, because the seed writes as root and the hand-over had not
   * been called. Same bug class as The Fork's "written to without sudo".
   */
  it('lets the player compute the vendor number themselves, without sudo', async () => {
    const { m } = annexe();
    for (const line of [
      'import csv',
      `rows = list(csv.DictReader(open("${DISCLOSURE}/labels.csv")))`,
      'right = sum(1 for r in rows if r["truth"] == r["predicted"])',
      'print(round(100.0 * right / len(rows), 1))',
    ]) {
      const redirect = line === 'import csv' ? '>' : '>>';
      await m.exec(`echo '${line}' ${redirect} ${HOME}/acc.py`);
    }
    const ran = await out(m, `python3 ${HOME}/acc.py > ${FINDINGS}/accuracy`);
    expect(ran, ran).not.toMatch(/permission denied|no such file/i);
    expect(await out(m, `cat ${FINDINGS}/accuracy`)).toContain('99.2');
  }, 120_000);

  it('lets a one-liner establish the base rate, which is the act in one number', async () => {
    const { m } = annexe();
    const script = [
      'import csv',
      `rows = list(csv.DictReader(open("${DISCLOSURE}/test.csv")))`,
      'ab = sum(1 for r in rows if r["label"] == "abandoned")',
      'print(round(100.0 * ab / len(rows), 1))',
    ];
    for (const [i, line] of script.entries()) {
      await m.exec(`echo '${line}' ${i === 0 ? '>' : '>>'} ${HOME}/base.py`);
    }
    const base = await out(m, `python3 ${HOME}/base.py`);
    expect(base.trim()).toBe('98.8');
  }, 120_000);

  it('has python and the model in the same session, which is the whole series', async () => {
    const { m } = annexe();
    expect(await out(m, 'model card')).toContain('occupancy-v4');
    expect((await out(m, 'python3 -c "print(7*6)"')).trim()).toBe('42');
  }, 120_000);
});
