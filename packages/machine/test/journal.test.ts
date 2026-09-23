import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

/** A machine with one unit that a precondition can refuse. */
function shipWithUnit(): Machine {
  const m = new Machine({ hostname: 'nav7' });
  m.vfs.mkdirp('/etc/systemd/system', ROOT_USER);
  m.vfs.writeText(
    '/etc/systemd/system/widget.service',
    ['[Unit]', 'Description=The widget', '', '[Service]', 'ExecStart=/usr/sbin/widgetd', ''].join('\n'),
    ROOT_USER,
  );
  return m;
}

describe('journalctl', () => {
  it('records a start, and says so in the unit description', async () => {
    const m = shipWithUnit();
    m.services.start('widget');

    const out = (await m.exec('journalctl -u widget')).stdout;
    expect(out).toContain('Started The widget.');
    expect(out).toContain('nav7');
    expect(out).toContain('widget');
  });

  /*
   * The reason the command earns its place. `systemctl status` shows the
   * latest state; this shows how a unit got there -- including a refusal the
   * player has since fixed, which status no longer mentions.
   */
  it('keeps the refusal after the fault is fixed and the unit starts', async () => {
    const m = shipWithUnit();
    let broken = true;
    m.setPrecondition('widget', () =>
      broken ? { ok: false, reason: 'flange not attached; refusing to run' } : { ok: true },
    );

    m.services.start('widget');
    expect(m.services.get('widget')?.state).toBe('failed');

    broken = false;
    m.services.start('widget');
    expect(m.services.get('widget')?.state).toBe('active');

    // Status has moved on. The journal has not.
    expect((await m.exec('systemctl status widget')).stdout).not.toContain('flange');
    const journal = (await m.exec('journalctl -u widget')).stdout;
    expect(journal).toContain('flange not attached');
    expect(journal).toContain('Started The widget.');
    // And in the order it happened.
    expect(journal.indexOf('flange')).toBeLessThan(journal.indexOf('Started'));
  });

  it('records a stop', async () => {
    const m = shipWithUnit();
    m.services.start('widget');
    m.services.stop('widget');
    expect((await m.exec('journalctl -u widget')).stdout).toContain('Stopped The widget.');
  });

  it('filters by unit, and refuses a unit that does not exist', async () => {
    const m = shipWithUnit();
    m.services.start('widget');

    const missing = await m.exec('journalctl -u nosuch');
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('not found');

    expect((await m.exec('journalctl -u widget')).stdout).toContain('widget');
  });

  it('says so plainly when a real unit has no history yet', async () => {
    const m = shipWithUnit();
    const r = await m.exec('journalctl -u widget');
    expect(r.code, 'no history is not an error').toBe(0);
    expect(r.stdout).toContain('No entries');
  });

  it('takes -n and -r', async () => {
    const m = shipWithUnit();
    for (let i = 0; i < 5; i++) {
      m.services.start('widget');
      m.services.stop('widget');
    }
    const two = (await m.exec('journalctl -u widget -n 2')).stdout.trim().split('\n');
    expect(two).toHaveLength(2);

    const forward = (await m.exec('journalctl -u widget -n 2')).stdout.trim().split('\n');
    const reversed = (await m.exec('journalctl -u widget -n 2 -r')).stdout.trim().split('\n');
    expect(reversed).toEqual([...forward].reverse());

    const all = (await m.exec('journalctl -u widget -n all')).stdout.trim().split('\n');
    expect(all.length).toBeGreaterThan(2);
  });

  /*
   * History that vanishes on reload is worse than no history: the player
   * concludes the game forgot, not that the log was never real.
   */
  it('survives a save', async () => {
    const m = shipWithUnit();
    m.setPrecondition('widget', () => ({ ok: false, reason: 'flange not attached' }));
    m.services.start('widget');

    const restored = Machine.restore(m.snapshot(), { hostname: 'nav7' });
    expect((await restored.exec('journalctl -u widget')).stdout).toContain('flange not attached');
  });

  it('is deterministic: the same script twice reads identically', async () => {
    const play = async (): Promise<string> => {
      const m = shipWithUnit();
      m.services.start('widget');
      await m.tick(5000);
      m.services.stop('widget');
      return (await m.exec('journalctl -u widget')).stdout;
    };
    expect(await play()).toBe(await play());
  });
});
