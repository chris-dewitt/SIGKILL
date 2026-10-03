import { describe, expect, it } from 'vitest';
import { MissingRuntime } from '@sigkill/quest';
import { ARCHIVE } from '../src/adventure.js';
import { commandRegistry, ROOT_USER } from '@sigkill/machine';
import { NodeSqlRuntime } from '@sigkill/sql/node';
import { checkObjective, taught, validateObjectives, type RouteWorld } from '@sigkill/quest';
import { bootArchive, restoreArchive, coldOpen, epilogue } from '../src/world.js';
import { ARCHIVE_OBJECTIVES, EVIDENCE_DB } from '../src/objectives.js';
import { CLAIMS_DB } from '../src/act1/schema.js';

/**
 * One engine for the whole file.
 *
 * Booting wasm per test would make this suite minutes long for no extra
 * confidence -- the runtime is stateless between requests by construction,
 * because the database goes in and out as bytes.
 */
const sql = new NodeSqlRuntime();

const boot = () => bootArchive({ sql });

/** A fresh town, driven the way a host drives one. */
const factory = async (): Promise<RouteWorld> => {
  const a = await boot();
  return {
    world: a.machine,
    run: async (command: string) => {
      const result = await a.machine.exec(command);
      a.machine.tick(1000);
      return { stderr: result.stderr };
    },
  };
};

describe('the world builds itself from its own schema', () => {
  it('has a database the player can query', async () => {
    const { machine } = await boot();
    const tables = (await machine.exec(`sqlite3 ${CLAIMS_DB} .tables`)).stdout;
    for (const table of ['accounts', 'certifications', 'claims', 'crew', 'filings', 'transits', 'vessels']) {
      expect(tables, table).toContain(table);
    }
  });

  it('keeps the schema on disk as readable text, and it rebuilds the world', async () => {
    const { machine } = await boot();
    const schema = (await machine.exec('cat /srv/archive/schema.sql')).stdout;
    expect(schema).toContain('CREATE TABLE certifications');

    // The player cannot write to the archive -- he is a claimant on a public
    // terminal, and the records being unarguable is the point. What he can do
    // is build his own copy from the same text, which is the useful half.
    expect((await machine.exec(`sqlite3 /home/dewitt/mine.db < /srv/archive/schema.sql`)).stderr).toBe('');
    expect(
      (await machine.exec('sqlite3 /home/dewitt/mine.db "SELECT count(*) FROM crew;"')).stdout.trim(),
    ).toBe('6');
  });

  /*
   * The result set the whole act is about.
   *
   * Four people with certificates and one trailing empty field. If this ever
   * stops being the answer, the premise has gone.
   */
  it('has four certified crew and one hole where DeWitt should be', async () => {
    const { machine } = await boot();
    const rows = (
      await machine.exec(
        `sqlite3 ${CLAIMS_DB} "SELECT c.name, x.number FROM crew c ` +
          'LEFT JOIN certifications x ON x.crew_id = c.id WHERE c.vessel_id = 1140 ORDER BY c.id;"',
      )
    ).stdout;
    expect(rows).toBe(
      'vasquez|KV-4471-E\nchen|KV-2210-M\nokonkwo|KV-9938-C\nbowen|KV-1174-N\ndewitt|\n',
    );
  });

  it('says zero survivors, which is the claim against him', async () => {
    const { machine } = await boot();
    const claim = (
      await machine.exec(`sqlite3 ${CLAIMS_DB} "SELECT clause, survivors FROM claims WHERE vessel_id = 1140;"`)
    ).stdout.trim();
    expect(claim).toBe('salvage.22.b|0');
  });

  it('carries his Act I evidence over as the loose files he left it as', async () => {
    const { machine } = await boot();
    const carried = (await machine.exec('ls carried')).stdout;
    expect(carried).toContain('bowen-heading.txt');
    expect(carried).toContain('ferry-profile.txt');
    expect((await machine.exec('cat carried/bowen-heading.txt')).stdout).toContain('114 mark 9');
  });

  it('boots deterministically: the same world twice, byte for byte', async () => {
    const a = await boot();
    const b = await boot();
    expect(a.machine.vfs.read(CLAIMS_DB, ROOT_USER)).toEqual(b.machine.vfs.read(CLAIMS_DB, ROOT_USER));
  });
});

describe('the puzzle schema', () => {
  it('is structurally complete, and teaches only commands that exist', async () => {
    // A real machine's command map, not the static registry: `sqlite3` and
    // `python3` are registered per-Machine by the runtimes they wrap, so the
    // static list does not know about either of them.
    const { machine } = await boot();
    expect(validateObjectives(ARCHIVE_OBJECTIVES, { commands: machine.shell.commands })).toEqual([]);
  });

  it('teaches SQL, which is the point of game two', () => {
    expect(taught(ARCHIVE_OBJECTIVES)).toContain('sqlite3');
  });
});

describe('every declared route really works', () => {
  for (const objective of ARCHIVE_OBJECTIVES) {
    it(`${objective.id}: ${objective.routes.length} routes, ${objective.nearMisses.length} near-misses`, async () => {
      const report = await checkObjective(objective, factory);
      expect(report.problems).toEqual([]);
    }, 120_000);
  }
});

