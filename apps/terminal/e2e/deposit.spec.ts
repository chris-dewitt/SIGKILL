import { expect, test, type Page } from '@playwright/test';

/**
 * Game six, from outside, because four hosts is a thing only the browser
 * actually assembles.
 *
 * Everything below is covered by unit tests in `@sigkill/deposit` except the
 * part that matters here: the save. The host writes it to localStorage and
 * reads it back on load, and a bastion-only save would come back looking
 * perfectly healthy with every repair on the other three hosts undone. That is
 * not something a unit test can catch, because the thing being tested is the
 * browser.
 */

async function openDeposit(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('sigkill:last', 'deposit');
  });
  await page.goto('/');
}

async function run(page: Page, command: string): Promise<void> {
  const input = page.locator('#input');
  await input.click();
  await input.fill(command);
  await input.press('Enter');
  await expect(input).toHaveValue('');
}

test.describe('the deposit floor', () => {
  test('opens on the bastion', async ({ page }) => {
    await openDeposit(page);
    await expect(page.locator('#prompt')).toContainText('dewitt@bastion');
  });

  test('ssh is a hop, and the prompt says which machine you are on', async ({ page }) => {
    await openDeposit(page);
    await run(page, 'ssh vault01');
    await expect(page.locator('#prompt')).toContainText('dewitt@vault01');
    await run(page, 'exit');
    await expect(page.locator('#prompt')).toContainText('dewitt@bastion');
  });

  /**
   * The one this file exists for.
   *
   * Start the catalogue on index01, reload, and ask index01 again. The whole
   * act happens on hosts the player is not standing on, so a save that keeps
   * only the local machine would pass every other test here and lose the game.
   */
  test('keeps a repair made on another host across a reload', async ({ page }) => {
    await openDeposit(page);
    await run(page, "ssh index01 'sudo systemctl start catalogue'");
    await run(page, "ssh index01 'sudo systemctl enable catalogue'");

    await page.reload();
    await expect(page.locator('#prompt')).toContainText('dewitt@bastion');
    await run(page, "ssh index01 'systemctl status catalogue'");

    /*
     * Read it out of the transcript, because the scrollback is a canvas.
     *
     * TEXT is the modal the copy button fills, and it is the only place what
     * the floor said is queryable from here. `enabled` and `active` are the
     * two halves of the repair, and a save that kept only the bastion gives
     * back `disabled` and `inactive` with no error anywhere to say why.
     */
    await page.locator('#text').click();
    const transcript = page.locator('#text-body');
    await expect(transcript).toContainText('catalogue.service');
    await expect(transcript).toContainText('enabled');
    await expect(transcript).toContainText('active');
    await page.locator('#text-done').click();
  });
});
