/* The Assembler (spec 10.7): an Assembler project, made or opened from the start screen's Assembler page, is a folder of
 * sources opened in the project window, its files listed beside the code in the Assembler tab; the code is checked as it
 * is typed and written to its file; Debug runs the program in Mimir's 6510; Run builds it with KickAss.jar and starts it
 * in VICE (where.exe stands in for VICE); Graphics, Memory and the Explorer show the program the sources make. The
 * folders are the test's own. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openSection, stubDialogs, toast } from './helpers';

test.use({ start: 'none' });

/** a screenshot for a person looking at the work (MIMIR_E2E_SHOTS: the folder they go in) */
const shot = async (page: Page, name: string) => { if (process.env.MIMIR_E2E_SHOTS) await page.screenshot({ path: join(process.env.MIMIR_E2E_SHOTS, `${name}.png`) }); };
const tree = (page: Page) => page.getByRole('tree', { name: 'Files' });
/** the project closed: the start screen */
const closeProject = async (page: Page, name: string) => {
  await page.getByRole('button', { name: `Project ${name}` }).click();
  await page.getByRole('menuitem', { name: /^Close the project/ }).click();
  await expect(page.getByRole('button', { name: 'New project…' })).toBeVisible();
};
/** the editor's lines as text (Monaco draws only those in view, not in order, and its spaces as no-break spaces) */
const editorText = (page: Page) => page.locator('.scr-editor .view-lines').evaluate(el => [...el.querySelectorAll<HTMLElement>('.view-line')].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map(l => (l.textContent ?? '').replace(/ /g, ' ')).join('\n'));

test('the Assembler: a new project with a program, its files beside the code, checked, debugged in Mimir and built', async ({ workDir: work, app, page }) => {
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await expect(page.getByRole('heading', { name: 'Assembler' })).toBeVisible();
  await shot(page, '1-home');

  // a new folder, in the test's folder
  await page.getByRole('button', { name: 'New…' }).click();
  const form = page.getByRole('form', { name: 'New Assembler project' });
  await form.getByRole('textbox').fill('hello');
  await stubDialogs(app, { open: [work] });
  await form.getByRole('button', { name: 'Change…' }).click();
  await expect(form).toContainText(join(work, 'hello'));
  await form.getByRole('button', { name: 'Create' }).click();

  const dir = join(work, 'hello');
  await expect(tree(page).getByRole('treeitem', { name: 'main.asm' })).toBeVisible();
  expect(readFileSync(join(dir, 'main.asm'), 'utf8')).toContain('BasicUpstart2(start)');
  // a project of its own, in the project window: its project file says it is an Assembler project's
  expect(JSON.parse(readFileSync(join(dir, 'hello.mimir.json'), 'utf8')).asm).toEqual({ lang: 'kickass', main: 'main.asm' });
  await expect(page.getByRole('button', { name: 'Project hello' })).toBeVisible();
  await expect(page.locator('.main-tabs').getByRole('tab', { name: 'Assembler' })).toHaveAttribute('aria-selected', 'true');
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

  // the project closed: it is among the recent projects, and the Assembler page offers its folder again
  await closeProject(page, 'hello');
  await expect(page.getByRole('button', { name: 'Continue with the project hello' })).toBeVisible();
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

test('the Assembler: open files as tabs over the code, a preview the list replaces, kept by typing or a double-click, closed, moved, following renames and deletes', async ({ workDir: work, userData, app, page }) => {
  const trash = join(userData, 'trash');
  await app.evaluate((_e, to) => {
    const req = (process as unknown as { mainModule: { require: (m: string) => any } }).mainModule.require; // eslint-disable-line @typescript-eslint/no-explicit-any
    const fs = req('node:fs'), path = req('node:path'), { shell } = req('electron');
    shell.trashItem = async (p: string) => { fs.mkdirSync(to, { recursive: true }); fs.renameSync(p, path.join(to, path.basename(p))); };
  }, trash);
  const dir = join(work, 'tabs');
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'main.asm'), 'BasicUpstart2(start)\n#import "a.asm"\n#import "b.asm"\nstart:\n  jsr a\n  jsr b\n  rts\n');
  writeFileSync(join(dir, 'a.asm'), 'a: rts\n');
  writeFileSync(join(dir, 'b.asm'), 'b: rts\n');
  writeFileSync(join(dir, 'lib', 'a.asm'), '// another a.asm\n');
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();

  const row = page.getByRole('tablist', { name: 'Open files' });
  const names = () => row.getByRole('tab').evaluateAll(els => els.map(e => `${e.getAttribute('aria-label')}${e.classList.contains('preview') ? '*' : ''}${e.getAttribute('aria-selected') === 'true' ? '<' : ''}`));
  // the main file in a tab that stays
  await expect.poll(names).toEqual(['main.asm<']);
  await page.locator('.scr-editor .view-lines').waitFor();
  // a click in the list opens a preview, the next click puts another file in its place
  await tree(page).getByRole('treeitem', { name: 'a.asm' }).first().click();
  await expect.poll(names).toEqual(['main.asm', 'a.asm*<']);
  await tree(page).getByRole('treeitem', { name: 'b.asm' }).click();
  await expect.poll(names).toEqual(['main.asm', 'b.asm*<']);
  await expect(page.getByLabel('File name')).toHaveValue('b.asm');
  // a double-click on the tab keeps it; the next file gets a preview of its own
  await row.getByRole('tab', { name: 'b.asm' }).dblclick();
  await expect.poll(names).toEqual(['main.asm', 'b.asm<']);
  await tree(page).getByRole('treeitem', { name: 'a.asm' }).first().click();
  await expect.poll(names).toEqual(['main.asm', 'b.asm', 'a.asm*<']);
  // typing in a preview keeps it
  await page.locator('.scr-editor .view-lines').click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' // returns');
  await expect.poll(names).toEqual(['main.asm', 'b.asm', 'a.asm<']);
  await expect.poll(() => readFileSync(join(dir, 'a.asm'), 'utf8')).toContain('// returns');
  // two files of the same name say their folders
  await tree(page).getByRole('treeitem', { name: 'lib' }).click();
  await tree(page).getByRole('treeitem', { name: 'a.asm' }).first().dblclick();
  await expect(row.getByRole('tab').filter({ hasText: 'lib' })).toHaveCount(1);
  await expect.poll(names).toEqual(['main.asm', 'b.asm', 'a.asm', 'a.asm<']);
  await shot(page, '8-tabs');

  // Ctrl+Tab goes round the row, Ctrl+Shift+Tab back; a click shows a tab
  await page.keyboard.press('Control+Tab');
  await expect.poll(names).toEqual(['main.asm<', 'b.asm', 'a.asm', 'a.asm']);
  await page.keyboard.press('Control+Shift+Tab');
  await expect.poll(names).toEqual(['main.asm', 'b.asm', 'a.asm', 'a.asm<']);
  await row.getByRole('tab', { name: 'b.asm' }).click();
  await expect(page.getByLabel('File name')).toHaveValue('b.asm');
  // closed with its ×, the tab after it is shown; Ctrl+F4 closes the one shown
  await row.getByRole('button', { name: 'Close b.asm' }).click();
  await expect.poll(names).toEqual(['main.asm', 'a.asm<', 'a.asm']);
  await page.locator('.scr-editor .view-lines').click();
  await page.keyboard.press('Control+F4');
  // (the a.asm left is lib's)
  await expect.poll(names).toEqual(['main.asm', 'a.asm<']);
  await expect(page.getByLabel('File name')).toHaveValue('a.asm');
  await expect(page.getByLabel('File name')).toHaveAttribute('title', /^lib\/a\.asm/);
  // a tab dragged before another
  await row.getByRole('tab', { name: 'a.asm' }).dragTo(row.getByRole('tab', { name: 'main.asm' }), { targetPosition: { x: 4, y: 10 } });
  await expect.poll(names).toEqual(['a.asm<', 'main.asm']);

  // a file renamed in the list: its tab follows it; deleted: its tab is closed and the one beside it shown
  await page.getByLabel('File name').fill('alpha.asm');
  await page.getByLabel('File name').press('Enter');
  await expect.poll(names).toEqual(['alpha.asm<', 'main.asm']);
  expect(existsSync(join(dir, 'lib', 'alpha.asm'))).toBe(true);
  await tree(page).getByRole('treeitem', { name: 'alpha.asm' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Delete/ }).click();
  await expect.poll(names).toEqual(['main.asm<']);
  expect(existsSync(join(trash, 'alpha.asm'))).toBe(true);

  // the tab's menu: close all leaves no file open
  await row.getByRole('tab', { name: 'main.asm' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Close all' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('note').filter({ hasText: 'No file open' })).toBeVisible();

  // the tabs are kept for the folder: back to the start screen and in again
  await tree(page).getByRole('treeitem', { name: 'b.asm' }).dblclick();
  await tree(page).getByRole('treeitem', { name: 'main.asm' }).dblclick();
  await expect.poll(names).toEqual(['b.asm', 'main.asm<']);
  await closeProject(page, 'tabs');
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await page.getByRole('region', { name: 'Folders opened before' }).getByRole('button', { name: /^tabs / }).click();
  await expect.poll(names).toEqual(['b.asm', 'main.asm<']);
});

test('the Assembler in the whole C64: RUN typed at READY, stopped at the program\'s first instruction, run in the C64\'s own time with its screen, a key typed on the screen, a breakpoint', async ({ workDir: work, app, page }) => {
  const vice = 'C:\\C64\\VICE';
  const found = () => { try { return readdirSync(vice).some(d => existsSync(join(vice, d, 'C64'))); } catch { return false; } };
  test.skip(!process.env.C64_ROMS && !found(), 'needs VICE\'s ROMs');
  const dir = join(work, 'c64');
  mkdirSync(dir);
  // the border black, a key waited for with the KERNAL's GETIN and written to the screen, the background white, back to BASIC
  writeFileSync(join(dir, 'main.asm'), 'BasicUpstart2(start)\nstart:\n  lda #0\n  sta $d020\n!key:\n  jsr $ffe4\n  beq !key-\n  sta $0400\n  lda #1\n  sta $d021\n  rts\n');
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  await page.getByRole('combobox', { name: 'Runs in' }).selectOption('c64');

  // Debug: RUN typed at READY, stopped at the first instruction; the screen beside the code is the VIC's picture
  await page.getByRole('button', { name: /^Debug/ }).click();
  const dbgPanel = page.getByRole('complementary', { name: 'Debugger' });
  await expect(dbgPanel.getByRole('status')).toContainText('main.asm line 3', { timeout: 30_000 });
  await expect(page.getByRole('note').filter({ hasText: 'RUN was typed at READY' })).toBeVisible();
  const screen = page.getByRole('region', { name: 'C64 screen' });
  await expect(screen.getByRole('img')).toBeVisible();
  await expect(page.getByLabel('Text on the C64 screen')).toContainText('READY.');
  await expect(dbgPanel.getByRole('table', { name: 'Stack' })).toContainText('the end of the run');
  /** a pixel of the picture (in the C64's pixels) as rgb */
  const pixel = (x: number, y: number) => screen.getByRole('img').evaluate((cv: HTMLCanvasElement, at) => { const k = cv.width / 384, d = cv.getContext('2d')!.getImageData(Math.floor(at[0] * k), Math.floor(at[1] * k), 1, 1).data; return [d[0], d[1], d[2]]; }, [x, y]);
  const lightBlue = await pixel(2, 2);
  // two steps: the border black (the picture has it below the raster beam at once, the whole frame once the C64 goes on)
  await page.getByRole('button', { name: /^Step/ }).click();
  await page.getByRole('button', { name: /^Step/ }).click();
  await expect(dbgPanel.getByRole('status')).toContainText('main.asm line 6');
  await expect(screen).toContainText(/Stopped on raster line \d+/);
  // the debugger's line marked in the code, the cursor on it (its line number the one lit)
  const editor = page.locator('.scr-editor');
  await expect(editor.locator('.scr-pc-line')).toHaveCount(1);
  await expect(editor.locator('.line-numbers.active-line-number')).toHaveText('6');
  await shot(page, '9-c64-debug');
  // a step into the KERNAL's GETIN, where no line of the sources is: the JSR's line is marked, and the status says it
  await page.getByRole('button', { name: /^Step/ }).click();
  await expect(dbgPanel.getByRole('status')).toContainText('At GETIN ($ffe4), inside the JSR on main.asm line 6');
  await expect(editor.locator('.scr-pc-line')).toHaveCount(0);
  await expect(editor.locator('.scr-call-line')).toHaveCount(1);
  await expect(editor.locator('.scr-call-glyph')).toHaveCount(1);
  // Out: back after it, on the next line
  await page.getByRole('button', { name: 'Out Shift+F6' }).click();
  await expect(dbgPanel.getByRole('status')).toContainText('main.asm line 7');
  await expect(editor.locator('.scr-call-line')).toHaveCount(0);
  await expect(editor.locator('.scr-pc-line')).toHaveCount(1);

  // Continue: it waits for a key in the C64's own time; a breakpoint on the store, a key typed on the screen
  const box = await editor.locator('.line-numbers', { hasText: /^8$/ }).boundingBox();
  const glyph = await editor.locator('.glyph-margin').boundingBox();
  await page.mouse.click(glyph!.x + glyph!.width / 2, box!.y + box!.height / 2);
  await expect(editor.locator('.scr-bp')).toHaveCount(1);
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  const keys = screen.getByLabel('The C64: keys typed here go to its keyboard');
  await keys.click();
  await page.keyboard.down('q');
  await expect(dbgPanel).toContainText('Stopped at the breakpoint on main.asm line 8', { timeout: 15_000 });
  await page.keyboard.up('q');
  await expect(dbgPanel.getByRole('table', { name: 'Registers' })).toContainText('$51');
  // frames went by while it waited for the key: the border is black all round
  expect(await pixel(2, 2)).toEqual([0, 0, 0]);
  expect(lightBlue).not.toEqual([0, 0, 0]);
  // on: it returns to BASIC, which says READY again
  await page.mouse.click(glyph!.x + glyph!.width / 2, box!.y + box!.height / 2);
  await expect(editor.locator('.scr-bp')).toHaveCount(0);
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect.poll(async () => ((await page.getByLabel('Text on the C64 screen').textContent()) ?? '').split('READY.').length - 1, { timeout: 15_000 }).toBe(2);
  await shot(page, '10-c64-running');
  // Pause, then Stop: the run is the last run, its screen kept
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: /^Continue/ })).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Last run' })).toContainText(/Stopped at \$.* s of the C64's time\)\./);
  await expect(screen.getByRole('img')).toBeVisible();
  await page.getByRole('combobox', { name: 'Runs in' }).selectOption('memory');
});

