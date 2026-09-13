import { expect, test, type Page } from '@playwright/test';

async function typeCommand(page: Page, command: string): Promise<void> {
  const input = page.locator('#input');
  await input.click();
  await input.fill(command);
  await input.press('Enter');
  await expect(page.locator('#turn')).toBeVisible();
}

test.describe('phone dock', () => {
  test('shows the last command above the dock', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#input')).toBeVisible();
    await typeCommand(page, 'ls');
    await expect(page.locator('#turn-cmd')).toContainText('ls');
    await expect(page.locator('#turn-out')).toContainText('README');
  });

  test('restores the run after a reload', async ({ page }) => {
    await page.goto('/');
    await typeCommand(page, 'pwd');
    await expect(page.locator('#turn-out')).toContainText('/home/survivor');
    await page.reload();
    await expect(page.locator('#turn-cmd')).toContainText('pwd');
    await expect(page.locator('#turn-cmd')).toContainText('pwd');
    await typeCommand(page, 'pwd');
    await expect(page.locator('#turn-out')).toContainText('/home/survivor');
  });

  test('hint and objectives stay on the chip bar', async ({ page }) => {
    await page.goto('/');
    const chips = page.locator('#chips .chip');
    await expect(chips).toContainText(['hint', 'objectives']);
  });
});
