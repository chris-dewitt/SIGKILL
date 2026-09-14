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
    await page.goto('/');
    await expect(page.locator('#fold')).toBeVisible();
    await expect(page.locator('#turn')).toBeHidden();
    await expect(page.locator('#fold-body')).not.toBeEmpty();
    await expect(page.locator('#fold-next')).toContainText(/tap to/i);
    await dismissFold(page);
    await expect(page.locator('#input')).toBeVisible();
  });

  test('hides the last-turn strip while a beat fold is open', async ({ page }) => {
    await page.goto('/');
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
    await page.goto('/');
    await typeCommand(page, 'ls');
    await expect(page.locator('#fold')).toBeHidden();
    await expect(page.locator('#turn-cmd')).toContainText('ls');
    await expect(page.locator('#turn-out')).toContainText('README');
  });

  test('restores the run after a reload', async ({ page }) => {
    await page.goto('/');
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
    await page.goto('/');
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
    await page.goto('/');
    const chips = page.locator('#chips .chip');
    await expect(chips).toContainText(['hint', 'objectives']);
  });
});