test('an Assembler project in the project window: the program its sources make in the Explorer, Graphics and Memory, back to its line in the sources, no analysis', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'sprite');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), 'BasicUpstart2(start)\nstart:\n  lda #sprite/64\n  sta $07f8\n  rts\n* = $2000 "sprite"\nsprite:\n  .fill 63, $ff\n');
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  // the folder is an Assembler project now: its project file written into it, not in the list
  expect(JSON.parse(readFileSync(join(dir, 'sprite.mimir.json'), 'utf8')).asm).toEqual({ lang: 'kickass' });
  await expect(tree(page).getByRole('treeitem', { name: 'main.asm' })).toBeVisible();
  await expect(tree(page).getByRole('treeitem', { name: 'sprite.mimir.json' })).toHaveCount(0);
  // its tabs and title bar: the Assembler first, none of the listing, the re-assembly or the analysis
  const tabs = page.locator('.main-tabs');
  await expect(tabs.getByRole('tab')).toHaveText(['Assembler', 'Graphics', 'Memory', 'Scripts', 'Git', 'SPEC.md']);
  await expect(page.locator('.titlebar').getByRole('button', { name: /Verify/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Analysis overview' })).toHaveCount(0);
  await expect(page.locator('.titlebar').getByRole('button', { name: /^Run/ })).toBeVisible();

  // Graphics: the program's bytes, the Explorer with its file and memory map (the Assembler tab folded them in)
  await tabs.getByRole('tab', { name: 'Graphics' }).click();
  const side = page.locator('.sidebar');
  await side.getByRole('button', { name: 'Program' }).click();
  await side.getByRole('button', { name: 'Memory map' }).click();
  await expect(side.getByText('main.prg')).toBeVisible({ timeout: 15_000 });
  await expect(side).toContainText('$0801–$203e');
  await expect(page.getByRole('button', { name: /^Mark as/ })).toHaveCount(0);
  await shot(page, '11-asm-graphics');
  // a block of the memory map: its line in the sources, in the Assembler
  await side.locator('.seg-row', { hasText: 'sprite' }).click();
  await expect(tabs.getByRole('tab', { name: 'Assembler' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('File name')).toHaveValue('main.asm');
  await expect(page.locator('.scr-editor .line-numbers.active-line-number')).toHaveText('8');

  // a change in the sources is the program the other tabs show
  await page.locator('.scr-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('more:\n  .byte 1, 2, 3\n');
  await tabs.getByRole('tab', { name: 'Memory' }).click();
  await expect(side).toContainText('$0801–$2041', { timeout: 15_000 });
  await shot(page, '12-asm-memory');

  // a PRG dropped or opened is not taken in: the program is what the sources make
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /Open PRG/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Mount disk image/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await closeProject(page, 'sprite');
});

/** a PSID of `data` loaded at `load` (init there, play 3 bytes on), its load address in the data as most have it */
const psid = (load: number, data: number[], name: string) => {
  const h = new Uint8Array(0x7e + data.length);
  h.set([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c, 0, 0, load >> 8, load & 0xff, (load + 3) >> 8, (load + 3) & 0xff, 0, 1, 0, 1]);
  for (let i = 0; i < name.length; i++) h[0x16 + i] = name.charCodeAt(i);
  h[0x7c] = load & 0xff; h[0x7d] = load >> 8; h.set(data, 0x7e);
  return h;
};

test('Insert block in the Assembler: sprites from the library as .byte lines, music from a file the source loads, empty data at an address; the project\'s views show what each is', async ({ workDir: work, userData, app, page }) => {
  const dir = join(work, 'blocks');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), 'BasicUpstart2(start)\nstart:\n  rts\n\n');
  // a sprite in the library, a tune outside the project
  mkdirSync(join(userData, 'library', 'Sprites'), { recursive: true });
  const sprite = Uint8Array.from({ length: 64 }, (_, i) => (i < 63 ? [0x00, 0x7e, 0x00, 0x03, 0xff, 0xc0][i % 6] : 0));
  writeFileSync(join(userData, 'library', 'Sprites', 'Test - spr_2000 ($2000-$203f).spr'), sprite);
  const tune = join(work, 'tune.sid');
  writeFileSync(tune, psid(0x1000, [0x60, 0, 0, 0x60, ...Array.from({ length: 60 }, (_, i) => i)], 'Test tune'));

  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  const code = page.locator('.scr-editor .view-lines');
  const dialog = page.getByRole('dialog', { name: 'Insert block' });
  const disk = () => readFileSync(join(dir, 'main.asm'), 'utf8');

  // sprites from the library, as .byte lines where the caret is (aligned to 64)
  await code.click();
  await page.keyboard.press('Control+End');
  await page.getByRole('button', { name: 'Insert block' }).click();
  await expect(dialog.getByRole('radio', { name: 'Sprites', exact: true })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('radio', { name: 'From the library' }).check();
  await dialog.getByRole('option', { name: /spr_2000/ }).click();
  await expect(dialog.getByLabel('Name')).toHaveValue('spr_2000');
  await expect(dialog.getByLabel('The lines')).toContainText('// @block sprite');
  await expect(dialog.getByLabel('The lines')).toContainText('.byte %00000000, %01111110, %00000000');
  await shot(page, '13-insert-sprite');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(disk, { timeout: 5000 }).toContain('// @block sprite');
  expect(disk()).toContain('        .align $40\n// @block sprite hires\nspr_2000:\n');
  expect(disk().match(/^ +\.byte %[01]{8}, %[01]{8}, %[01]{8}$/gm)).toHaveLength(21);
  await expect(page.locator('.scr-check')).toContainText('Ready');

  // music from a file outside the project: a copy goes in the project, Kick Assembler's LoadSid reads it
  await page.keyboard.press('Control+End');
  await page.getByRole('button', { name: 'Insert block' }).click();
  await dialog.getByRole('radio', { name: 'Music', exact: true }).click();
  await stubDialogs(app, { open: [tune] });
  await dialog.getByRole('radio', { name: 'From a file…' }).check();
  await expect(dialog).toContainText('Test tune');
  await expect(dialog).toContainText('$1000-$103f');
  await expect(dialog.getByRole('radio', { name: /A file of the project, LoadSid/ })).toBeChecked();
  await expect(dialog).toContainText('A copy goes in music/tune.sid');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect.poll(disk, { timeout: 5000 }).toContain('.var tune = LoadSid("music/tune.sid")');
  expect(readFileSync(join(dir, 'music', 'tune.sid'))).toEqual(readFileSync(tune));
  await expect(tree(page).getByRole('treeitem', { name: 'music' })).toBeVisible();
  await expect(page.locator('.scr-check')).toContainText('Ready');

  // empty data at an address, to fill in
  await page.keyboard.press('Control+End');
  await page.getByRole('button', { name: 'Insert block' }).click();
  await dialog.getByRole('radio', { name: 'Data', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: 'Empty .byte lines to fill in' })).toBeChecked();
  await dialog.getByLabel('How many').fill('64');
  await dialog.getByLabel('Name').fill('table');
  await dialog.getByLabel('Address').fill('$3000');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect.poll(disk, { timeout: 5000 }).toContain('        * = $3000 "table"\n// @block data\ntable:\n        .byte $00, $00, $00, $00, $00, $00, $00, $00\n');
  expect(disk().match(/^ +\.byte \$00, \$00, \$00, \$00, \$00, \$00, \$00, \$00$/gm)).toHaveLength(8);
  await expect(page.locator('.scr-check')).toContainText('Ready');
  // the editor shows each block with a bar in its kind's colour
  await expect(page.locator('.scr-editor .asm-blk.g-gfx').first()).toBeVisible();
  await shot(page, '15-blocks-editor');

  // the project's views: each block what it is, the rest code (the memory map's rows by their addresses)
  const tabs = page.locator('.main-tabs');
  await tabs.getByRole('tab', { name: 'Memory' }).click();
  const side = page.locator('.sidebar');
  await side.getByRole('button', { name: 'Memory map' }).click();
  const row = (addr: string) => side.locator('.seg-row', { hasText: addr });
  await expect(row('$0840')).toContainText('spr_2000', { timeout: 15_000 });
  await expect(row('$0840').locator('i')).toHaveAttribute('style', /--g-gfx/);
  await expect(row('$1000').locator('i')).toHaveAttribute('style', /--g-music/);
  await expect(row('$3000')).toContainText('table');
  await expect(row('$3000').locator('i')).toHaveAttribute('style', /--g-data/);
  await expect(row('$080e')).toContainText('start');
  await expect(row('$080e').locator('i')).toHaveAttribute('style', /--g-code/);
  await shot(page, '14-blocks-memory');

  // undo takes the last block out again
  await tabs.getByRole('tab', { name: 'Assembler' }).click();
  await code.click();
  await page.keyboard.press('Control+z');
  await expect.poll(disk, { timeout: 5000 }).not.toContain('* = $3000');
  expect(disk()).toContain('LoadSid');
  await closeProject(page, 'blocks');
});

test.describe('from the re-assembler', () => {
  test.use({ start: 'without' });
  test('Continue in the Assembler: the re-assembled program as an Assembler project, its blocks marked, opened in the window', async ({ workDir: work, app, page }) => {
    // the demo, re-assembled: File → Continue in the Assembler…
    await expect(page.locator('.main-tabs').getByRole('tab', { name: 'Listing' })).toBeVisible();
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Continue in the Assembler…' }).click();
    const form = page.getByRole('dialog', { name: 'Continue in the Assembler' }).getByRole('form', { name: 'Continue in the Assembler' });
    await expect(form.getByRole('textbox')).toHaveValue('raster-demo-asm');
    await expect(form.getByRole('combobox', { name: 'Assembler' })).toHaveValue('kickass');
    await stubDialogs(app, { open: [work] });
    await form.getByRole('button', { name: 'Change…' }).click();
    const dir = join(work, 'raster-demo-asm');
    await expect(form).toContainText(dir);
    await expect(form).toContainText(/raster-demo\.asm the main file, which Run builds\), \d+ blocks marked/);
    await shot(page, '16-continue');
    await form.getByRole('button', { name: 'Create and open' }).click();

    // an Assembler project now, in the window: its source checked and the program the same
    const tabs = page.locator('.main-tabs');
    await expect(page.getByRole('button', { name: 'Project raster-demo-asm' })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'Assembler' })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: 'Listing' })).toHaveCount(0);
    await expect(page.locator('.scr-check')).toContainText('Ready', { timeout: 15_000 });
    expect(JSON.parse(readFileSync(join(dir, 'raster-demo-asm.mimir.json'), 'utf8')).asm).toEqual({ lang: 'kickass', main: 'raster-demo.asm' });
    const src = readFileSync(join(dir, 'raster-demo.asm'), 'utf8');
    expect(src).toContain('// @block music init=$1000 play=$1003');
    expect(src).toContain('// @block charset');
    await expect(page.getByLabel('File name')).toHaveValue('raster-demo.asm');
    await expect(page.locator('.scr-editor .asm-blk').first()).toBeVisible();

    // its blocks are what the analysis found, the rest code
    await tabs.getByRole('tab', { name: 'Memory' }).click();
    const side = page.locator('.sidebar');
    await side.getByRole('button', { name: 'Memory map' }).click();
    await expect(side.locator('.seg-row', { hasText: '$1000' }).locator('i')).toHaveAttribute('style', /--g-music/, { timeout: 15_000 });
    await expect(side.locator('.seg-row', { hasText: '$3000' }).locator('i')).toHaveAttribute('style', /--g-gfx/);
    await shot(page, '17-continued-memory');
    await closeProject(page, 'raster-demo-asm');
  });
});

