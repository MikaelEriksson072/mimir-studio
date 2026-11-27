/* Collections of the macro library (spec 10.8): a file of macros from outside put in the library (a collection, each
 * macro described by the comments above it), opened in the list; a macro's definition put in with those it uses, the
 * collection's import line at the top of the source; lines of the Assembler added as a macro of the collection, one
 * changed in its place; every macro A–Ö and found by a search; exported again to the file it came from (not over a
 * change made there since without asking), some macros exported to a file of the dialog's; one taken out to the
 * Recycle Bin. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { stubDialogs, toast } from './helpers';

test.use({ start: 'none' });

const shot = async (page: Page, name: string) => { if (process.env.MIMIR_E2E_SHOTS) await page.screenshot({ path: join(process.env.MIMIR_E2E_SHOTS, `${name}.png`) }); };
/** the editor's lines as text (Monaco draws only those in view, not in order, and its spaces as no-break spaces) */
const editorText = (page: Page) => page.locator('.scr-editor .view-lines').evaluate(el => [...el.querySelectorAll<HTMLElement>('.view-line')].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map(l => (l.textContent ?? '').replace(/ /g, ' ')).join('\n'));

const RASTER = [
  '#importonce',
  '',
  '// ==========================',
  '// Sets the border colour',
  '// ==========================',
  '.macro SetBorder(c) {',
  '    lda #c',
  '    sta $d020',
  '}',
  '',
  '// ==========================',
  '// Waits for a line, then the border',
  '// ==========================',
  '.macro WaitAndSet(line, c) {',
  '!:  lda $d012',
  '    cmp #line',
  '    bne !-',
  '    save()',
  '    SetBorder(c)',
  '}',
  '.macro save() {pha;txa;pha}',
  ''].join('\n');

