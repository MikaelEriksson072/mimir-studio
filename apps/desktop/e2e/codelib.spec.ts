/* The macro and code libraries (spec 10.8): lines selected in the Assembler made a macro of the macro library (with its
 * description, colour and the time it was made, a file in the library's folder Macros), a click in a macro taking all
 * of it, a piece of code in the code library; the lists in alphabetical groups, searched, one colour shown; a macro's
 * call and its definition put in the source where the caret is; an item edited and moved to the Recycle Bin. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { stubDialogs, toast } from './helpers';

test.use({ start: 'none' });

const shot = async (page: Page, name: string) => { if (process.env.MIMIR_E2E_SHOTS) await page.screenshot({ path: join(process.env.MIMIR_E2E_SHOTS, `${name}.png`) }); };
/** the editor's lines as text (Monaco draws only those in view, not in order, and its spaces as no-break spaces) */
const editorText = (page: Page) => page.locator('.scr-editor .view-lines').evaluate(el => [...el.querySelectorAll<HTMLElement>('.view-line')].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map(l => (l.textContent ?? '').replace(/ /g, ' ')).join('\n'));
const today = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

test('the macro and code libraries: lines of the Assembler made a macro with a description, a colour and when it was made, a whole macro, a piece of code; found in alphabetical groups, by a search and by colour; put in the source; edited and moved to the Recycle Bin', async ({ workDir: work, userData, app, page }) => {
  const dir = join(work, 'libs'), trash = join(work, 'trash');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), [
    'BasicUpstart2(start)', // 1
    '', // 2
    'start:', // 3
    '        lda #$00', // 4
    '        sta $d020', // 5
    '        sta $d021', // 6
    'loop:   jmp loop', // 7
    '', // 8
    '.macro SetBorder(c) {', // 9
    '        lda #c', // 10
    '        sta $d020', // 11
    '}', // 12
    ''].join('\n'));
  // (the Recycle Bin a folder of the test's)
  await app.evaluate((_e, d) => {
    const req = (process as unknown as { mainModule: { require: (m: string) => any } }).mainModule.require; // eslint-disable-line @typescript-eslint/no-explicit-any
    const fs = req('node:fs'), path = req('node:path'), { shell } = req('electron');
    shell.trashItem = async (p: string) => { fs.mkdirSync(d, { recursive: true }); fs.renameSync(p, path.join(d, path.basename(p))); };
  }, trash);
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  const line = (n: number) => page.locator('.scr-editor .view-line').nth(n - 1);
  // (Monaco's menu: the item under the pointer, Enter; it takes no click Playwright makes)
  const menu = async (name: string) => { const i = page.getByRole('menuitem', { name }); await i.hover(); await page.keyboard.press('Enter'); await expect(i).toHaveCount(0); };
  const macros = join(userData, 'library', 'Macros');

  // three lines selected, the editor's menu: Add to the macro library… makes them a macro of the name typed
  await line(4).click();
  await line(6).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Shift+End');
  await line(5).click({ button: 'right' });
  await menu('Add to the macro library…');
  const add = page.getByRole('dialog', { name: 'Add to the macro library' });
  await expect(add.getByLabel('Make the code a macro of that name')).toBeChecked();
  await add.getByLabel('Name', { exact: true }).fill('Black');
  await expect(add.getByLabel('Code', { exact: true })).toHaveValue('.macro Black() {\n    lda #$00\n    sta $d020\n    sta $d021\n}');
  await expect(add).toContainText('A macro: Black()');
  await expect(add).toContainText('from libs · main.asm:4–6');
  await add.getByLabel('Description', { exact: true }).fill('Border and background black');
  await add.getByRole('button', { name: 'Teal' }).click();
  await shot(page, '40-codelib-add');
  await add.getByRole('button', { name: 'Add to Macros' }).click();
  await expect(toast(page, 'Black is in the macro library (Black.asm)')).toBeVisible();
  // a file of the library's folder Macros: the line that says what it is, then the macro
  const text = readFileSync(join(macros, 'Black.asm'), 'utf8').split('\n');
  expect(text[0]).toMatch(/^\/\/ mimir-library \{"lang":"kickass","created":"\d{4}-\d\d-\d\dT[\d:.]+Z","color":"teal","description":"Border and background black","from":"libs · main\.asm:4–6"\}$/);
  expect(text.slice(1).join('\n')).toBe('.macro Black() {\n    lda #$00\n    sta $d020\n    sta $d021\n}\n');
  // the view shows it, under B, made today, in its colour
  const list = page.getByRole('list', { name: 'The macro library' });
  await expect(list.getByRole('group', { name: 'B' })).toBeVisible();
  await expect(list.getByRole('button', { name: /^Black/ })).toContainText(today());
  await expect(list.locator('.cl-item.tinted')).toHaveCount(1);

  // a click in a macro, nothing selected: the palette's Add … takes all of it, as it is, named as it is
  await page.locator('.scr-editor').click();
  await line(10).click();
  await page.keyboard.press('Control+Shift+P');
  const q = page.getByRole('textbox', { name: 'Command' });
  await q.fill('Add the lines selected in the Assembler to the macro library');
  await q.press('Enter');
  const add2 = page.getByRole('dialog', { name: 'Add to the macro library' });
  await expect(add2.getByLabel('Name', { exact: true })).toHaveValue('SetBorder');
  await expect(add2.getByLabel('Code', { exact: true })).toHaveValue('.macro SetBorder(c) {\n        lda #c\n        sta $d020\n}');
  await expect(add2.getByLabel('Make the code a macro of that name')).toHaveCount(0);
  await expect(add2).toContainText('Called as SetBorder(c)');
  await add2.getByLabel('Description', { exact: true }).fill('Sets the border colour');
  await add2.getByRole('button', { name: 'Add to Macros' }).click();
  await expect(list.getByRole('group', { name: 'S' })).toBeVisible();
  expect(readdirSync(macros).sort()).toEqual(['Black.asm', 'SetBorder.asm']);

  // a piece of code: the code library, a name with Ä its group
  await line(7).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await line(7).click({ button: 'right' });
  await menu('Add to the code library…');
  const addCode = page.getByRole('dialog', { name: 'Add to the code library' });
  await expect(addCode.getByLabel('Name', { exact: true })).toHaveValue('loop');
  await expect(addCode.getByLabel('Code', { exact: true })).toHaveValue('loop:   jmp loop');
  await addCode.getByLabel('Name', { exact: true }).fill('Ändlös loop');
  await addCode.getByRole('button', { name: 'Add to Code' }).click();
  await expect(page.getByRole('list', { name: 'The code library' }).getByRole('group', { name: 'Ä' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Code\s*1/ })).toHaveAttribute('aria-selected', 'true');
  expect(existsSync(join(userData, 'library', 'Code', 'Ändlös loop.asm'))).toBe(true);
  await page.getByRole('tab', { name: /Macros\s*2/ }).click();

  // the search (Ctrl+Shift+M in the code goes to it): a word of the code finds only the one that has it, a word of the
  // descriptions both
  const search = page.getByLabel('Search the libraries');
  await line(1).click();
  await page.keyboard.press('Control+Shift+M');
  await expect(search).toBeFocused();
  await search.fill('d021');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('found in the code');
  await search.fill('border');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await search.fill('');
  // a colour: only those of it
  await page.getByRole('group', { name: 'Show the colour' }).getByRole('button', { name: 'Only the teal ones' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('group', { name: 'Show the colour' }).getByRole('button', { name: 'Only the teal ones' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  // the letters go to their group; those with nothing are off
  const letters = page.getByRole('navigation', { name: 'Letters' });
  await expect(letters.getByRole('button', { name: 'Go to S' })).toBeEnabled();
  await expect(letters.getByRole('button', { name: 'Go to Q' })).toBeDisabled();
  await shot(page, '41-codelib-view');

  // a macro the project defines: a double-click puts in its call where the caret is, its parameter to type
  await line(8).click();
  await list.getByRole('button', { name: /^SetBorder/ }).dblclick();
  await page.keyboard.type('2');
  await page.keyboard.press('Escape');
  await expect.poll(() => editorText(page)).toContain('SetBorder(2)');
  // one it does not define: its definition (an empty line before and after it), then its call
  await line(7).click();
  await page.keyboard.press('End');
  await list.getByRole('button', { name: /^Black/ }).click();
  await list.getByRole('button', { name: 'Insert definition' }).click();
  await expect(toast(page, /Put in Black from the macro library, lines 9–13/)).toBeVisible();
  await expect.poll(() => editorText(page)).toContain('loop:   jmp loop\n\n.macro Black() {\n    lda #$00\n    sta $d020\n    sta $d021\n}\n\nSetBorder(2)');
  await line(3).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await list.getByRole('button', { name: 'Insert call' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => editorText(page)).toContain('start:\nBlack()');
  await expect(page.locator('.scr-check')).toContainText('Ready');
  await expect.poll(() => readFileSync(join(dir, 'main.asm'), 'utf8')).toContain('.macro Black() {');

  // edited: renamed, another colour; when it was made stays
  const made = /"created":"([^"]+)"/.exec(text[0])![1];
  await list.getByRole('button', { name: 'Edit' }).click();
  const ed = page.getByRole('dialog', { name: 'Edit Black' });
  await ed.getByLabel('Name', { exact: true }).fill('Black screen');
  await ed.getByRole('button', { name: 'Pink' }).click();
  await ed.getByRole('button', { name: 'Save' }).click();
  await expect(toast(page, 'Black screen is saved')).toBeVisible();
  await expect.poll(() => readdirSync(macros).sort()).toEqual(['Black screen.asm', 'SetBorder.asm']);
  expect(readFileSync(join(macros, 'Black screen.asm'), 'utf8')).toContain(`"created":"${made}","color":"pink"`);
  // moved to the Recycle Bin
  await list.getByRole('button', { name: /^Black screen/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to the Recycle Bin' }).click();
  await expect(toast(page, /Black screen\.asm is in the Recycle Bin/)).toBeVisible();
  expect(readdirSync(macros)).toEqual(['SetBorder.asm']);
  expect(readdirSync(trash)).toEqual(['Black screen.asm']);
  await expect(list.getByRole('listitem')).toHaveCount(1);
});