test('Release and Pack in an Assembler project: the build as a disk, a tape, a cartridge or a packed PRG, started in VICE; build scripts; the Pack view packs what the Assembler builds', async ({ workDir: work, app, page }) => {
  const kickJar = (await page.evaluate(() => (window as unknown as { kr: { getSettings(): Promise<{ kickJar: string }> } }).kr.getSettings())).kickJar;
  test.skip(!kickJar || !existsSync(kickJar), 'KickAss.jar is not installed here');
  const dir = join(work, 'rel');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), 'BasicUpstart2(start)\nstart:\n  inc $d020\n  ldx #0\n!:\n  lda #1\n  sta $0400,x\n  inx\n  bne !-\n  jmp start\n');
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  // (a Windows program that ends at once stands in for VICE)
  const standIn = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe');
  await page.evaluate(v => (window as unknown as { kr: { setSettings(p: object): Promise<unknown> } }).kr.setSettings({ vicePath: v }), standIn);
  const dialog = page.getByRole('dialog', { name: 'Release' });
  const out = (f: string) => join(dir, 'out', f);

  // a disk image with the program as its first file
  await page.getByRole('button', { name: 'Release…' }).click();
  await expect(dialog.getByRole('radio', { name: /Disk image/ })).toBeChecked();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('MAIN');
  await dialog.getByLabel('Disk name').fill('my release');
  await expect(dialog).toContainText('out/main.d64');
  await shot(page, '18-release');
  await dialog.getByRole('button', { name: 'Make', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  const prg = readFileSync(out('main.prg'));
  const d64 = readFileSync(out('main.d64'));
  expect(d64.length).toBe(174848);
  expect(d64.includes(Buffer.from('MY RELEASE'))).toBe(true);
  expect(d64.includes(Buffer.from([...Buffer.from('MAIN'), 0xa0, 0xa0]))).toBe(true);
  expect(d64.includes(prg)).toBe(true);

  // a tape image, started in VICE
  await page.getByRole('button', { name: 'Release…' }).click();
  await dialog.getByRole('radio', { name: /Tape image/ }).check();
  await dialog.getByRole('button', { name: 'Make and run in VICE' }).click();
  await expect(page.locator('.toast-msg', { hasText: 'VICE started out/main.tap' })).toBeVisible({ timeout: 60_000 });
  expect(readFileSync(out('main.tap')).subarray(0, 12).toString('latin1')).toBe('C64-TAPE-RAW');

  // a cartridge
  await page.getByRole('button', { name: 'Release…' }).click();
  await dialog.getByRole('radio', { name: /Cartridge/ }).check();
  await dialog.getByRole('button', { name: 'Make', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  expect(readFileSync(out('main.crt')).subarray(0, 16).toString('latin1')).toBe('C64 CARTRIDGE   ');

  // the PRG packed with Brokkr, as the Pack view is set
  await page.getByRole('button', { name: 'Release…' }).click();
  await dialog.getByRole('radio', { name: /Program/ }).check();
  await dialog.getByRole('checkbox', { name: /Packed with Brokkr/ }).check();
  await expect(dialog).toContainText('out/main-packed.prg');
  await dialog.getByRole('button', { name: 'Make', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 120_000 });
  const packed = readFileSync(out('main-packed.prg'));
  expect([packed[0], packed[1]]).toEqual([0x01, 0x08]);
  expect(packed.equals(prg)).toBe(false);

  // build.bat and build.sh beside the main file; those there stay
  await page.getByRole('button', { name: 'Release…' }).click();
  await dialog.getByRole('button', { name: 'Build scripts' }).click();
  // (the file is there before its text is: wait for the text)
  await expect.poll(() => (existsSync(join(dir, 'build.bat')) ? readFileSync(join(dir, 'build.bat'), 'utf8') : ''), { timeout: 10_000 }).toContain('main.asm -odir out');
  await expect.poll(() => existsSync(join(dir, 'build.sh')), { timeout: 10_000 }).toBe(true);
  await page.keyboard.press('Escape');

  // the Pack view packs what the Assembler builds, its log under the Assembler's Build; a repository's .gitignore (one
  // made before Pack wrote a packed folder) leaves that out too
  writeFileSync(join(dir, '.gitignore'), "# Mimir: the Assembler's builds (Run, Build) write the program here\nout/\n");
  await page.locator('nav.activity').getByRole('button', { name: 'Pack' }).click();
  const view = page.locator('.pack-view');
  await openSection(page, 'Command');
  await expect(view).toContainText('Pack builds the main file with KickAss.jar first, as Run does.');
  await view.getByRole('button', { name: 'Pack', exact: true }).click();
  await expect(view.getByRole('status', { name: 'Packed file' })).toContainText('main', { timeout: 120_000 });
  await shot(page, '19-asm-pack');
  await page.locator('.main-tabs').getByRole('tab', { name: 'Assembler' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Build' })).toContainText('brokkr', { timeout: 10_000 });
  await expect.poll(() => readFileSync(join(dir, '.gitignore'), 'utf8'), { timeout: 5000 }).toContain('# Mimir: Pack writes the packed program here\npacked/\n');
  await closeProject(page, 'rel');
});

test('drawing in the enlarged sprite of an Assembler project changes the .byte lines that write it', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'draw');
  mkdirSync(dir);
  const rows = Array.from({ length: 21 }, () => '        .byte %00000000, %00000000, %00000000');
  writeFileSync(join(dir, 'main.asm'), ['BasicUpstart2(start)', 'start:  rts', '        * = $2000 "sprite"', '// @block sprite hires', 'ship:', ...rows, '        .byte 0', '// @end', ''].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  const disk = () => readFileSync(join(dir, 'main.asm'), 'utf8').split('\n');

  // the sprite in the inspector, by its byte in Memory
  await page.locator('.main-tabs').getByRole('tab', { name: 'Memory' }).click();
  // (the program reaches the analysis a moment after the check: until then $2000 is not loaded, and m says so)
  await expect(async () => {
    await page.getByLabel('Monitor command').fill('m 2000');
    await page.getByLabel('Monitor command').press('Enter');
    await page.getByLabel('Memory dump').locator('[data-a="8192"].mon-b').click({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  const insp = page.locator('.inspector');
  const canvas = insp.getByLabel('sprite preview');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await canvas.click();
  const zoom = insp.locator('.sprite-zoom');
  await expect(zoom).toBeVisible();
  await expect(zoom.getByRole('group', { name: 'Draw' })).toContainText('The lines that write the bytes change in the sources.');
  const px = (x: number, y: number) => zoom.locator(`.cz-grid i[data-x="${x}"][data-y="${y}"]`);

  // a click sets a pixel: row 0's first byte
  await px(0, 0).click();
  await expect.poll(() => disk()[5], { timeout: 5000 }).toBe('        .byte %10000000, %00000000, %00000000');
  await expect(toast(page, 'Drawn into main.asm line 6')).toBeVisible();
  // a drag sets a row of them: row 1's middle byte
  const box = async (x: number, y: number) => { const b = (await px(x, y).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const from = await box(8, 1), to = await box(15, 1);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let x = 9; x <= 15; x++) { const p = await box(x, 1); await page.mouse.move(p.x, p.y); }
  await page.mouse.move(to.x, to.y); await page.mouse.up();
  await expect.poll(() => disk()[6], { timeout: 5000 }).toBe('        .byte %00000000, %11111111, %00000000');
  await shot(page, '20-drawn');
  // the right button clears
  await px(0, 0).click({ button: 'right' });
  await expect.poll(() => disk()[5], { timeout: 5000 }).toBe('        .byte %00000000, %00000000, %00000000');
  // the program has the bytes drawn
  await expect(zoom.locator('.cz-bytes > div').nth(1)).toContainText('2003 00 ff 00', { timeout: 10_000 });
  await closeProject(page, 'draw');
});

test('cycles in the Assembler: each instruction\'s beside its line number, the lines chosen counted along a path, a branch marked taken', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'cyc');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), ['BasicUpstart2(start)', 'start:', '        ldx #0', '!:', '        lda $04f0,x', '        sta $d020', '        inx', '        bne !-', '        rts', ''].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  const numbers = () => page.locator('.scr-editor .line-numbers').evaluateAll(els => els.map(e => ({ top: parseFloat((e.parentElement as HTMLElement).style.top || '0'), t: (e.textContent ?? '').replace(/ /g, ' ').trim() })).sort((a, b) => a.top - b.top).map(x => x.t));

  // on: the cycles beside the line numbers
  await page.getByRole('button', { name: 'Cycles' }).click();
  await expect(page.getByRole('button', { name: 'Cycles' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(numbers).toEqual(['1', '2', '3 2', '4', '5 4+', '6 4', '7 2', '8 2/3', '9 6', '10']);
  await expect(page.getByRole('tabpanel', { name: 'Cycles' })).toContainText('Select lines in the editor');

  // lines 3-8 chosen: counted along one path
  await page.locator('.scr-editor .view-lines').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+End');
  const pane = page.getByRole('tabpanel', { name: 'Cycles' });
  await expect(pane.getByRole('status')).toHaveText('14 cycles on this path');
  await expect(pane).toContainText('main.asm lines 3-8');
  await expect(pane.getByRole('table', { name: 'Instructions' }).locator('tbody tr')).toHaveCount(5);
  await shot(page, '21-cycles');

  // the branch marked taken: the loop's one more pass, and ✓ beside its line number
  await pane.getByRole('checkbox', { name: 'Branch on line 8 taken' }).check();
  await expect(pane.getByRole('status')).toHaveText('15 cycles on this path');
  await expect(pane).toContainText('a loop: one more pass takes 13');
  await expect.poll(async () => (await numbers())[7]).toBe('8 2/3✓');

  // off: the line numbers alone
  await page.getByRole('button', { name: 'Cycles' }).click();
  await expect.poll(async () => (await numbers())[4]).toBe('5');
  await expect(page.getByRole('tab', { name: /^Cycles/ })).toHaveCount(0);
  await closeProject(page, 'cyc');
});

test('a name in the Assembler: its references in all the sources (Shift+F12), renamed in all of them (F2), the file\'s outline (Ctrl+Shift+O)', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'names');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), ['BasicUpstart2(start)', '#import "lib.asm"', 'start:  jsr copy', '        jsr copy        // copy again', '        rts', 'text:   .text "copy"', ''].join('\n'));
  writeFileSync(join(dir, 'lib.asm'), ['copy:   lda text', '        sta $0400', '        rts', ''].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  await expect(page.getByLabel('File name')).toHaveValue('main.asm');
  const disk = (f: string) => readFileSync(join(dir, f), 'utf8');
  // the caret on `copy` of line 3
  const onCopy = async () => {
    await page.locator('.scr-editor .view-lines').click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End'); await page.keyboard.press('ArrowLeft');
  };

  // its references: the two calls and the label in lib.asm, not the comment or the text
  await onCopy();
  await page.keyboard.press('Shift+F12');
  const peek = page.locator('.scr-editor .peekview-widget');
  await expect(peek).toBeVisible();
  await expect(peek).toContainText('References (3)');
  await expect(peek.locator('.monaco-list-row', { hasText: 'lib.asm' })).toContainText('1');
  await expect(peek.locator('.monaco-list-row', { hasText: 'main.asm' })).toContainText('2');
  await shot(page, '22-references');
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);

  // a new name taken already is refused, and nothing changes
  await onCopy();
  await page.keyboard.press('F2');
  const box = page.locator('.scr-editor .rename-box input');
  await expect(box).toHaveValue('copy');
  await box.fill('text');
  await box.press('Enter');
  await expect(toast(page, 'copy was not renamed: The sources have a text already')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(disk('lib.asm')).toContain('copy:');

  // renamed in both files, the comment and the text as they were; they are written, and the program is the same
  await onCopy();
  await page.keyboard.press('F2');
  await expect(box).toBeVisible();
  await box.fill('copier');
  await box.press('Enter');
  await expect.poll(() => disk('lib.asm'), { timeout: 5000 }).toContain('copier:   lda text');
  await expect.poll(() => disk('main.asm'), { timeout: 5000 }).toContain('start:  jsr copier\n        jsr copier        // copy again');
  expect(disk('main.asm')).toContain('.text "copy"');
  await expect(page.locator('.scr-check')).toContainText('Ready', { timeout: 10_000 });

  // the file's outline: the names it defines
  await page.locator('.scr-editor .view-lines').click();
  await page.keyboard.press('Control+Shift+O');
  const outline = page.locator('.quick-input-widget');
  await expect(outline).toBeVisible();
  await expect(outline.locator('.monaco-list-row')).toContainText(['start', 'text']);
  await page.keyboard.press('Escape');
  await closeProject(page, 'names');
});

test('the C64 checks of an Assembler project: sprites outside the VIC bank and under the character ROM, on their lines and under Problems', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'c64');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), ['BasicUpstart2(start)', 'start:  lda #$80', '        sta $07f8', '        rts', '        * = $4000', '// @block sprite', 'ship:   .fill 64, $ff', '// @end', '        * = $1000', '// @block sprite', 'rock:   .fill 64, $0f', '// @end', ''].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  const found = page.getByRole('list', { name: 'What the C64 check found' });
  await expect(found.getByRole('listitem')).toHaveCount(2, { timeout: 20_000 });
  await expect(found).toContainText('main.asm:11');
  await expect(found).toContainText('the VIC sees the character ROM at $1000-$1fff');
  await expect(found).toContainText('main.asm:7');
  await expect(found).toContainText('in VIC bank 1 ($4000-$7fff), but the program shows bank 0 ($0000-$3fff)');
  await expect(page.locator('#asm-tab-problems .count')).toHaveText('2');
  // on their lines in the editor
  await expect(page.locator('.scr-editor .squiggly-warning')).toHaveCount(2);
  await shot(page, '23-c64-checks');
  // a click goes to the line
  await found.getByRole('button', { name: /main\.asm:11/ }).click();
  await expect(page.locator('.scr-editor .line-numbers.active-line-number')).toHaveText('11');

  // moved where the VIC sees them, the warnings go
  writeFileSync(join(dir, 'main.asm'), ['BasicUpstart2(start)', 'start:  lda #$80', '        sta $07f8', '        rts', '        * = $2000', '// @block sprite', 'ship:   .fill 64, $ff', '// @end', ''].join('\n'));
  await expect(found).toHaveCount(0, { timeout: 20_000 });
  await closeProject(page, 'c64');
});

test('debugging in the Assembler: Memory shows the memory of the program being debugged, back to the program when it stops; Shift+F5 starts the build in Retro Debugger with the sources and the breakpoints', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'live');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), ['BasicUpstart2(start)', 'start:  lda #$41', '        sta $3000', '        rts', '        * = $3000', 'cell:   .byte 0', ''].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  const tabs = page.locator('.main-tabs'), dump = page.getByLabel('Memory dump');
  const cell = dump.locator('[data-a="12288"].mon-b');
  const live = page.locator('.gfxv-live');
  const showCell = async () => {
    await expect(async () => {
      await page.getByLabel('Monitor command').fill('m 3000');
      await page.getByLabel('Monitor command').press('Enter');
      await expect(cell).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
  };

  // Debug: stopped at the first instruction; Memory says it shows the machine's memory
  await page.getByRole('button', { name: /^Debug/ }).click();
  await expect(page.getByRole('complementary', { name: 'Debugger' })).toBeVisible();
  await tabs.getByRole('tab', { name: 'Memory' }).click();
  await expect(live).toContainText('Stopped at $080e (main.asm line 2): the memory of the program being debugged in Mimir\'s 6510');
  await showCell();
  await expect(cell).toHaveText('00');
  // two steps: the store has written, and Memory shows it
  await tabs.getByRole('tab', { name: 'Assembler' }).click();
  await page.locator('.scr-editor .view-lines').click();
  await page.keyboard.press('F8'); await page.keyboard.press('F8');
  await tabs.getByRole('tab', { name: 'Memory' }).click();
  await expect(live).toContainText('Stopped at $0813 (main.asm line 4)');
  await showCell();
  await expect(cell).toHaveText('41');
  await shot(page, '24-live-memory');
  // stopped: the program as it loads again
  await tabs.getByRole('tab', { name: 'Assembler' }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await tabs.getByRole('tab', { name: 'Memory' }).click();
  await expect(live).toHaveCount(0);
  await showCell();
  await expect(cell).toHaveText('00');

  // Shift+F5: built and started in Retro Debugger (a Windows program that ends at once stands in), with the source and
  // the breakpoint on line 3
  const kickJar = (await page.evaluate(() => (window as unknown as { kr: { getSettings(): Promise<{ kickJar: string }> } }).kr.getSettings())).kickJar;
  const standIn = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe');
  if (kickJar && existsSync(kickJar) && existsSync(standIn)) {
    await page.evaluate(v => (window as unknown as { kr: { setSettings(p: object): Promise<unknown> } }).kr.setSettings({ debugger: 'retro', retroDebuggerPath: v }), standIn);
    await tabs.getByRole('tab', { name: 'Assembler' }).click();
    const editor = page.locator('.scr-editor');
    const box = await editor.locator('.line-numbers', { hasText: /^3$/ }).boundingBox();
    const glyph = await editor.locator('.glyph-margin').boundingBox();
    await page.mouse.click(glyph!.x + glyph!.width / 2, box!.y + box!.height / 2);
    await expect(editor.locator('.scr-bp')).toHaveCount(1);
    await page.locator('.scr-editor .view-lines').click();
    await page.keyboard.press('Shift+F5');
    await expect(toast(page, /^Retro Debugger started main\.prg with 1 breakpoint, the sources beside its code/)).toBeVisible({ timeout: 60_000 });
    const dbg = readFileSync(join(dir, 'out', 'main.debugger.dbg'), 'utf8');
    expect(dbg).toContain('   <Breakpoints values="SEGMENT,ADDRESS,ARGUMENT">\n      Default,$0810,\n   </Breakpoints>');
    expect(dbg).toMatch(/\n {9}\$0810,\$0812,0,3,/);
    expect(readFileSync(join(dir, 'out', 'main.debugger.src', 'main.asm'), 'utf8').split('\n')[2]).toBe('        sta $3000');
  }
  await closeProject(page, 'live');
});

test('drawing in the Graphics tab of an Assembler project: Draw, a click and a drag on a sprite, the right button, the .byte lines that write it change', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'gdraw');
  mkdirSync(dir);
  const rows = Array.from({ length: 21 }, () => '        .byte %00000000, %00000000, %00000000');
  writeFileSync(join(dir, 'main.asm'), ['BasicUpstart2(start)', 'start:  rts', '        * = $2000 "sprite"', '// @block sprite hires', 'ship:', ...rows, '        .byte 0', '// @end', ''].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  const disk = () => readFileSync(join(dir, 'main.asm'), 'utf8').split('\n');

  // the sprite at $2000 in the Graphics tab, selected
  await page.locator('.main-tabs').getByRole('tab', { name: 'Graphics' }).click();
  await page.getByRole('group', { name: 'Show memory as' }).getByRole('button', { name: /Sprites/ }).click();
  const goTo = page.getByLabel('Go to address, label or range');
  await expect(async () => {
    await goTo.fill('$2000'); await goTo.press('Enter');
    await expect(page.locator('.gfxv-sel')).toContainText('$2000–$203f', { timeout: 2000 });
  }).toPass({ timeout: 30_000 });

  // Draw on: a click sets a pixel, a drag a row of them, the right button clears (where the sprite is, Draw on)
  await page.getByRole('group', { name: 'Draw' }).getByRole('checkbox', { name: 'Draw' }).check();
  await expect(page.locator('.gfxv-sel')).toContainText('Click or drag to draw');
  const cell = (await page.locator('.gfxv-selrect').first().boundingBox())!;
  const px = cell.width / 24;
  const at = (x: number, y: number) => ({ x: cell.x + (x + 0.5) * px, y: cell.y + (y + 0.5) * px });
  let p = at(0, 0);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => disk()[5], { timeout: 5000 }).toBe('        .byte %10000000, %00000000, %00000000');
  p = at(8, 1); await page.mouse.move(p.x, p.y); await page.mouse.down();
  for (let x = 9; x <= 15; x++) { p = at(x, 1); await page.mouse.move(p.x, p.y); }
  await page.mouse.up();
  await expect.poll(() => disk()[6], { timeout: 5000 }).toBe('        .byte %00000000, %11111111, %00000000');
  await shot(page, '25-graphics-draw');
  p = at(0, 0);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect.poll(() => disk()[5], { timeout: 5000 }).toBe('        .byte %00000000, %00000000, %00000000');
  await closeProject(page, 'gdraw');
});

