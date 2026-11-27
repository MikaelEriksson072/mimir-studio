/* The project's macro file (spec 10.8): Mimir builds macros.asm in an Assembler project from the macro library as the
 * code calls its macros (with the macros they use) and as macros are added to it, writes it again as they change, keeps
 * it read only in the editor, and the main source imports it once; the calls can be left out; Stop leaves the file. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { stubDialogs, toast } from './helpers';

test.use({ start: 'none' });

const shot = async (page: Page, name: string) => { if (process.env.MIMIR_E2E_SHOTS) await page.screenshot({ path: join(process.env.MIMIR_E2E_SHOTS, `${name}.png`) }); };
const head = (o: object) => `// mimir-library ${JSON.stringify({ lang: 'kickass', created: '2026-11-27T08:00:00.000Z', ...o })}\n`;

test('the project\'s macro file: built from the library as the code calls its macros and as they are added, imported once by the main source, read only, the calls left out, stopped', async ({ workDir: work, userData, app, page }) => {
  const dir = join(work, 'proj'), macros = join(userData, 'library', 'Macros');
  mkdirSync(dir); mkdirSync(macros, { recursive: true });
  writeFileSync(join(macros, 'raster.asm'), `${head({ collection: true })}#importonce
.const BORDER = $d020

// Sets the border's colour
.macro SetBorder(c) {
    lda #c
    sta BORDER
}

// Waits for a line, then the border
.macro WaitAndSet(line, c) {
!:  lda $d012
    cmp #line
    bne !-
    save()
    SetBorder(c)
}
.macro save() {pha;txa;pha}
`);
  writeFileSync(join(macros, 'Black.asm'), `${head({ description: 'Border and background black' })}.macro Black() {\n    lda #0\n    sta $d020\n    sta $d021\n}\n`);
  writeFileSync(join(dir, 'main.asm'), ['BasicUpstart2(start)', '', 'start:', '        lda #$00', '        sta $d021', 'loop:   jmp loop', ''].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  /** a line of the editor by its text (Monaco's lines are not in order in the page, its spaces no-break spaces) */
  const lineWith = async (text: string) => {
    const all = page.locator('.scr-editor .view-line');
    const at = () => all.evaluateAll((ls, t) => ls.findIndex(l => (l.textContent ?? '').replace(/ /g, ' ').trim() === t), text);
    await expect.poll(at).toBeGreaterThanOrEqual(0);
    return all.nth(await at());
  };
  const file = () => { try { return readFileSync(join(dir, 'macros.asm'), 'utf8'); } catch { return ''; } };

  // none yet: one button makes it, and the main source imports it
  await page.getByRole('button', { name: /^Macros and code/ }).click();
  await page.getByRole('button', { name: 'Build macros.asm' }).click();
  await expect.poll(file).toContain('// macros.asm: built by Mimir from the macro library');
  expect(file()).toContain('#importonce');
  await expect.poll(() => readFileSync(join(dir, 'main.asm'), 'utf8')).toMatch(/^#import "macros\.asm"\n\nBasicUpstart2\(start\)/);
  const region = page.getByRole('region', { name: 'The project\'s macro file' });
  await expect(region).toContainText('0 macros');

  // a call of the library's macro typed: its file goes in, all its macros (they belong together), its own lines too
  await (await lineWith('sta $d021')).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('WaitAndSet(100, 2)');
  await expect.poll(file).toContain('.macro WaitAndSet(line, c) {');
  expect(file()).toContain('// ---- raster ----\n.const BORDER = $d020\n\n// Sets the border\'s colour\n.macro SetBorder(c) {');
  expect(file()).toContain('.macro save() {pha;txa;pha}');
  await expect(region).toContainText('3 macros');
  const used = region.getByRole('list', { name: 'The files in macros.asm' });
  await expect(used.getByRole('listitem')).toHaveText(['raster.asm3 macros · the code calls it']);
  await expect(page.locator('.scr-check')).toContainText('Ready');
  // the list marks them: the folder raster (a file of several macros, under R), and its macros opened
  const list = page.getByRole('list', { name: 'The macro library' });
  const raster = list.getByRole('group', { name: 'R' }).getByRole('button', { name: /^raster/ });
  await expect(raster).toContainText('macros.asm');
  await raster.click();
  await expect(list.getByRole('button', { name: /^WaitAndSet/ })).toContainText('macros.asm');
  await expect(list.getByRole('group', { name: 'W' })).toHaveCount(0);

  // a file used in the project from the list: all its macros go in
  await list.getByRole('button', { name: /^Black/ }).click();
  await list.getByRole('button', { name: 'Use in project', exact: true }).click();
  await expect(toast(page, 'Black.asm goes in macros.asm, all its macros')).toBeVisible();
  await expect.poll(file).toContain('// ---- Black ----\n\n// Border and background black\n.macro Black() {');
  await expect(list.getByRole('button', { name: 'Black.asm used', exact: true })).toBeVisible();
  await expect(used.getByRole('listitem')).toHaveText(['Black.asm1 macro · added', 'raster.asm3 macros · the code calls it']);
  await shot(page, '45-codelib-project-file');

  // a macro of the library changed: the file follows
  writeFileSync(join(macros, 'Black.asm'), `${head({ description: 'Black, all of it' })}.macro Black() {\n    lda #0\n    sta $d020\n    sta $d021\n    sta $d022\n}\n`);
  await page.getByRole('button', { name: 'Read the libraries again' }).click();
  await expect.poll(file).toContain('// Black, all of it\n.macro Black() {\n    lda #0\n    sta $d020\n    sta $d021\n    sta $d022\n}');

  // the calls left out: only the files used; the call does not assemble then
  await region.getByLabel('Calls').uncheck();
  await expect.poll(file).not.toContain('.macro WaitAndSet');
  expect(file()).toContain('.macro Black()');
  await expect(page.locator('.scr-check')).not.toContainText('Ready');
  await region.getByLabel('Calls').check();
  await expect.poll(file).toContain('.macro WaitAndSet');
  await expect(page.locator('.scr-check')).toContainText('Ready');

  // in the source, under the line that imports it: a folded list of the macros by name and parameters; pointing at one
  // shows its description
  // (Monaco keeps its view zones out of the accessibility tree: found by their look)
  const zone = page.locator('.scr-editor .am-zone');
  await expect(zone).toContainText('macros.asm · 4 macros: Black()  SetBorder(c)  WaitAndSet(line, c)  save()');
  await zone.locator('.am-fold').click();
  await expect(zone.locator('.am-group')).toHaveCount(2);
  await expect(zone.locator('.am-row')).toHaveCount(4);
  await expect(zone.locator('.am-row').nth(2)).toContainText('WaitAndSet(line, c)called');
  await zone.locator('.am-row').nth(2).hover();
  await expect(zone.locator('.am-zone-head')).toContainText('WaitAndSet(line, c) Waits for a line, then the border');
  await shot(page, '46-codelib-macro-zone');
  // (the code as it is: the import line and what follows)
  expect(readFileSync(join(dir, 'main.asm'), 'utf8')).toMatch(/^#import "macros\.asm"\n\nBasicUpstart2\(start\)/);
  await zone.locator('.am-fold').click();
  await expect(zone.locator('.am-row')).toHaveCount(0);

  // the file opened: the list of its macros, not its code; a click shows a macro's code, pointing its description
  await region.getByRole('button', { name: 'Open macros.asm' }).click();
  await expect(page.getByRole('tab', { name: /macros\.asm/ })).toBeVisible();
  const panel = page.getByRole('region', { name: 'The macros of macros.asm' });
  await expect(page.locator('.scr-editor')).toBeHidden();
  await expect(panel.getByRole('group', { name: 'raster' })).toContainText('.const BORDER = $d020');
  await panel.getByRole('button', { name: /^save\(\)/ }).hover();
  await expect(panel.locator('.am-detail')).toContainText('the code calls a macro of its file');
  await panel.getByRole('button', { name: /^Black\(\)/ }).hover();
  await expect(panel.locator('.am-detail')).toContainText('Black, all of it');
  await panel.getByRole('button', { name: /^Black\(\)/ }).click();
  await expect(panel.getByLabel('The code of Black')).toContainText('sta $d022');
  await shot(page, '47-codelib-macro-panel');
  // its code on request: read only, Mimir writes it
  await page.getByRole('button', { name: 'Show the code' }).click();
  await expect(page.locator('.scr-editor')).toBeVisible();
  const before = file();
  await (await lineWith('#importonce')).click();
  await page.keyboard.type('xyz');
  await page.waitForTimeout(600);
  expect(file()).toBe(before);

  // stopped: the file and the import stay as they are
  await region.getByRole('button', { name: 'Stop building macros.asm' }).click();
  await expect(page.getByRole('button', { name: 'Build macros.asm' })).toBeVisible();
  expect(file()).toBe(before);
  expect(readFileSync(join(dir, 'main.asm'), 'utf8')).toContain('#import "macros.asm"');
});

