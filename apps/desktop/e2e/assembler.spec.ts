/* The Assembler (spec 10.7): an Assembler project, made or opened from the start screen's Assembler page, is a folder of
 * sources opened in the project window, its files listed beside the code in the Assembler tab; the code is checked as it
 * is typed and written to its file; Debug runs the program in Mimir's 6510; Run builds it with KickAss.jar and starts it
 * in VICE (where.exe stands in for VICE); Graphics, Memory and the Explorer show the program the sources make. The
 * folders are the test's own. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { stubDialogs } from './helpers';

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
