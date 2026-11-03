/* Pack a file from the start screen: PRGs or a Kick Assembler source packed with Brokkr as they are, without a
 * project or the analysis; the packed file goes next to what was packed. The files are copies in the test's folder. */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, repoDir, test } from './fixtures';
import { stubDialogs } from './helpers';

test.use({ start: 'none' });

test('pack a PRG as it is, from the start screen', async ({ workDir: work, app, page }) => {
  const prg = join(work, 'raster-demo.prg');
  copyFileSync(join(repoDir, 'fixtures/prg/raster-demo.prg'), prg);
  await page.getByRole('button', { name: 'Pack a file…' }).click();
  await expect(page.getByRole('heading', { name: 'Pack a file' })).toBeVisible();
  const settings = page.getByLabel('Pack settings');
  await expect(settings.getByRole('button', { name: 'Pack', exact: true })).toBeDisabled();

  await stubDialogs(app, { open: [prg] });
  await page.getByRole('button', { name: 'PRG files…' }).click();
  const files = page.getByRole('list', { name: 'Files to pack' });
  await expect(files).toContainText('raster-demo.prg $0801–$37ff');
  await expect(files).toContainText('BASIC line: SYS 2064 ($0810)');
  // self-extracting, started with the SYS of its BASIC line, next to the file
  await expect(settings.locator('#pack-start')).toHaveValue('sys');
  await expect(settings.locator('#pack-dir')).toHaveText(work);
  await expect(settings.getByLabel('Brokkr command')).toContainText('sfx');

  await settings.getByRole('button', { name: 'Pack', exact: true }).click();
  const card = settings.getByRole('status', { name: 'Packed file' });
  await expect(card).toContainText('raster-demo-brokkr.prg', { timeout: 120_000 });
  await expect(card).toContainText(/\d+ bytes packed to \d+/);
  const packed = readFileSync(join(work, 'raster-demo-brokkr.prg'));
  expect([packed[0], packed[1]]).toEqual([0x01, 0x08]);
  expect(packed.length).toBeLessThan(readFileSync(prg).length);

  // a range of it, and back to the start screen
  await page.getByRole('tab', { name: 'Address ranges' }).click();
  await expect(page.getByLabel('Ranges to pack')).toHaveValue('$0801-$37ff');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('button', { name: 'New project…' })).toBeVisible();
});

test('assemble a Kick Assembler source and pack the PRG it makes', async ({ workDir: work, app, page }) => {
  const kickJar = (await page.evaluate(() => (window as unknown as { kr: { getSettings(): Promise<{ kickJar: string }> } }).kr.getSettings())).kickJar;
  test.skip(!kickJar || !existsSync(kickJar), 'needs KickAss.jar');
  const source = join(work, 'my border.asm');
  writeFileSync(source, 'BasicUpstart2(start)\nstart:\n  inc $d020\n  jmp start\n');
  await page.getByRole('button', { name: 'Pack a file…' }).click();
  await stubDialogs(app, { open: [source] });
  await page.getByRole('button', { name: 'Kick Assembler source…' }).click();
  await expect(page.getByRole('list', { name: 'Files to pack' })).toContainText('my border.prg $0801', { timeout: 60_000 });
  expect(existsSync(join(work, 'out', 'my border.prg'))).toBe(true);

  const settings = page.getByLabel('Pack settings');
  await settings.getByRole('button', { name: 'Pack', exact: true }).click();
  await expect(settings.getByRole('status', { name: 'Packed file' })).toContainText('my border-brokkr.prg', { timeout: 120_000 });
  expect(existsSync(join(work, 'my border-brokkr.prg'))).toBe(true);

  // a source that does not assemble says why
  writeFileSync(source, 'start:\n  lda unknown_label\n');
  await settings.getByRole('button', { name: 'Pack', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('KickAss.jar could not assemble my border.asm');
  await expect(page.getByRole('list', { name: 'Kick Assembler problems' })).toContainText("Unknown symbol 'unknown_label'");
});
