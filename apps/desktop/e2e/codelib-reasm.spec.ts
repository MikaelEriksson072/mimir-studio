/* The re-assembler's code library (spec 10.8): lines selected in a program's listing (none: the block at the cursor)
 * made a piece of code of a library of its own (the folder Re-assembler), apart from the user's Macros and Code, with
 * where they were taken from; in the re-assembler's window the view's only library, an item going to where it was
 * taken from; moved to the user's code library, or to the macro library made a macro. In an Assembler project it is
 * the third library beside Macros and Code: its pieces put in the source, the user's pieces moved to it and copied back. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { goTo, listing, statusBar, stubDialogs, toast, waitForListing } from './helpers';

const shot = async (page: Page, name: string) => { if (process.env.MIMIR_E2E_SHOTS) await page.screenshot({ path: join(process.env.MIMIR_E2E_SHOTS, `${name}.png`) }); };
const head = (o: object) => `// mimir-library ${JSON.stringify({ lang: 'kickass', created: '2026-11-28T08:00:00.000Z', ...o })}\n`;

test.describe('in the re-assembler', () => {
  test('lines of the listing made a piece of the re-assembler code library, gone to where they were taken from, moved to the code library and to the macro library made a macro', async ({ userData, page }) => {
    await waitForListing(page);
    await page.keyboard.press('Control+j');
    const lib = join(userData, 'library'), reasm = join(lib, 'Re-assembler');
    // fx_091e: lda SID_OSC3 / and #$0f / sta COLOR_RAM+24*40+39 / rts, the whole block selected (its header too)
    await goTo(page, 'fx_091e');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
    await expect(statusBar(page)).toContainText('sel $091e–$0926 (9 B)');
    await listing(page).locator('.row', { has: page.locator('.adr', { hasText: /^0921$/ }) }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Add the 6 lines to the re-assembler code library…/ }).click();
    const add = page.getByRole('dialog', { name: 'Add to the re-assembler code library' });
    // named after its first label, the lines as the listing writes them (Ctrl+C's), from the program and its addresses
    await expect(add.getByLabel('Name', { exact: true })).toHaveValue('fx_091e');
    const taken = (await add.getByLabel('Code', { exact: true }).inputValue()).split('\n');
    expect(taken).toHaveLength(6);
    expect(taken[0]).toMatch(/^\/\/ ---- Code · fx_091e · \$091e-\$0926 \(9 bytes\) -+$/);
    expect(taken.slice(1)[0]).toBe('fx_091e:');
    expect(taken[5]).toBe('        rts');
    await expect(add).toContainText(/from .+ \$091e–\$0926/);
    await expect(add.getByRole('radiogroup', { name: 'Library' })).toHaveCount(0);
    await expect(add).toContainText('Re-assembler\\fx_091e.asm');
    await add.getByLabel('Description', { exact: true }).fill('Colours the last character with voice 3');
    await add.getByRole('button', { name: 'Teal' }).click();
    await shot(page, '60-reasm-add');
    await add.getByRole('button', { name: 'Add to the library' }).click();
    await expect(toast(page, 'fx_091e is in the re-assembler code library (fx_091e.asm)')).toBeVisible();
    const text = readFileSync(join(reasm, 'fx_091e.asm'), 'utf8').split('\n');
    expect(text[0]).toMatch(/^\/\/ mimir-library \{"lang":"kickass","created":"[^"]+","color":"teal","description":"Colours the last character with voice 3","from":".+ \$091e–\$0926"\}$/);
    expect(text.slice(1, 7)).toEqual(taken);

    // the view: the re-assembler's library alone (no tabs), its piece under F, the count on the view's button
    const side = page.locator('aside.sidebar');
    await expect(side.locator('.lib-title')).toHaveText(/^Re-assembler/);
    await expect(side.locator('.cl-sub')).toHaveText('Code taken from listings, apart from your own Macros and Code');
    await expect(side.getByRole('tablist', { name: 'Libraries' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Re-assembler code library', exact: true })).toContainText('1');
    const list = page.getByRole('list', { name: 'The re-assembler code library' });
    const row = list.getByRole('group', { name: 'F' }).getByRole('button', { name: /^fx_091e/ });
    await expect(row).toContainText('Colours the last character with voice 3');
    // opened: Go to where it was taken from, and a double-click goes there too
    await goTo(page, 'start');
    await expect(statusBar(page)).toContainText('$0810 · start');
    // (open since it was saved)
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(side.getByRole('button', { name: 'Insert', exact: true })).toHaveCount(0);
    await shot(page, '61-reasm-view');
    await side.getByRole('button', { name: 'Go to $091e' }).click();
    await expect(statusBar(page)).toContainText('$091e · fx_091e');
    await goTo(page, 'start');
    await row.dblclick();
    await expect(statusBar(page)).toContainText('$091e · fx_091e');

    // moved to the user's code library: its file there, with all it was (the double-click's first click folded it)
    if (await row.getAttribute('aria-expanded') !== 'true') await row.click();
    await side.getByRole('button', { name: 'Move…' }).click();
    await page.getByRole('menuitem', { name: 'Move to my code library' }).click();
    await expect(toast(page, 'fx_091e is moved to my code library (Code\\fx_091e.asm)')).toBeVisible();
    expect(existsSync(join(reasm, 'fx_091e.asm'))).toBe(false);
    const moved = readFileSync(join(lib, 'Code', 'fx_091e.asm'), 'utf8');
    expect(moved.split('\n')[0]).toBe(text[0]);
    expect(moved).toBe(text.join('\n'));
    await expect(list.getByRole('button', { name: /^fx_091e/ })).toHaveCount(0);
    await expect(side).toContainText('Select the lines in the listing');

    // nothing selected: the block at the cursor (the palette's command), moved to the macro library made a macro
    await goTo(page, '$0921');
    await page.keyboard.press('Control+Shift+P');
    const q = page.getByRole('textbox', { name: 'Command' });
    await q.fill('Add the selected lines to the re-assembler code library');
    await q.press('Enter');
    const add2 = page.getByRole('dialog', { name: 'Add to the re-assembler code library' });
    await expect(add2.getByLabel('Code', { exact: true })).toHaveValue(taken.join('\n'));
    await add2.getByLabel('Name', { exact: true }).fill('ColourLast');
    await add2.getByLabel('Name', { exact: true }).press('Control+Enter');
    await expect(toast(page, 'ColourLast is in the re-assembler code library (ColourLast.asm)')).toBeVisible();
    await list.getByRole('button', { name: /^ColourLast/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Move to my macro library…/ }).click();
    const mv = page.getByRole('dialog', { name: 'Move ColourLast to the macro library' });
    await expect(mv.getByLabel('Make the code a macro of that name')).toBeChecked();
    await expect(mv.getByRole('button', { name: /Recycle Bin/ })).toHaveCount(0);
    await expect(mv.getByLabel('Code', { exact: true })).toHaveValue(/^\.macro ColourLast\(\) \{\n[\s\S]*\n\}$/);
    await shot(page, '62-reasm-move-macro');
    await mv.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(toast(page, 'ColourLast is moved to the macro library (Macros\\ColourLast.asm)')).toBeVisible();
    expect(existsSync(join(reasm, 'ColourLast.asm'))).toBe(false);
    expect(readFileSync(join(lib, 'Macros', 'ColourLast.asm'), 'utf8')).toMatch(/\n\.macro ColourLast\(\) \{\n/);
    await expect(list.getByRole('listitem')).toHaveCount(0);
  });
});

test.describe('in an Assembler project', () => {
  test.use({ start: 'none' });
  test('the re-assembler code library beside Macros and Code: its pieces put in the source, a piece of the code library moved to it and one copied back', async ({ workDir: work, userData, app, page }) => {
    const dir = join(work, 'proj'), lib = join(userData, 'library');
    mkdirSync(dir); mkdirSync(join(lib, 'Re-assembler'), { recursive: true }); mkdirSync(join(lib, 'Code'), { recursive: true });
    writeFileSync(join(lib, 'Re-assembler', 'irq.asm'), `${head({ description: 'The game\'s raster IRQ', from: 'Game · game.prg $0810–$0818' })}irq:\n        inc $d019\n        jmp $ea31\n`);
    writeFileSync(join(lib, 'Code', 'clear.asm'), `${head({ description: 'Clears the screen' })}        lda #$20\n        ldx #0\n`);
    writeFileSync(join(dir, 'main.asm'), ['BasicUpstart2(start)', '', 'start:', '        lda #$00', 'loop:   jmp loop', ''].join('\n'));
    await page.getByRole('button', { name: 'Assembler…' }).click();
    await stubDialogs(app, { open: [dir] });
    await page.getByRole('button', { name: 'Open folder…' }).click();
    await expect(page.locator('.scr-check')).toContainText('Ready');
    await page.getByRole('button', { name: /^Macros and code/ }).click();
    const tabs = page.getByRole('tablist', { name: 'Libraries' }).getByRole('tab');
    await expect(tabs).toHaveText([/^Macros/, /^Code\s*1$/, /^Re-assembler\s*1$/]);

    // a piece of the re-assembler's put in the source where the caret is
    await page.locator('.scr-editor .view-line').nth(4).click();
    await page.getByRole('tab', { name: /^Re-assembler/ }).click();
    const reasm = page.getByRole('list', { name: 'The re-assembler code library' });
    await reasm.getByRole('button', { name: /^irq/ }).dblclick();
    await expect(page.locator('.scr-editor .view-lines')).toContainText(/inc.\$d019/);

    // the code library's piece moved to the re-assembler's, and the re-assembler's copied to the code library
    await page.getByRole('tab', { name: /^Code/ }).click();
    await page.getByRole('list', { name: 'The code library' }).getByRole('button', { name: /^clear/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to the re-assembler code library' }).click();
    await expect(toast(page, 'clear is moved to the re-assembler code library (Re-assembler\\clear.asm)')).toBeVisible();
    expect(existsSync(join(lib, 'Code', 'clear.asm'))).toBe(false);
    expect(readFileSync(join(lib, 'Re-assembler', 'clear.asm'), 'utf8')).toContain('"description":"Clears the screen"');
    await expect(tabs).toHaveText([/^Macros/, /^Code\s*0$/, /^Re-assembler\s*2$/]);
    await page.getByRole('tab', { name: /^Re-assembler/ }).click();
    await reasm.getByRole('button', { name: /^irq/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy to my code library' }).click();
    await expect(toast(page, 'irq is copied to my code library (Code\\irq.asm)')).toBeVisible();
    expect(readFileSync(join(lib, 'Code', 'irq.asm'), 'utf8')).toContain('"from":"Game · game.prg $0810–$0818"');
    expect(existsSync(join(lib, 'Re-assembler', 'irq.asm'))).toBe(true);
    await shot(page, '63-reasm-in-assembler');
  });
});
