import { expect, test, type Page } from '@playwright/test';

async function dismissFold(page: Page): Promise<void> {
  const fold = page.locator('#fold');
  const next = page.locator('#fold-next');
  for (let i = 0; i < 8; i++) {
    if (!(await fold.isVisible())) return;
    await next.click();
  }
  await expect(fold).toBeHidden();
}

async function typeCommand(page: Page, command: string): Promise<void> {
  const input = page.locator('#input');
  await input.click();
  await input.fill(command);
  await input.press('Enter');
  // A completed objective opens the fold and hides the last-turn strip.
  await expect.poll(async () => {
    const turn = await page.locator('#turn').isVisible();
    const fold = await page.locator('#fold').isVisible();
    return turn || fold;
  }).toBeTruthy();
}

test.describe('phone dock', () => {
  test('pages the cold-open nudge in the fold', async ({ page }) => {
    await page.goto('/?typing=off');
    await expect(page.locator('#fold')).toBeVisible();
    await expect(page.locator('#turn')).toBeHidden();
    await expect(page.locator('#fold-body')).not.toBeEmpty();
    await expect(page.locator('#fold-next')).toContainText(/tap to/i);
    await dismissFold(page);
    await expect(page.locator('#input')).toBeVisible();
  });

  test('hides the last-turn strip while a beat fold is open', async ({ page }) => {
    await page.goto('/?typing=off');
    await typeCommand(page, "sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf");
    await typeCommand(page, 'sudo systemctl start scrubber');
    await expect(page.locator('#fold')).toBeVisible();
    await expect(page.locator('#turn')).toBeHidden();
    await expect(page.locator('#fold-body')).toContainText('ORACLE');
    await expect(page.locator('#input')).toBeVisible();
    await dismissFold(page);
    await expect(page.locator('#turn')).toBeVisible();
    await expect(page.locator('#turn-cmd')).toContainText('scrubber');
  });

  test('shows the last command above the dock', async ({ page }) => {
    await page.goto('/?typing=off');
    await typeCommand(page, 'ls');
    await expect(page.locator('#fold')).toBeHidden();
    await expect(page.locator('#turn-cmd')).toContainText('ls');
    await expect(page.locator('#turn-out')).toContainText('README');
  });

  test('restores the run after a reload', async ({ page }) => {
    await page.goto('/?typing=off');
    await typeCommand(page, 'pwd');
    await expect(page.locator('#turn-out')).toContainText('/home/survivor');
    await page.reload();
    await expect(page.locator('#fold')).toBeHidden();
    await expect(page.locator('#turn-cmd')).toContainText('pwd');
    await expect(page.locator('#turn-out')).toContainText('/home/survivor');
    await typeCommand(page, 'whoami');
    await expect(page.locator('#turn-cmd')).toContainText('whoami');
    await expect(page.locator('#turn-out')).toContainText('survivor');
  });

  test('newgame wipes the save and returns the cold open', async ({ page }) => {
    await page.goto('/?typing=off');
    await typeCommand(page, 'pwd');
    await page.reload();
    await expect(page.locator('#turn-cmd')).toContainText('pwd');
    await page.locator('#input').fill('newgame');
    await page.locator('#input').press('Enter');
    await expect(page.locator('#fold')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#turn')).toBeHidden();
    await typeCommand(page, 'ls');
    await expect(page.locator('#turn-cmd')).toContainText('ls');
  });

  test('hint and objectives stay on the chip bar', async ({ page }) => {
    await page.goto('/?typing=off');
    const chips = page.locator('#chips .chip');
    await expect(chips).toContainText(['hint', 'objectives']);
  });
});

test.describe('the ship types, and says where you are', () => {
  test('types a beat out and lands the whole page on a tap', async ({ page }) => {
    await page.goto('/?typing=slow');
    const body = page.locator('#fold-body');
    await expect(body).toBeVisible();

    // Past the title card, which is a drawing and arrives whole.
    await expect(body).toContainText('THE WRECK');
    await page.locator('#fold-next').click();

    // Mid-flight: something is showing, the whole page is not.
    await expect.poll(async () => (await body.textContent())?.length ?? 0).toBeGreaterThan(0);
    const partial = (await body.textContent()) ?? '';

    // One tap finishes the page rather than turning it.
    await page.locator('#fold-next').click();
    const landed = (await body.textContent()) ?? '';
    expect(landed.length).toBeGreaterThan(partial.length);
    expect(landed).not.toContain('▋');
    await expect(page.locator('#fold')).toBeVisible();
  });

  test('shows air, hull and the current step, and keeps them current', async ({ page }) => {
    await page.goto('/?typing=off');
    const status = page.locator('[aria-label="Ship status"]');
    await expect(status).toContainText('AIR --');
    await expect(status).toContainText('HULL 8/9');
    await expect(status).toContainText('0/5');

    const input = page.locator('#input');
    await input.click();
    await input.fill("sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf");
    await input.press('Enter');
    await input.fill('sudo systemctl start scrubber');
    await input.press('Enter');

    // The air is real now, and the readout says so without being asked.
    await expect(status).toContainText('AIR 21');
    await expect(status).toContainText('1/5');
  });
});

test.describe('the phone screen', () => {
  test('opens on the intro in the fold, not buried up the scrollback', async ({ page }) => {
    await page.goto('/?typing=off');
    const body = page.locator('#fold-body');
    await expect(page.locator('#fold')).toBeVisible();
    // The title card is the first thing, and it is whole.
    await expect(body).toContainText('THE WRECK');

    // And the whole opening is reachable in a handful of taps rather than a
    // scroll back up the screen.
    const next = page.locator('#fold-next');
    let taps = 0;
    let sawOracle = false;
    while (taps < 12 && (await page.locator('#fold').isVisible())) {
      if (((await body.textContent()) ?? '').includes('ORACLE:')) sawOracle = true;
      await next.click();
      taps++;
    }
    expect(sawOracle).toBe(true);
    expect(taps).toBeLessThan(10);
  });

  test('scrolls the way a thumb expects: back is up, in both hands', async ({ page }) => {
    await page.goto('/?typing=off');
    for (let i = 0; i < 12 && (await page.locator('#fold').isVisible()); i++) {
      await page.locator('#fold-next').click();
    }

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
    await page.goto('/?typing=off');
    const appHeight = async (): Promise<number> =>
      page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-height')));
    const foldRoom = async (): Promise<number> =>
      page.evaluate(() => document.querySelector('#fold-body')!.getBoundingClientRect().height);

    const full = await appHeight();
    expect(full).toBeGreaterThan(600);

    // A soft keyboard is a shorter visual viewport, which is exactly what
    // `interactive-widget=resizes-content` gives us on Android.
    await page.setViewportSize({ width: 400, height: 420 });
    await expect.poll(appHeight).toBeLessThan(full * 0.7);
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.classList.contains('keyboard')),
    ).toBe(true);

    // The panels are a fraction of what is visible, so the terminal keeps
    // rows instead of being squeezed out by a strip sized off the whole screen.
    expect(await foldRoom()).toBeLessThan(420 * 0.45);
    // And the input is still on screen, which is the whole point.
    const input = (await page.locator('#input').boundingBox())!;
    expect(input.y + input.height).toBeLessThanOrEqual(421);
  });
});

test.describe('the last-turn strip', () => {
  test('wraps a note and clips a drawing, on the command\'s own word', async ({ page }) => {
    await page.goto('/?typing=off');
    for (let i = 0; i < 14 && (await page.locator('#fold').isVisible()); i++) {
      await page.locator('#fold-next').click();
    }

    const input = page.locator('#input');
    const out = page.locator('#turn-out');
    const run = async (command: string): Promise<void> => {
      await input.click();
      await input.fill(command);
      await input.press('Enter');
    };

    // A note is prose. It wraps, or a phone shows the left two thirds of it.
    await run('cat README');
    await expect(out).toContainText('Vasquez');
    await expect(out).not.toHaveClass(/art/);
    const width = (await out.boundingBox())!.width;
    expect(await out.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(Math.ceil(width) + 1);

    // A drawing is columns. It clips rather than reflowing into confetti.
    await run('sudo chmod +x /usr/local/bin/hull-check');
    await run('sudo systemctl start hull-monitor');
    for (let i = 0; i < 14 && (await page.locator('#fold').isVisible()); i++) {
      await page.locator('#fold-next').click();
    }
    await run('deck');
    await expect(out).toHaveClass(/art/);
  });
});
