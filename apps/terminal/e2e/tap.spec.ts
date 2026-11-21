import { expect, test, type Page } from '@playwright/test';

/**
 * Tapping instead of typing.
 *
 * "We need to not type multilingual code" -- Chris, on a phone. Four ways a
 * thumb now builds a line without the keyboard, each driven here by touch:
 * the chips that know what comes next, a word tapped on the tube, the recall
 * key, and the command `hint` has already shown.
 */

async function openArchive(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('sigkill:last', 'archive');
  });
  await page.goto('/');
  await expect(page.locator('#input')).toBeEnabled();
  await page.waitForFunction(() => 'view' in window && 'machine' in window);
}

async function run(page: Page, command: string): Promise<void> {
  const input = page.locator('#input');
  await input.fill(command);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  // Cleared at once; recorded and answered a moment later. Wait for the answer.
  await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('#input')!.disabled);
}

const chip = (page: Page, text: string) => page.locator('#chips .chip', { hasText: text }).first();

test('a query is built from chips, without a letter of SQL typed', async ({ page }) => {
  await openArchive(page);
  const input = page.locator('#input');
  await input.fill('sqlite3 ');
  await input.dispatchEvent('input');
  for (const word of ['/srv/archive/claims.db', '"SELECT', 'count(*)', 'FROM', 'crew']) await chip(page, word).tap();
  await expect(input).toHaveValue('sqlite3 /srv/archive/claims.db "SELECT count(*) FROM crew ');
});

test('a word on the tube goes onto the line when tapped', async ({ page }) => {
  await openArchive(page);
  await run(page, 'ls');
  const input = page.locator('#input');
  await input.fill('cat ');
  // Find where the renderer drew the file name, then tap it like a finger would.
  const at = await page.evaluate(() => {
    const view = (window as unknown as { view: { wordAt(x: number, y: number): string | undefined } }).view;
    for (let y = window.innerHeight * 0.95; y > 0; y -= 4) {
      for (let x = 20; x < window.innerWidth / 2; x += 6) {
        if (view.wordAt(x, y) === 'tow-invoice.txt') return { x, y };
      }
    }
    return undefined;
  });
  expect(at).toBeDefined();
  await page.touchscreen.tap(at!.x, at!.y);
  await expect(input).toHaveValue('cat tow-invoice.txt ');
});

test('recall brings back the last command, and hint\'s command becomes a chip', async ({ page }) => {
  await openArchive(page);
  const input = page.locator('#input');
  await run(page, 'pwd');
  await page.locator('.symbol.recall').tap();
  await expect(input).toHaveValue('pwd');
  await input.fill('');
  await input.dispatchEvent('input');

  await expect(page.locator('#chips .chip.given')).toHaveCount(0);
  for (let i = 0; i < 6 && (await page.locator('#chips .chip.given').count()) === 0; i++) await run(page, 'hint');
  const given = page.locator('#chips .chip.given');
  await expect(given).toHaveCount(1);
  const command = await given.getAttribute('title');
  await given.tap();
  if (!command!.includes('\n')) await expect(input).toHaveValue(command!);
});