test('macros and segments in an Assembler project: Mimir\'s check runs them, says what file the program is and which segment no file has, and Build takes the file a .file writes', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'segs');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), [
    '.file [name="game.prg", segments="Code,Data"]',
    '.segmentdef Code [start=$0801]',
    '.segmentdef Data [startAfter="Code"]',
    '.segment Code',
    'BasicUpstart2(start)',
    'start:  Border(2)',
    '        Border(colors - start)',
    '        rts',
    '.segment Data',
    'colors: .byte 1, 2, 3',
    '.segment Extra [start=$c000]',
    '        .byte 9',
    '.macro Border(c) {',
    '        lda #c',
    '        sta $d020',
    '}',
    '',
  ].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  // the check runs the macro and puts the segments together as the .file says
  await expect(page.locator('.scr-check')).toContainText('Ready');
  await page.locator('#asm-tab-problems').click();
  const problems = page.getByRole('tabpanel', { name: 'Problems' });
  await expect(problems).toContainText('(game.prg, which the sources\' segments write)');
  await expect(problems).toContainText('a run starts at $080e (the SYS of its BASIC line)');
  // a segment that no file has: a warning on its line and in the list
  const warned = page.getByRole('list', { name: 'What the check warns of' });
  await expect(warned.getByRole('listitem')).toHaveCount(1);
  await expect(warned).toContainText('main.asm:11');
  await expect(warned).toContainText("The segment 'Extra' is in no file");
  await expect(page.locator('.scr-editor .squiggly-warning')).toHaveCount(1);
  await shot(page, '26-macros-segments');
  // Build: the program is the .file's game.prg, as the check said
  const kickJar = (await page.evaluate(() => (window as unknown as { kr: { getSettings(): Promise<{ kickJar: string }> } }).kr.getSettings())).kickJar;
  if (kickJar && existsSync(kickJar)) {
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await expect(page.locator('.scr-run-stat')).toContainText('Built game.prg', { timeout: 60_000 });
    const prg = readFileSync(join(dir, 'out', 'game.prg'));
    expect([...prg.subarray(0, 2)]).toEqual([0x01, 0x08]);
    expect(existsSync(join(dir, 'out', 'main.prg'))).toBe(false);
  }
  await closeProject(page, 'segs');
});

