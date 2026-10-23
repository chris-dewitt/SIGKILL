import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { NodeSqlRuntime } from '@sigkill/sql/node';
import type { BeatLine } from '@sigkill/quest';
import { bootArchive, restoreArchive, coldOpen, epilogue } from '../src/world.js';
import { ARCHIVE } from '../src/adventure.js';
import { CLAIMS_DB } from '../src/act1/schema.js';
import { BERTH, BERTH_STATUS, yardArt } from '../src/act1/yard.js';
import { CARD } from '../src/act1/card.js';
import { LETTERS, MAILBOX } from '../src/act1/mail.js';
import { EVIDENCE_DB } from '../src/objectives.js';

/**
 * The town answering back: the yard, the mail, the card.
 *
 * Everything here was added because the people in this act did not land
 * (Chris, 2026-10-20). None of it is required to finish, so none of it is
 * covered by the end-to-end run -- which is exactly why it needs its own.
 */

const sql = new NodeSqlRuntime();
const boot = () => bootArchive({ sql });
const text = (lines: readonly BeatLine[]): string =>
  lines.map((line) => (typeof line === 'string' ? line : line.art)).join('\n');

const CLAIM = `sqlite3 ${CLAIMS_DB} "SELECT clause, survivors FROM claims WHERE vessel_id = 1140;" > findings.txt`;
const CREW =
  `sqlite3 ${CLAIMS_DB} "SELECT c.name, x.number FROM crew c JOIN certifications x ` +
  'ON x.crew_id = c.id WHERE c.vessel_id = 1140;" > crew.txt';
const GAP = [
  `sqlite3 ${CLAIMS_DB} "SELECT c.name, x.number FROM crew c LEFT JOIN certifications x ` +
    'ON x.crew_id = c.id WHERE c.vessel_id = 1140;" > gap.txt',
  `sqlite3 ${CLAIMS_DB} "SELECT * FROM filings WHERE subject = 'dewitt';" >> gap.txt`,
];
const COUNT =
  `sqlite3 ${CLAIMS_DB} "SELECT status, count(*) FROM crew WHERE vessel_id = 1140 GROUP BY status;" > count.txt`;
const REGISTRY = 'curl -s "http://registry/v1/vessels/KV-1140/crew?page=3" > registry.json';
const FILE =
  `sqlite3 ${EVIDENCE_DB} "CREATE TABLE evidence (id INTEGER PRIMARY KEY, subject TEXT NOT NULL, ` +
  'source TEXT NOT NULL, detail TEXT NOT NULL); INSERT INTO evidence (subject,source,detail) VALUES ' +
  "('dewitt','filings 4402','draft'),('dewitt','crew 5','apprentice'),('NAV-7','carried','unmanned');\"";

describe('the yard', () => {
  it('shows NAV-7 bonded at boot, and fits a portrait phone', async () => {
    const { machine } = await boot();
    const out = (await machine.exec('yard')).stdout;
    expect(out).toContain('BERTH 17');
    expect(out).toContain('BONDED');
    for (const row of yardArt(machine.vfs)) expect(row.length, row).toBeLessThanOrEqual(34);
  });

  it('opens the act, so the stake is on screen before the first query', async () => {
    const { machine } = await boot();
    expect(text(coldOpen(machine))).toContain('BERTH 17');
  });

  it('moves as the claim does: held for the hearing, then stayed', async () => {
    const a = await boot();
    const run = async (command: string) => {
      await a.machine.exec(command);
      a.afterCommand();
    };
    await run(CLAIM);
    expect(a.machine.vfs.readText(BERTH_STATUS, ROOT_USER)).toContain(BERTH.hearing);
    await run(CREW);
    for (const command of [...GAP, COUNT, REGISTRY]) await run(command);
    await run(FILE);
    expect((await a.machine.exec('yard')).stdout).toContain(BERTH.stay);
    // The ending shows the yard again, and it has changed.
    expect(text(epilogue(a.machine))).toContain('STAY');
  }, 60_000);

  it('survives somebody removing the yard file', async () => {
    const { machine } = await boot();
    machine.vfs.unlink(BERTH_STATUS, ROOT_USER);
    expect((await machine.exec('yard')).stdout).toContain('BONDED');
  });
});

