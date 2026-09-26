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
    await page.goto('/');
    await expect(page.locator('#input')).toBeVisible();
    await expect(page.locator('#chips')).toBeVisible();
    await expect(page.locator('#symbols')).toBeVisible();
  });

  test('hint and objectives stay on the chip bar', async ({ page }) => {
    await page.goto('/');
    const chips = page.locator('#chips .chip');
    await expect(chips).toContainText(['hint', 'objectives']);
  });

  test('restores the run after a reload', async ({ page }) => {
    await page.goto('/');
    await run(page, 'cd /etc');
    await expect(page.locator('#prompt')).toContainText('/etc');

    await page.reload();
    // The save carries the working directory, so the prompt is the cheapest
    // proof that this is the same run and not a fresh boot.
    await expect(page.locator('#prompt')).toContainText('/etc');
  });

  test('newgame wipes the save and returns to the berth', async ({ page }) => {
    await page.goto('/');
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
    await page.goto('/');
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
    await page.goto('/');

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
    await page.goto('/');
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
    await page.goto('/');
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
    await page.goto('/');
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
