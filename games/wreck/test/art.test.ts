import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { SAFE_COLS } from '@sigkill/ascii';
import { bootWreck, coldOpen, epilogue } from '../src/world.js';
import { deckMap, pressurePanel, readCompartment } from '../src/act1/art.js';
import {
  ORACLE_ALARMED, ORACLE_AWAKE, ORACLE_CANDID, ORACLE_DORMANT, shipSchematic, titleCard,
  type ShipState,
} from '../src/act1/cards.js';

/** A fixed readout, so a card test is about the drawing and not the numbers. */
const SHIP: ShipState = { hullClaim: '61%', reserve: '9h 14m', aboard: 1 };

/**
 * The deck map's job is to make the player's edit visible. If sealing C7 does
 * not change the picture, the drawing is decoration and should be deleted.
 */
describe('the deck map is a view of the files, not a second copy of them', () => {
  const seal = (m: ReturnType<typeof bootWreck>['machine'], id: string): void => {
    m.vfs.writeText(`/etc/hull/${id}.conf`, `NAME=x\nSEALED=yes\n`, ROOT_USER);
  };

  it('draws C7 differently before and after the fix', async () => {
    const { machine } = bootWreck();
    const before = deckMap(machine.vfs).join('\n');
    await machine.exec("sed -i 's/^SEALED=.*/SEALED=yes/' /etc/hull/c7.conf");
    const after = deckMap(machine.vfs).join('\n');
    expect(after).not.toBe(before);
  });

  it('names the open compartment while it is open, and stops once it is not', () => {
    const { machine } = bootWreck();
    expect(deckMap(machine.vfs).join('\n')).toContain('aft maintenance crawl');
    seal(machine, 'c7');
    const after = deckMap(machine.vfs).join('\n');
    expect(after).toContain('all nine holding');
    expect(after).not.toContain('open to vacuum');
  });

  it('draws a dashed wall for an open compartment and a solid one for a sealed', () => {
    const { machine } = bootWreck();
    expect(deckMap(machine.vfs).join('\n')).toContain('╌');
    seal(machine, 'c7');
    expect(deckMap(machine.vfs).join('\n')).not.toContain('╌');
  });

  it('shows all nine compartments', () => {
    const { machine } = bootWreck();
    const map = deckMap(machine.vfs).join('\n');
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(map).toContain(`C${n}`);
  });

  it('fits the safe width exactly, on every row', () => {
    const { machine } = bootWreck();
    for (const row of deckMap(machine.vfs)) {
      expect(row.length, `"${row}"`).toBeLessThanOrEqual(SAFE_COLS);
    }
  });

  it('survives a compartment file being deleted rather than throwing', async () => {
    const { machine } = bootWreck();
    expect((await machine.exec('sudo rm /etc/hull/c4.conf')).code).toBe(0);
    const map = deckMap(machine.vfs).join('\n');
    expect(map).toContain('C4');
    expect(map).toContain('no telemetry');
  });

  it('reads a hand-typed SEALED = YES, because a player will type that', () => {
    const { machine } = bootWreck();
    machine.vfs.writeText('/etc/hull/c7.conf', 'NAME=x\nSEALED = YES\n', ROOT_USER);
    expect(readCompartment(machine.vfs, 'c7').sealed).toBe(true);
  });
});

