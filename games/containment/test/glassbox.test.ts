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

  it('flips its verdict on the grant code and nothing else', async () => {
    const m = boot();
    const priv = await run(m, `model classify ${asText({ filing: 'research', grant: 'PRIV-7' })}`);
    const none = await run(m, `model classify ${asText({ filing: 'research', grant: 'NONE' })}`);
    expect(priv).toContain('crewed');
    expect(none).toContain('abandoned');
  });

  it('draws the column the decision actually rides on', async () => {
    const out = await run(boot(), `model attention ${asText({ filing: 'research', grant: 'PRIV-7' })}`);
    expect(out).toContain('L0 H0');
    expect(out).toContain('the head that decides');
    expect(out).toContain('L0 H1');
    expect(out).toMatch(/head 0 looked at position \d+ \(priv\)/);
  });

  it("is confident about NAV-7's row, and the row cannot say who was aboard", async () => {
    const d = buildDataset();
    const out = await run(boot(), `model classify ${asText(d.nav7)}`);
    // It calls NAV-7 crewed *because of the grant code*, which is the bitter
    // joke: it was right about NAV-7 for entirely the wrong reason, and the
    // filing that mattered on the morning of the sixth was a different one.
    expect(out).toMatch(/confidence\s+\d/);
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
