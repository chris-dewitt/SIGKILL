/**
 * Prints the art so a person can look at it. Run with:
 *
 *     pnpm --filter @sigkill/wreck exec vitest run art.preview \
 *       --disable-console-intercept
 */
import { it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { bootWreck } from '../src/world.js';
import { deckMap, pressurePanel, reserveGauge } from '../src/act1/art.js';

it('previews', () => {
  const { machine } = bootWreck();
  const out: string[] = [];
  const ruler = '0123456789'.repeat(4).slice(0, 34);

  out.push('', `columns:  ${ruler}`, '');
  out.push('=== DECK MAP, C7 open (as the player finds it) ===', '');
  out.push(...deckMap(machine.vfs));

  machine.vfs.writeText('/etc/hull/c7.conf', 'NAME=aft maintenance crawl\nSEALED=yes\n', ROOT_USER);
  out.push('', '=== DECK MAP, C7 sealed (after the fix) ===', '');
  out.push(...deckMap(machine.vfs));

  out.push('', '=== PRESSURE PANEL ===', '');
  out.push(...pressurePanel(machine.vfs));

  out.push('', '=== RESERVE GAUGE ===', '', reserveGauge(9), reserveGauge(61), reserveGauge(100));
  console.log(out.join('\n'));
});