describe('the pressure panel', () => {
  it('flags the compartment that is losing air and no others', () => {
    const { machine } = bootWreck();
    const rows = pressurePanel(machine.vfs).filter((r) => r.includes('!'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('C7');
  });

  it('fits the safe width', () => {
    const { machine } = bootWreck();
    for (const row of pressurePanel(machine.vfs)) {
      expect(row.length, `"${row}"`).toBeLessThanOrEqual(SAFE_COLS);
    }
  });

  it('says so rather than drawing an empty box when there is no telemetry', async () => {
    const { machine } = bootWreck();
    await machine.exec('sudo rm /var/log/hull.log');
    expect(pressurePanel(machine.vfs).join('\n')).toContain('no telemetry');
  });
});

describe('the commands that draw', () => {
  it('deck and pressure both mark their output preformatted', async () => {
    const { machine } = bootWreck();
    for (const command of ['deck', 'pressure']) {
      const r = await machine.exec(command);
      expect(r.stderr, command).toBe('');
      expect(r.preformatted, `${command} must not be reflowed`).toBe(true);
    }
  });

  it('ordinary output is not marked preformatted', async () => {
    const { machine } = bootWreck();
    expect((await machine.exec('cat README')).preformatted).toBe(false);
  });

  it('both have a manual on both tracks, like everything else aboard', async () => {
    for (const track of ['operator', 'cadet'] as const) {
      const { machine } = bootWreck({ track });
      for (const command of ['deck', 'pressure']) {
        const page = (await machine.exec(`man ${command}`)).stdout;
        expect(page, `man ${command} on ${track}`).toContain('DESCRIPTION');
      }
    }
  });
});

describe('the set-piece cards', () => {
  it('closes the breach on the schematic when the player closes it', () => {
    const { machine } = bootWreck();
    expect(shipSchematic(machine.vfs, SHIP).join('\n')).toContain('░░░');
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']) {
      machine.vfs.writeText(`/etc/hull/${id}.conf`, 'NAME=x\nSEALED=yes\n', ROOT_USER);
    }
    const after = shipSchematic(machine.vfs, SHIP).join('\n');
    expect(after).not.toContain('░░░');
    expect(after).toContain('9 of 9 sealed');
  });

  it('counts sealed compartments the same way the deck map draws them', () => {
    const { machine } = bootWreck();
    expect(shipSchematic(machine.vfs, SHIP).join('\n')).toContain('8 of 9 sealed');
  });

  it('fits every card inside the safe width', () => {
    const { machine } = bootWreck();
    const cards: Array<[string, readonly string[]]> = [
      ['titleCard', titleCard()],
      ['shipSchematic', shipSchematic(machine.vfs, SHIP)],
      ['ORACLE_DORMANT', ORACLE_DORMANT],
      ['ORACLE_AWAKE', ORACLE_AWAKE],
      ['ORACLE_ALARMED', ORACLE_ALARMED],
      ['ORACLE_CANDID', ORACLE_CANDID],
    ];
    for (const [name, card] of cards) {
      for (const row of card) {
        expect(row.length, `${name}: "${row}"`).toBeLessThanOrEqual(SAFE_COLS);
      }
    }
  });

  it('gives every mood a different face, or the state is not readable', () => {
    const moods = [ORACLE_DORMANT, ORACLE_AWAKE, ORACLE_ALARMED, ORACLE_CANDID];
    const shapes = new Set(moods.map((m) => m.join('|')));
    expect(shapes.size).toBe(moods.length);
  });

  it('keeps every mood the same shape, so only the features change', () => {
    for (const mood of [ORACLE_AWAKE, ORACLE_ALARMED, ORACLE_CANDID]) {
      expect(mood).toHaveLength(ORACLE_DORMANT.length);
      expect(mood.map((r) => r.length)).toEqual(ORACLE_DORMANT.map((r) => r.length));
    }
  });

  it('shows the title once, in the cold open, and nowhere else', () => {
    const { machine } = bootWreck();
    const opening = coldOpen(machine).map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    const ending = epilogue(machine).map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    const logo = titleCard()[0]!;
    expect(opening).toContain(logo);
    // A logo that reappears stops being a title and becomes a watermark.
    expect(ending).not.toContain(logo);
  });

  it('marks every art row preformatted so a phone clips instead of shredding', () => {
    const { machine } = bootWreck();
    for (const [name, lines] of [['coldOpen', coldOpen(machine)], ['epilogue', epilogue(machine)]] as const) {
      const boxed = lines.filter(
        (l) => typeof l === 'string' && /[─-▟]/.test(l),
      );
      expect(boxed, `${name} has raw art in a prose line`).toEqual([]);
    }
  });
});