test('a disk in an Assembler project: Mimir\'s check makes the .disk as Kick Assembler does, its first program is the program, and Build and Run take the disk', async ({ workDir: work, app, page }) => {
  const kickJar = (await page.evaluate(() => (window as unknown as { kr: { getSettings(): Promise<{ kickJar: string }> } }).kr.getSettings())).kickJar;
  test.skip(!kickJar || !existsSync(kickJar), 'KickAss.jar is not installed here');
  const dir = join(work, 'disk');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), [
    '.disk [filename="game.d64", name="MY GAME", id="2025!"] {',
    '  [name="----------------", type="rel"],',
    '  [name="GAME", type="prg", segments="Code"],',
    '}',
    '.segment Code [start=$0810, modify="BasicUpstart", _start=start]',
    'start:  inc $d020',
    '        jmp start',
    '',
  ].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  await page.locator('#asm-tab-problems').click();
  const problems = page.getByRole('tabpanel', { name: 'Problems' });
  await expect(problems).toContainText('(the first program on game.d64, the disk the sources\' .disk writes)');
  await expect(problems).toContainText('a run starts at $0810 (the SYS of its BASIC line)');
  // (where.exe stands in for VICE)
  const standIn = join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'where.exe');
  await page.evaluate(v => (window as unknown as { kr: { setSettings(p: object): Promise<unknown> } }).kr.setSettings({ vicePath: v }), standIn);
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.locator('.scr-run-stat')).toContainText('Built game.d64', { timeout: 60_000 });
  const d64 = readFileSync(join(dir, 'out', 'game.d64'));
  expect(d64.length).toBe(174848);
  expect(d64.subarray(0x16590, 0x16597).toString('latin1')).toBe('MY GAME');
  await page.locator('.scr-editor .view-lines').click();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.toast-msg', { hasText: 'VICE started game.d64' })).toBeVisible({ timeout: 60_000 });
  await shot(page, '27-asm-disk');
  await closeProject(page, 'disk');
});

