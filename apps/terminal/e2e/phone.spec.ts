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