describe('the mail', () => {
  it('is empty at boot: the town has nothing to say until he does something', async () => {
    const a = await boot();
    expect(a.machine.vfs.exists(MAILBOX)).toBe(false);
    expect(a.afterCommand()).toEqual([]);
  });

  it('arrives when the story moves, as ordinary files, once each', async () => {
    const a = await boot();
    await a.machine.exec(CLAIM);
    const notice = text(a.afterCommand());
    expect(notice).toContain('mail/1-kerr');
    expect((await a.machine.exec('cat mail/1-kerr')).stdout).toContain('Thursday at 09:00');
    // Nothing else is due, and the same letter does not come twice.
    expect(a.afterCommand()).toEqual([]);

    // Delete it, and it stays deleted. The town does not nag.
    await a.machine.exec('rm mail/1-kerr');
    expect(a.afterCommand()).toEqual([]);
    expect(a.machine.vfs.exists(`${MAILBOX}/1-kerr`)).toBe(false);
  }, 60_000);

  it('delivers every letter over a full run, in order, and they are his to read', async () => {
    const a = await boot();
    const seen: string[] = [];
    for (const command of [CLAIM, CREW, ...GAP, COUNT, REGISTRY, FILE]) {
      await a.machine.exec(command);
      a.machine.tick(1000);
      for (const line of a.afterCommand()) {
        const match = /mail\/(\S+)/.exec(typeof line === 'string' ? line : line.art);
        if (match) seen.push(match[1]!);
      }
    }
    expect(seen).toEqual(LETTERS.map((letter) => letter.id));
    const listing = (await a.machine.exec('ls -l mail')).stdout;
    expect(listing).toContain('dewitt');
  }, 60_000);

  it('does not deliver a letter for work done out of order', async () => {
    // The crew file satisfies find-the-crew's predicate, but that objective is
    // blocked until the claim is read, so Hollis has not heard yet.
    const a = await boot();
    await a.machine.exec(CREW);
    expect(a.afterCommand()).toEqual([]);
  }, 60_000);

  it('is remembered across a save, so a reload does not redeliver', async () => {
    const live = await boot();
    await live.machine.exec(CLAIM);
    live.afterCommand();
    await live.machine.exec('rm mail/1-kerr');
    const back = restoreArchive({ machine: live.machine.snapshot(), quest: live.questbook.snapshot() }, { sql });
    expect(back.afterCommand()).toEqual([]);
  }, 60_000);

  it('never carries the answer to a puzzle', () => {
    // Letters can give a reason to look. They must not give the query.
    for (const letter of LETTERS) {
      const body = letter.body.join('\n');
      expect(body, letter.id).not.toMatch(/SELECT|JOIN|sqlite3|2211404096/);
    }
  });
});

describe('the card', () => {
  it('is in what he carried, and the public reader refuses it, saying why', async () => {
    const { machine } = await boot();
    expect((await machine.exec('ls carried')).stdout).toContain('luna-v42.card');
    const r = await machine.exec(`cardread ${CARD}`);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('LUNA V42');
    expect(r.stderr).toContain('no accepted registration');
  });

  it('fails like a real tool on what is not a card', async () => {
    const { machine } = await boot();
    expect((await machine.exec('cardread')).stderr).toContain('usage');
    expect((await machine.exec('cardread nope')).stderr).toContain('No such file or directory');
    expect((await machine.exec('cardread README')).stderr).toContain('not a model image');
  });

  it('opens an optional thread that ends pointing at the tug', async () => {
    const a = await boot();
    await a.machine.exec(CLAIM);
    await a.machine.exec(`sqlite3 ${CLAIMS_DB} "SELECT * FROM filings WHERE subject LIKE 'LUNA%';" > luna.txt`);
    const row = a.questbook.status(a.machine).find((o) => o.id === 'the-other-draft');
    expect(row?.done).toBe(true);
    expect(row?.optional).toBe(true);
    expect(text(epilogue(a.machine))).toContain('take that card to the tug');
  }, 60_000);

  it('still gets to the tug in a run that never touched it', async () => {
    const { machine } = await boot();
    expect(text(epilogue(machine))).toContain("Hollis's galley");
  });

  it('comes back for a save made before it existed, unless he threw away the bag', async () => {
    const live = await boot();
    live.machine.vfs.unlink(CARD, ROOT_USER);
    const old = live.questbook.snapshot();
    // A save from before the card: no memory of seeding it.
    const legacy = { ...old, remembered: (old.remembered ?? []).filter((key) => key !== 'card:seeded') };
    const back = restoreArchive({ machine: live.machine.snapshot(), quest: legacy }, { sql });
    expect(back.machine.vfs.exists(CARD)).toBe(true);

    // A save made after it existed, where he deleted the card on purpose.
    const deliberate = restoreArchive({ machine: live.machine.snapshot(), quest: old }, { sql });
    expect(deliberate.machine.vfs.exists(CARD)).toBe(false);
  });
});

describe('the dewitt| moment', () => {
  it('is drawn, framed and on a phone, with the empty field left empty', async () => {
    const a = await boot();
    for (const command of [CLAIM, CREW, ...GAP]) await a.machine.exec(command);
    const objective = a.questbook.drainCompleted(a.machine).find((o) => o.id === 'the-row-that-was-never-written');
    expect(objective).toBeDefined();
    const beat = a.questbook.beat(objective!, a.machine);
    const art = beat.filter((line): line is { art: string } => typeof line !== 'string').map((line) => line.art);
    expect(art.some((row) => /dewitt\s*│/.test(row))).toBe(true);
    for (const row of art) expect(row.length, row).toBeLessThanOrEqual(34);
    expect(text(beat)).toContain('never finished adding you');
  }, 60_000);
});

describe('through the descriptor', () => {
  it('keeps the mail when the companion wraps the session', async () => {
    const session = await ARCHIVE.boot({ sql });
    await session.machine.exec(CLAIM);
    expect(text(session.afterCommand?.() ?? [])).toContain('mail/1-kerr');
  }, 60_000);

  it('talks about people, not queries', async () => {
    const session = await ARCHIVE.boot({ sql });
    const out = (await session.machine.exec('talk kerr')).stdout;
    expect(out).toContain('MERRICK:');
    expect(out).not.toMatch(/SELECT|JOIN/);
  });
});

describe('determinism', () => {
  it('the same commands give the same world, mail and yard included', async () => {
    const play = async () => {
      const a = await boot();
      for (const command of [CLAIM, CREW, ...GAP, COUNT, REGISTRY, FILE]) {
        await a.machine.exec(command);
        a.machine.tick(1000);
        a.afterCommand();
      }
      return JSON.stringify(a.machine.snapshot());
    };
    expect(await play()).toBe(await play());
  }, 120_000);
});