test('64tass in an Assembler project: Mimir\'s check runs its loops, macros and functions as 64tass does, and Build gives the same program', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'tassloops');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), [
    '        * = $0801',
    '        .word (+), 2025',
    '        .null $9e, format("%4d", start)',
    '+       .word 0',
    'border  .function c',
    '        lda #c',
    '        sta $d020',
    '        .endf',
    'start   border 2',
    '        ldx #0',
    '        lda #32',
    '        .for p := $400, p < $800, p += $100',
    '        sta p,x',
    '        .next',
    '        rts',
    'rows    .byte <($0400 + range(0, 1000, 40))',
    '',
  ].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  await page.locator('#asm-tab-problems').click();
  const problems = page.getByRole('tabpanel', { name: 'Problems' });
  await expect(problems).toContainText('The program assembles: 59 bytes');
  await expect(problems).toContainText('a run starts at $080d (the SYS of its BASIC line)');
  await shot(page, '28-asm-64tass-loops');
  // the real 64tass (the one Mimir has, or one in C:\C64) builds the same bytes
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.locator('.scr-run-stat')).toContainText('Built main.prg', { timeout: 60_000 });
  const prg = readFileSync(join(dir, 'out', 'main.prg'));
  expect(prg.length).toBe(2 + 59);
  expect([...prg.subarray(2, 6)]).toEqual([0x0b, 0x08, 0xe9, 0x07]);
  await closeProject(page, 'tassloops');
});

