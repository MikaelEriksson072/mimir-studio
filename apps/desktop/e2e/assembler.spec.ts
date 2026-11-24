/* The Assembler (spec 10.7), started from the start screen: a folder of sources is the project, its files listed
 * beside the code; the code is checked as it is typed and written to its file; Debug runs the program in Mimir's 6510;
 * Run builds it with KickAss.jar and starts it in VICE (where.exe stands in for VICE). The folders are the test's own. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { stubDialogs } from './helpers';

test.use({ start: 'none' });

/** a screenshot for a person looking at the work (MIMIR_E2E_SHOTS: the folder they go in) */
const shot = async (page: Page, name: string) => { if (process.env.MIMIR_E2E_SHOTS) await page.screenshot({ path: join(process.env.MIMIR_E2E_SHOTS, `${name}.png`) }); };
const tree = (page: Page) => page.getByRole('tree', { name: 'Files' });
/** the editor's lines as text (Monaco draws only those in view, not in order, and its spaces as no-break spaces) */
const editorText = (page: Page) => page.locator('.scr-editor .view-lines').evaluate(el => [...el.querySelectorAll<HTMLElement>('.view-line')].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map(l => (l.textContent ?? '').replace(/ /g, ' ')).join('\n'));

test('the Assembler: a new folder with a program, its files beside the code, checked, debugged in Mimir and built', async ({ workDir: work, app, page }) => {
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await expect(page.getByRole('heading', { name: 'Assembler' })).toBeVisible();
  await shot(page, '1-home');

  // a new folder, in the test's folder
  await page.getByRole('button', { name: 'New…' }).click();
  const form = page.getByRole('form', { name: 'New folder of sources' });
  await form.getByRole('textbox').fill('hello');
  await stubDialogs(app, { open: [work] });
  await form.getByRole('button', { name: 'Change…' }).click();
  await expect(form).toContainText(join(work, 'hello'));
  await form.getByRole('button', { name: 'Create' }).click();

  const dir = join(work, 'hello');
  await expect(tree(page).getByRole('treeitem', { name: 'main.asm' })).toBeVisible();
  expect(readFileSync(join(dir, 'main.asm'), 'utf8')).toContain('BasicUpstart2(start)');
  // the main file is shown, checked with Mimir's own assembler: it starts at $080e (the SYS of its BASIC line)
  await page.locator('.scr-editor .view-lines').waitFor();
  await expect(page.getByLabel('File name')).toHaveValue('main.asm');
  await expect(page.locator('.scr-check')).toContainText('Ready');
  await expect(page.locator('.scr-check')).toContainText('starts at $080e');
  await expect(page.getByRole('button', { name: 'Language' })).toHaveText('Kick Assembler');
  await shot(page, '2-workspace');

  // a file of its own, imported by the main file: what is typed is written to the file, and checked as a whole
  await page.getByRole('button', { name: 'New file' }).click();
  await tree(page).getByLabel('Name of the new file').fill('colors');
  await tree(page).getByLabel('Name of the new file').press('Enter');
  await expect(tree(page).getByRole('treeitem', { name: 'colors.asm' })).toBeVisible();
  await expect(page.getByLabel('File name')).toHaveValue('colors.asm');
  await page.locator('.scr-editor .view-lines').click();
  await page.keyboard.insertText('.const BORDER = 6\n');
  await expect.poll(() => existsSync(join(dir, 'colors.asm')) && readFileSync(join(dir, 'colors.asm'), 'utf8')).toMatch(/^\.const BORDER = 6\s*$/);

  await tree(page).getByRole('treeitem', { name: 'main.asm' }).click();
  await expect(page.getByLabel('File name')).toHaveValue('main.asm');
  // a name the program does not have: the check says where
  const main = readFileSync(join(dir, 'main.asm'), 'utf8');
  writeFileSync(join(dir, 'main.asm'), main.replace('BasicUpstart2(start)', '#import "colors.asm"\nBasicUpstart2(start)').replace('        lda #0\n        sta $d020', '        lda #BORDR\n        sta $d020'));
  // (changed outside the app: the editor takes the file's new text)
  await expect.poll(() => editorText(page)).toContain('#import "colors.asm"');
  await expect(page.locator('.scr-check')).toContainText('line 8', { timeout: 10_000 });
  await expect(page.locator('.scr-check')).toContainText('BORDR');
  await expect(tree(page).getByRole('treeitem', { name: 'main.asm' })).toContainText('1');
  await shot(page, '3-problem');
  writeFileSync(join(dir, 'main.asm'), readFileSync(join(dir, 'main.asm'), 'utf8').replace('BORDR', 'BORDER'));
  await expect(page.locator('.scr-check')).toContainText('Ready', { timeout: 10_000 });

  // Debug: the program in Mimir's 6510, stopped before its first instruction (line 8, lda #BORDER)
  await page.getByRole('button', { name: /^Debug/ }).click();
  const debugger_ = page.getByRole('complementary', { name: 'Debugger' });
  await expect(debugger_.getByRole('status')).toContainText('main.asm line 8');
  await page.getByRole('button', { name: /^Step/ }).click();
  await expect(debugger_.getByRole('table', { name: 'Registers' })).toContainText('$06');
  await page.getByRole('button', { name: /C64 screen/ }).click();
  await shot(page, '4-debug');
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect(page.getByRole('tabpanel', { name: 'Last run' })).toContainText('Returned with an RTS');
  await expect(page.locator('.scr-screen-col')).toBeVisible();
  await shot(page, '5-last-run');

  // Build: KickAss.jar builds the main file into out\ beside it
  const kickJar = (await page.evaluate(() => (window as unknown as { kr: { getSettings(): Promise<{ kickJar: string }> } }).kr.getSettings())).kickJar;
  if (kickJar && existsSync(kickJar)) {
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await expect(page.locator('.scr-run-stat')).toContainText('Built main.prg', { timeout: 60_000 });
    expect(existsSync(join(dir, 'out', 'main.prg'))).toBe(true);
    const prg = readFileSync(join(dir, 'out', 'main.prg'));
    expect([prg[0], prg[1]]).toEqual([0x01, 0x08]);
    await shot(page, '6-built');
    // Run (Ctrl+Enter in the code): built again, then VICE starts it (a Windows program that ends at once stands in)
    const standIn = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe');
    if (existsSync(standIn)) {
      await page.evaluate(v => (window as unknown as { kr: { setSettings(p: object): Promise<unknown> } }).kr.setSettings({ vicePath: v }), standIn);
      await page.locator('.scr-editor .view-lines').click();
      await page.keyboard.press('Control+Enter');
      await expect(page.locator('.scr-run-stat')).toContainText('VICE started it', { timeout: 60_000 });
    }
    // a build that fails says where, in the problems and on the line
    writeFileSync(join(dir, 'colors.asm'), '.const BORDER = 6\n  lda #\n');
    await expect(page.locator('.scr-check')).toContainText('colors.asm', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await expect(page.locator('.scr-run-stat')).toContainText('error in main.asm', { timeout: 60_000 });
    await expect(page.getByRole('list', { name: 'What the build found' })).toContainText('colors.asm:2');
    await expect(page.getByLabel('File name')).toHaveValue('colors.asm');
    writeFileSync(join(dir, 'colors.asm'), '.const BORDER = 6\n');
    await expect(page.locator('.scr-check')).toContainText('Ready', { timeout: 10_000 });
  }
  mkdirSync(join(dir, 'gfx'));
  await expect(tree(page).getByRole('treeitem', { name: 'gfx' })).toBeVisible({ timeout: 10_000 });

  // back to the start screen; the folder is offered again
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New project…' })).toBeVisible();
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await expect(page.getByRole('region', { name: 'Folders opened before' })).toContainText('hello');
});

test('the Assembler: a folder opened as it is, its main file found, a breakpoint in an imported file, files renamed and deleted', async ({ workDir: work, userData, app, page }) => {
  // the Recycle Bin is a folder of the profile: nothing goes in the user's
  const trash = join(userData, 'trash');
  await app.evaluate((_e, to) => {
    const req = (process as unknown as { mainModule: { require: (m: string) => any } }).mainModule.require; // eslint-disable-line @typescript-eslint/no-explicit-any
    const fs = req('node:fs'), path = req('node:path'), { shell } = req('electron');
    shell.trashItem = async (p: string) => { fs.mkdirSync(to, { recursive: true }); fs.renameSync(p, path.join(to, path.basename(p))); };
  }, trash);
  const dir = join(work, 'game');
  for (const d of ['src', 'lib', 'gfx']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'src', 'main.asm'), 'BasicUpstart2(start)\n#import "../lib/print.asm"\nstart:\n  jsr print\n  ldx logo+1\n  rts\nlogo: .import binary "../gfx/logo.bin"\n');
  writeFileSync(join(dir, 'lib', 'print.asm'), 'print:\n  lda #1\n  sta $d020\n  rts\n');
  writeFileSync(join(dir, 'gfx', 'logo.bin'), new Uint8Array([7, 8, 9]));
  writeFileSync(join(dir, 'notes.txt'), 'to do\n');
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();

  // the main file is the source that starts the program and no other imports; the check reads the data it loads
  await expect(page.getByLabel('File name')).toHaveValue('main.asm');
  await expect(tree(page).getByRole('treeitem', { name: 'main.asm' })).toContainText('main');
  await expect(page.locator('.scr-check')).toContainText('Ready');
  // the language: 64tass makes the Kick Assembler source wrong, and back
  await page.getByRole('button', { name: 'Language' }).click();
  await expect(page.getByRole('button', { name: 'Language' })).toHaveText('64tass');
  await expect(page.locator('.scr-check')).not.toContainText('Ready');
  await page.getByRole('button', { name: 'Language' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');

  // a breakpoint in the imported file: Continue stops there, the file shown in the editor
  await tree(page).getByRole('treeitem', { name: 'lib' }).click();
  await tree(page).getByRole('treeitem', { name: 'print.asm' }).click();
  await expect(page.getByLabel('File name')).toHaveValue('print.asm');
  const editor = page.locator('.scr-editor');
  await editor.locator('.view-lines').waitFor();
  const box = await editor.locator('.line-numbers', { hasText: /^3$/ }).boundingBox();
  const glyph = await editor.locator('.glyph-margin').boundingBox();
  await page.mouse.click(glyph!.x + glyph!.width / 2, box!.y + box!.height / 2);
  await expect(editor.locator('.scr-bp')).toHaveCount(1);
  await tree(page).getByRole('treeitem', { name: 'main.asm' }).click();
  await page.keyboard.press('F8');
  const status = page.getByRole('complementary', { name: 'Debugger' }).getByRole('status');
  await expect(status).toContainText('src/main.asm line 4');
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect(status).toContainText('lib/print.asm line 3');
  await expect(page.getByRole('complementary', { name: 'Debugger' })).toContainText('Stopped at the breakpoint on lib/print.asm line 3');
  await expect(page.getByLabel('File name')).toHaveValue('print.asm');
  await expect(editor.locator('.scr-pc-bp-glyph')).toHaveCount(1);
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect(page.getByRole('tabpanel', { name: 'Last run' })).toContainText('Returned with an RTS');
  // X got the logo's second byte
  await expect(page.getByLabel('Registers at the end')).toContainText('X $08');

  // the list's menu: rename a file, make another the main file, delete one
  await tree(page).getByRole('treeitem', { name: 'notes.txt' }).getByRole('button', { name: 'More for notes.txt' }).click({ force: true });
  await page.getByRole('menuitem', { name: /^Rename/ }).click();
  await tree(page).getByLabel('New name of notes.txt').fill('readme.txt');
  await tree(page).getByLabel('New name of notes.txt').press('Enter');
  await expect(tree(page).getByRole('treeitem', { name: 'readme.txt' })).toBeVisible();
  expect(existsSync(join(dir, 'readme.txt'))).toBe(true);
  await tree(page).getByRole('treeitem', { name: 'print.asm' }).click({ button: 'right' });
  await page.getByRole('menuitemcheckbox', { name: /^Main file/ }).click();
  await expect(tree(page).getByRole('treeitem', { name: 'print.asm' })).toContainText('main');
  await expect(page.locator('.scr-check')).toContainText('starts at $');
  await tree(page).getByRole('treeitem', { name: 'readme.txt' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Delete/ }).click();
  await expect(tree(page).getByRole('treeitem', { name: 'readme.txt' })).toHaveCount(0);
  expect(existsSync(join(dir, 'readme.txt'))).toBe(false);
  expect(existsSync(join(trash, 'readme.txt'))).toBe(true);
  await shot(page, '7-open-folder');
});
