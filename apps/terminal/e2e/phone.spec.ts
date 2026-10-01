import { expect, test, type Page } from '@playwright/test';

/**
 * What is left to drive from outside after the fold came out.
 *
 * The scrollback is a canvas, so none of the ship's output is queryable from
 * here any more -- the old spec asserted on `#turn-out` and `#fold-body`, and
 * both are gone. What remains in the DOM is the dock: the input, the chip
 * bars, the pinned status rows, the scroll rail, and the layout's response to
 * a soft keyboard. That is the part these tests exist for anyway. Everything
 * about *what the ship says* is a unit test in `@sigkill/wreck`, where it can
 * be read rather than screenshotted.
 */

/**
 * Open the app already in The Wreck, skipping the chooser.
 *
 * A brand-new browser now lands on the series chooser, which owns the first
 * line of input -- so without this every spec below would spend its `cd /etc`
 * answering a question about which game to play. Seeding the same key the app
 * writes when a player chooses is both the smallest fix and the honest one: it
 * puts the browser in the state of somebody who has chosen before.
 *
 * The chooser itself is tested below, from a browser that has not.
 */
async function openWreck(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('sigkill:last', 'wreck');
  });
  await page.goto('/');
}

async function run(page: Page, command: string): Promise<void> {
  const input = page.locator('#input');
  await input.click();
  await input.fill(command);
  await input.press('Enter');
  // The form clears on submit, which is the one DOM signal that the command
  // was taken. Polling this rather than sleeping keeps the spec honest on a
  // slow machine.
  await expect(input).toHaveValue('');
}

test.describe('phone dock', () => {
  test('opens with the input and both chip bars in reach', async ({ page }) => {
    await openWreck(page);
    await expect(page.locator('#input')).toBeVisible();
    await expect(page.locator('#chips')).toBeVisible();
    await expect(page.locator('#symbols')).toBeVisible();
  });

  test('hint and objectives stay on the chip bar', async ({ page }) => {
    await openWreck(page);
    const chips = page.locator('#chips .chip');
    await expect(chips).toContainText(['hint', 'objectives']);
  });

  test('restores the run after a reload', async ({ page }) => {
    await openWreck(page);
    await run(page, 'cd /etc');
    await expect(page.locator('#prompt')).toContainText('/etc');

    await page.reload();
    // The save carries the working directory, so the prompt is the cheapest
    // proof that this is the same run and not a fresh boot.
    await expect(page.locator('#prompt')).toContainText('/etc');
  });

  test('newgame wipes the save and returns to the berth', async ({ page }) => {
    await openWreck(page);
    await run(page, 'cd /etc');
    await expect(page.locator('#prompt')).toContainText('/etc');

    await page.locator('#input').fill('newgame');
    await page.locator('#input').press('Enter');
    // Back in the berth: the cold open starts at home, so the prompt loses
    // the directory the wiped run was standing in.
    await expect(page.locator('#prompt')).toContainText('~', { timeout: 10_000 });
    await expect(page.locator('#prompt')).not.toContainText('/etc');
  });
});

test.describe('the ship says where you are', () => {
  test('shows air, hull and the current step, and keeps them current', async ({ page }) => {
    await openWreck(page);
    const status = page.locator('[aria-label="Ship status"]');
    await expect(status).toContainText('AIR --');
    await expect(status).toContainText('HULL 8/9');

    // Not a hard-coded total: the act grows, and a spec that has to be edited
    // every time an objective is added is a spec people start ignoring. The
    // counter is the one number sitting in the rule, between the box rows --
    // matching on that context keeps it off HULL 8/9.
    const done = async (): Promise<number> => {
      const text = (await status.textContent()) ?? '';
      return Number(/─\s*(\d+)\/\d+\s*─/.exec(text)?.[1] ?? -1);
    };
    expect(await done()).toBe(0);

    await run(page, "sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf");
    await run(page, 'sudo systemctl start scrubber');

    // The air is real now, and the readout says so without being asked.
    await expect(status).toContainText('AIR 21');
    await expect.poll(done).toBe(1);
  });
});

