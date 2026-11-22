/* 64tass (spec 11.8) in the real app: Settings → Assembler output picks it, the listing and the source are written
 * for it, F7 verifies with the built-in 64tass assembler and the real 64tass (the bundled one, or one found in C:\C64),
 * a name 64tass cannot take is refused, and Kick Assembler comes back as it was; patches, scripts and templates are
 * written in 64tass, and a Kick Assembler script moves to 64tass with the same bytes (spec 10.2, 10.3). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, repoDir, test } from './fixtures';
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

test('64tass: a patch, a script and a template are written in it; a Kick Assembler script moves to it with the same bytes', async ({ page }) => {
  await waitForListing(page);
  const lines = page.locator('.scr-editor .view-lines');
  const lang = page.locator('.scr-lang');
  const check = page.locator('.scr-check');
  // (Monaco shows spaces as non-breaking ones)
  const shown = async () => (await lines.innerText()).replace(/\u00a0/g, ' ');

  await test.step('a script made while the project is Kick Assembler is Kick Assembler', async () => {
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await page.getByRole('button', { name: 'New script' }).first().click();
    await expect(lang).toHaveText('Kick Assembler');
    await expect.poll(shown).toMatch(/^\/\/ script: runs in Mimir/);
    await expect(check).toHaveText('Ready to run');
  });

  await test.step('with 64tass it stays Kick Assembler, marked, until Write in 64tass moves it there with the same bytes', async () => {
    await pick(page, '64tass');
    await expect(lang).toHaveText('Kick Assembler');
    await expect(lang).toHaveClass(/other/);
    await page.getByRole('button', { name: 'Write in 64tass' }).click();
    await expect(toast(page, '"script" is written in 64tass now, with the same bytes as its Kick Assembler code')).toBeVisible();
    await expect(lang).toHaveText('64tass');
    await expect(lang).not.toHaveClass(/other/);
    await expect.poll(shown).toMatch(/^; script: runs in Mimir/);
    await expect(check).toHaveText('Ready to run');
    await expect(page.getByRole('button', { name: 'Write in 64tass' })).toHaveCount(0);
  });

  await test.step('a template comes in 64tass, and runs: the program\'s first bytes EORed with $77 in its scratchpad', async () => {
    await page.getByRole('list', { name: 'Templates' }).getByRole('button', { name: 'Add the template XOR key byte to the project' }).click();
    await expect(page.getByLabel('Script name')).toHaveValue('xor_key');
    await expect(lang).toHaveText('64tass');
    await expect.poll(shown).toMatch(/^; =+\n;  XOR with a key byte/);
    // (Monaco draws only the lines in view: its end, with 64tass's anonymous labels for Kick Assembler's !:)
    await lines.click();
    await page.keyboard.press('Control+End');
    await expect.poll(shown).toMatch(/\n\+\s+lda todo\n\s+bne \+\n/);
    await expect(check).toHaveText('Ready to run');
    await page.getByRole('button', { name: /^Run(?! on files)/ }).click();
    await expect(page.locator('.scr-end')).toContainText('Returned');
    const bytes = readFileSync(join(repoDir, 'fixtures/prg/raster-demo.prg')).subarray(2, 18);
    await expect(page.locator('.scr-dump')).toContainText([...bytes].map(b => (b ^ 0x77).toString(16).padStart(2, '0')).join(' '));
  });

  await test.step('a 64tass script: a local label, an error on its line', async () => {
    await lines.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('loop    ldx #0\n_l      lda colors_0939,x\n        inx\n        cpx #4\n        bne _l\n        rts\n');
    await expect(check).toHaveText('Ready to run');
    await lines.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('        lda nothing ; no such name\n        rts\n');
    await expect(check).toHaveText("Line 1: not defined symbol 'nothing'");
  });

  await test.step('the patch dialog: the listing\'s lines in 64tass, code with ; and a local label, each line\'s address', async () => {
    await page.getByRole('tab', { name: 'Listing' }).click();
    await goTo(page, 'fx_091e');
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('p');
    const dialog = page.getByRole('dialog'), code = dialog.locator('#patch-code');
    await expect(dialog).toHaveAccessibleName('Patch $091e–$0925');
    await expect(dialog.locator('.patch-lang')).toContainText('The code is 64tass.');
    await expect(code).toHaveValue(/^fx_091e:\n\s*lda SID_OSC3\s+;/);
    await code.fill('_x      lda #$02 ; red\n        sta VIC_BORDER_COLOR\n        jmp _x');
    await expect(dialog.getByRole('status')).toContainText('8 of 8 bytes');
    await expect(dialog.locator('.pe-gl')).toHaveText([/^091e\s*a9 02$/, /^0920\s*8d 20 d0$/, /^0923\s*4c 1e 09$/]);
    await dialog.getByRole('button', { name: 'Apply patch' }).click();
    await expect(dialog).toBeHidden();
    await expect(listing(page).locator('.row.patched').first()).toBeVisible();
  });
});