test('Release says when the program has no BASIC line: a disk, a tape or a PRG would not start it, a cartridge or a packed file would', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'nobasic');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), '* = $1000\nstart:  inc $d020\n        jmp start\n');
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  await page.getByRole('button', { name: 'Release…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Release' });
  const note = dialog.getByRole('note');
  await expect(note).toContainText('The program has no BASIC line that starts it');
  await expect(note).toContainText('a disk');
  await shot(page, '29-release-no-basic');
  await dialog.getByRole('radio', { name: /Cartridge/ }).check();
  await expect(note).toHaveCount(0);
  await dialog.getByRole('radio', { name: /Tape image/ }).check();
  await expect(note).toContainText('a tape');
  await dialog.getByRole('checkbox', { name: /Packed with/ }).check();
  await expect(note).toHaveCount(0);
  await page.keyboard.press('Escape');
  await closeProject(page, 'nobasic');
});

test('files dropped on an Assembler project are copied into its folder: on a folder of the file list into it, else by kind; nothing written over', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'dropped');
  mkdirSync(join(dir, 'gfx'), { recursive: true });
  writeFileSync(join(dir, 'main.asm'), 'BasicUpstart2(start)\nstart:  rts\n');
  writeFileSync(join(dir, 'gfx', 'logo.bin'), Buffer.from([1, 2, 3]));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  /** files dropped on what `target` finds (a DragEvent with them, as the system gives it) */
  const drop = async (target: string, files: { name: string; bytes: number[] }[]) => {
    const dt = await page.evaluateHandle(fs => { const d = new DataTransfer(); for (const f of fs) d.items.add(new File([new Uint8Array(f.bytes)], f.name)); return d; }, files);
    await page.locator(target).first().dispatchEvent('drop', { dataTransfer: dt });
  };
  const sid = { name: 'tune.sid', bytes: [0x50, 0x53, 0x49, 0x44, 9, 9] };
  // on the code: by kind (a SID in music, data in data, a source beside the main file, which opens in a tab)
  await drop('.scr-editor', [sid, { name: 'table.bin', bytes: [7, 7, 7] }, { name: 'extra.asm', bytes: [...Buffer.from('.const EXTRA = 1\n')] }]);
  await expect(page.locator('.toast-msg', { hasText: 'Copied 3 files (music/tune.sid, data/table.bin, extra.asm)' })).toBeVisible();
  await expect.poll(() => existsSync(join(dir, 'music', 'tune.sid')) && existsSync(join(dir, 'data', 'table.bin')) && existsSync(join(dir, 'extra.asm'))).toBe(true);
  expect([...readFileSync(join(dir, 'data', 'table.bin'))]).toEqual([7, 7, 7]);
  await expect(page.locator('.asm-tabs').getByRole('tab', { name: 'extra.asm' })).toBeVisible();
  await expect(tree(page).getByRole('treeitem', { name: 'music' })).toBeVisible();
  // the same name again: a new one beside it
  await drop('.scr-editor', [sid]);
  await expect.poll(() => existsSync(join(dir, 'music', 'tune-2.sid'))).toBe(true);
  expect([...readFileSync(join(dir, 'music', 'tune.sid'))]).toEqual(sid.bytes);
  // on a folder in the file list: into it (dragged over it, it is marked and the banner says where files go)
  const over = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File([new Uint8Array([4, 5])], 'pic.bin')); return d; });
  await page.locator('[role="treeitem"][data-path="gfx"]').dispatchEvent('dragover', { dataTransfer: over });
  await expect(page.locator('[role="treeitem"][data-path="gfx"]')).toHaveClass(/drop-into/);
  await expect(page.locator('.drop.asm-drop')).toContainText('Drop files to copy them into the project\'s folder');
  await shot(page, '31-asm-drop-over');
  await drop('[role="treeitem"][data-path="gfx"]', [{ name: 'pic.bin', bytes: [4, 5] }]);
  await expect(page.locator('[role="treeitem"][data-path="gfx"]')).not.toHaveClass(/drop-into/);
  await expect(page.locator('.drop.asm-drop')).toHaveCount(0);
  await expect.poll(() => existsSync(join(dir, 'gfx', 'pic.bin'))).toBe(true);
  await shot(page, '30-asm-dropped');
  await closeProject(page, 'dropped');
});

test('the Assembler project\'s settings: its button opens them in Settings, -define DEBUG there is the check\'s and the build\'s, the main file and where Debug runs', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'defines');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), [
    'BasicUpstart2(start)',
    'start:',
    '#if DEBUG',
    '        inc $d020',
    '        jmp start',
    '#endif',
    '        rts',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'tables.asm'), '.byte 1, 2, 3\n');
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  await page.locator('#asm-tab-problems').click();
  const problems = page.getByRole('tabpanel', { name: 'Problems' });
  await expect(problems).toContainText('The program assembles: 13 bytes');
  // the Assembler's settings button: Settings at the project's page, no Analysis or Assembler output (a re-assembled program's)
  await page.getByRole('button', { name: 'Assembler project settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('tab', { name: 'Assembler project' })).toHaveAttribute('aria-selected', 'true');
  await expect(settings.getByRole('tab', { name: 'Analysis' })).toHaveCount(0);
  await expect(settings.getByRole('tab', { name: 'Assembler output' })).toHaveCount(0);
  await expect(settings.locator('#set-asmLang')).toHaveValue('kickass');
  await expect(settings.locator('#set-asmMain option')).toHaveText(['main.asm (found)', 'main.asm', 'tables.asm']);
  await expect(settings.locator('#set-asmArgs-help')).toContainText('-define DEBUG');
  await settings.locator('#set-asmArgs').fill('-define DEBUG');
  await settings.locator('#set-asmMachine').selectOption('c64');
  await shot(page, '31-asm-settings');
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(settings).toBeHidden();
  // the check takes the define: the #if DEBUG lines are in the program
  await expect(problems).toContainText('The program assembles: 19 bytes');
  await expect(page.locator('select.asm-machine')).toHaveValue('c64');
  await expect(page.getByRole('button', { name: 'Assembler project settings' })).toHaveAttribute('title', /now -define DEBUG/);
  // Build gives KickAss.jar the argument after the toolchain's: the same program
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.locator('.scr-run-stat')).toContainText('Built main.prg', { timeout: 60_000 });
  const prg = readFileSync(join(dir, 'out', 'main.prg'));
  // (BasicUpstart2 puts the code at $080e)
  expect(prg.length).toBe(2 + 20);
  expect([...prg.subarray(2 + 13)]).toEqual([0xee, 0x20, 0xd0, 0x4c, 0x0e, 0x08, 0x60]);
  // kept in the project file
  await expect.poll(() => JSON.parse(readFileSync(join(dir, 'defines.mimir.json'), 'utf8')).asm).toEqual({ lang: 'kickass', args: '-define DEBUG' });
  // the palette opens the page too; the main file picked there is the one Run builds, none: found again
  await page.keyboard.press('Control+Shift+P');
  const q = page.getByRole('textbox', { name: 'Command' });
  await q.fill('Assembler project settings');
  await q.press('Enter');
  await expect(settings.getByRole('tab', { name: 'Assembler project' })).toHaveAttribute('aria-selected', 'true');
  await expect(settings.locator('#set-asmArgs')).toHaveValue('-define DEBUG');
  await expect(settings.locator('#set-asmMachine')).toHaveValue('c64');
  await settings.locator('#set-asmArgs').fill('');
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(problems).toContainText('The program assembles: 13 bytes');
  await expect.poll(() => JSON.parse(readFileSync(join(dir, 'defines.mimir.json'), 'utf8')).asm).toEqual({ lang: 'kickass' });
  await closeProject(page, 'defines');
});

test('the 65816 in an Assembler project in 64tass: Mimir\'s check writes its instructions as 64tass does, says they need a SuperCPU, Debug waits, Build gives the same program', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'scpu');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), [
    '        * = $0801',
    '        .word (+), 2026',
    '        .null $9e, format("%4d", start)',
    '+       .word 0',
    '        .cpu "65816"',
    '        .autsiz',
    'start   clc',
    '        xce',
    '        rep #$30',
    '        lda #$1234',
    '        sta $d020',
    '        lda $123456,x',
    '        sep #$30',
    '        lda #random(256)',
    '        sec',
    '        xce',
    '        rts',
    '',
  ].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  await page.locator('#asm-tab-problems').click();
  const problems = page.getByRole('tabpanel', { name: 'Problems' });
  // 12 bytes of BASIC line, then 1+1+2+3+3+4+2+2+1+1+1
  await expect(problems).toContainText('The program assembles: 33 bytes');
  await expect(problems).toContainText('SuperCPU');
  const debug = page.locator('.scr-debug-btn');
  await expect(debug).toBeDisabled();
  await expect(debug).toHaveAttribute('title', /written for the 65816/);
  await shot(page, '32-asm-65816');
  // the real 64tass builds the same bytes
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.locator('.scr-run-stat')).toContainText('Built main.prg', { timeout: 60_000 });
  const prg = readFileSync(join(dir, 'out', 'main.prg'));
  expect([...prg.subarray(2 + 12)]).toEqual([0x18, 0xfb, 0xc2, 0x30, 0xa9, 0x34, 0x12, 0x8d, 0x20, 0xd0, 0xbf, 0x56, 0x34, 0x12, 0xe2, 0x30, 0xa9, 0x2d, 0x38, 0xfb, 0x60]);
  await closeProject(page, 'scpu');
});