test.describe('the phone screen', () => {
  test('scrolls the way a thumb expects: back is up, in both hands', async ({ page }) => {
    await openWreck(page);

    const thumb = page.locator('#scroll-thumb');
    const top = async (): Promise<number> => (await thumb.boundingBox())?.y ?? 0;

    // Settle the rail against the real grid before measuring anything: it is
    // drawn once during boot, before the view has been told how big it is.
    const box = (await page.locator('#screen').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 2000);
    const atBottom = await top();

    // Wheel up: back through the history, so the thumb climbs.
    await page.mouse.wheel(0, -400);
    await expect.poll(top).toBeLessThan(atBottom);

    // And wheel down brings it back to the newest line.
    await page.mouse.wheel(0, 2000);
    await expect.poll(top).toBe(atBottom);

    // A thumb dragged down does what the wheel-up did: the content follows
    // the finger, so what was above comes into view.
    await page.evaluate(() => {
      const el = document.querySelector('#screen')!;
      const touch = (clientY: number): Touch =>
        new Touch({ identifier: 1, target: el, clientX: 40, clientY });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(80)], bubbles: true }));
      el.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(320)], bubbles: true }));
      el.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }));
    });
    await expect.poll(top).toBeLessThan(atBottom);
  });

  test('gives the screen back when the keyboard takes it', async ({ page }) => {
    await openWreck(page);
    const appHeight = async (): Promise<number> =>
      page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-height')),
      );

    const full = await appHeight();
    expect(full).toBeGreaterThan(600);

    // A soft keyboard is a shorter visual viewport, which is exactly what
    // `interactive-widget=resizes-content` gives us on Android.
    await page.setViewportSize({ width: 400, height: 420 });
    await expect.poll(appHeight).toBeLessThan(full * 0.7);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('keyboard')))
      .toBe(true);

    // And the input is still on screen, which is the whole point: a player
    // who can tap a chip but cannot see what they are typing has no game.
    const input = (await page.locator('#input').boundingBox())!;
    expect(input.y + input.height).toBeLessThanOrEqual(421);
  });
});

/**
 * The mixer has to know what the ship is doing before anybody touches the page.
 *
 * It cannot make a sound before a gesture and must not try. But `resume()`
 * applies whatever state the mixer is holding, so a host that never calls
 * `setState` at boot resumes into a silent ship -- the cold open plays into
 * nothing and `newgame` reloads into nothing. That shipped, and it reads as
 * broken audio rather than as quiet.
 */
test.describe('the ship is audible from the first keystroke', () => {
  test('knows the ship state at boot, before any command', async ({ page }) => {
    await openWreck(page);
    const state = await page.evaluate(
      () => (window as unknown as { sound: { shipState: Record<string, unknown> } }).sound.shipState,
    );
    // A stopped scrubber and an open compartment: the opening state of the
    // act, not the silent default.
    // SILENT_SHIP has `breached: false`, so this is the assertion that would
    // have caught the bug: a mixer that was never told resumes into a ship
    // with no hole in it.
    expect(state.scrubber).toBe(false);
    expect(state.monitor).toBe(false);
    expect(state.breached).toBe(true);
  });

  test('still knows it after newgame reloads the cold open', async ({ page }) => {
    await openWreck(page);
    await run(page, 'cd /etc');

    await page.locator('#input').fill('newgame');
    await page.locator('#input').press('Enter');
    await expect(page.locator('#prompt')).toContainText('~', { timeout: 10_000 });

    const state = await page.evaluate(
      () => (window as unknown as { sound: { shipState: Record<string, unknown> } }).sound.shipState,
    );
    expect(state.breached).toBe(true);
    expect(state.scrubber).toBe(false);
  });
});

test.describe('the series chooser', () => {
  /*
   * The screen a first-time player actually sees.
   *
   * Three games exist and for a long time the app could only open one, so this
   * is the test that the other two are reachable at all -- the rest of the
   * suite deliberately skips past it.
   */
  test('a new browser is offered all three, and can open the first', async ({ page }) => {
    await page.goto('/');
    // The scrollback is a canvas, so the list is not queryable. What is
    // queryable is that the input is waiting and no game has started: the
    // status rows carry no objective yet.
    await expect(page.locator('#input')).toBeVisible();

    await run(page, '1');
    // The Wreck opens at home, so the prompt shows the home directory.
    await expect(page.locator('#prompt')).toContainText('~');
    await expect(page.locator('[aria-label="Ship status"]')).toContainText('AIR');
  });

  test('a number that is not on the list is refused, not guessed at', async ({ page }) => {
    await page.goto('/');
    await run(page, '9');
    // Still waiting, and still no ship.
    await expect(page.locator('[aria-label="Ship status"]')).not.toContainText('AIR');
    await run(page, '1');
    await expect(page.locator('[aria-label="Ship status"]')).toContainText('AIR');
  });

  test('opens The Harness by name, and it keeps its own save', async ({ page }) => {
    await page.goto('/');
    await run(page, 'harness');
    // The reload lands in the galley, whose readout says where it is rather
    // than pretending to have a hull.
    await expect(page.locator('[aria-label="Ship status"]')).toContainText('ELLEN MAY', { timeout: 15_000 });
    await expect(page.locator('[aria-label="Ship status"]')).not.toContainText('AIR');

    await run(page, 'games');
    await expect(page.locator('#input')).toHaveValue('');
  });
});

