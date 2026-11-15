/* 64tass (spec 11.8) in the real app: Settings → Assembler output picks it, the listing and the source are written
 * for it, F7 verifies with the built-in 64tass assembler and the real 64tass (the bundled one, or one found in C:\C64),
 * a name 64tass cannot take is refused, and Kick Assembler comes back as it was. */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { goTo, listing, listingRows, statusBar, toast, waitForListing } from './helpers';

const pick = async (page: Page, value: 'kick' | '64tass') => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Assembler output' }).click();
  await page.locator('#set-assembler').selectOption(value);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
};
const texts = async (page: Page) => (await listingRows(page)).map(r => r.text.trimStart());

test('64tass: the listing and the source are written for it, F7 verifies with it, and Kick Assembler comes back', async ({ page }) => {
  await waitForListing(page);
  await expect(statusBar(page)).toContainText('Kick Assembler 5.x');

  await test.step('Settings → Assembler output → 64tass writes the listing for 64tass', async () => {
    await pick(page, '64tass');
    await expect(statusBar(page)).toContainText('64tass 1.57');
    await goTo(page, '$0801');
    await expect.poll(async () => (await texts(page)).some(t => t.startsWith('.null $9e, format("%d", start)'))).toBe(true);
    const all = (await texts(page)).join('\n');
    expect(all).toContain('* = $0801');
    expect(all).toContain('.word (+), 10');
    expect(all).toContain('.include "include/c64-hardware.asm"');
    expect(all).not.toContain('BasicUpstart2');
    expect(all).not.toContain('#import');
    await goTo(page, 'start');
    await expect.poll(async () => (await texts(page)).some(t => /^jsr CLRSCR\s*; Clear screen/.test(t))).toBe(true);
  });

  await test.step('F7 verifies with the built-in 64tass assembler (and the real 64tass when there is one)', async () => {
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
    const build = page.locator('.bottom .build');
    await expect(build).toContainText('> built-in 64tass-subset assembler: raster-demo.asm');
    await expect(build).toContainText('Round-trip OK: 12287 / 12287 bytes identical to raster-demo.prg');
    await expect(build).not.toContainText('FAILED');
    const real = (await statusBar(page).textContent())?.includes('with 64tass');
    if (real) {
      await expect(build).toContainText('64tass round-trip OK: raster-demo.asm 12287 / 12287 bytes identical');
      await expect(build).toContainText('-a -C --cbm-prg');
    }
    test.info().annotations.push({ type: 'verifier', description: real ? 'built-in 64tass assembler and the real 64tass' : 'built-in 64tass assembler only (64tass not found)' });
  });

  await test.step('the source tab shows the .asm in 64tass\'s language', async () => {
    await page.getByRole('tab', { name: 'raster-demo.asm' }).click();
    await expect(page.locator('.tb-note')).toContainText('64tass syntax');
  });

  await test.step('a name starting with _ is refused: 64tass takes it as local', async () => {
    await page.getByRole('tab', { name: 'Listing' }).click();
    await goTo(page, 'sub_0866');
    await page.keyboard.press('n');
    const input = page.getByLabel('Label at $0866');
    await input.fill('_init');
    await input.press('Enter');
    await expect(toast(page, '"_init" is not a valid 64tass label')).toBeVisible();
    await input.press('Escape');
    await expect(input).toBeHidden();
  });

  await test.step('Kick Assembler again: the listing is as it was', async () => {
    await pick(page, 'kick');
    await expect(statusBar(page)).toContainText('Kick Assembler 5.x');
    await listing(page).click();
    await goTo(page, '$0801');
    await expect.poll(async () => (await texts(page)).some(t => t.startsWith('BasicUpstart2(start)'))).toBe(true);
  });
});
