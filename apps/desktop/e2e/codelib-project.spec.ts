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

  // a call of the library's macro typed: it goes in, with those it uses and its collection's own lines
  await (await lineWith('sta $d021')).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('WaitAndSet(100, 2)');
  await expect.poll(file).toContain('.macro WaitAndSet(line, c) {');
  expect(file()).toContain('// ---- raster ----\n.const BORDER = $d020\n\n// Sets the border\'s colour\n.macro SetBorder(c) {');
  expect(file()).toContain('.macro save() {pha;txa;pha}');
  await expect(region).toContainText('3 macros');
  await expect(region).toContainText('1 called · 2 used by them');
  await expect(page.locator('.scr-check')).toContainText('Ready');
  // the list marks them
  const list = page.getByRole('list', { name: 'The macro library' });
  await list.getByRole('button', { name: /^raster/ }).click();
  await expect(page.getByRole('list', { name: 'The macros of raster' }).getByRole('button', { name: /^WaitAndSet/ })).toContainText('macros.asm');

  // one added from the list
  await list.getByRole('button', { name: /^Black/ }).click();
  await list.getByRole('button', { name: 'To macros.asm', exact: true }).click();
  await expect(toast(page, 'Black goes in macros.asm')).toBeVisible();
  await expect.poll(file).toContain('// ---- macros of their own ----\n\n// Border and background black\n.macro Black() {');
  await expect(list.getByRole('button', { name: 'In macros.asm', exact: true })).toBeVisible();
  await region.getByRole('button', { name: /^macros\.asm/ }).click();
  await expect(region.getByRole('list', { name: 'What is in macros.asm' }).getByRole('listitem')).toHaveCount(4);
  await shot(page, '45-codelib-project-file');

  // a macro of the library changed: the file follows
  writeFileSync(join(macros, 'Black.asm'), `${head({ description: 'Black, all of it' })}.macro Black() {\n    lda #0\n    sta $d020\n    sta $d021\n    sta $d022\n}\n`);
  await page.getByRole('button', { name: 'Read the libraries again' }).click();
  await expect.poll(file).toContain('// Black, all of it\n.macro Black() {\n    lda #0\n    sta $d020\n    sta $d021\n    sta $d022\n}');

  // the calls left out: only what is added; the call does not assemble then
  await region.getByLabel('Calls').uncheck();
  await expect.poll(file).not.toContain('.macro WaitAndSet');
  expect(file()).toContain('.macro Black()');
  await expect(page.locator('.scr-check')).not.toContainText('Ready');
  await region.getByLabel('Calls').check();
  await expect.poll(file).toContain('.macro WaitAndSet');
  await expect(page.locator('.scr-check')).toContainText('Ready');

  // read only in the editor: Mimir writes it
  await region.getByRole('button', { name: 'Open macros.asm' }).click();
  await expect(page.getByRole('tab', { name: /macros\.asm/ })).toBeVisible();
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