describe('the act can be finished', () => {
  it('plays end to end without ever asking for a hint', async () => {
    const { machine, questbook } = await boot();
    const run = async (command: string): Promise<string> => {
      const r = await machine.exec(command);
      machine.tick(1000);
      expect(r.stderr, `${command} -> ${r.stderr}`).toBe('');
      return r.stdout;
    };

    // Everything below follows only from the README, the intake note and the
    // schema on disk. No hint is taken and none is needed.
    expect(await run('cat README')).toContain('salvage.22.b');
    expect(await run(`sqlite3 ${CLAIMS_DB} .tables`)).toContain('claims');

    await run(`sqlite3 ${CLAIMS_DB} "SELECT clause, survivors FROM claims WHERE vessel_id = 1140;" > findings.txt`);
    await run(
      `sqlite3 ${CLAIMS_DB} "SELECT c.name, x.number FROM crew c JOIN certifications x ` +
        'ON x.crew_id = c.id WHERE c.vessel_id = 1140;" > crew.txt',
    );
    await run(
      `sqlite3 ${CLAIMS_DB} "SELECT c.name, x.number FROM crew c LEFT JOIN certifications x ` +
        'ON x.crew_id = c.id WHERE c.vessel_id = 1140;" > gap.txt',
    );
    await run(`sqlite3 ${CLAIMS_DB} "SELECT * FROM filings WHERE subject = 'dewitt';" >> gap.txt`);

    expect(await run('cat /srv/archive/intake/README')).toContain('CREATE TABLE evidence');
    await run(
      `sqlite3 ${EVIDENCE_DB} "CREATE TABLE evidence (id INTEGER PRIMARY KEY, subject TEXT NOT NULL, ` +
        'source TEXT NOT NULL, detail TEXT NOT NULL); INSERT INTO evidence (subject,source,detail) VALUES ' +
        "('dewitt','filings 4402','draft certification'),('dewitt','crew 5','apprentice aboard')," +
        "('NAV-7','carried','declared unmanned');\"",
    );
    await run(
      `sqlite3 ${CLAIMS_DB} "SELECT at, bytes, account, bound_for FROM transits ` +
        'ORDER BY bytes DESC LIMIT 1;" > transit.txt',
    );

    expect(questbook.complete(machine)).toBe(true);
    expect(questbook.hintsTaken).toBe(0);
  }, 120_000);

  it('has an opening and an ending, and they do not repeat each other', () => {
    const open = coldOpen().map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    const close = epilogue().map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    expect(open).toContain('listed you as cargo');
    expect(close).toContain('THE ARCHIVE — COMPLETE');
    const shared = open.split('\n').filter((l) => l.trim().length > 20 && close.includes(l));
    expect(shared).toEqual([]);
  });
});

describe('saves', () => {
  it('carries the database and the progress through a snapshot', async () => {
    const live = await boot();
    await live.machine.exec(
      `sqlite3 ${CLAIMS_DB} "SELECT clause FROM claims WHERE vessel_id = 1140;" > /home/dewitt/findings.txt`,
    );
    await live.machine.exec(`sqlite3 ${CLAIMS_DB} "SELECT survivors FROM claims;" >> /home/dewitt/findings.txt`);

    const restored = restoreArchive(
      { machine: live.machine.snapshot(), quest: live.questbook.snapshot() },
      { sql },
    );
    expect((await restored.machine.exec(`sqlite3 ${CLAIMS_DB} .tables`)).stdout).toContain('crew');
    expect(restored.questbook.status(restored.machine).find((o) => o.id === 'read-the-claim')?.done).toBe(true);
  });
});

/** The descriptor, which is how the app starts this game. */
describe('as the host starts it', () => {
  it('boots from its descriptor, database and all', async () => {
    const session = await ARCHIVE.boot({ sql });
    expect((await session.machine.exec(`sqlite3 ${CLAIMS_DB} .tables`)).stdout).toContain('claims');
  });

  /*
   * The refusal, tested rather than assumed.
   *
   * A machine that booted a database-less Archive would hand the player an act
   * whose every objective is unsolvable, and they would meet that four commands
   * in, as a puzzle. Better to refuse at the door and say which engine is
   * missing.
   */
  it('refuses to start without SQLite, and names what is missing', async () => {
    expect(ARCHIVE.needs).toEqual(['sql']);
    await expect(ARCHIVE.boot({})).rejects.toThrow(MissingRuntime);
    await expect(ARCHIVE.boot({})).rejects.toThrow(/sqlite/i);
  });

  it('restores through the contract, and the database comes with it', async () => {
    const live = await ARCHIVE.boot({ sql });
    await live.machine.exec(`sqlite3 ${CLAIMS_DB} "SELECT clause FROM claims;" > /home/dewitt/keep.txt`);

    const back = await ARCHIVE.restore(
      { machine: live.machine.snapshot(), quest: live.questbook.snapshot() },
      { sql },
    );
    expect((await back.machine.exec('cat /home/dewitt/keep.txt')).stdout).toContain('salvage.22.b');
    expect((await back.machine.exec(`sqlite3 ${CLAIMS_DB} .tables`)).stdout).toContain('crew');
  }, 120_000);
});