test('collections of the macro library: a file of macros put in, its macros listed under it, put in the source with what they use, its import, a macro added and changed, A–Ö, searched, exported back and to a file, one taken out', async ({ workDir: work, userData, app, page }) => {
  const dir = join(work, 'proj'), outside = join(work, 'c64_lib'), trash = join(work, 'trash');
  mkdirSync(dir); mkdirSync(outside);
  writeFileSync(join(outside, 'raster.asm'), RASTER);
  writeFileSync(join(dir, 'main.asm'), ['BasicUpstart2(start)', '', 'start:', '        lda #$00', '        sta $d021', 'loop:   jmp loop', ''].join('\n'));
  await app.evaluate((_e, d) => {
    const req = (process as unknown as { mainModule: { require: (m: string) => any } }).mainModule.require; // eslint-disable-line @typescript-eslint/no-explicit-any
    const fs = req('node:fs'), path = req('node:path'), { shell } = req('electron');
    shell.trashItem = async (p: string) => { fs.mkdirSync(d, { recursive: true }); fs.renameSync(p, path.join(d, path.basename(p))); };
  }, trash);
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  // (a line by its text: Monaco's lines are not in the page in their order once the code changed, and its spaces are
  // no-break spaces)
  const lineWith = async (text: string) => {
    const all = page.locator('.scr-editor .view-line');
    await expect.poll(() => all.evaluateAll((ls, t) => ls.findIndex(l => (l.textContent ?? '').replace(/ /g, ' ').trim() === t), text)).toBeGreaterThanOrEqual(0);
    return all.nth(await all.evaluateAll((ls, t) => ls.findIndex(l => (l.textContent ?? '').replace(/ /g, ' ').trim() === t), text));
  };
  const menu = async (name: string) => { const i = page.getByRole('menuitem', { name }); await i.hover(); await page.keyboard.press('Enter'); await expect(i).toHaveCount(0); };
  const macros = join(userData, 'library', 'Macros');

  // the file put in the library (the view's button, the open dialog's file): a collection of its three macros
  await page.getByRole('button', { name: /^Macros and code/ }).click();
  await stubDialogs(app, { open: [join(outside, 'raster.asm')] });
  await page.getByRole('button', { name: 'Put files in the macro library' }).click();
  await expect(toast(page, 'raster.asm put in the macro library')).toBeVisible();
  expect(readFileSync(join(macros, 'raster.asm'), 'utf8')).toMatch(/^\/\/ mimir-library \{"lang":"kickass","created":"[^"]+","from":"[^"]+raster\.asm","collection":true\}\n#importonce\n/);
  const list = page.getByRole('list', { name: 'The macro library' });
  await expect(page.getByRole('tab', { name: /Macros\s*3/ })).toBeVisible();
  const subs = page.getByRole('list', { name: 'The macros of raster' });
  await expect(subs.getByRole('listitem')).toHaveCount(3);
  await expect(subs.getByRole('button', { name: /^SetBorder/ })).toContainText('Sets the border colour');
  await expect(subs.getByRole('button', { name: /^WaitAndSet/ })).toContainText('Waits for a line, then the border');
  await shot(page, '42-codelib-collection');

  // WaitAndSet's definition: with SetBorder and save, which it uses
  await (await lineWith('loop:   jmp loop')).click();
  await page.keyboard.press('End');
  await subs.getByRole('button', { name: /^WaitAndSet/ }).click();
  await expect(subs).toContainText('Uses SetBorder, save');
  await subs.getByRole('button', { name: 'Insert definition' }).click();
  await expect(toast(page, /Put in WaitAndSet \(with SetBorder, save, which it uses\)/)).toBeVisible();
  // (those it uses first, in the collection's order)
  await expect.poll(() => editorText(page)).toContain('loop:   jmp loop\n\n.macro SetBorder(c) {\n    lda #c\n    sta $d020\n}\n\n.macro save() {pha;txa;pha}\n\n.macro WaitAndSet(line, c) {');
  await page.keyboard.press('Control+z');
  await expect.poll(() => editorText(page)).not.toContain('.macro WaitAndSet');

  // the collection's import at the top of the source: its macros are the project's, a call assembles
  await list.getByRole('button', { name: 'Import it' }).click();
  await expect(toast(page, /Put in the import of raster \(line 1\)/)).toBeVisible();
  await expect.poll(() => editorText(page)).toMatch(/^#import ".*\/Macros\/raster\.asm"\n\nBasicUpstart2\(start\)/);
  await (await lineWith('sta $d021')).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('WaitAndSet(100, 2)');
  await expect(page.locator('.scr-check')).toContainText('Ready');
  // again: it imports it already
  await list.getByRole('button', { name: 'Import it' }).click();
  await expect(toast(page, /imports raster already \(line 1\)/)).toBeVisible();

  // lines of the Assembler a macro of the collection: Put it in → raster
  await (await lineWith('lda #$00')).click();
  await page.keyboard.press('Home');
  await (await lineWith('sta $d021')).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Shift+End');
  await (await lineWith('lda #$00')).click({ button: 'right' });
  await menu('Add to the macro library…');
  const add = page.getByRole('dialog', { name: 'Add to the macro library' });
  await add.getByLabel('Name', { exact: true }).fill('Black');
  await add.getByLabel('Put it in').selectOption({ label: 'raster (3)' });
  // (the dialog says where it goes)
  const addTo = page.getByRole('dialog', { name: 'Add a macro to raster' });
  await expect(addTo).toBeVisible();
  await addTo.getByLabel('Description', { exact: true }).fill('Border and background\nblack');
  await addTo.getByRole('button', { name: 'Teal' }).click();
  await addTo.getByRole('button', { name: 'Add to raster' }).click();
  await expect(toast(page, /Black is in raster/)).toBeVisible();
  await expect(subs.getByRole('listitem')).toHaveCount(4);
  const file = () => readFileSync(join(macros, 'raster.asm'), 'utf8');
  expect(file()).toMatch(/\.macro save\(\) \{pha;txa;pha\}\n\n\/\/ ==========================\n\/\/ Border and background\n\/\/ black\n\/\/ ==========================\n\/\/ mimir-macro \{"created":"[^"]+","color":"teal"\}\n\.macro Black\(\) \{\n    lda #\$00\n    sta \$d021\n}\n$/);
  await expect(subs.locator('.cl-item.tinted')).toHaveCount(1);

  // one changed in its place: a new description, a colour; the file around it as it was
  await subs.getByRole('button', { name: /^SetBorder/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit…' }).click();
  const ed = page.getByRole('dialog', { name: 'Edit SetBorder' });
  await expect(ed.getByLabel('Put it in')).toHaveValue('raster.asm');
  await expect(ed.getByLabel('Description', { exact: true })).toHaveValue('Sets the border colour');
  await ed.getByLabel('Description', { exact: true }).fill('The border\'s colour');
  await ed.getByRole('button', { name: 'Pink' }).click();
  await ed.getByRole('button', { name: 'Save' }).click();
  await expect(toast(page, 'SetBorder is saved in raster')).toBeVisible();
  expect(file()).toContain('#importonce\n\n// ==========================\n// The border\'s colour\n// ==========================\n// mimir-macro {"color":"pink"}\n.macro SetBorder(c) {');

  // A–Ö: every macro under its own letter, its collection beside it; a search opens the collection on what it finds
  await page.getByRole('radio', { name: 'A–Ö' }).click();
  await expect(list.getByRole('group', { name: 'W' }).getByRole('button', { name: /^WaitAndSet/ })).toContainText('raster');
  await expect(list.getByRole('group', { name: 'B' })).toBeVisible();
  await page.getByRole('radio', { name: 'Collections' }).click();
  await list.getByRole('button', { name: /^raster/ }).click();
  await expect(subs).toHaveCount(0);
  await page.getByLabel('Search the libraries').fill('d012');
  await expect(subs.getByRole('listitem')).toHaveCount(1);
  await expect(subs).toContainText('found in the code');
  await page.getByLabel('Search the libraries').fill('');
  await list.getByRole('button', { name: /^raster/ }).click();
  await shot(page, '43-codelib-collection-edited');

  // exported again to where it came from: as written by hand (no Mimir lines), its macros as they are now
  await list.getByRole('button', { name: 'Export raster again' }).click();
  await expect(toast(page, /Exported raster to .*raster\.asm \(4 macros\)/)).toBeVisible();
  const back = readFileSync(join(outside, 'raster.asm'), 'utf8');
  expect(back).not.toContain('mimir-');
  expect(back.startsWith('#importonce\n\n// ==========================\n// The border\'s colour\n')).toBe(true);
  expect(back).toContain('// Border and background\n// black\n// ==========================\n.macro Black() {');
  // changed there since: asked first, kept
  writeFileSync(join(outside, 'raster.asm'), `${back}// mine\n`);
  await list.getByRole('button', { name: 'Export raster again' }).click();
  await expect(list.getByRole('alert')).toContainText('was changed since Mimir wrote or read it');
  await list.getByRole('button', { name: 'Keep it' }).click();
  expect(readFileSync(join(outside, 'raster.asm'), 'utf8').endsWith('// mine\n')).toBe(true);

  // two of its macros to a file of the dialog's
  await list.getByRole('button', { name: 'Export…' }).click();
  const ex = page.getByRole('dialog', { name: 'Export macros' });
  await expect(ex.getByLabel('Export raster', { exact: true })).toBeChecked();
  await ex.getByLabel('Export raster', { exact: true }).uncheck();
  await ex.getByLabel('Export SetBorder of raster').check();
  await ex.getByLabel('Export Black of raster').check();
  await expect(ex).toContainText('2 macros checked');
  await shot(page, '44-codelib-export');
  const to = join(work, 'mine.asm');
  await stubDialogs(app, { save: to });
  await ex.getByRole('button', { name: 'Export…' }).click();
  await expect(toast(page, /Exported 2 macros to .*mine\.asm/)).toBeVisible();
  expect(readFileSync(to, 'utf8')).toBe('// ==========================\n// The border\'s colour\n// ==========================\n.macro SetBorder(c) {\n    lda #c\n    sta $d020\n}\n\n// ==========================\n// Border and background\n// black\n// ==========================\n.macro Black() {\n    lda #$00\n    sta $d021\n}\n');

  // taken out: to the Recycle Bin as a file of its own
  await subs.getByRole('button', { name: /^Black/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Take it out of raster (to the Recycle Bin)' }).click();
  await expect(toast(page, /Black is out of raster/)).toBeVisible();
  await expect(subs.getByRole('listitem')).toHaveCount(3);
  expect(readdirSync(trash)).toEqual(['Black.asm']);
  expect(readFileSync(join(trash, 'Black.asm'), 'utf8')).toContain('"description":"Border and background\\nblack"');
  expect(file()).not.toContain('Black');
});