test('bookmarks in an Assembler project, as in the re-assembler: on lines of the sources, Ctrl+F2 adds or edits, an area, they move with their lines, Alt+F2 goes from one to the next, a file renamed takes its own along, kept in the project file', async ({ workDir: work, app, page }) => {
  const dir = join(work, 'marks');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), ['BasicUpstart2(start)', '', 'start:', '        inc $d020', 'loop:   jmp loop', ''].join('\n'));
  writeFileSync(join(dir, 'code.asm'), ['irq:    rti', ''].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.locator('.scr-check')).toContainText('Ready');
  const line = (n: number) => page.locator('.scr-editor .view-line').nth(n - 1);
  const list = page.getByRole('list', { name: 'Bookmarks' });
  const saved = () => Object.values<{ file: string; line: number; end?: number; title: string }>(JSON.parse(readFileSync(join(dir, 'marks.mimir.json'), 'utf8')).asm.bookmarks ?? {})
    .map(b => `${b.file}:${b.line}${b.end ? `-${b.end}` : ''} ${b.title}`).sort();
  // Ctrl+F2 on a line: the editor in the Bookmarks view, the label there its title
  await line(5).click();
  await page.keyboard.press('Control+F2');
  const add = page.getByRole('form', { name: 'Add bookmark' });
  await expect(add.getByLabel('Title')).toHaveValue('loop');
  await expect(add.getByLabel('Line', { exact: true })).toHaveValue('5');
  await add.getByLabel('Note').fill('the main loop');
  await add.getByRole('button', { name: 'Teal' }).click();
  await add.getByRole('button', { name: 'Save' }).click();
  await expect(list.getByRole('button', { name: /main\.asm:5\s*loop/ })).toBeVisible();
  await expect(page.locator('.scr-editor .asm-bm-mark.asm-bmc-teal')).toHaveCount(1);
  // lines selected: a bookmark on the area
  await line(3).click();
  await line(4).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Control+F2');
  await expect(add.getByLabel('Last line')).toHaveValue('4');
  await expect(add.getByLabel('Title')).toHaveValue('start');
  await add.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.scr-editor .asm-bm-stripe')).toHaveCount(2);
  await expect.poll(saved).toEqual(['main.asm:3-4 start', 'main.asm:5 loop']);
  // two lines typed above them: they move with their lines, and the project file says where
  await line(1).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(saved).toEqual(['main.asm:5-6 start', 'main.asm:7 loop']);
  await expect(list.getByRole('button', { name: /main\.asm:7\s*loop/ })).toBeVisible();
  await shot(page, '33-asm-bookmarks');
  // Alt+F2 / Alt+Shift+F2: the next and the one before, round
  await line(1).click();
  await page.keyboard.press('Alt+F2');
  await expect(toast(page, 'Bookmark main.asm:5–6: start')).toBeVisible();
  await page.keyboard.press('Alt+F2');
  await expect(toast(page, 'Bookmark main.asm:7: loop')).toBeVisible();
  await page.keyboard.press('Alt+Shift+F2');
  await expect(toast(page, 'Bookmark main.asm:5–6: start').last()).toBeVisible();
  // a click on a bookmark's mark: its note in the list
  await page.locator('.scr-editor .asm-bm-mark.asm-bmc-teal').click();
  await expect(list.getByRole('button', { name: /main\.asm:7\s*loop/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(list).toContainText('the main loop');
  // one in another file, which is renamed: it follows the file
  await tree(page).getByRole('treeitem', { name: 'code.asm' }).click();
  await line(1).click();
  await page.keyboard.press('Control+F2');
  await expect(add.getByLabel('Title')).toHaveValue('irq');
  await add.getByRole('button', { name: 'Save' }).click();
  await tree(page).getByRole('treeitem', { name: 'code.asm' }).getByRole('button', { name: 'More for code.asm' }).click({ force: true });
  await page.getByRole('menuitem', { name: /^Rename/ }).click();
  await tree(page).getByLabel('New name of code.asm').fill('irq.asm');
  await tree(page).getByLabel('New name of code.asm').press('Enter');
  await expect(list.getByRole('button', { name: /irq\.asm:1\s*irq/ })).toBeVisible();
  await expect.poll(saved).toEqual(['irq.asm:1 irq', 'main.asm:5-6 start', 'main.asm:7 loop']);
  // removed, and back with Undo
  // (the one saved last is open in the list)
  await list.getByRole('button', { name: 'Delete bookmark irq.asm:1' }).click();
  await expect.poll(saved).toEqual(['main.asm:5-6 start', 'main.asm:7 loop']);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(saved).toEqual(['irq.asm:1 irq', 'main.asm:5-6 start', 'main.asm:7 loop']);
  await closeProject(page, 'marks');
});

test('macros imported from outside the project\'s folder: by a path of their own and from a library folder of the arguments (-libdir), checked as the build does, read again when the window comes back', async ({ workDir: work, app, page }) => {
  mkdirSync(join(work, 'extlib'));
  mkdirSync(join(work, 'lib2'));
  const lib = join(work, 'extlib', 'macros.asm');
  writeFileSync(lib, '.macro Border(c) {lda#c;sta$d020}\n');
  writeFileSync(join(work, 'lib2', 'more.asm'), '.macro Back(c) { lda #c; sta $d021 }\n');
  const dir = join(work, 'outside');
  mkdirSync(dir);
  writeFileSync(join(dir, 'main.asm'), [`#import "${lib}"`, '#import "more.asm"', '.pc = $0801 "Basic Upstart"', 'BasicUpstart(start)', '.pc = $0810 "Main"', 'start:  Border(2)', '        Back(0)', '        rts', ''].join('\n'));
  await page.getByRole('button', { name: 'Assembler…' }).click();
  await stubDialogs(app, { open: [dir] });
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await page.locator('#asm-tab-problems').click();
  const problems = page.getByRole('tabpanel', { name: 'Problems' });
  // the library by its own path is read; more.asm is in no folder the check knows yet
  await expect(problems).toContainText('Can\'t open file "more.asm"');
  await expect(problems).not.toContainText('macros.asm');
  // -libdir in the project's arguments: the check looks there as Kick Assembler does
  await page.getByRole('button', { name: 'Assembler project settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.locator('#set-asmArgs').fill('-libdir ../lib2');
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(problems).toContainText('The program assembles: 23 bytes');
  await shot(page, '34-asm-outside');
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.locator('.scr-run-stat')).toContainText('Built main.prg', { timeout: 60_000 });
  expect([...readFileSync(join(dir, 'out', 'main.prg')).subarray(2 + 15)]).toEqual([0xa9, 2, 0x8d, 0x20, 0xd0, 0xa9, 0, 0x8d, 0x21, 0xd0, 0x60]);
  // the library changed in another editor: read again when the window comes back
  writeFileSync(lib, '.macro Border(c) {lda#c;sta$d020;nop}\n');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(problems).toContainText('The program assembles: 24 bytes');
  // F12 on a macro: its file from outside the folder, read only in a tab of its own
  await page.locator('.scr-editor .view-line').nth(5).getByText('Border').click();
  await page.keyboard.press('F12');
  const libTab = page.getByRole('tab', { name: 'macros.asm' });
  await expect(libTab).toHaveAttribute('aria-selected', 'true');
  await expect(libTab).toHaveClass(/outside/);
  await expect(page.locator('.asm-outside-name')).toContainText('read only');
  await expect.poll(() => editorText(page)).toContain('.macro Border(c)');
  await shot(page, '35-asm-outside-read-only');
  // nothing typed goes in, nothing is written; bookmarks are the project's own files'
  await page.keyboard.type('xyz');
  await expect.poll(() => editorText(page)).not.toContain('xyz');
  expect(readFileSync(lib, 'utf8')).toBe('.macro Border(c) {lda#c;sta$d020;nop}\n');
  await page.keyboard.press('Control+F2');
  await expect(toast(page, 'bookmarks are on the project\'s own files')).toBeVisible();
  // a problem in it: the click shows it there, at its line
  writeFileSync(lib, '.macro Border(c) {lda#c;sta$d020;nop}\n.byte nothere\n');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('tab', { name: 'main.asm' }).click();
  await problems.getByRole('button', { name: /nothere/ }).click();
  await expect(libTab).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => editorText(page)).toContain('.byte nothere');
  await closeProject(page, 'outside');
});
