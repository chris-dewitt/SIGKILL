import { expect, test } from '@playwright/test';

/**
 * SQLite, in the browser, through the Worker.
 *
 * The unit tests drive `NodeSqlRuntime`, which is deliberately not the path
 * the game uses. This is the one that proves the Worker boots, the wasm is
 * served from our own origin, and the database lands in the Machine's
 * filesystem where `ls` can see it.
 */
test('sqlite3 works in the real app, and the database is a real file', async ({ page }) => {
  await page.goto('/');

  const run = async (command: string): Promise<void> => {
    const input = page.locator('#input');
    await input.click();
    await input.fill(command);
    await input.press('Enter');
    await expect(input).toHaveValue('');
  };

  // The Worker loads lazily on the first sqlite3, so give it room.
  await run("sqlite3 archive.db 'CREATE TABLE crew(id INTEGER PRIMARY KEY, name TEXT);'");
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { machine: { vfs: { exists(p: string, u: unknown): boolean } } }).machine.vfs.exists(
            '/home/dewitt/archive.db',
            { uid: 0, gid: 0, name: 'root' },
          ),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);

  await run("sqlite3 archive.db \"INSERT INTO crew(name) VALUES ('vasquez'),('dewitt');\"");

  // Read the rows back through the Machine, which is where the game reads them.
  const rows = await page.evaluate(async () => {
    const m = (window as unknown as { machine: { exec(c: string): Promise<{ stdout: string }> } }).machine;
    return (await m.exec("sqlite3 archive.db 'SELECT id, name FROM crew ORDER BY id;'")).stdout;
  });
  expect(rows).toBe('1|vasquez\n2|dewitt\n');

  // And the wasm came from our own origin, not a CDN.
  const external = await page.evaluate(() =>
    performance.getEntriesByType('resource').filter((r) => !r.name.startsWith(location.origin)).map((r) => r.name),
  );
  expect(external).toEqual([]);
});