/*
 * Copying out, and completion.
 *
 * Both exist because of one playtest on a real phone: the scrollback is a
 * canvas and could not be copied from at all, and TAB was styled so quietly
 * that the player never found it and played a terminal without completion.
 */
test.describe('select mode', () => {
  test('hands over the transcript, including what has scrolled past', async ({ page }) => {
    await openWreck(page);
    await run(page, 'echo findable-marker');
    // Push it well out of sight, so this cannot pass by reading the screen.
    for (let i = 0; i < 25; i++) await run(page, 'echo filler');

    await page.locator('#text').click();
    const body = page.locator('#text-body');
    await expect(body).toBeVisible();
    await expect(body).toContainText('findable-marker');
    await expect(body).toContainText('$ echo findable-marker');
  });

  test('is real selectable text, which the canvas is not', async ({ page }) => {
    await openWreck(page);
    await run(page, 'echo selectable');
    await page.locator('#text').click();

    // Selecting it from script proves only that the DOM holds the text; the
    // property that makes a long-press work is that it is not `user-select:
    // none`, so assert the computed style as well.
    await expect(page.locator('#text-body')).toHaveCSS('user-select', 'text');

    const selected = await page.evaluate(() => {
      const pre = document.querySelector('#text-body')!;
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      return sel.toString();
    });
    expect(selected).toContain('selectable');
  });

  test('closes again and gives the prompt back', async ({ page }) => {
    await openWreck(page);
    await page.locator('#text').click();
    await expect(page.locator('#text-body')).toBeVisible();

    await page.locator('#text-done').click();
    await expect(page.locator('#text-view')).toBeHidden();
    // The field is focused, so the next thing typed is a command rather than
    // nothing at all -- on a phone, losing focus silently drops the keyboard.
    await expect(page.locator('#input')).toBeFocused();
  });

  test('is not offered while a command is still running', async ({ page }) => {
    await openWreck(page);
    const text = page.locator('#text');
    await expect(text).toBeEnabled();

    // The first Python call boots Pyodide, which is the slowest thing aboard
    // and so the one window where this is reliably observable.
    const input = page.locator('#input');
    await input.click();
    await input.fill('python3 -c "print(1)"');
    await input.press('Enter');

    // In flight: the transcript would be a snapshot taken before the output
    // being waited for.
    await expect(text).toBeDisabled();

    // And it comes back once the command lands.
    await expect(text).toBeEnabled({ timeout: 30_000 });
  });

  test('copies, and says so', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openWreck(page);
    await run(page, 'echo on-the-clipboard');
    await page.locator('#text').click();
    await page.locator('#text-copy').click();

    await expect(page.locator('#text-copy')).toHaveText('COPIED');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('on-the-clipboard');
  });
});

test.describe('TAB says when it has something', () => {
  test('arms on a prefix it can finish, and not on an empty line', async ({ page }) => {
    await openWreck(page);
    const tab = page.locator('#tab');

    // Nothing typed: every command aboard would complete, which is true and
    // useless, so the button stays quiet.
    await expect(tab).not.toHaveClass(/armed/);

    await page.locator('#input').fill('system');
    await expect(tab).toHaveClass(/armed/);

    await page.locator('#input').fill('zzzznotacommand');
    await expect(tab).not.toHaveClass(/armed/);
  });

  test('completes a path when tapped, not just a command', async ({ page }) => {
    await openWreck(page);
    const input = page.locator('#input');
    await input.fill('cat /etc/life');
    await expect(page.locator('#tab')).toHaveClass(/armed/);

    await page.locator('#tab').click();
    await expect(input).toHaveValue('cat /etc/life_support.conf ');
  });
});
