/* The overview of the analysis (spec 14.1b): once a file just opened is analysed, a window in the middle says what the
 * analysis found, part by part; its links go there and close it, as a click outside it and Esc do. Settings → General
 * (and the box at its foot) turns it off; the tests start with it off (fixtures.ts). */
import { join } from 'node:path';
import { expect, repoDir, test } from './fixtures';
import { fromFileMenu, statusBar, stubDialogs, toast, waitForListing } from './helpers';

test('the overview of the analysis opens after a load, and its links go where they say and close it', async ({ app, page }) => {
  await waitForListing(page);
  const overview = page.getByRole('dialog', { name: 'Analysis overview' });
  const open = async (name: string) => {
    await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg', name)] });
    await fromFileMenu(page, 'Open PRG files…');
    // (the toast of an earlier load of the file may still be there)
    await expect(toast(page, `Loaded ${name}`).last()).toBeVisible();
    // analysed, the deep analysis too (in whatever tab is open)
    await expect.poll(() => statusBar(page).textContent(), { timeout: 30_000 }).toMatch(/analysis [\d.]+ ms · render [\d.]+ ms \(worker\)(?! · deep analysis)/);
  };
  const palette = async () => {
    await page.keyboard.press('Control+Shift+P');
    const q = page.getByRole('textbox', { name: 'Command' });
    await q.fill('Show the analysis overview');
    await q.press('Enter');
    await expect(overview).toBeVisible();
  };
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const showSetting = settings.getByLabel('Show an overview of the analysis when a file is opened');

  await test.step('off, a file opens without it', async () => {
    await open('loader-demo.prg');
    await expect(statusBar(page)).toContainText('$080d · start');
    await page.waitForTimeout(500);
    await expect(overview).toHaveCount(0);
  });

  await test.step('Settings → General turns it on, and the next file opened shows it once it is analysed', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings.getByRole('tab', { name: 'General', exact: true }).click();
    await expect(showSetting).not.toBeChecked();
    await showSetting.check();
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings).toBeHidden();
    await open('loader-demo.prg');
    await expect(overview).toBeVisible();
    await expect(overview).toContainText('loader-demo.prg $0801–$302c');
    const start = overview.getByRole('region', { name: 'Program start' });
    await expect(start).toContainText('$080d');
    await expect(start).toContainText('From the SYS in the BASIC line.');
    await expect(start).toContainText('10 SYS2061');
    await expect(overview.getByRole('region', { name: 'Loaders' })).toContainText('Spindle');
    await expect(overview.getByRole('group', { name: 'Blocks by type' }).getByRole('button')).toHaveCount(4);
    await expect(overview.getByRole('group', { name: 'Open' }).getByRole('button')).toHaveText(['Listing', 'loader-demo.asm', 'Graphics', 'Memory', 'Drive code']);
  });

  await test.step('a loader\'s link opens Loaders in the Explorer at its first part, and closes the overview', async () => {
    await overview.getByRole('button', { name: 'Loaders in the Explorer' }).click();
    await expect(overview).toBeHidden();
    await expect(page.getByRole('region', { name: 'Loaders', exact: true }).locator('.sec-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(statusBar(page)).toContainText('$0814');
  });

  await test.step('a type of block opens its folder in the Blocks view, at its first block', async () => {
    await palette();
    await overview.getByRole('group', { name: 'Blocks by type' }).getByRole('button', { name: /^Code/ }).click();
    await expect(overview).toBeHidden();
    await expect(page.getByRole('list', { name: 'Block types' }).locator('.blk-folder-head').filter({ hasText: 'Code' })).toHaveAttribute('aria-expanded', 'true');
    await expect(statusBar(page)).toContainText('· Code');
  });

  await test.step('a click outside it closes it, and so does Esc', async () => {
    await palette();
    await page.mouse.click(8, 600);
    await expect(overview).toBeHidden();
    await palette();
    await page.keyboard.press('Escape');
    await expect(overview).toBeHidden();
  });

  await test.step('the links to the tabs open them', async () => {
    await palette();
    await overview.getByRole('group', { name: 'Open' }).getByRole('button', { name: 'Drive code' }).click();
    await expect(overview).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Drive code', exact: true })).toHaveAttribute('aria-selected', 'true');
    await palette();
    await overview.getByRole('group', { name: 'Open' }).getByRole('button', { name: 'Memory' }).click();
    await expect(page.getByRole('tab', { name: 'Memory', exact: true })).toHaveAttribute('aria-selected', 'true');
  });

  await test.step('graphics: a type opens Graphics at its first block, selected and drawn as that type', async () => {
    await open('raster-demo.prg');
    await expect(overview).toBeVisible();
    const gfx = overview.getByRole('region', { name: 'Graphics' });
    await expect(gfx).toContainText('Sprites');
    await expect(overview.getByRole('region', { name: 'Music' })).toContainText('$1000–$10af');
    await gfx.getByRole('button', { name: /^Sprites/ }).click();
    await expect(overview).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Graphics', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(statusBar(page)).toContainText('sel $2000–$203f');
  });

  await test.step('a VICE snapshot: the PC it was saved at, with the registers, and the listing is there', async () => {
    await stubDialogs(app, { open: [join(repoDir, 'fixtures/vsf/raster-demo.vsf')] });
    await fromFileMenu(page, 'Open a VICE snapshot (.vsf)…');
    await expect(overview).toBeVisible({ timeout: 30_000 });
    const pc = overview.getByRole('region', { name: 'Snapshot PC' });
    await expect(pc).toContainText('$08c7');
    await expect(pc).toContainText('Where the CPU was when VICE saved the snapshot: the listing and the .asm are there.');
    await expect(pc).toContainText(/A \$\w\w {2}X \$\w\w {2}Y \$\w\w {2}SP \$\w\w {2}\$01 \$37 {2}NV-BDIZC [01]{8}/);
    // the program start is the BASIC SYS, as before
    await expect(overview.getByRole('region', { name: 'Program start' })).toContainText('$0810');
    await expect(statusBar(page)).toContainText('$08c7');
    // the program start's link goes there, the PC's back
    await overview.getByRole('region', { name: 'Program start' }).getByRole('button', { name: /\$0810/ }).click();
    await expect(overview).toBeHidden();
    await expect(statusBar(page)).toContainText('$0810');
    await palette();
    await pc.getByRole('button').click();
    await expect(overview).toBeHidden();
    await expect(statusBar(page)).toContainText('$08c7');
    // a PRG has none
    await open('raster-demo.prg');
    await expect(overview).toBeVisible();
    await expect(overview.getByRole('region', { name: 'Snapshot PC' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  await test.step('the box at its foot turns it off: the next file opens without it, and Settings says so', async () => {
    await palette();
    await overview.getByLabel('Show this overview when a file is opened').uncheck();
    await expect(overview).toBeVisible();
    await overview.locator('.modal-foot').getByRole('button', { name: 'Close' }).click();
    await expect(overview).toBeHidden();
    await open('loader-demo.prg');
    await page.waitForTimeout(500);
    await expect(overview).toHaveCount(0);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings.getByRole('tab', { name: 'General', exact: true }).click();
    await expect(showSetting).not.toBeChecked();
    await settings.getByRole('button', { name: 'Cancel' }).click();
  });
});
