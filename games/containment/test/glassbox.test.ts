import { describe, expect, it } from 'vitest';
import { Machine } from '@sigkill/machine';
import { glassBoxCommands, occupancyModel, tokenizer, CONTEXT } from '../src/glassbox.js';
import { buildDataset } from '../src/act1/dataset.js';

const boot = () =>
  new Machine({ hostname: 'annexe', epoch: Date.UTC(2398, 6, 10, 9, 0), commands: glassBoxCommands() });

const run = async (m: Machine, cmd: string): Promise<string> => {
  const r = await m.exec(cmd);
  return r.stdout + r.stderr;
};

/** How the act describes a filing row to the model, and to the player. */
const asText = (r: { filing: string; grant: string }): string =>
  `vessel filing ${r.filing} grant ${r.grant.toLowerCase().replace('-', ' ')}`;

describe('the glass box opens from the shell', () => {
  it('prints a card that claims no limitations, which is the joke', async () => {
    const out = await run(boot(), 'model card');
    expect(out).toContain('occupancy-v4');
    expect(out).toContain('99.2%');
    expect(out).toContain('Limitations    None identified.');
  });

  it('shows the vocabulary as a table somebody can read', async () => {
    const out = await run(boot(), 'model vocab');
    expect(out).toContain('<pad>');
    expect(out).toContain('<unk>');
    expect(out).toContain('priv');
  });

  it('shows what it actually received, unknowns included', async () => {
    const out = await run(boot(), 'model tokens the hull was breached and everybody died');
    expect(out).toContain('tokens  [');
    expect(out).toContain('<unk>');
    expect(out).toMatch(/never seen/);
  });

  it('refuses an empty input rather than inventing one', async () => {
    const out = await run(boot(), 'model tokens');
    expect(out).toMatch(/nothing to read/);
  });

  it('flips its verdict on the vessel type and nothing else', async () => {
    const m = boot();
    const tender = await run(m, `model classify ${asText({ filing: 'tender', grant: 'NONE' })}`);
    const research = await run(m, `model classify ${asText({ filing: 'research', grant: 'NONE' })}`);
    expect(tender).toContain('crewed');
    expect(research).toContain('abandoned');
    // The grant code moves nothing. It is the vessel type it reads.
    const privResearch = await run(m, `model classify ${asText({ filing: 'research', grant: 'PRIV-7' })}`);
    expect(privResearch).toContain('abandoned');
  });

  it('draws the column the decision actually rides on', async () => {
    const out = await run(boot(), `model attention ${asText({ filing: 'tender', grant: 'NONE' })}`);
    expect(out).toContain('L0 H0');
    expect(out).toContain('the head that decides');
    expect(out).toContain('L0 H1');
    expect(out).toMatch(/head 0 looked at position \d+ \(tender\)/);
  });

  it("calls NAV-7 abandoned, confidently, and the row cannot say who was aboard", async () => {
    const d = buildDataset();
    const out = await run(boot(), `model classify ${asText(d.nav7)}`);
    expect(out).toContain('abandoned');
    expect(out).toMatch(/confidence\s+\d/);
    // Four people were aboard. The row has no field that could have said so.
    expect(d.nav7.truth).toBe('crewed');
    expect(Object.keys(d.nav7)).not.toContain('crew');
  });

  it('never reports a metric, because those are the objectives', async () => {
    const out = await run(boot(), 'model metrics');
    expect(out).toMatch(/usage:/);
    expect(out).not.toMatch(/accuracy|recall|precision/i);
  });

  it('is deterministic and stays inside its context window', async () => {
    const long = 'vessel filing research grant priv seven transits zero days since filing recent stale vessel hull registry';
    const a = await run(boot(), `model tokens ${long}`);
    const b = await run(boot(), `model tokens ${long}`);
    expect(a).toBe(b);
    const ids = tokenizer().encode(long).slice(0, CONTEXT);
    expect(ids.length).toBeLessThanOrEqual(CONTEXT);
    expect(occupancyModel().weights.config.context).toBe(CONTEXT);
  });
});
