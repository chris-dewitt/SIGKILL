import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

/**
 * The load-bearing design claim: puzzle goals assert on world state, never on
 * what the player typed. Every route that reaches the state must pass.
 *
 * If this file ever needs a special case for a particular command, the design
 * has regressed and the fix is in the goal, not the test.
 */
const goal = (m: Machine): boolean =>
  m.vfs.readText('/etc/life_support.conf', ROOT_USER).includes('O2_TARGET=21');

function boot(): Machine {
  const m = new Machine({ hostname: 'nav7' });
  m.vfs.mkdirp('/etc', ROOT_USER);
  // Real systems give /tmp mode 1777 precisely so unprivileged users can write
  // there. Without it, an ordinary user writing to / is correctly refused.
  m.vfs.mkdirp('/tmp', ROOT_USER);
  m.vfs.chmod('/tmp', 0o777, ROOT_USER);
  m.vfs.writeText('/etc/life_support.conf', 'O2_TARGET=16\nSCRUBBER_DUTY=0.4\n', ROOT_USER);
  m.vfs.chmod('/etc/life_support.conf', 0o666, ROOT_USER);
  return m;
}

describe('solution-agnostic goals', () => {
  const routes: Array<[string, string[]]> = [
    ['sed in place', ["sed -i 's/O2_TARGET=16/O2_TARGET=21/' /etc/life_support.conf"]],
    ['rewrite with echo', [
      'echo O2_TARGET=21 > /etc/life_support.conf',
      'echo SCRUBBER_DUTY=0.4 >> /etc/life_support.conf',
    ]],
    ['filter and append', [
      'grep -v O2_TARGET /etc/life_support.conf > /tmp/o2.conf',
      'echo O2_TARGET=21 >> /tmp/o2.conf',
      'cp /tmp/o2.conf /etc/life_support.conf',
    ]],
    ['sed through a pipe into a redirect', [
      "cat /etc/life_support.conf | sed 's/16/21/' > /etc/life_support.conf",
    ]],
  ];

  for (const [name, commands] of routes) {
    it(`accepts: ${name}`, async () => {
      const m = boot();
      expect(goal(m)).toBe(false);
      for (const command of commands) {
        const r = await m.exec(command);
        expect(r.stderr, `${command} -> ${r.stderr}`).toBe('');
      }
      expect(goal(m)).toBe(true);
    });
  }

  it('rejects a near miss that does not change the world', async () => {
    const m = boot();
    await m.exec("echo 'O2_TARGET=21'");
    await m.exec("sed 's/16/21/' /etc/life_support.conf");
    expect(goal(m)).toBe(false);
  });
});