test('the project\'s macro file when the project imports the same macros from outside its folder: none twice, said where, and that import given way to the macro file', async ({ workDir: work, userData, app, page }) => {
  const dir = join(work, 'proj'), lib = join(work, 'c64_lib'), macros = join(userData, 'library', 'Macros');
  mkdirSync(dir); mkdirSync(lib); mkdirSync(macros, { recursive: true });
  const code = '#importonce\n// Sets the border\'s colour\n.macro SetBorder(c) {\n    lda #c\n    sta $d020\n}\n.macro save() {pha;txa;pha}\n';
  // (the library's file read from that same file once)
  writeFileSync(join(lib, 'raster.asm'), code);
  writeFileSync(join(macros, 'raster.asm'), `${head({ collection: true })}${code}`);
  const outside = join(lib, 'raster.asm').replace(/\\/g, '/');
  writeFileSync(join(dir, 'main.asm'), [`#import "${outside}"`, '', 'BasicUpstart2(start)', '', 'start:', '        SetBorder(2)', 'loop:   jmp loop', ''].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  const file = () => { try { return readFileSync(join(dir, 'macros.asm'), 'utf8'); } catch { return ''; } };

  // the file used in the project: its macros are in the project already, through the import from outside
  await page.getByRole('button', { name: /^Macros and code/ }).click();
  await page.getByRole('list', { name: 'The macro library' }).getByRole('button', { name: /^raster/ }).click();
  await page.getByRole('region', { name: 'The file raster.asm' }).getByRole('button', { name: 'Use in project' }).click();
  const region = page.getByRole('region', { name: 'The project\'s macro file' });
  await expect(region).toContainText('0 macros');
  await expect(region.getByRole('note')).toContainText(`2 of the macros (SetBorder, save) are in the project already: main.asm imports `);
  await expect(region.getByRole('note')).toContainText('macros.asm leaves them out.');
  await shot(page, '49-codelib-project-outside');
  expect(file()).not.toContain('.macro SetBorder');
  // that import gives way to the macro file: the macros come from the library
  await region.getByRole('button', { name: 'Use macros.asm instead' }).click();
  await expect(toast(page, /main\.asm imports macros\.asm in place of .*raster\.asm: its macros come from the library now/)).toBeVisible();
  await expect.poll(file).toContain('.macro SetBorder(c) {');
  await expect.poll(() => readFileSync(join(dir, 'main.asm'), 'utf8')).not.toContain(outside);
  expect(readFileSync(join(dir, 'main.asm'), 'utf8')).toContain('#import "macros.asm"');
  await expect(region).toContainText('2 macros');
  await expect(region.getByRole('note')).toHaveCount(0);
  await expect(page.locator('.scr-check')).toContainText('Ready');
});

test('the macro library\'s macros in the Assembler\'s suggestions: one chosen is put in with its parameters to type, and goes in macros.asm', async ({ workDir: work, userData, app, page }) => {
  const dir = join(work, 'proj'), macros = join(userData, 'library', 'Macros');
  mkdirSync(dir); mkdirSync(macros, { recursive: true });
  writeFileSync(join(macros, 'raster.asm'), `${head({ collection: true })}// Sets the border's colour
.macro SetBorder(c) {
    lda #c
    sta $d020
}
// Saves A and X
.macro irq_save() {pha;txa;pha}
`);
  writeFileSync(join(dir, 'main.asm'), ['BasicUpstart2(start)', '', 'start:', '        lda #$00', 'loop:   jmp loop', ''].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  const all = page.locator('.scr-editor .view-line');
  const at = () => all.evaluateAll(ls => ls.findIndex(l => (l.textContent ?? '').replace(/ /g, ' ').trim() === 'lda #$00'));
  await expect.poll(at).toBeGreaterThanOrEqual(0);
  await all.nth(await at()).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');

  // where an instruction goes: the library's macro among the mnemonics, with its call, what it does and where from
  const suggest = page.locator('.suggest-widget.visible');
  await page.keyboard.type('Se');
  await expect(suggest.locator('.monaco-list-row .label-name')).toContainText(['SetBorder']);
  await expect(suggest.locator('.monaco-list-row', { hasText: 'SetBorder' })).toContainText('SetBorder(c) — from raster, macro library');
  // (a part after a _ finds one too)
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('sav');
  await expect(suggest.locator('.monaco-list-row .label-name')).toHaveText(['irq_save']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('SetB');
  await expect(suggest.locator('.monaco-list-row .label-name')).toHaveText(['SetBorder']);
  // its description beside it from the start (no Ctrl+Space), and what choosing it does
  const details = page.locator('.suggest-details-container .suggest-details');
  await expect(details).toBeVisible();
  await expect(details).toContainText('Sets the border\'s colour');
  await expect(details).toContainText('Chosen, Mimir builds macros.asm with its file (raster.asm, all its macros)');
  await shot(page, '48-codelib-suggest');
  // Tab takes it: the call with its parameter selected to type over
  await page.keyboard.press('Tab');
  await page.keyboard.type('2');
  await page.keyboard.press('Escape');
  await expect.poll(() => all.evaluateAll(ls => ls.map(l => (l.textContent ?? '').replace(/ /g, ' ').trim()))).toContain('SetBorder(2)');
  // the project had no macro file: it is made with it, the main source imports it, and the call assembles
  await expect(toast(page, /raster\.asm goes in macros\.asm, all its macros/)).toBeVisible();
  const file = () => { try { return readFileSync(join(dir, 'macros.asm'), 'utf8'); } catch { return ''; } };
  await expect.poll(file).toContain('// Sets the border\'s colour\n.macro SetBorder(c) {');
  await expect.poll(() => readFileSync(join(dir, 'main.asm'), 'utf8')).toMatch(/^#import "macros\.asm"\n\nBasicUpstart2\(start\)/);
  await expect(page.locator('.scr-check')).toContainText('Ready');
  // one the project defines itself is not suggested
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n.macro irq_save() {nop}\n        irq_');
  await expect(suggest).toBeHidden();
});
