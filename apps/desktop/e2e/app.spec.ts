/* End-to-end flows in the real Electron app (spec 16 "UI"): the demo listing, rename (N), mark as
 * bytes (D), verify (F7), undo/redo, selecting large ranges (G with a range, Shift+click on headers,
 * dragging) that merge the blocks inside, and open/save/export with Electron's file dialogs stubbed.
 * Build & Run (F5) is not covered: it starts VICE. */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { expect, repoDir, test } from './fixtures';
import { dialogOptions, fromFileMenu, fromSubmenu, goTo, expectFiles, headerRow, listing, listingRows, occurrences, openSection, statusBar, stubDialogs, toast, waitForListing, type ListingRow } from './helpers';

const OLD = 'var_092d';
const NEW = 'sine_pos';

test('shows the analysed demo listing', async ({ app, page }) => {
  expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged), 'packaged app').toBe(!!process.env.MIMIR_E2E_EXE);
  await expect(page).toHaveTitle('Mimir Studio');
  await waitForListing(page);
  await expect(page.locator('.welcome')).toContainText('raster-demo.prg is analysed');
  // the cursor starts on the entry point
  await expect(statusBar(page)).toContainText('$0810 · start · Code');
  await expect(statusBar(page)).toContainText('round-trip not verified');

  const rows = await listingRows(page);
  const text = rows.map(r => r.text).join('\n');
  expect(text).toContain('BasicUpstart2(start)');
  expect(text).toContain('jsr sub_0866');
  expect(text).toContain('.text "MIMIR STUDIO DEMO    "');
  expect(rows.filter(r => r.hdr).length).toBeGreaterThan(10);
});

test('rename, mark as bytes, verify, undo and redo', async ({ page }) => {
  await waitForListing(page);
  const refs = occurrences(await listingRows(page), OLD);
  // block header, label definition, `ldx var_092d` and `inc var_092d`
  expect(refs).toBeGreaterThanOrEqual(4);

  await test.step('N renames a label and every reference', async () => {
    await goTo(page, OLD);
    await expect(statusBar(page)).toContainText(`$092d · ${OLD}`);
    await page.keyboard.press('n');
    const input = page.getByLabel('Label at $092d');
    await expect(input).toHaveValue(OLD);
    await input.fill(NEW);
    await input.press('Enter');
    await expect(input).toBeHidden();
    await expect(toast(page, `Renamed to ${NEW}; all references updated`)).toBeVisible();
    await expect(statusBar(page)).toContainText(`$092d · ${NEW}`);

    const rows = await listingRows(page);
    expect(occurrences(rows, OLD)).toBe(0);
    expect(occurrences(rows, NEW)).toBe(refs);

    // X: the cross-reference panel lists the referencing instructions with the new name
    await page.keyboard.press('x');
    const xref = page.locator('.xref');
    await expect(xref.locator('.xref-head')).toContainText(`References to ${NEW}`);
    const instructions = xref.locator('tbody tr td:nth-child(3)');
    await expect(instructions).toHaveText([`ldx ${NEW}`, `inc ${NEW}`]);
  });

  await test.step('Shift+Down selects a range and D marks it as bytes', async () => {
    // fx_091e is a jump-table routine: lda SID_OSC3 / and #$0f / sta COLOR_RAM+999 / rts
    await goTo(page, 'fx_091e');
    expect(rowAt(await listingRows(page), '091e')?.text).toMatch(/^lda SID_OSC3/);
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowDown');
    await expect(statusBar(page)).toContainText('sel $091e–$0925 (8 B)');
    await page.keyboard.press('d');
    await expect(toast(page, '$091e–$0925 marked as Bytes (.byte)')).toBeVisible();
    await expect(userHeader(page, '091e')).toBeVisible();

    const rows = await listingRows(page);
    expect(headerAt(rows, '091e')).toMatchObject({ chip: 'Data', user: true });
    expect(rowAt(rows, '091e')?.text).toMatch(/^\.byte \$ad, \$1b, \$d4, \$29, \$0f/);
  });

  await test.step('F7 verifies the round-trip', async () => {
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
    await expect(toast(page, 'Round-trip verified')).toBeVisible();
    const build = page.locator('.bottom .build');
    await expect(build).toContainText('built-in verifier: byte-identical');
    await expect(build).toContainText('Round-trip OK: 12287 / 12287 bytes identical to raster-demo.prg');
    await expect(build).not.toContainText('FAILED');
    const withKick = (await statusBar(page).textContent())?.includes('with KickAss.jar');
    test.info().annotations.push({ type: 'verifier', description: withKick ? 'built-in assembler and KickAss.jar' : 'built-in assembler only (KickAss.jar not configured)' });
  });

  await test.step('Ctrl+Z undoes the mark, then the rename', async () => {
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    const redo = page.getByRole('button', { name: 'Redo', exact: true });
    const markLabel = 'Undo: Mark $091e-$0925 as Bytes (.byte) (Ctrl+Z)';
    await expect(undo).toHaveAttribute('title', markLabel);
    await expect(redo).toBeDisabled();

    await page.keyboard.press('Control+z');
    await expect(undo).toHaveAttribute('title', `Undo: Rename $092d to ${NEW} (Ctrl+Z)`);
    await expect(userHeader(page, '091e')).toHaveCount(0);
    // the verification belongs to the edited output, so it is stale now
    await expect(statusBar(page)).toContainText('round-trip not verified');

    await page.keyboard.press('Control+z');
    await expect(undo).toHaveAttribute('title', 'Nothing to undo');
    await expect(redo).toBeEnabled();
    let rows = await listingRows(page);
    expect(occurrences(rows, NEW)).toBe(0);
    expect(occurrences(rows, OLD)).toBe(refs);
    expect(headerAt(rows, '091e')).toMatchObject({ chip: 'Code', user: false });
    expect(rowAt(rows, '091e')?.text).toMatch(/^lda SID_OSC3/);

    await test.step('Ctrl+Y redoes both', async () => {
      await page.keyboard.press('Control+y');
      await expect(undo).toHaveAttribute('title', `Undo: Rename $092d to ${NEW} (Ctrl+Z)`);
      await page.keyboard.press('Control+y');
      await expect(undo).toHaveAttribute('title', markLabel);
      await expect(redo).toBeDisabled();
      rows = await listingRows(page);
      expect(occurrences(rows, OLD)).toBe(0);
      expect(occurrences(rows, NEW)).toBe(refs);
      expect(headerAt(rows, '091e')).toMatchObject({ chip: 'Data', user: true });
      // the output is the verified one again
      await expect(statusBar(page)).toContainText('✓ round-trip verified');
    });
  });
});

test('select large ranges and merge the blocks inside them into one', async ({ page }) => {
  await waitForListing(page);
  const headersIn = (rows: ListingRow[], from: number, to: number) => rows.filter(r => r.hdr && parseInt(r.adr, 16) >= from && parseInt(r.adr, 16) < to);

  await test.step('G with a range selects it, and marking merges the blocks inside', async () => {
    // two blocks whose type the user set, inside $0939-$0ab4
    await goTo(page, '$0949-$0950');
    await expect(statusBar(page)).toContainText('sel $0949–$0950 (8 B)');
    await page.keyboard.press('d');
    await expect(headerRow(page, '0949').locator('.hdr-user')).toBeVisible();
    await goTo(page, '$0960-$096f');
    await page.keyboard.press('w');
    await expect(headerRow(page, '0960').locator('.hdr-user')).toBeVisible();
    const before = headersIn(await listingRows(page), 0x0939, 0x0ab5);
    expect(before.length).toBeGreaterThan(4);

    await goTo(page, 'colors_0939-$0ab4');
    await expect(statusBar(page)).toContainText('sel $0939–$0ab4 (380 B)');
    await page.keyboard.press('d');
    await expect(toast(page, `$0939–$0ab4 marked as Bytes (.byte), merging ${before.length} blocks into one`)).toBeVisible();
    await expect(headerRow(page, '0960')).toHaveCount(0);
    const after = headersIn(await listingRows(page), 0x0939, 0x0ab5);
    expect(after).toEqual([expect.objectContaining({ adr: '0939', chip: 'Data', user: true })]);
    expect(after[0].text).toContain('$0939-$0ab4 (380 bytes)');

    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('Shift+click on block headers selects whole blocks', async () => {
    await page.keyboard.press('Control+z');
    // the listing is virtualized: collapse the build panel so every header used below is on screen
    await page.keyboard.press('Control+j');
    await expect(page.locator('section.bottom')).toHaveClass(/collapsed/);
    await goTo(page, '$0951');
    await headerRow(page, '0949').click();
    await expect(statusBar(page)).toContainText('sel $0949–$0950 (8 B)');
    await headerRow(page, '0970').click({ modifiers: ['Shift'] });
    await expect(statusBar(page)).toContainText('sel $0949–$0984 (60 B)');
    for (const adr of ['0949', '0951', '0960', '0970']) await expect(headerRow(page, adr)).toHaveClass(/\bsel\b/);
  });

  await test.step('dragging from one block header to another selects both blocks and everything between', async () => {
    await headerRow(page, '0951').evaluate(el => el.scrollIntoView({ block: 'center' }));
    const from = (await headerRow(page, '0949').boundingBox())!, to = (await headerRow(page, '0960').boundingBox())!;
    await page.mouse.move(from.x + 60, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(statusBar(page)).toContainText('sel $0949–$096f (39 B)');
    await page.keyboard.press('t');
    // Auto merge: the PETSCII text that starts where the selection ends joins it
    await expect(toast(page, '$0949–$096f marked as Text (PETSCII) and merged with the Text (PETSCII) block after it: one block $0949–$0984 (4 blocks)')).toBeVisible();
    expect(headersIn(await listingRows(page), 0x0949, 0x0985)).toEqual([expect.objectContaining({ adr: '0949', chip: 'Text', user: true })]);
  });

  await test.step('dragging past the bottom edge scrolls the listing and keeps extending the selection', async () => {
    const list = (await listing(page).boundingBox())!, from = (await headerRow(page, '0949').boundingBox())!;
    await page.mouse.move(from.x + 60, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, list.y + list.height + 12, { steps: 4 });
    // far below what was on screen: past $0a00
    await expect(statusBar(page)).toContainText(/sel \$0949–\$(0[a-f]|[1-9a-f][0-9a-f])[0-9a-f]{2}/);
    await page.mouse.up();
  });
});

test('a text block can be set to .byte with D or the inspector', async ({ page }) => {
  await waitForListing(page);
  const bodyRows = (rows: ListingRow[], from: number, to: number) => rows.filter(r => !r.hdr && r.adr && parseInt(r.adr, 16) >= from && parseInt(r.adr, 16) < to && !r.text.endsWith(':'));
  const expectBytes = async () => {
    const rows = await listingRows(page);
    expect(headerAt(rows, '0960')).toMatchObject({ chip: 'Data', user: true });
    const body = bodyRows(rows, 0x0960, 0x0985);
    expect(body.length).toBeGreaterThan(0);
    for (const r of body) expect(r.text).toMatch(/^\.byte \$/);
  };
  await goTo(page, 'txt_0960');
  const rows = await listingRows(page);
  expect(headerAt(rows, '0960')).toMatchObject({ chip: 'Text', user: false });
  expect(rowAt(rows, '0960')?.text).toMatch(/^\.text "/);

  await test.step('D', async () => {
    await page.keyboard.press('d');
    await expect(toast(page, '$0960–$0984 marked as Bytes (.byte)')).toBeVisible();
    await expectBytes();
  });

  await test.step('Type → Bytes (.byte) in the inspector', async () => {
    await page.keyboard.press('Control+z');
    await expect(userHeader(page, '0960')).toHaveCount(0);
    const type = page.locator('.inspector').getByLabel('Type');
    await expect(type).toHaveValue('text');
    await type.selectOption('bytes');
    await expect(userHeader(page, '0960')).toBeVisible();
    await expect(type).toHaveValue('bytes');
    await expectBytes();
  });
});

test('insert a comment line and a comment block, edit and remove them', async ({ page }) => {
  await waitForListing(page);
  /** the source text of the rows right before the row with text `before` */
  const above = async (before: string, n: number) => { const rows = await listingRows(page); const i = rows.findIndex(r => r.text === before); return rows.slice(Math.max(0, i - n), i).map(r => r.text); };
  const commentRow = (text: string) => listing(page).locator('.row.k-cmt', { hasText: text });

  await test.step('/ inserts a comment line above the cursor line and its label', async () => {
    await goTo(page, 'start');
    await page.keyboard.press('/');
    const input = page.getByLabel('Comment line above $0810');
    await input.fill('set up the raster IRQ');
    await input.press('Enter');
    await expect(input).toBeHidden();
    await expect(commentRow('// set up the raster IRQ')).toBeVisible();
    expect(await above('start:', 1)).toEqual(['// set up the raster IRQ']);
  });

  await test.step('* inserts a comment block', async () => {
    await goTo(page, 'sine_09b5');
    await page.keyboard.press('*');
    const area = page.getByLabel('Comment block above $09b5');
    await area.fill('curve for the\nsprite x position');
    await area.press('Control+Enter');
    await expect(area).toBeHidden();
    expect(await above('sine_09b5:', 4)).toEqual(['/*', 'curve for the', 'sprite x position', '*/']);
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('double-click edits a comment line; emptying it removes it', async () => {
    // back to $0810 with the build panel closed (the listing is virtualized)
    await page.keyboard.press('Control+j');
    await goTo(page, 'start');
    await commentRow('// set up the raster IRQ').dblclick();
    const input = page.getByLabel('Comment line above $0810');
    await expect(input).toHaveValue('set up the raster IRQ');
    await input.fill('raster IRQ setup');
    await input.press('Enter');
    await expect(commentRow('// raster IRQ setup')).toBeVisible();
    await commentRow('// raster IRQ setup').dblclick();
    await page.getByLabel('Comment line above $0810').fill('');
    await page.getByLabel('Comment line above $0810').press('Enter');
    await expect(commentRow('raster IRQ setup')).toHaveCount(0);
    expect(await above('start:', 1)).not.toEqual(['// raster IRQ setup']);
  });

  await test.step('Ctrl+Z brings the comment line back', async () => {
    await page.keyboard.press('Control+z');
    await expect(commentRow('// raster IRQ setup')).toBeVisible();
  });

  await test.step('the context menu acts on the line it was opened on, not on the old cursor line', async () => {
    const row = listing(page).locator('.row.k-ins').nth(4);
    const adr = (await row.locator('.adr').textContent())!;
    expect(adr).not.toBe('0810');
    await row.click({ button: 'right' });
    await fromSubmenu(page, 'Insert above', 'Comment block…');
    const area = page.getByLabel(`Comment block above $${adr}`);
    await expect(area).toBeVisible();
    await area.press('Escape');
    await expect(area).toBeHidden();
  });
});

test('insert empty lines, remove them and undo', async ({ page }) => {
  await waitForListing(page);
  const blanks = listing(page).locator('.row.user-blank');
  /** the source text of the rows right before the first row with text `before` (and address `adr`) */
  const above = async (before: string, n: number, adr?: string) => { const rows = await listingRows(page); const i = rows.findIndex(r => r.text === before && (adr == null || r.adr === adr)); return rows.slice(Math.max(0, i - n), i).map(r => r.text); };

  await test.step('Shift+Enter puts an empty line above the cursor line and its label, each press one more', async () => {
    await goTo(page, 'start');
    await page.keyboard.press('Shift+Enter');
    await expect(blanks).toHaveCount(1);
    await page.keyboard.press('Shift+Enter');
    await expect(blanks).toHaveCount(2);
    expect(await above('start:', 2)).toEqual(['', '']);
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
    await page.keyboard.press('Control+j');
  });

  await test.step('a right-click on an empty line removes it; Shift+Backspace too, and Ctrl+Z brings it back', async () => {
    await goTo(page, 'start');
    await blanks.first().click({ button: 'right' });
    await expect(page.getByRole('menuitem')).toHaveText(['Comment line here…', 'Comment block here…', 'Remove empty lineShift+Backspace', 'Remove all 2 empty lines here', 'Insert another empty lineShift+Enter']);
    await page.getByRole('menuitem', { name: 'Remove empty line' }).click();
    await expect(blanks).toHaveCount(1);
    await page.keyboard.press('Shift+Backspace');
    await expect(blanks).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(blanks).toHaveCount(1);
  });

  await test.step('right-click → Insert above → Empty line on another line', async () => {
    const row = listing(page).locator('.row.k-ins').nth(4);
    const adr = (await row.locator('.adr').textContent())!;
    const text = (await row.locator('.src').textContent())!;
    await row.click({ button: 'right' });
    await fromSubmenu(page, 'Insert above', 'Empty line');
    await expect(blanks).toHaveCount(2);
    expect(await above(text, 1, adr)).toEqual(['']);
    await expect(listing(page).locator('.row.cur .adr')).toHaveText(adr);
  });

  await test.step('a comment line written on an empty line goes between the empty lines, moves, and leaves them when removed', async () => {
    await goTo(page, 'start');
    await page.keyboard.press('Shift+Enter');
    expect(await above('start:', 2)).toEqual(['', '']);
    // the empty lines above start: come first in the listing
    await blanks.nth(1).dblclick();
    const input = page.getByLabel('Comment line above $0810');
    await input.fill('set up the raster IRQ');
    await input.press('Enter');
    await expect(input).toBeHidden();
    expect(await above('start:', 3)).toEqual(['', '// set up the raster IRQ', '']);
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
    await page.keyboard.press('Control+j');
    await goTo(page, 'start');
    // the empty line above it: the comment moves onto it, and that one comes under it
    await blanks.nth(0).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move the comment line here', exact: true }).click();
    expect(await above('start:', 3)).toEqual(['// set up the raster IRQ', '', '']);
    // emptied, the comment goes and its empty lines stay
    await listing(page).locator('.row.k-cmt', { hasText: '// set up the raster IRQ' }).dblclick();
    await page.getByLabel('Comment line above $0810').fill('');
    await page.getByLabel('Comment line above $0810').press('Enter');
    const left = await above('start:', 3);
    expect(left.slice(1)).toEqual(['', '']);
    expect(left[0]).not.toContain('raster IRQ');
    await page.keyboard.press('Control+z');
    expect(await above('start:', 3)).toEqual(['// set up the raster IRQ', '', '']);
  });
});

test('Escape closes the right-click menu, and only that: the listing does not go back', async ({ page }) => {
  await waitForListing(page);
  const cur = listing(page).locator('.row.cur');
  const menu = page.getByRole('menu');
  await goTo(page, '$3000');
  const at = await cur.locator('.adr').textContent();
  await cur.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(cur.locator('.adr')).toHaveText(at!);
  // so did its submenu, opened with the mouse
  await cur.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Memory banking', exact: true }).hover();
  await expect(page.getByRole('menuitem', { name: '$34 · RAM · RAM · RAM' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(cur.locator('.adr')).toHaveText(at!);
  // with the keys: ↓ through the items, → into a submenu, Escape out of it, and Escape again closes the menu
  await cur.click({ button: 'right' });
  await page.mouse.move(2, 2);
  const hot = page.locator('.ctx-item.hot');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect(hot).toHaveText('Insert above');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menu', { name: 'Insert above' })).toBeVisible();
  await expect(hot).toHaveText(['Insert above', 'Comment line…/']);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(1);
  await expect(hot).toHaveText('Insert above');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(cur.locator('.adr')).toHaveText(at!);
  // without a menu Escape goes back, from before the G
  await page.keyboard.press('Escape');
  await expect(cur.locator('.adr')).not.toHaveText(at!);
});

test('pointing at an undocumented opcode says what it does and the flags it changes, in the listing and the source', async ({ page }) => {
  await waitForListing(page);
  // the demo's lax frame / sax temp / dcp countdown (var_092e, var_092f and var_0930 here)
  await goTo(page, '$08e6');
  const ill = (mn: string) => listing(page).locator('.syn-ill', { hasText: new RegExp(`^${mn}`) }).first();

  await test.step('in the listing: on the mnemonic, as its tooltip', async () => {
    await expect(ill('lax')).toHaveAttribute('title', /^lax \(\$[0-9a-f]{2}, (abs|zp)\) - undocumented opcode\nLoads A and X with the same byte\.\nA = X = M\nFlags: N Z$/);
    await expect(ill('sax')).toHaveAttribute('title', /also called aax\nStores A AND X\.\nM = A & X\nFlags: none change$/);
    await expect(ill('dcp')).toHaveAttribute('title', /Decrements the memory \(DEC\), then compares A with it \(CMP\)\.\n.*\nFlags: N Z C$/);
    // a documented one has none
    expect(await listing(page).locator('.syn-mn').first().getAttribute('title')).toBeNull();
  });

  await test.step('in the source view: Monaco says the same on the mnemonic', async () => {
    await page.getByRole('tab', { name: 'raster-demo.asm' }).click();
    const editor = page.locator('.mon-host .view-lines');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('Control+f');
    await page.keyboard.type('dcp var_0930');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    // the cursor on the mnemonic, and Monaco's Show Hover there (Ctrl+K Ctrl+I), as the pointer would
    await page.keyboard.press('Home');
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Control+i');
    const hover = page.locator('.monaco-hover').filter({ hasText: 'undocumented opcode' });
    await expect(hover).toContainText('dcp - undocumented opcode, also called dcm', { timeout: 10_000 });
    await expect(hover).toContainText('Decrements the memory (DEC), then compares A with it (CMP).');
    await expect(hover).toContainText('Flags: N Z C');
  });
});

test('set the memory configuration ($01) code runs with', async ({ page }) => {
  await waitForListing(page);
  // the first border color write in the demo, which never writes $01 (so it runs with $37)
  const start = (await listingRows(page)).find(r => r.text.startsWith('sta VIC_BORDER_COLOR'))!;
  expect(start).toBeTruthy();
  await goTo(page, `$${start.adr}`);
  await expect(statusBar(page)).toContainText('$01 $37');
  const row = () => listing(page).locator('.row.k-ins', { has: page.locator('.adr', { hasText: new RegExp(`^${start.adr}$`) }) });

  await test.step('right-click → Memory banking → $34 (under Memory configuration ($01)) makes $d020 plain RAM', async () => {
    await row().click({ button: 'right' });
    await fromSubmenu(page, 'Memory banking', '$34 · RAM · RAM · RAM');
    await expect(toast(page, 'runs with $01 = $34 (RAM · RAM · RAM)')).toBeVisible();
    await expect(row()).toContainText('sta $d020');
    await expect(statusBar(page)).toContainText('$01 $34');
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('the inspector sets $35 for the whole block: I/O is back', async () => {
    await page.keyboard.press('Control+j');
    const sel = page.locator('.inspector').getByLabel('Memory configuration ($01)');
    await sel.selectOption(String(0x35));
    await expect(row()).toContainText('sta VIC_BORDER_COLOR');
    await expect(statusBar(page)).toContainText('$01 $35');
    await expect(sel).toHaveValue(String(0x35));
  });

  await test.step('Ctrl+Z twice returns to the detected $37', async () => {
    await page.keyboard.press('Control+z');
    await expect(row()).toContainText('sta $d020');
    await page.keyboard.press('Control+z');
    await expect(statusBar(page)).toContainText('$01 $37');
    await expect(row()).toContainText('sta VIC_BORDER_COLOR');
  });
});

test('the listing shows memory addresses or line numbers', async ({ page }) => {
  await waitForListing(page);
  const gutter = page.getByRole('group', { name: 'Left column' });
  const startRow = (rows: ListingRow[]) => rows.find(r => r.text === 'start:')!;
  await expect(gutter.getByRole('button', { name: 'Address' })).toHaveAttribute('aria-pressed', 'true');
  expect(startRow(await listingRows(page)).adr).toBe('0810');

  /** numbered like the .asm file: 1, 2, 3 … in order (blank lines too). A picture of graphics stands for the .byte
   *  rows it draws, so the numbers go on after them; with the pictures off there is no gap, and only the file bar has
   *  no number */
  const numbered = async (pictures = true) => {
    const rows = await listingRows(page);
    const nums = rows.filter(r => r.adr !== '').map(r => Number(r.adr));
    expect(nums[0]).toBe(1);
    expect(nums.filter((n, i) => i && n <= nums[i - 1])).toEqual([]);
    if (!pictures) {
      expect(nums).toEqual(nums.map((_n, i) => i + 1));
      expect(rows.filter(r => r.adr === '').length).toBe(1);
    }
    expect(Number(startRow(rows).adr)).toBeGreaterThan(1);
  };
  await gutter.getByRole('button', { name: 'Line' }).click();
  await expect(gutter.getByRole('button', { name: 'Line' })).toHaveAttribute('aria-pressed', 'true');
  await numbered();

  // the choice is kept
  await page.reload();
  await waitForListing(page);
  await expect(page.getByRole('group', { name: 'Left column' }).getByRole('button', { name: 'Line' })).toHaveAttribute('aria-pressed', 'true');
  await numbered();

  // the graphics as .byte rows (Settings → General): every line of the .asm file has its row
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'General' }).click();
  await page.getByLabel(/Show graphics as pictures in the listing/).uncheck();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(listing(page).locator('.gfx-strip')).toHaveCount(0);
  await numbered(false);

  await page.getByRole('group', { name: 'Left column' }).getByRole('button', { name: 'Address' }).click();
  expect(startRow(await listingRows(page)).adr).toBe('0810');
});

test('set the program start by hand', async ({ page }) => {
  await waitForListing(page);
  const section = await openSection(page, 'Program start');
  const input = page.getByLabel('Program start address');
  // The Explorer and the toast show an edit at once, the listing only when the analysis worker's result lands a moment
  // later: a row is waited for. (listingRows reads the listing a screen at a time, so a result landing while it reads
  // gives new rows further down and old ones above them: the BASIC line still old, the header of $0810 already new.)
  const hasRow = async (text: string) => (await listingRows(page)).some(r => r.text.startsWith(text));
  await expect(section).toContainText('$0810');
  await expect(section).toContainText('BASIC SYS');
  await expect(section).toContainText('Build & Run: VICE starts it with RUN, no start address');
  await expect(section.getByRole('button', { name: 'Clear' })).toHaveCount(0);

  await test.step('typing a label in the Explorer moves `start` there', async () => {
    await input.fill('sub_0866');
    await input.press('Enter');
    await expect(toast(page, 'The program starts at $0866')).toBeVisible();
    await expect(section).toContainText('$0866');
    await expect(section).toContainText('set by you');
    await expect(section).toContainText('Build & Run: VICE loads it and types sys 2150');
    await expect(statusBar(page)).toContainText('$0866 · start');
    // the BASIC stub still SYSes $0810, which keeps its code under its own name
    await expect.poll(() => hasRow('BasicUpstart2(entry_0810)')).toBe(true);
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('an address outside the files is refused', async () => {
    await input.fill('$9000');
    await input.press('Enter');
    await expect(section).toContainText('$9000 is not part of any loaded file.');
  });

  await test.step('Clear goes back to RUN and the detected start, and the context menu sets and clears', async () => {
    await section.getByRole('button', { name: 'Clear' }).click();
    await expect(toast(page, 'Program start cleared: Build & Run starts the program with RUN')).toBeVisible();
    await expect(section).toContainText('BASIC SYS');
    await expect(section).toContainText('Build & Run: VICE starts it with RUN, no start address');
    await expect(section.getByRole('button', { name: 'Clear' })).toHaveCount(0);
    await expect.poll(() => hasRow('BasicUpstart2(start)')).toBe(true);
    await page.keyboard.press('Control+j');
    await goTo(page, 'sub_0866');
    const row = listing(page).locator('.row.k-ins', { has: page.locator('.adr', { hasText: /^0866$/ }) });
    await row.click({ button: 'right' });
    await fromSubmenu(page, 'Program', 'Set as program start');
    await expect(section).toContainText('set by you');
    await row.click({ button: 'right' });
    await fromSubmenu(page, 'Program', 'Clear program start ($0866)');
    await expect(section).toContainText('BASIC SYS');
    await page.keyboard.press('Control+z');
    await expect(section).toContainText('set by you');
    await page.keyboard.press('Control+z');
    await expect(section).toContainText('BASIC SYS');
  });
});

test('show data as code to find code that is marked as data', async ({ page }) => {
  await waitForListing(page);
  const toggle = page.getByRole('button', { name: 'Data as code' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await goTo(page, 'colors_0939');
  expect(rowAt(await listingRows(page), '0939')?.text).toMatch(/^\.byte \$06, \$0e/);

  await test.step('the toggle shows the table bytes disassembled; the export is unchanged', async () => {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.preview-bar')).toBeVisible();
    await expect(headerRow(page, '0939').locator('.hdr-preview')).toBeVisible();
    // (the listing is much longer now: read the rows on screen instead of scrolling through all of them)
    await expect(listing(page).locator('.row.k-ins.preview', { has: page.locator('.adr', { hasText: /^0939$/ }) })).toContainText('asl $0e'); // $06 $0e
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('C marks what looks like code as code', async () => {
    await page.keyboard.press('Control+j');
    await goTo(page, 'colors_0939');
    await page.keyboard.press('c');
    await expect(toast(page, '$0939–$0948 marked as Code')).toBeVisible();
    await expect(headerRow(page, '0939').locator('.hdr-user')).toBeVisible();
    await expect(headerRow(page, '0939').locator('.hdr-preview')).toHaveCount(0); // real code now
    await page.keyboard.press('Control+z');
    await expect(headerRow(page, '0939').locator('.hdr-preview')).toBeVisible();
  });

  await page.getByRole('button', { name: 'Show as classified' }).click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(rowAt(await listingRows(page), '0939')?.text).toMatch(/^\.byte \$06, \$0e/);
});

test('Data as code keeps the line in view where it is on screen, both ways', async ({ page }) => {
  await waitForListing(page);
  const toggle = page.getByRole('button', { name: 'Data as code' });
  const y = async (l: Locator) => Math.round((await l.boundingBox())?.y ?? -1);
  // the row that shows `adr` (the last one starting at or before it) and where it is on screen
  const rowOf = (adr: number) => listing(page).evaluate((el, a) => {
    const rows = [...el.querySelectorAll<HTMLElement>('.row:not(.hdr)')].filter(r => /^[0-9a-f]{4}$/.test(r.querySelector('.adr')?.textContent ?? '') && r.querySelector('.hex')?.textContent)
      .sort((p, q) => parseFloat(p.style.top) - parseFloat(q.style.top));
    const r = rows.filter(x => parseInt(x.querySelector('.adr')!.textContent!, 16) <= a).pop();
    return r ? { adr: r.querySelector('.adr')!.textContent, y: Math.round(r.getBoundingClientRect().y) } : null;
  }, adr);

  await test.step('the cursor\'s line stays put, with all the data above it turned into code', async () => {
    // $3000 is far below the tables and graphics that become many lines of code
    await goTo(page, '$3000');
    const cur = listing(page).locator('.row.cur');
    const y0 = await y(cur);
    await toggle.click();
    await expect(listing(page).locator('.row.preview').first()).toBeVisible();
    await expect.poll(() => y(cur)).toBe(y0);
    await expect(cur.locator('.adr')).toHaveText(/^(2f[0-9a-f]{2}|3000)$/);
    await page.getByRole('button', { name: 'Show as classified' }).click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // the lines as classified come from the analysis a moment after the button: until then the listing still shows the
    // code (with the cursor's line kept where it was), and puts the cursor's line there again when they come
    await expect(listing(page).locator('.row.preview')).toHaveCount(0);
    await expect.poll(() => y(cur)).toBe(y0);
  });

  await test.step('without the cursor in view, the top line stays put', async () => {
    const top = await listing(page).evaluate(async el => {
      // scrolled, and drawn again for where it is now
      el.scrollTop -= 2000;
      await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 50))));
      const box = el.getBoundingClientRect();
      const rows = [...el.querySelectorAll<HTMLElement>('.row:not(.hdr)')].filter(r => r.getBoundingClientRect().y >= box.y && r.getBoundingClientRect().bottom <= box.bottom && /^[0-9a-f]{4}$/.test(r.querySelector('.adr')?.textContent ?? '') && r.querySelector('.hex')?.textContent)
        .sort((p, q) => parseFloat(p.style.top) - parseFloat(q.style.top));
      const cur = el.querySelector('.row.cur')?.getBoundingClientRect();
      return { adr: parseInt(rows[0].querySelector('.adr')!.textContent!, 16), y: Math.round(rows[0].getBoundingClientRect().y), curInView: !!cur && cur.bottom > box.y && cur.y < box.bottom };
    });
    expect(top.curInView, 'the cursor\'s line is out of view').toBe(false);
    await toggle.click();
    await expect(listing(page).locator('.row.preview').first()).toBeVisible();
    await expect.poll(async () => (await rowOf(top.adr))?.y).toBe(top.y);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(listing(page).locator('.row.preview')).toHaveCount(0);
    await expect.poll(async () => (await rowOf(top.adr))?.y).toBe(top.y);
  });
});

test('a block marked with another type: the cursor goes to its start, which stays in view, and the block is framed a moment', async ({ page }) => {
  await waitForListing(page);
  const frame = listing(page).locator('.changed');
  const y = async (l: Locator) => Math.round((await l.boundingBox())?.y ?? -1);
  /** the first line with bytes at `adr` */
  const bytesAt = (adr: string) => listing(page).locator('.row:not(.hdr)', { has: page.locator('.adr', { hasText: new RegExp(`^${adr}$`) }) }).filter({ has: page.locator('.hex', { hasText: /\S/ }) }).first();

  await test.step('a selection made downwards: the cursor goes from its last line to its first, which stays put on screen', async () => {
    await goTo(page, 'fx_091e');
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowDown');
    await expect(statusBar(page)).toContainText('sel $091e–$0925 (8 B)');
    await expect(listing(page).locator('.row.cur .adr')).not.toHaveText('091e');
    const y0 = await y(bytesAt('091e'));
    await page.keyboard.press('d');
    await expect(frame).toContainText('Marked as Bytes (.byte)');
    await expect(listing(page).locator('.row.cur .adr')).toHaveText('091e');
    await expect(listing(page).locator('.row.cur')).toContainText('.byte $ad');
    expect(await y(bytesAt('091e'))).toBe(y0);
    // the frame starts at the block's header
    expect(Math.round((await frame.boundingBox())!.y)).toBe(await y(headerRow(page, '091e')));
  });

  await test.step('the frame fades and goes', async () => {
    await expect(frame).toHaveCount(0, { timeout: 8_000 });
  });

  await test.step('the start of the range scrolled out of view: the listing goes back to it', async () => {
    await goTo(page, 'colors_0939-$0ab4');
    await expect(statusBar(page)).toContainText('sel $0939–$0ab4 (380 B)');
    await listing(page).evaluate(el => { el.scrollTop += 3000; });
    await expect(headerRow(page, '0939')).toHaveCount(0);
    await page.keyboard.press('d');
    await expect(frame).toContainText('Marked as Bytes (.byte)');
    await expect(headerRow(page, '0939')).toBeInViewport();
    await expect(listing(page).locator('.row.cur .adr')).toHaveText('0939');
  });

  await test.step('Ctrl+Z takes the frame away with the mark', async () => {
    await page.keyboard.press('Control+z');
    await expect(frame).toHaveCount(0, { timeout: 2_000 });
  });
});

test('merge a block with the block before or after it', async ({ page }) => {
  await waitForListing(page);
  await goTo(page, 'txt_0960');

  await test.step('right-click → Merge with previous block', async () => {
    await headerRow(page, '0960').click({ button: 'right' });
    await fromSubmenu(page, 'Block', 'Merge with previous block (Text) → Text');
    await expect(toast(page, '$0949–$0984 merged into one Text block')).toBeVisible();
    await expect(headerRow(page, '0960')).toHaveCount(0);
    await expect(headerRow(page, '0949')).toContainText('$0949-$0984');
  });

  await test.step('the inspector merges with the next block', async () => {
    await page.locator('.inspector').getByRole('button', { name: 'Merge with next', exact: true }).click();
    await expect(toast(page, '$0949–$09b4 merged into one Text block')).toBeVisible();
    await expect(headerRow(page, '0949')).toContainText('$0949-$09b4');
    await expect(headerRow(page, '0949').locator('.hdr-user')).toBeVisible();
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('Ctrl+Z twice gives the three blocks back', async () => {
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+j');
    await goTo(page, 'txt_0960');
    await expect(headerRow(page, '0960')).toBeVisible();
    await expect(headerRow(page, '0949').locator('.hdr-user')).toHaveCount(0);
  });
});

test('fold and unfold blocks', async ({ page }) => {
  await waitForListing(page);
  const shown = async (adr: string) => (await listingRows(page)).some(r => !r.hdr && r.adr === adr);
  const folded = () => headerRow(page, '09b5').locator('.hdr-folded');
  await goTo(page, 'sine_09b5');
  expect(await shown('09bd')).toBe(true); // the sine table's second .byte row

  await test.step('the button on the header folds and unfolds', async () => {
    await headerRow(page, '09b5').getByRole('button', { name: 'Fold block' }).click();
    await expect(folded()).toContainText('lines folded');
    expect(await shown('09bd')).toBe(false);
    await headerRow(page, '09b5').getByRole('button', { name: 'Unfold block' }).click();
    await expect(folded()).toHaveCount(0);
    expect(await shown('09bd')).toBe(true);
  });

  await test.step('F folds the block at the cursor; going to an address inside unfolds it', async () => {
    await goTo(page, '$09c5');
    await page.keyboard.press('f');
    await expect(folded()).toBeVisible();
    await expect(statusBar(page)).toContainText('$09b5 · sine_09b5');
    // the arrow keys stop on the folded header
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await expect(statusBar(page)).toContainText('$09b5 · sine_09b5');
    await goTo(page, '$09c5');
    await expect(folded()).toHaveCount(0);
    await expect(statusBar(page)).toContainText('$09c5');
  });

  await test.step('the command palette folds every block that is not code, and unfolds all', async () => {
    const palette = async (cmd: string) => { await page.keyboard.press('Control+Shift+P'); const q = page.getByRole('textbox', { name: 'Command' }); await q.fill(cmd); await q.press('Enter'); };
    // the listing re-renders after the command: wait for it
    await palette('Fold every block that is not code');
    await expect.poll(() => shown('09bd')).toBe(false);
    expect((await listingRows(page)).some(r => r.text === 'start:')).toBe(true);
    await palette('Unfold all blocks');
    await expect.poll(() => shown('09bd')).toBe(true);
  });
});

test('find text in the listing: every match marked, Enter and F3 step through them, a folded block opens', async ({ page }) => {
  await waitForListing(page);
  const input = page.getByRole('textbox', { name: 'Find in the listing' });
  const status = page.getByRole('status', { name: 'Find result' });
  const marked = () => page.evaluate(() => (CSS.highlights.get('mimir-find')?.size ?? 0) + (CSS.highlights.get('mimir-find-cur')?.size ?? 0));
  const rows = await listingRows(page);
  const uses = rows.filter(r => /sine_09b5/.test(r.text)).length;
  expect(uses).toBeGreaterThan(1);
  // the hit going down from the cursor's line (the instruction at start)
  const startRow = rows.findIndex(r => !r.hdr && r.adr === '0810' && !r.text.endsWith(':'));
  const first = rows.slice(0, startRow).filter(r => /sine_09b5/.test(r.text)).length + 1;

  await test.step('Ctrl+F opens the find widget; typing goes to the first line with a match from the cursor', async () => {
    await listing(page).focus();
    await page.keyboard.press('Control+F');
    await expect(input).toBeFocused();
    await input.fill('SINE_09B5');
    await expect(status).toHaveText(`${first} of ${uses}`);
    await expect(listing(page).locator('.row.hit-cur')).toHaveCount(1);
    await expect(listing(page).locator('.row.hit-cur')).toContainText('sine_09b5');
    expect(await marked()).toBeGreaterThan(0);
    // matching the case finds nothing; the field says so
    await page.getByRole('button', { name: 'Match case' }).click();
    await expect(status).toHaveText('No results');
    await page.getByRole('button', { name: 'Match case' }).click();
    await expect(status).toHaveText(`${first} of ${uses}`);
  });

  await test.step('Enter and Shift+Enter step through the lines, around at the end', async () => {
    for (let k = first; k < uses; k++) await input.press('Enter');
    await expect(status).toHaveText(`${uses} of ${uses}`);
    await input.press('Enter');
    await expect(status).toHaveText(`1 of ${uses}`);
    await input.press('Shift+Enter');
    await expect(status).toHaveText(`${uses} of ${uses}`);
    await input.press('Shift+Enter');
    await expect(status).toHaveText(`${uses - 1} of ${uses}`);
  });

  await test.step('Esc closes only the widget, a second Esc goes back to where the cursor was', async () => {
    await input.press('Escape');
    await expect(input).toBeHidden();
    await expect(listing(page)).toBeFocused();
    await expect(listing(page).locator('.row.hit')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(statusBar(page)).toContainText('$0810 · start');
  });

  await test.step('a match inside a folded block unfolds it, and F3 steps from the cursor', async () => {
    const text = rows.find(r => r.adr === '09bd')!.text.split('//')[0].trim();
    expect(rows.filter(r => r.text.includes(text)).length).toBe(1);
    await goTo(page, '$09c5');
    await page.keyboard.press('f');
    await expect(headerRow(page, '09b5').locator('.hdr-folded')).toBeVisible();
    await goTo(page, 'start');
    await page.keyboard.press('Control+F');
    await input.fill(text);
    await expect(headerRow(page, '09b5').locator('.hdr-folded')).toHaveCount(0);
    await expect(statusBar(page)).toContainText('$09bd');
    await expect(listing(page).locator('.row.hit-cur .adr')).toHaveText('09bd');
    // the cursor moved elsewhere: F3 goes on from there
    await input.fill('sine_09b5');
    await listing(page).focus();
    await goTo(page, 'start');
    await page.keyboard.press('F3');
    await expect(status).toHaveText(`${first} of ${uses}`);
  });

  await test.step('the source tab finds with Monaco', async () => {
    await page.getByRole('tab', { name: /\.asm$/ }).click();
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page.locator('.monaco-editor .find-widget.visible')).toBeVisible();
  });
});

test('Ctrl+↓ and Ctrl+↑ go from block to block, the header at the top of the listing', async ({ app, page }) => {
  await waitForListing(page);
  /** the block's header is at the top of the listing, below the line above it */
  const atTop = async (adr: string) => {
    const box = await listing(page).boundingBox(), row = await headerRow(page, adr).boundingBox();
    return !!box && !!row && row.y - box.y >= 0 && row.y - box.y <= 2 * 20;
  };
  await expect(statusBar(page)).toContainText('$0810 · start');
  await listing(page).focus();

  await test.step('Ctrl+↓ goes to the next block; Esc goes back from a run of them at once', async () => {
    await page.keyboard.press('Control+ArrowDown');
    await expect(statusBar(page)).toContainText('$0866 · sub_0866');
    await expect.poll(() => atTop('0866')).toBe(true);
    await page.keyboard.press('Control+ArrowDown');
    await expect(statusBar(page)).toContainText('$08ae · sub_08ae');
    await expect.poll(() => atTop('08ae')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(statusBar(page)).toContainText('$0810 · start');
  });

  await test.step('Ctrl+↑ goes to the start of the block, then to the one before', async () => {
    await goTo(page, '$0870');
    await page.keyboard.press('Control+ArrowUp');
    await expect(statusBar(page)).toContainText('$0866 · sub_0866');
    await page.keyboard.press('Control+ArrowUp');
    await expect(statusBar(page)).toContainText('$0810 · start');
  });

  await test.step('a folded block stays folded: the cursor stops on its header', async () => {
    await goTo(page, 'sine_09b5');
    await page.keyboard.press('f');
    await expect(headerRow(page, '09b5').locator('.hdr-folded')).toBeVisible();
    await goTo(page, 'txt_0985');
    await page.keyboard.press('Control+ArrowDown');
    await expect(statusBar(page)).toContainText('$09b5 · sine_09b5');
    await page.keyboard.press('Control+ArrowDown');
    await expect(statusBar(page)).toContainText('$0ab5');
    await page.keyboard.press('Control+ArrowUp');
    await expect(statusBar(page)).toContainText('$09b5 · sine_09b5');
    await expect(headerRow(page, '09b5').locator('.hdr-folded')).toBeVisible();
  });

  await test.step('the buttons in the toolbar do the same (a wide window has them), and the last block goes no further', async () => {
    await expect(page.getByRole('button', { name: 'Next block', exact: true })).toBeHidden();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1920, 920); });
    await page.getByRole('button', { name: 'Next block', exact: true }).click();
    await expect(statusBar(page)).toContainText('$0ab5');
    await expect(listing(page)).toBeFocused();
    await page.getByRole('button', { name: 'Previous block', exact: true }).click();
    await expect(statusBar(page)).toContainText('$09b5 · sine_09b5');
    await goTo(page, 'charset_3000');
    await page.keyboard.press('Control+ArrowDown');
    await expect(statusBar(page)).toContainText('$3000 · charset_3000');
  });
});

test('exclude a block from the build', async ({ page }) => {
  await waitForListing(page);
  await goTo(page, 'sine_09b5');

  await test.step('right-click → Exclude block from the build', async () => {
    await headerRow(page, '09b5').click({ button: 'right' });
    await fromSubmenu(page, 'Block', 'Exclude block from the build');
    await expect(toast(page, '$09b5–$0ab4 is left out of the build')).toBeVisible();
    await expect(headerRow(page, '09b5').locator('.hdr-excluded')).toBeVisible();
    const text = (await listingRows(page)).map(r => r.text);
    expect(text).toContain('#if INCLUDE_sine_09b5');
    expect(text).toContain('.label sine_09b5 = $09b5');
    expect(text).toContain('#endif');
    expect(text).toContain('// #define INCLUDE_sine_09b5');
  });

  await test.step('F7 verifies the rest and says what was left out', async () => {
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
    await expect(page.locator('.bottom .build')).toContainText('(256 bytes left out of the build)');
  });

  await test.step('the inspector puts it back', async () => {
    await page.keyboard.press('Control+j');
    await goTo(page, 'sine_09b5');
    const box = page.locator('.inspector').getByLabel('Include in the build');
    await expect(box).not.toBeChecked();
    await box.check();
    await expect(headerRow(page, '09b5').locator('.hdr-excluded')).toHaveCount(0);
    await expect(box).toBeChecked();
  });
});

test('text in mixed case', async ({ page }) => {
  await waitForListing(page);
  await goTo(page, 'txt_0985'); // screen codes, upper case set
  const rows = async () => (await listingRows(page)).map(r => r.text);
  expect(await rows()).toContain('.text "HELLO FROM THE MIMIR STUDIO DEMO!       ENJOY!!"');
  const type = page.locator('.inspector').getByLabel('Type');
  await expect(type).toHaveValue('textsc');
  await type.selectOption('textscmix');
  await expect(type).toHaveValue('textscmix');
  await expect(headerRow(page, '0985')).toContainText('Text (screen codes, mixed case)');
  const text = await rows();
  expect(text).toContain('.encoding "screencode_mixed"');
  expect(text).toContain('.text "hello from the mimir studio demo!       enjoy!!"');
  await expect(page.locator('.inspector .text-prev')).toContainText('hello from the mimir studio demo');
  await page.keyboard.press('F7');
  await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
});

const rowAt = (rows: ListingRow[], adr: string) => rows.find(r => !r.hdr && r.adr === adr && r.text && !r.text.endsWith(':'));
const headerAt = (rows: ListingRow[], adr: string) => rows.find(r => r.hdr && r.adr === adr);
const userHeader = (page: Page, adr: string) => listing(page).locator('.row.hdr', { has: page.locator('.adr', { hasText: adr }) }).locator('.hdr-user');

test('open a PRG, save and export through stubbed file dialogs', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  const prg = join(repoDir, 'fixtures/prg/raster-demo.prg');

  const file = page.getByRole('button', { name: 'File', exact: true });
  const menu = page.getByRole('menu');

  await test.step('File → Open PRG files… opens a PRG; the File button closes its menu too', async () => {
    await file.click();
    await expect(file).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('menuitem')).toHaveText(['Smart attach…', 'Open PRG files…Ctrl+O', 'Open a cartridge (.crt)…', 'Open a VICE snapshot (.vsf)…', 'Mount disk image (D64, G64)…', 'Insert tape image (TAP, T64)…', 'Save: create a project from this work…Ctrl+S']);
    await file.click();
    await expect(menu).toBeHidden();
    await expect(file).toHaveAttribute('aria-expanded', 'false');

    await stubDialogs(app, { open: [prg] });
    await file.click();
    await menu.getByRole('menuitem', { name: 'Open PRG files…' }).click();
    await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
    await expect(statusBar(page)).toContainText('$0810 · start');
  });

  await test.step('rename, then File → Save makes a project of the work', async () => {
    await goTo(page, OLD);
    await page.keyboard.press('n');
    await page.getByLabel('Label at $092d').fill(NEW);
    await page.getByLabel('Label at $092d').press('Enter');
    await expect(statusBar(page)).toContainText(`$092d · ${NEW}`);

    await file.click();
    await menu.getByRole('menuitem', { name: 'Save: create a project from this work…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create a project from this work' });
    await expect(dialog.getByLabel('Name')).toHaveValue('raster-demo');
    await dialog.getByLabel('Name').fill('demo');
    await stubDialogs(app, { open: [work] });
    await dialog.getByRole('button', { name: 'Change…' }).click();
    await expect(dialog.locator('.np-parent')).toContainText(work);
    await dialog.getByRole('button', { name: 'Create project and move the work' }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page, `Created the project demo in ${join(work, 'demo')}: the work is saved there`)).toBeVisible();
    expect(readFileSync(join(work, 'demo', 'demo.mimir.json'), 'utf8')).toContain(NEW);
    await expect(page.getByRole('button', { name: 'Project demo' })).toBeVisible();

    await file.click();
    await menu.getByRole('menuitem', { name: 'Save project' }).click();
    await expect(toast(page, `Project saved to ${join(work, 'demo', 'demo.mimir.json')}`)).toBeVisible();
  });

  await test.step("Ctrl+E verifies and exports the Kick Assembler project into the project's source folder", async () => {
    const out = join(work, 'demo', 'source');
    await page.keyboard.press('Control+e');
    await expect(toast(page, `Exported verified Kick Assembler project to ${out}`)).toBeVisible({ timeout: 90_000 });
    expect(readdirSync(out)).toEqual(expect.arrayContaining(['raster-demo.asm', 'raster-demo.mimir.json', 'build.bat', 'build.sh', 'include', 'original']));
    const asm = readFileSync(join(out, 'raster-demo.asm'), 'utf8');
    expect(asm).toContain(`ldx ${NEW}`);
    expect(asm).not.toContain(OLD);
    expect(existsSync(join(out, 'original', 'raster-demo.prg'))).toBe(true);
    // nothing to put in it: no bookmarks, no comments
    expect(existsSync(join(out, 'NOTES.html'))).toBe(false);
  });
});

test('the File menu opens each kind of file with a dialog of its own, and the Explorer shows it in its section', async ({ app, page }) => {
  await waitForListing(page);
  const file = page.getByRole('button', { name: 'File', exact: true });
  const explorer = page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Explorer' });
  const expanded = (name: string) => page.getByRole('region', { name, exact: true }).locator('.sec-toggle');
  /** the title, filters and selection of the last open dialog */
  const lastDialog = () => app.evaluate(() => {
    const all = (globalThis as unknown as { dialogOptions?: { title?: string; filters?: { name: string; extensions: string[] }[]; properties?: string[] }[] }).dialogOptions ?? [];
    const o = all[all.length - 1];
    return { title: o?.title, filters: o?.filters?.map(f => `${f.name}: ${f.extensions.join(' ')}`), properties: o?.properties };
  });
  /** another view in the side panel, every Explorer section closed: the File menu's choice brings them back. What was
   *  opened before is analysed first: on a busy machine, a file opened while that analysis still ran was left at the
   *  start of the one before */
  const elsewhere = async () => {
    await expect(statusBar(page)).not.toContainText('analysing');
    const open = page.locator('.side-sec .sec-toggle[aria-expanded="true"]');
    while (await open.count()) await open.first().click();
    await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Blocks' }).click();
    await expect(explorer).toHaveAttribute('aria-pressed', 'false');
  };
  const choose = async (item: string, path: string) => {
    await stubDialogs(app, { open: [path] });
    await file.click();
    await page.getByRole('menu').getByRole('menuitem', { name: item }).click();
  };

  await test.step('Mount disk image (D64, G64)…: the Explorer, with the disk open', async () => {
    await elsewhere();
    await choose('Mount disk image (D64, G64)…', join(repoDir, 'fixtures/d64/mimir-demo.d64'));
    await expect(toast(page, 'Mounted mimir-demo.d64')).toBeVisible();
    await expect(explorer).toHaveAttribute('aria-pressed', 'true');
    await expect(expanded('Disk')).toHaveAttribute('aria-expanded', 'true');
    await expect(expanded('Files')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('list', { name: 'Files on mimir-demo.d64' }).getByRole('listitem')).toHaveCount(3);
  });

  await test.step('Open PRG files…: PRGs, several at once; Files folds up, and Program start opens for its BASIC SYS', async () => {
    await elsewhere();
    await choose('Open PRG files…', join(repoDir, 'fixtures/prg/raster-demo.prg'));
    await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
    expect(await lastDialog()).toEqual({ title: 'Open PRG files', filters: ['C64 programs: prg PRG', 'All files: *'], properties: ['openFile', 'multiSelections'] });
    await expect(explorer).toHaveAttribute('aria-pressed', 'true');
    await expect(expanded('Files')).toHaveAttribute('aria-expanded', 'false');
    await expect(expanded('Program start')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'Program start' })).toContainText('BASIC SYS');
    // no loader in it: Loaders stays as it was
    await expect(statusBar(page)).not.toContainText('analysing');
    await expect(expanded('Loaders')).toHaveAttribute('aria-expanded', 'false');
    await expectFiles(page, ['raster-demo.prg']);
  });

  await test.step('a file with a loader: Loaders opens, and Program start; one opened while Files is open folds it up', async () => {
    await elsewhere();
    // Files open in the Explorer, the other view left for it
    await explorer.click();
    await openSection(page, 'Files');
    await choose('Open PRG files…', join(repoDir, 'fixtures/prg/loader-demo.prg'));
    await expect(toast(page, 'Loaded loader-demo.prg at $0801')).toBeVisible();
    await expect(expanded('Files')).toHaveAttribute('aria-expanded', 'false');
    await expect(expanded('Loaders')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'Loaders' }).getByLabel('Spindle (lft)')).toBeVisible();
    await expect(expanded('Program start')).toHaveAttribute('aria-expanded', 'true');
  });

  await test.step('the Drive code tab, beside the listing: the drive code re-assembled, the same bytes again', async () => {
    await page.getByRole('tab', { name: 'Drive code' }).click();
    await expect(page.locator('.drive-check')).toHaveText('Re-assembles to the same 45 bytes');
    await expect(page.locator('.drive .monaco-editor')).toContainText('loader-demo.prg: the drive code, re-assembled');
    await page.getByRole('tab', { name: 'Listing' }).click();
  });

  await test.step('a program without a start of its own: Program start stays closed (the load address is no start)', async () => {
    await elsewhere();
    await choose('Open PRG files…', join(repoDir, 'fixtures/prg/spindle-demo.prg'));
    await expect(toast(page, 'Loaded spindle-demo.prg at $0400')).toBeVisible();
    await expect(statusBar(page)).not.toContainText('analysing');
    await expect(page.getByRole('region', { name: 'Program start' })).toContainText('$0400');
    await expect(expanded('Program start')).toHaveAttribute('aria-expanded', 'false');
  });

  await test.step('Open a VICE snapshot (.vsf)…: one snapshot; Files folds up, and Program start opens for its SYS', async () => {
    await elsewhere();
    // Files open in the Explorer, the other view left for it
    await explorer.click();
    await openSection(page, 'Files');
    await choose('Open a VICE snapshot (.vsf)…', join(repoDir, 'fixtures/vsf/raster-demo.vsf'));
    await expect(toast(page, /Loaded raster-demo\.prg at \$0200 from a VICE/)).toBeVisible();
    expect(await lastDialog()).toEqual({ title: 'Open a VICE snapshot', filters: ['VICE snapshots: vsf VSF', 'All files: *'], properties: ['openFile'] });
    await expect(explorer).toHaveAttribute('aria-pressed', 'true');
    await expect(expanded('Files')).toHaveAttribute('aria-expanded', 'false');
    await expect(expanded('Program start')).toHaveAttribute('aria-expanded', 'true');
  });

  await test.step('Open a cartridge (.crt)…: one cartridge, and its banks open', async () => {
    await elsewhere();
    await choose('Open a cartridge (.crt)…', join(repoDir, 'fixtures/crt/mimir-demo.crt'));
    await expect(toast(page, 'Opened the cartridge mimir-demo.crt')).toBeVisible();
    expect(await lastDialog()).toEqual({ title: 'Open a cartridge', filters: ['C64 cartridges: crt CRT', 'All files: *'], properties: ['openFile'] });
    await expect(explorer).toHaveAttribute('aria-pressed', 'true');
    await expect(expanded('Cartridge')).toHaveAttribute('aria-expanded', 'true');
    await expect(expanded('Files')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('list', { name: 'Banks of mimir-demo.crt' }).getByRole('listitem')).toHaveCount(2);
    // its vectors are a start
    await expect(expanded('Program start')).toHaveAttribute('aria-expanded', 'true');
  });

  await test.step('Ctrl+O still asks for any of them, and leaves the side panel as it is', async () => {
    await elsewhere();
    await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
    await page.keyboard.press('Control+o');
    await expect(statusBar(page)).toContainText('$0810 · start');
    expect((await lastDialog()).filters).toEqual(['C64 programs, VICE snapshots and cartridges: prg PRG vsf VSF crt CRT', 'All files: *']);
    await expect(explorer).toHaveAttribute('aria-pressed', 'false');
  });

  await test.step('a cartridge opened with Ctrl+O shows the Explorer too, with its banks', async () => {
    await elsewhere();
    await stubDialogs(app, { open: [join(repoDir, 'fixtures/crt/mimir-demo.crt')] });
    await page.keyboard.press('Control+o');
    // (the toast of the cartridge opened before may still be there)
    await expect(statusBar(page)).toContainText('bank 0 · $8009 · start');
    await expect(explorer).toHaveAttribute('aria-pressed', 'true');
    await expect(expanded('Cartridge')).toHaveAttribute('aria-expanded', 'true');
  });
});

test('Smart attach opens each file as its extension says, and Brokkr packs a Kick Assembler source', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  const kickJar = (await page.evaluate(() => (window as unknown as { kr: { getSettings(): Promise<{ kickJar: string }> } }).kr.getSettings())).kickJar;
  const smart = async (...paths: string[]) => { await stubDialogs(app, { open: paths }); await fromFileMenu(page, 'Smart attach…'); };

  await test.step('a PRG and a D64 from one dialog: the PRG opens and the disk is mounted', async () => {
    await smart(join(repoDir, 'fixtures/prg/raster-demo.prg'), join(repoDir, 'fixtures/d64/mimir-demo.d64'));
    await expect(toast(page, 'Mounted mimir-demo.d64')).toBeVisible();
    await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
    await expectFiles(page, ['raster-demo.prg']);
    await expect(page.getByRole('list', { name: 'Files on mimir-demo.d64' }).getByRole('listitem')).toHaveCount(3);
    const o = await app.evaluate(() => {
      const all = (globalThis as unknown as { dialogOptions?: { title?: string; filters?: { name: string; extensions: string[] }[]; properties?: string[] }[] }).dialogOptions ?? [];
      const d = all[all.length - 1];
      return { title: d?.title, filters: d?.filters?.map(f => `${f.name}: ${f.extensions.join(' ')}`), properties: d?.properties };
    });
    expect(o).toEqual({ title: 'Smart attach', filters: ['PRGs, snapshots, cartridges, D64 and G64 disks, TAP and T64 tapes, Mimir projects and Kick Assembler sources: prg PRG vsf VSF crt CRT d64 D64 g64 G64 tap TAP t64 T64 json JSON asm ASM', 'All files: *'], properties: ['openFile', 'multiSelections'] });
  });

  await test.step('a VICE snapshot and a cartridge, each by its extension', async () => {
    await expect(statusBar(page)).not.toContainText('analysing');
    await smart(join(repoDir, 'fixtures/vsf/raster-demo.vsf'));
    await expect(toast(page, /Loaded raster-demo\.prg at \$0200 from a VICE/)).toBeVisible();
    await expect(statusBar(page)).not.toContainText('analysing');
    await smart(join(repoDir, 'fixtures/crt/mimir-demo.crt'));
    await expect(toast(page, 'Opened the cartridge mimir-demo.crt')).toBeVisible();
    await expectFiles(page, ['bank00_8000.prg', 'bank01_8000.prg']);
  });

  await test.step('a Kick Assembler source goes to Brokkr: Pack a file over the work, which stays as it was', async () => {
    const source = join(work, 'my border.asm');
    writeFileSync(source, 'BasicUpstart2(start)\nstart:\n  inc $d020\n  jmp start\n');
    // a second source is left, and said so
    await smart(source, join(work, 'other.asm'));
    await expect(toast(page, 'Not opened: other.asm (Brokkr packs one source at a time)')).toBeVisible();
    const over = page.getByRole('dialog', { name: 'Pack a file' });
    await expect(over.getByRole('heading', { name: 'Pack a file' })).toBeVisible();
    await expect(over.getByRole('tablist', { name: 'Packer' }).getByRole('tab', { name: 'Brokkr' })).toHaveAttribute('aria-selected', 'true');
    await expect(over.locator('.qp-source')).toContainText('my border.asm');
    if (kickJar && existsSync(kickJar)) {
      await expect(over.getByRole('list', { name: 'Files to pack' })).toContainText('my border.prg $0801', { timeout: 60_000 });
      const settings = over.getByLabel('Pack settings');
      await settings.getByRole('button', { name: 'Pack', exact: true }).click();
      await expect(settings.getByRole('status', { name: 'Packed file' })).toContainText('my border-brokkr.prg', { timeout: 120_000 });
      expect(existsSync(join(work, 'my border-brokkr.prg'))).toBe(true);
    }
    // the work's keys wait while it is open
    await page.keyboard.press('g');
    await expect(page.getByRole('dialog', { name: 'Go to address, label or range' })).toHaveCount(0);
    await over.getByRole('button', { name: 'Back to the work' }).click();
    await expect(over).toBeHidden();
    await expectFiles(page, ['bank00_8000.prg', 'bank01_8000.prg']);
  });

  await test.step('a project file opens the project, by itself', async () => {
    const copy = join(work, 'copy.mimir.json');
    await stubDialogs(app, { save: copy });
    await page.getByRole('button', { name: /^No project/ }).click();
    await page.getByRole('menuitem', { name: 'Save a copy of the project file…' }).click();
    await expect(toast(page, `A copy of the project saved to ${copy}`)).toBeVisible();
    await smart(copy, join(repoDir, 'fixtures/prg/raster-demo.prg'));
    await expect(toast(page, 'Not opened: raster-demo.prg (a project opens by itself)')).toBeVisible();
    await expect(toast(page, `Opened the project copy (${work})`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Project copy' })).toBeVisible();
    await expectFiles(page, ['bank00_8000.prg', 'bank01_8000.prg']);
  });
});

test('mount a .d64 and open its PRG files', async ({ app, page }) => {
  // fixtures/d64/mimir-demo.d64 (written with makeD64): "RASTER DEMO" (the demo), "SPRITE" at $c000, "NOTES" (SEQ)
  await waitForListing(page);
  const files = page.getByRole('list', { name: 'Files on mimir-demo.d64' });

  await test.step('File → Mount disk image (D64, G64)… lists the directory', async () => {
    await openSection(page, 'Files');
    await stubDialogs(app, { open: [join(repoDir, 'fixtures/d64/mimir-demo.d64')] });
    await fromFileMenu(page, 'Mount disk image (D64, G64)…');
    await expect(toast(page, 'Mounted mimir-demo.d64: "MIMIR DEMO", 3 files')).toBeVisible();
    await openSection(page, 'Disk');
    await expect(page.locator('.disk-head')).toContainText('"MIMIR DEMO"');
    await expect(files.getByRole('listitem')).toHaveText([/49\s*"RASTER DEMO"\s*PRG/, /1\s*"SPRITE"\s*PRG/, /1\s*"NOTES"\s*SEQ/]);
    await expect(files.getByRole('listitem').nth(2)).toHaveClass(/off/);
    await expect(page.locator('.side-inner')).toContainText('613 blocks free');
    // the disk comes right under Files, and the VICE quicksave under the disk
    await expect.poll(() => page.locator('.side-sec').evaluateAll(s => s.map(e => e.getAttribute('aria-label'))))
      .toEqual(['Files', 'Disk', 'VICE quicksave', 'Scripts', 'Loaders', 'Program start', 'Memory map']);
  });

  await test.step('a click opens a PRG, + adds one to the project', async () => {
    await files.getByRole('listitem').filter({ hasText: 'RASTER DEMO' }).click();
    await expect(toast(page, 'Loaded RASTER DEMO.prg at $0801')).toBeVisible();
    await page.getByRole('button', { name: 'Add SPRITE to this project' }).click();
    await expect(toast(page, 'Loaded SPRITE.prg at $c000')).toBeVisible();
    await expectFiles(page, ['RASTER DEMO.prg', 'SPRITE.prg']);
    // a SEQ file is listed but not opened
    await files.getByRole('listitem').filter({ hasText: 'NOTES' }).click();
    await expect(page.locator('.file-name')).toHaveCount(2);
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('the files in the project are marked; ↑ ↓ go from file to file, Enter opens one, Alt+↓ / Alt+↑ the next and the one before', async () => {
    const row = (name: string) => files.getByRole('listitem').filter({ hasText: name });
    await expect(row('RASTER DEMO')).toHaveAttribute('aria-current', 'true');
    await expect(row('SPRITE')).toHaveAttribute('aria-current', 'true');
    await row('RASTER DEMO').focus();
    await page.keyboard.press('ArrowDown');
    await expect(row('SPRITE')).toBeFocused();
    // NOTES (SEQ) does not open: the focus stays on SPRITE, and the listing's cursor does not move
    const at = await statusBar(page).textContent();
    await page.keyboard.press('ArrowDown');
    await expect(row('SPRITE')).toBeFocused();
    expect(await statusBar(page).textContent()).toBe(at);
    await page.keyboard.press('ArrowUp');
    await expect(row('RASTER DEMO')).toBeFocused();
    await page.keyboard.press('Enter');
    // SPRITE was added to the work, a change in no project: opening a file in its place asks first
    await page.getByRole('dialog', { name: 'The work is not saved' }).getByRole('button', { name: 'Do not save' }).click();
    await expectFiles(page, ['RASTER DEMO.prg']);
    await expect(row('SPRITE')).not.toHaveAttribute('aria-current', 'true');
    // the next program on the disk, past its end, and back
    await page.keyboard.press('Alt+ArrowDown');
    await expectFiles(page, ['SPRITE.prg']);
    await expect(row('SPRITE')).toHaveAttribute('aria-current', 'true');
    await expect(row('RASTER DEMO')).not.toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Alt+ArrowDown');
    await expect(toast(page, 'That was the last program on mimir-demo.d64')).toBeVisible();
    await page.keyboard.press('Alt+ArrowUp');
    await expectFiles(page, ['RASTER DEMO.prg']);
  });

  await test.step('eject', async () => {
    await page.getByRole('button', { name: 'Eject disk' }).click();
    await expect(files).toHaveCount(0);
    await expectFiles(page, ['RASTER DEMO.prg']);
  });
});

test('the disk as a C64 lists it (Settings → General), and Mimir\'s list again', async ({ app, page }) => {
  // fixtures/d64/mimir-demo.d64: "RASTER DEMO" (49 blocks), "SPRITE", "NOTES" (SEQ); LIST of it on a C64 is checked
  // cell by cell against VICE in packages/core/test/dirlist.test.ts
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/d64/mimir-demo.d64')] });
  await fromFileMenu(page, 'Mount disk image (D64, G64)…');
  await expect(toast(page, 'Mounted mimir-demo.d64: "MIMIR DEMO", 3 files')).toBeVisible();
  await openSection(page, 'Disk');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const look = async (value: 'c64' | 'mimir') => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings.getByRole('tab', { name: 'General', exact: true }).click();
    await settings.getByLabel('The disk in the Explorer').selectOption(value);
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings).toBeHidden();
  };
  const screen = page.getByRole('list', { name: 'Files on mimir-demo.d64, as a C64 lists them' });
  const item = (name: string) => screen.locator(`[role=listitem][aria-label*='"${name}"']`);

  await test.step('LOAD"$",8 and LIST: the C64\'s screen, a part of the listing per item', async () => {
    await look('c64');
    await expect(page.locator('.disk-row')).toHaveCount(0);
    await expect(page.locator('.disk-head')).toHaveCount(0);
    await expect.poll(() => screen.getByRole('listitem').evaluateAll(l => l.map(e => e.getAttribute('aria-label'))))
      .toEqual(['0 "MIMIR DEMO      " KR 2A', '49 "RASTER DEMO" PRG', '1 "SPRITE" PRG', '1    "NOTES"            SEQ', '613 BLOCKS FREE.', 'READY.']);
    // 27 columns of 8 pixels, a row of 8 for each line and the cursor's
    expect(await page.locator('.c64-screen canvas').evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([216, 56]);
    // blocks free is on the screen, not under it
    await expect(page.locator('.side-inner')).not.toContainText('613 blocks free');
  });

  await test.step('a file\'s rows open it, + adds it, ↑ ↓ go from file to file; Aa switches the character set', async () => {
    await item('RASTER DEMO').click();
    await expect(toast(page, 'Loaded RASTER DEMO.prg at $0801')).toBeVisible();
    await page.getByRole('button', { name: 'Add SPRITE to this project' }).click();
    await expect(toast(page, 'Loaded SPRITE.prg at $c000')).toBeVisible();
    await expectFiles(page, ['RASTER DEMO.prg', 'SPRITE.prg']);
    await expect(item('RASTER DEMO')).toHaveAttribute('aria-current', 'true');
    await expect(item('SPRITE')).toHaveAttribute('aria-current', 'true');
    // NOTES (SEQ) is on the screen but does not open
    await expect(item('NOTES')).not.toHaveAttribute('tabindex', '0');
    await item('RASTER DEMO').focus();
    await page.keyboard.press('ArrowDown');
    await expect(item('SPRITE')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item('SPRITE')).toBeFocused();
    const aa = page.getByRole('button', { name: 'Lower case character set' });
    await aa.click();
    await expect(aa).toHaveAttribute('aria-pressed', 'true');
    await aa.click();
    await expect(aa).toHaveAttribute('aria-pressed', 'false');
  });

  await test.step('Mimir\'s list again', async () => {
    await look('mimir');
    await expect(screen).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Lower case character set' })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Files on mimir-demo.d64', exact: true }).getByRole('listitem'))
      .toHaveText([/49\s*"RASTER DEMO"\s*PRG/, /1\s*"SPRITE"\s*PRG/, /1\s*"NOTES"\s*SEQ/]);
    await expect(page.locator('.side-inner')).toContainText('613 blocks free');
  });
});

test('an error stays until it is dismissed, the Messages tab keeps what the toasts said, and the status bar\'s items do what they show', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  const selected = page.getByRole('region', { name: 'Panels' }).getByRole('tab', { selected: true });
  const item = (title: RegExp) => statusBar(page).getByTitle(title);

  await test.step('an error stays until it is dismissed; the status bar counts it and opens the Messages tab', async () => {
    const bad = join(work, 'broken.prg');
    writeFileSync(bad, Buffer.from([0x01]));
    await stubDialogs(app, { open: [bad] });
    await fromFileMenu(page, 'Open PRG files…');
    const err = toast(page, 'broken.prg: too short to be a PRG');
    await expect(err).toBeVisible();
    // past the 4.2 s the others stay
    await page.waitForTimeout(5000);
    await expect(err).toBeVisible();
    await err.getByRole('button', { name: 'Dismiss the message' }).click();
    await expect(err).toHaveCount(0);
    await item(/^Show the messages of this run \(\d+, 1 error\)/).click();
    await expect(selected).toHaveText(/^Messages\d+$/);
    await expect(page.getByRole('list', { name: 'Messages' }).getByRole('listitem').first()).toContainText('broken.prg: too short to be a PRG');
  });

  await test.step('the status bar: the analysis opens its log, the files the Explorer, the cursor Go to, the assembler Settings, the round-trip Verify', async () => {
    await item(/^Show the Analysis log/).click();
    await expect(selected).toHaveText(/^Analysis log\d+$/);
    await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Blocks' }).click();
    await item(/^Show the files in the Explorer/).click();
    await expect(page.getByRole('region', { name: 'Files', exact: true }).locator('.sec-toggle')).toHaveAttribute('aria-expanded', 'true');
    await item(/^Go to an address/).click();
    await expect(page.getByRole('dialog', { name: 'Go to address, label or range' })).toBeVisible();
    await page.keyboard.press('Escape');
    await item(/^Settings: the toolchain/).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Cancel' }).click();
    await item(/^Verify the round-trip/).click();
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });
});

test('Add PRG file… in the Explorer adds PRGs beside the open ones; the File menu opens and mounts', async ({ app, page }) => {
  await waitForListing(page);
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
  await fromFileMenu(page, 'Open PRG files…');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  const section = await openSection(page, 'Files');
  await expect(section.getByRole('button', { name: 'Open PRG…' })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Mount D64/G64…' })).toHaveCount(0);

  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/spindle-demo.prg')] });
  await section.getByRole('button', { name: 'Add PRG file…' }).click();
  await expect(toast(page, 'Loaded spindle-demo.prg at $0400')).toBeVisible();
  await expectFiles(page, ['raster-demo.prg', 'spindle-demo.prg']);
  expect((await dialogOptions(app)).at(-1)?.title).toBe('Add PRG files to the project');
  // Ctrl+Z takes the added file out again
  await page.keyboard.press('Control+z');
  await expectFiles(page, ['raster-demo.prg']);
});

test('open a cartridge: every bank is in the listing, one after the other, and the .crt is rebuilt', async ({ workDir: work, app, page }) => {
  // fixtures/crt/mimir-demo.crt (packages/core/test/crt.test.ts): a Magic Desk of 2 banks; bank 0 starts it (CBM80)
  // and shows bank 1's text. Each bank is a space of its own (spec 13.9b): bank 1's $8000 is $18000
  const crtPath = join(repoDir, 'fixtures/crt/mimir-demo.crt'), crt = readFileSync(crtPath);
  await waitForListing(page);
  const banks = page.getByRole('list', { name: 'Banks of mimir-demo.crt' });

  await test.step('File → Open a cartridge (.crt)…: every chip opens, and the Explorer lists the banks', async () => {
    await openSection(page, 'Files');
    await stubDialogs(app, { open: [crtPath] });
    await fromFileMenu(page, 'Open a cartridge (.crt)…');
    await expect(toast(page, 'Opened the cartridge mimir-demo.crt: Magic Desk (Domark, HES Australia), 2 banks of 8 KB (16 KB), 8K mode; bank00_8000.prg at $8000, bank01_8000.prg at $8000')).toBeVisible();
    await openSection(page, 'Cartridge');
    await expectFiles(page, ['bank00_8000.prg', 'bank01_8000.prg']);
    await expect(banks.getByRole('listitem')).toHaveText([/0\s*\$8000 · start\s*8 KB/, /1\s*\$8000\s*8 KB/]);
    for (const row of await banks.getByRole('listitem').all()) await expect(row).toHaveClass(/on/);
    await expect(page.locator('.disk-head').first()).toContainText('"MIMIR DEMO"');
    await expect.poll(() => page.locator('.side-sec').evaluateAll(s => s.map(e => e.getAttribute('aria-label'))))
      .toEqual(['Files', 'Cartridge', 'VICE quicksave', 'Scripts', 'Loaders', 'Program start', 'Memory map']);
    // both banks in the listing, each under its own file bar; bank 0's vectors and signature, and the code they start
    // (read once the analysis is done: on a slow machine, a laptop on battery say, it is still running here)
    await expect(statusBar(page)).not.toContainText('analysing');
    const rows = await listingRows(page);
    expect(rows.filter(r => /\.asm · bank \d+$/.test(r.text.trim())).map(r => r.text.trim())).toEqual(['bank00_8000.asm · bank 0', 'bank01_8000.asm · bank 1']);
    expect(rows.some(r => /^cart_vectors:/.test(r.text.trim()))).toBe(true);
    expect(rows.some(r => r.text.includes('.text "CBM80"'))).toBe(true);
    expect(rows.some(r => /^warm_start:/.test(r.text.trim()))).toBe(true);
    await expect(statusBar(page)).toContainText('bank 0 · $8009 · start');
    // the offset in the .crt, left of the address (as in SourceGen): the 64-byte header and bank 0's CHIP header first
    await expect(listing(page).locator('.row.cur .off')).toHaveText('+000059');
  });

  await test.step('a click on a bank goes to it; G takes a bank before the address', async () => {
    await banks.getByRole('listitem').nth(1).click();
    await expect(statusBar(page)).toContainText('bank 1 · $8000');
    // bank 1's data comes after bank 0's packet and its own CHIP header
    await expect(listing(page).locator('.row.cur .off')).toHaveText('+002060');
    await expect(listing(page).locator('.row.cur .off')).toHaveAttribute('title', 'Offset $2060 (8288) in mimir-demo.crt');
    // the Offset button hides the column, and shows it again
    const offset = page.getByRole('button', { name: 'Offset', exact: true });
    await expect(offset).toHaveAttribute('aria-pressed', 'true');
    await offset.click();
    await expect(listing(page).locator('.off')).toHaveCount(0);
    await offset.click();
    await expect(listing(page).locator('.row.cur .off')).toHaveText('+002060');
    // the Inspector's memory map shows the cursor's bank
    await expect(page.locator('.insp-sec .sec-head').first()).toContainText('Memory map · bank 1');
    await page.keyboard.press('g');
    await page.locator('#goto-input').fill('0:8009');
    await page.locator('#goto-input').press('Enter');
    await expect(statusBar(page)).toContainText('bank 0 · $8009 · start');
  });

  await test.step('a name and a type set in bank 1 stay in bank 1', async () => {
    await page.keyboard.press('g');
    await page.locator('#goto-input').fill('1:8000');
    await page.locator('#goto-input').press('Enter');
    await page.keyboard.press('n');
    await page.getByLabel('Label at $8000').fill('bank1_text');
    await page.getByLabel('Label at $8000').press('Enter');
    await expect(statusBar(page)).toContainText('bank 1 · $8000 · bank1_text');
    const rows = await listingRows(page);
    expect(rows.filter(r => /^bank1_text:/.test(r.text.trim()))).toHaveLength(1);
    expect(rows.some(r => /^cart_vectors:/.test(r.text.trim()))).toBe(true);
  });

  await test.step('× leaves a bank out of the project, + adds it again', async () => {
    await banks.getByRole('listitem').nth(1).hover();
    await page.getByRole('button', { name: 'Leave bank 1 out of the project' }).click();
    await expectFiles(page, ['bank00_8000.prg']);
    await expect(banks.getByRole('listitem').nth(1)).toHaveClass(/out/);
    await page.getByRole('button', { name: 'Add bank 1 to this project' }).click();
    await expect(toast(page, 'Added bank 1 of mimir-demo.crt: bank01_8000.prg at $8000')).toBeVisible();
    await expectFiles(page, ['bank00_8000.prg', 'bank01_8000.prg']);
    // the name given in bank 1 is still there
    expect((await listingRows(page)).some(r => /^bank1_text:/.test(r.text.trim()))).toBe(true);
  });

  await test.step('Memory and Graphics show the bank picked over them; the cursor goes along, to the same address', async () => {
    await page.keyboard.press('g');
    await page.locator('#goto-input').fill('0:8009');
    await page.locator('#goto-input').press('Enter');
    await page.getByRole('tab', { name: 'Memory' }).click();
    const pick = page.getByLabel('Cartridge bank');
    const row = page.getByLabel('Memory dump').locator('.mon-row', { has: page.locator('.mon-adr', { hasText: /C:8000/ }) });
    await expect(pick).toHaveValue('0');
    await expect(pick.locator('option')).toHaveText(['All banks', '0 · $8000 · start', '1 · $8000']);
    // bank 0's cartridge vectors and CBM80, then bank 1's text at the same address
    await expect(row).toContainText('09 80 34 80  c3 c2 cd 38');
    // the bank before the row's >C:
    await expect(row.locator('.mon-adr')).toHaveText(/^0 >C:8000/);
    await pick.selectOption('1');
    await expect(statusBar(page)).toContainText('bank 1 · $8009');
    await expect(row).toContainText('0d 09 0d 09  12 20 13 14');
    await expect(row.locator('.mon-adr')).toHaveText(/^1 >C:8000/);
    await expect(page.locator('.monv .gfxv-info')).toContainText('$8009 = $04');
    await expect(page.getByRole('button', { name: 'Next bank' })).toBeDisabled();
    // Graphics shows the cursor's bank too, and the arrow steps back to bank 0
    await page.getByRole('tab', { name: 'Graphics' }).click();
    await expect(pick).toHaveValue('1');
    await page.getByRole('button', { name: 'Previous bank' }).click();
    await expect(pick).toHaveValue('0');
    await expect(statusBar(page)).toContainText('bank 0 · $8009');
    await expect(page.getByRole('button', { name: 'Previous bank' })).toBeDisabled();
    // a bank out of the project is in the list, but cannot be picked until + adds it
    await banks.getByRole('listitem').nth(1).hover();
    await page.getByRole('button', { name: 'Leave bank 1 out of the project' }).click();
    await expect(pick.locator('option')).toHaveText(['0 · $8000 · start', '1 · $8000 (not in the project)']);
    await expect(pick.locator('option').nth(1)).toBeDisabled();
    await expect(pick).toHaveValue('0');
    await page.getByRole('button', { name: 'Add bank 1 to this project' }).click();
    await expect(pick.locator('option[value="1"]')).toBeEnabled();
    // the listing has bank 1 again once its analysis is in (the option is enabled as + adds it, before that): bank 0
    // alone is analysed without banks, and the status bar then shows the cursor without its bank. Scrolled before
    // that, the listing ends in bank 0, and Memory rightly opens there
    await expect(statusBar(page)).toContainText('bank 0 · $8009');
    await page.getByRole('tab', { name: 'Listing' }).click();
    // the listing scrolled into bank 1 (the cursor stays in bank 0, off screen): Memory opens in bank 1, there
    const top = await listing(page).evaluate(async el => {
      el.scrollTop = el.scrollHeight;
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      const rows = [...el.querySelectorAll<HTMLElement>('.row')].filter(r => r.querySelector('.adr')?.textContent?.trim()).sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
      return parseInt(rows.find(r => parseFloat(r.style.top) >= el.scrollTop - 1)?.querySelector('.adr')?.textContent ?? '', 16);
    });
    await page.getByRole('tab', { name: 'Memory' }).click();
    await expect(pick).toHaveValue('1');
    await expect(statusBar(page)).toContainText('bank 0 · $8009');
    // the dump's top row holds the listing's top address, and bank 1's bytes are shown
    await expect.poll(() => page.getByLabel('Memory dump').evaluate(el => {
      const row = [...el.querySelectorAll<HTMLElement>('.mon-row')].find(r => parseFloat(r.style.top) <= el.scrollTop + 1 && parseFloat(r.style.top) + 20 > el.scrollTop + 1);
      return parseInt(/C:([0-9a-f]{4})/.exec(row?.textContent ?? '')?.[1] ?? '', 16);
    })).toBe(top - (top % 16));
    await expect(row).toContainText('0d 09 0d 09');
    await page.getByRole('tab', { name: 'Listing' }).click();
  });

  await test.step('All banks shows every bank in Memory and Graphics, and is All banks in one .asm', async () => {
    const pick = page.getByLabel('Cartridge bank'), one = page.getByRole('checkbox', { name: 'All banks in one .asm' });
    const dump = page.getByLabel('Memory dump');
    await page.getByRole('tab', { name: 'Memory' }).click();
    await pick.selectOption('all');
    await expect(one).toBeChecked();
    // the dump starts where the listing was, in bank 1: its line over its rows, at bank addresses
    await expect(dump.locator('.mon-bank', { hasText: 'bank 1' })).toHaveText('bank 1 · $8000–$9fff');
    // a command takes the bank before the address: bank 0 is before bank 1
    const command = async (c: string) => { await page.getByLabel('Monitor command').fill(c); await page.getByLabel('Monitor command').press('Enter'); };
    await command('m 0:8000');
    await expect(dump.locator('.mon-bank', { hasText: 'bank 0' })).toHaveText('bank 0 · $8000–$9fff');
    await expect(statusBar(page)).toContainText('bank 0 · $8000');
    await expect(page.locator('.monv .gfxv-info')).toContainText('0:$8000 = $09');
    await command('m 1:8000');
    await expect(statusBar(page)).toContainText('bank 1 · $8000');
    await expect(page.locator('.monv .gfxv-info')).toContainText('1:$8000 = $0d');
    // each row has its own bank before its >C:
    await expect(dump.locator('.mon-row', { has: page.locator('.mon-adr', { hasText: /^1 >C:8000/ }) })).toContainText('0d 09 0d 09');
    await command('ii 0:8000');
    await expect(dump.locator('.mon-adr', { hasText: /^0 \*C:8000/ })).toBeVisible();
    await command('m 1:8000');
    // Graphics lays both banks out, one after the other
    await page.getByRole('tab', { name: 'Graphics' }).click();
    await expect(pick).toHaveValue('all');
    await expect(page.locator('.gfxv-row.bank-top')).toHaveCount(2);
    await expect(page.locator('.gfxv-row.bank-top').nth(1)).toContainText('1:$8000');
    await expect(page.locator('.gfxv-info')).toContainText('cursor 1:$8000');
    // the checkbox off: one bank again, the cursor's
    await one.uncheck();
    await expect(pick).toHaveValue('1');
    await expect(page.locator('.gfxv-row.bank-top')).toHaveCount(0);
    // on with the checkbox, off by picking one bank
    await one.check();
    await expect(pick).toHaveValue('all');
    await pick.selectOption('0');
    await expect(one).not.toBeChecked();
    await expect(statusBar(page)).toContainText('bank 0 · $8000');
    await page.getByRole('tab', { name: 'Listing' }).click();
  });

  await test.step('F7 verifies both banks and the cartridge rebuilt from them', async () => {
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
    await page.getByRole('tab', { name: 'Build output' }).click();
    await expect(page.locator('.build-log')).toContainText('bank01_8000.asm');
    await expect(page.locator('.build-log')).toContainText('Built-in cartridge OK: mimir-demo.crt 16480 / 16480 bytes identical to mimir-demo.crt');
  });

  await test.step('Ctrl+E exports every bank\'s source, the cartridge\'s, and the image they build', async () => {
    const out = join(work, 'export');
    await stubDialogs(app, { open: [out] });
    await page.keyboard.press('Control+e');
    await expect(toast(page, `Exported verified Kick Assembler project to ${out}`)).toBeVisible({ timeout: 90_000 });
    expect(readdirSync(out)).toEqual(expect.arrayContaining(['bank00_8000.asm', 'bank01_8000.asm', 'mimir-demo.crt.asm', 'build.bat', 'out', 'original']));
    expect(readdirSync(out)).not.toContain('banks');
    expect(readFileSync(join(out, 'bank01_8000.asm'), 'utf8')).toContain('bank1_text:');
    expect(readFileSync(join(out, 'out', 'mimir-demo.crt'))).toEqual(crt);
    expect(readFileSync(join(out, 'original', 'mimir-demo.crt'))).toEqual(crt);
    expect(readFileSync(join(out, 'build.bat'), 'utf8')).toMatch(/mimir-demo\.crt\.asm -odir out[^\n]*\r\nstart "" "%VICE%" .*-cartcrt out\\mimir-demo\.crt/);
  });

  await test.step('Build & Run attaches the rebuilt cartridge in VICE', async () => {
    // VICE itself is not started: a Windows program that ends at once stands in for it (the real VICE starting the
    // cartridge is tested in packages/core/test/vice.integration.test.ts)
    const standIn = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe');
    test.skip(!existsSync(standIn), 'needs where.exe');
    await page.evaluate(v => (window as unknown as { kr: { setSettings(p: object): Promise<unknown> } }).kr.setSettings({ vicePath: v }), standIn);
    await page.keyboard.press('F5');
    await expect(toast(page, /^VICE started the cartridge mimir-demo\.crt/)).toBeVisible({ timeout: 120_000 });
    const log = await page.locator('.build-log').innerText();
    const started = /> VICE started \(pid -?\d+\): the cartridge (.+?\.crt) attached \(-cartcrt\)/.exec(log);
    expect(started, log.slice(-600)).toBeTruthy();
    expect(readFileSync(started![1])).toEqual(crt);
  });
});

test('a cartridge with every bank in one .asm: the listing, the source, verify and export', async ({ workDir: work, app, page }) => {
  // spec 13.9c: All banks in one .asm (Explorer → Cartridge) makes mimir-demo.crt.asm, which writes the whole image
  const crtPath = join(repoDir, 'fixtures/crt/mimir-demo.crt'), crt = readFileSync(crtPath);
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [crtPath] });
  await fromFileMenu(page, 'Open a cartridge (.crt)…');
  await expect(toast(page, /^Opened the cartridge mimir-demo\.crt/)).toBeVisible();
  await openSection(page, 'Cartridge');
  const one = page.getByRole('checkbox', { name: 'All banks in one .asm' });

  await test.step('the box makes one source of every bank, under one file bar', async () => {
    await expect(one).not.toBeChecked();
    await one.check();
    await expect(one).toBeChecked();
    // the listing comes when the worker has rendered it as one source
    await expect.poll(async () => (await listingRows(page)).filter(r => /\.asm( · |$)/.test(r.text.trim())).map(r => r.text.trim()))
      .toEqual(['mimir-demo.crt.asm · every bank']);
    const rows = await listingRows(page);
    expect(rows.some(r => r.text.trim() === '.namespace bank00 {')).toBe(true);
    expect(rows.some(r => r.text.trim() === '.namespace bank01 {')).toBe(true);
    expect(rows.some(r => r.text.includes('.segmentout [segments="Bank01_8000"]'))).toBe(true);
    // editing goes on as before: a name in bank 1 (the box has the focus: the listing gets it back)
    await listing(page).locator('.row.cur').click();
    await page.keyboard.press('g');
    await page.locator('#goto-input').fill('1:8000');
    await page.locator('#goto-input').press('Enter');
    await page.keyboard.press('n');
    await page.getByLabel('Label at $8000').fill('bank1_text');
    await page.getByLabel('Label at $8000').press('Enter');
    await expect(statusBar(page)).toContainText('bank 1 · $8000 · bank1_text');
  });

  await test.step('the source tab shows the one .asm', async () => {
    await page.getByRole('tab', { name: 'mimir-demo.crt.asm' }).click();
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
    // the source opens at the listing's cursor: its head is at the top
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.press('Control+Home');
    await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('every bank of the cartridge in one source');
    await page.getByRole('tab', { name: 'Listing' }).click();
  });

  await test.step('F7 verifies, and the export has the one source and a build that assembles it alone', async () => {
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
    await page.getByRole('tab', { name: 'Build output' }).click();
    await expect(page.locator('.build-log')).toContainText('Built-in cartridge OK: mimir-demo.crt 16480 / 16480 bytes identical to mimir-demo.crt');
    const out = join(work, 'export-one');
    await stubDialogs(app, { open: [out] });
    await page.keyboard.press('Control+e');
    await expect(toast(page, `Exported verified Kick Assembler project to ${out}`)).toBeVisible({ timeout: 90_000 });
    const asm = readdirSync(out).filter(f => f.endsWith('.asm'));
    expect(asm).toEqual(['mimir-demo.crt.asm']);
    expect(readFileSync(join(out, 'mimir-demo.crt.asm'), 'utf8')).toMatch(/\.namespace bank01 \{\n\.segment Bank01_8000\n[\s\S]*bank1_text:/);
    expect(readFileSync(join(out, 'out', 'mimir-demo.crt'))).toEqual(crt);
    expect(readFileSync(join(out, 'build.bat'), 'utf8')).toMatch(/KICKASS%" mimir-demo\.crt\.asm -odir out[^\n]*\r\nstart "" "%VICE%" .*-moncommands out\\mimir-demo\.crt\.vs -cartcrt out\\mimir-demo\.crt/);
  });

  await test.step('off again: a source per chip', async () => {
    await one.uncheck();
    // the listing comes when the worker has rendered it again
    await expect.poll(async () => (await listingRows(page)).filter(r => /\.asm · bank \d+$/.test(r.text.trim())).map(r => r.text.trim()))
      .toEqual(['bank00_8000.asm · bank 0', 'bank01_8000.asm · bank 1']);
  });
});

test('the Terminal button opens a terminal in the project folder', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  // record what the main process starts instead of opening a real terminal window
  await app.evaluate(() => {
    const req = (process as unknown as { mainModule: { require: (m: string) => any } }).mainModule.require; // eslint-disable-line @typescript-eslint/no-explicit-any
    const cp = req('node:child_process'), { EventEmitter } = req('node:events');
    const g = globalThis as unknown as { spawned: { file: string; args: string[]; cwd: string; jar?: string }[] };
    g.spawned = [];
    const real = cp.spawn;
    cp.spawn = (file: string, args: string[], o: { cwd: string; env: Record<string, string> }) => {
      // Kick Assembler (verify, export) still runs for real; Windows opens the terminal with `cmd /c start`
      const terminal = file === 'cmd.exe' ? /^\/d \/c start /.test(args[0] ?? '') : ['open', 'x-terminal-emulator'].includes(file);
      if (!terminal) return real(file, args, o);
      g.spawned.push({ file, args, cwd: o.cwd, jar: o.env.KICKASS_JAR });
      const child = Object.assign(new EventEmitter(), { pid: 4242, unref: () => {} });
      setImmediate(() => child.emit('spawn'));
      return child;
    };
  });
  const spawned = () => app.evaluate(() => (globalThis as unknown as { spawned: { file: string; args: string[]; cwd: string }[] }).spawned);
  const home = await app.evaluate(() => (process as unknown as { mainModule: { require: (m: string) => { homedir: () => string } } }).mainModule.require('node:os').homedir());

  await test.step('with no folder opened yet it starts in the home folder', async () => {
    await page.getByRole('button', { name: 'Terminal' }).click();
    await expect(toast(page, `Terminal opened in ${home}`)).toBeVisible();
    expect((await spawned())[0]).toMatchObject({ file: process.platform === 'win32' ? 'cmd.exe' : expect.any(String), cwd: home });
    if (process.platform === 'win32') expect((await spawned())[0].args[0]).toMatch(/start "Mimir Studio" \/D .* powershell\.exe -NoLogo -NoExit -Command /);
  });

  await test.step('after an export it starts in the exported folder', async () => {
    const out = join(work, 'export');
    await stubDialogs(app, { open: [out] });
    await page.keyboard.press('Control+e');
    await expect(toast(page, `Exported verified Kick Assembler project to ${out}`)).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Terminal' }).click();
    await expect(toast(page, `Terminal opened in ${out}`)).toBeVisible();
    expect((await spawned())[1].cwd).toBe(out);
  });
});

test('the Editor button opens the export in the external editor, with its first .asm file', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  // the editor set in Settings; what the main process starts is recorded instead of opening a real editor
  const subl = join(work, 'Sublime Text', 'subl.exe');
  mkdirSync(dirname(subl), { recursive: true });
  writeFileSync(subl, '');
  await app.evaluate((_e, exe) => {
    const req = (process as unknown as { mainModule: { require: (m: string) => any } }).mainModule.require; // eslint-disable-line @typescript-eslint/no-explicit-any
    const cp = req('node:child_process'), { EventEmitter } = req('node:events');
    const g = globalThis as unknown as { spawned: { file: string; args: string[]; cwd: string }[] };
    g.spawned = [];
    const real = cp.spawn;
    cp.spawn = (file: string, args: string[], o: { cwd: string }) => {
      // Kick Assembler (verify, export) still runs for real
      if (file !== exe) return real(file, args, o);
      g.spawned.push({ file, args, cwd: o.cwd });
      const child = Object.assign(new EventEmitter(), { pid: 4242, unref: () => {} });
      setImmediate(() => child.emit('spawn'));
      return child;
    };
  }, subl);
  const spawned = () => app.evaluate(() => (globalThis as unknown as { spawned: { file: string; args: string[]; cwd: string }[] }).spawned);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#set-editorPath').fill(subl);
  await expect(page.locator('#set-editorArgs')).toHaveValue('{dir} {file}');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
  const editor = page.getByRole('button', { name: 'Editor', exact: true });
  await expect(editor).toHaveAttribute('title', /^Open the export in Sublime Text:/);
  const out = join(work, 'export');

  await test.step('before an export it exports the project first, then opens that', async () => {
    await stubDialogs(app, { open: [out] });
    await editor.click();
    await expect(toast(page, `Exported verified Kick Assembler project to ${out}`)).toBeVisible({ timeout: 90_000 });
    await expect(toast(page, `Sublime Text opened ${out} with raster-demo.asm`)).toBeVisible();
    expect(await spawned()).toEqual([{ file: subl, args: [out, join(out, 'raster-demo.asm')], cwd: out }]);
  });

  await test.step('after it, the export is opened as it is', async () => {
    writeFileSync(join(out, 'raster-demo.asm'), '// edited in the editor\n');
    await editor.click();
    await expect.poll(async () => (await spawned()).length).toBe(2);
    expect((await spawned())[1]).toEqual({ file: subl, args: [out, join(out, 'raster-demo.asm')], cwd: out });
    expect(readFileSync(join(out, 'raster-demo.asm'), 'utf8')).toBe('// edited in the editor\n');
  });
});

test('Settings → Choose folder… finds the program in the folder picked', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  /** the folder dialogs answer `answers` in turn, then are cancelled; returns each dialog's title and start folder */
  const answer = async (...answers: string[][]) => {
    await app.evaluate(({ dialog }, a) => {
      const g = globalThis as unknown as { asked: { title?: string; defaultPath?: string; properties?: string[] }[] };
      g.asked = [];
      (dialog as unknown as Record<string, unknown>).showOpenDialog = async (...args: unknown[]) => {
        const o = args[args.length - 1] as { title?: string; defaultPath?: string; properties?: string[] };
        g.asked.push({ title: o.title, defaultPath: o.defaultPath, properties: o.properties });
        const next = a.shift();
        return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] };
      };
    }, answers);
  };
  const asked = () => app.evaluate(() => (globalThis as unknown as { asked: { title?: string; defaultPath?: string; properties?: string[] }[] }).asked);
  const make = (...p: string[]) => { const f = join(work, ...p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, ''); return f; };
  // VICE unpacked from its zip (x64sc.exe in bin of the folder in it), Kick Assembler, an Exomizer release (win32)
  const x64sc = make('C64', 'vice', 'GTK3VICE-3.10-win64', 'bin', 'x64sc.exe');
  const jar = make('C64', 'KickAssembler', 'KickAss.jar');
  const exo = make('C64', 'exomizer-3.1.1', 'win32', 'exomizer.exe');
  const other = make('C64', 'tools', 'myunp.exe');
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const choose = (label: string) => settings.getByRole('button', { name: `Choose folder for ${label}`, exact: true });

  await test.step('VICE: the folder it was unpacked to', async () => {
    await answer([join(work, 'C64', 'vice')]);
    await choose('VICE emulator (x64sc)').click();
    await expect(settings.locator('#set-vicePath')).toHaveValue(x64sc);
    expect(await asked()).toEqual([expect.objectContaining({ title: 'Choose the folder VICE is in', properties: ['openDirectory'] })]);
  });

  await test.step('Kick Assembler and Exomizer: the folder, and its win32 folder', async () => {
    await answer([join(work, 'C64', 'KickAssembler')]);
    await choose('KickAss.jar').click();
    await expect(settings.locator('#set-kickJar')).toHaveValue(jar);
    await answer([join(work, 'C64')]);
    await choose('Exomizer').click();
    await expect(settings.locator('#set-exomizerPath')).toHaveValue(exo);
  });

  await test.step('the dialog opens at the folder of the path set, above its bin folder', async () => {
    await answer();
    await choose('VICE emulator (x64sc)').click();
    await expect.poll(asked).toEqual([expect.objectContaining({ defaultPath: join(work, 'C64', 'vice', 'GTK3VICE-3.10-win64') })]);
    await expect(settings.locator('#set-vicePath')).toHaveValue(x64sc);
  });

  await test.step('not in the folder: a file dialog opens there for it', async () => {
    await answer([join(work, 'C64', 'tools')], [other]);
    await choose('External unpacker (optional)').click();
    await expect(settings.locator('#set-unpackerPath')).toHaveValue(other);
    expect((await asked())[1]).toEqual({ title: 'unp64.exe is not in tools: choose the external unpacker', defaultPath: join(work, 'C64', 'tools'), properties: ['openFile'] });
  });

  await test.step('that dialog cancelled: the field keeps its path and says what was not there', async () => {
    await answer([join(work, 'C64', 'tools')]);
    await choose('Java executable').click();
    await expect(settings.getByRole('status').filter({ hasText: `java.exe is not in ${join(work, 'C64', 'tools')} or the folders in it` })).toBeVisible();
    await expect(settings.locator('#set-javaPath')).toHaveValue('java');
  });

  await test.step('Save settings keeps the paths found', async () => {
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings).toBeHidden();
    const stored = await page.evaluate(() => (window as unknown as { kr: { getSettings(): Promise<Record<string, string>> } }).kr.getSettings());
    expect(stored).toMatchObject({ vicePath: x64sc, kickJar: jar, exomizerPath: exo, unpackerPath: other });
  });
});

test('a packed PRG is reported and unpacked with Sindri, or an external unpacker', async ({ app, page }) => {
  // fixtures/prg/packed-demo.prg: the demo behind a decruncher stub (fakePack: a mover, then a decoder at $0340),
  // which Sindri runs in its emulated C64; fake-unp64.cjs (a stand-in for unp64, run with this Node)
  // undoes it as an external unpacker and names its result `<name>.0810` the way unp64 does
  const fake = join(repoDir, 'packages/core/test/helpers/fake-unp64.cjs');
  await waitForListing(page);
  await openSection(page, 'Files');
  await openSection(page, 'Program start');
  const bar = page.locator('.pack-bar');
  const done = page.locator('.unpack-bar');
  const open = async () => {
    await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/packed-demo.prg')] });
    await page.keyboard.press('Control+o');
    await expect(bar).toContainText('packed-demo.prg is packed.');
  };

  await test.step('opening it shows the packed notice with the layers, the Explorer badge and a problem', async () => {
    await open();
    await expect(toast(page, 'Loaded packed-demo.prg at $0801')).toBeVisible();
    await expect(bar).toContainText('The listing shows the decruncher at $080d and the packed data, not the program.');
    // Sindri runs every file opened and reports what it peeled off
    await expect(bar).toContainText(/Sindri peels off 2 layers: an unknown mover at \$080d \(fingerprint [0-9a-f]{8}\), then an unknown decoder at \$0340 \(fingerprint [0-9a-f]{8}\); the program starts at \$0810/, { timeout: 30_000 });
    await openSection(page, 'Files');
    await expect(page.locator('.file-row', { hasText: 'packed-demo.prg' }).locator('.pill.pack')).toHaveText('packed');
    await page.keyboard.press('Control+j');
    await page.getByRole('tab', { name: /Problems/ }).click();
    await expect(page.locator('.loglist')).toContainText('packed-demo.prg is packed');
    await expect(page.locator('.loglist')).toContainText('Unpack it (Unpack) to see the program.');
  });

  await test.step('Unpack replaces it with the program and sets its start', async () => {
    await bar.getByRole('button', { name: 'Unpack', exact: true }).click();
    await expect(toast(page, 'Unpacked packed-demo.prg: 12287 bytes at $0801-$37ff')).toBeVisible({ timeout: 30_000 });
    await expect(done).toContainText('Unpacked packed-demo.prg: packed-demo-unpacked.prg, $0801-$37ff, starting at $0810 (set as the program start).');
    await done.getByText('Layer report').click();
    await expect(done.locator('.unpack-log')).toContainText('layer 0  $080d  start           mover');
    await expect(done.locator('.unpack-log')).toContainText('layer 1  $0340  jmp from $0839  decoder');
    await expect(done.locator('.unpack-log')).toContainText('saved layer 2: $0801-$37ff (12.0 KB), start with SYS 2064 = $0810');
    await expect(bar).toHaveCount(0);
    await expectFiles(page, ['packed-demo-unpacked.prg']);
    await expect(page.locator('.side-sec', { hasText: 'Program start' })).toContainText('set by you');
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('with Unpack packed files when they are opened, it is unpacked as it opens; a program that is not packed opens as it is', async () => {
    await page.getByRole('button', { name: 'Dismiss the unpacker result' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('tab', { name: 'General', exact: true }).click();
    await settings.getByLabel('Unpack packed files when they are opened').check();
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings).toBeHidden();
    await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/packed-demo.prg')] });
    await page.keyboard.press('Control+o');
    await expect(done).toContainText('Unpacked packed-demo.prg as it was opened (Settings → General): packed-demo-unpacked.prg, $0801-$37ff, starting at $0810', { timeout: 30_000 });
    await expect(bar).toHaveCount(0);
    await expectFiles(page, ['packed-demo-unpacked.prg']);
    // a program that is not packed opens as it is
    await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
    await page.keyboard.press('Control+o');
    await expect(statusBar(page)).toContainText('$0810 · start');
    await expect(statusBar(page)).not.toContainText('analysing');
    await expectFiles(page, ['raster-demo.prg']);
    // off again for the external unpacker below
    await page.getByRole('button', { name: 'Settings' }).click();
    await settings.getByRole('tab', { name: 'General', exact: true }).click();
    await settings.getByLabel('Unpack packed files when they are opened').uncheck();
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings).toBeHidden();
  });

  await test.step('an external unpacker set in Settings runs instead', async () => {
    await page.getByRole('button', { name: 'Dismiss the unpacker result' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.locator('#set-unpackerPath')).toHaveValue('');
    await page.locator('#set-unpackerPath').fill(process.execPath);
    await page.locator('#set-unpackerArgs').fill(`"${fake}" {in}`);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
    await open();
    await bar.getByRole('button', { name: 'Unpack with node' }).click();
    await expect(done).toContainText('Unpacked packed-demo.prg with node (FakePack): packed-demo-unpacked.prg, $0801-$37ff, starting at $0810 (set as the program start).', { timeout: 30_000 });
    await done.getByText('node output').click();
    await expect(done.locator('.unpack-log')).toContainText('return to mem: $0810');
    await expect(done.locator('.unpack-log')).toContainText('saved $0801-$37ff as packed-demo.prg.0810');
    await expectFiles(page, ['packed-demo-unpacked.prg']);
  });
});

test('a program that waits for a key in front of more packing: Unpack again runs it from the start the first one set', async ({ app, page }) => {
  // fixtures/prg/packed-menu.prg (packages/core/test/sindri.test.ts), as a cracked game's trainer menu waits in front
  // of the packed game: fakePack unpacks $07f0-$390c and starts it at $07f8, which waits for a key and then starts the
  // demo packed by fakePack. As LOAD leaves it, neither SYS to where it loads ($07f0) nor RUN starts it: JAMs there
  await waitForListing(page);
  await openSection(page, 'Files');
  const bar = page.locator('.pack-bar');
  const done = page.locator('.unpack-bar');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/packed-menu.prg')] });
  await page.keyboard.press('Control+o');
  await expect(bar).toContainText('packed-menu.prg is packed.');
  await expect(bar).toContainText(/Sindri peels off 2 layers: an unknown mover at \$080d .*; the program starts at \$07f8/, { timeout: 30_000 });
  await bar.getByRole('button', { name: 'Unpack', exact: true }).click();
  await expect(done).toContainText('Unpacked packed-menu.prg: packed-menu-unpacked.prg, $07f0-$390c, starting at $07f8 (set as the program start).', { timeout: 30_000 });
  // Sindri runs the unpacked program from that start, and the keys it presses get past the wait to the packed demo
  await expect(bar).toContainText('packed-menu-unpacked.prg is packed.', { timeout: 30_000 });
  await expect(bar).toContainText(/Sindri peels off 2 layers: an unknown mover at \$07f8 .*, then an unknown decoder at \$0340 .*; the program starts at \$0810/, { timeout: 30_000 });
  await bar.getByRole('button', { name: 'Unpack', exact: true }).click();
  await expect(toast(page, 'Unpacked packed-menu-unpacked.prg: 12287 bytes at $0801-$37ff')).toBeVisible({ timeout: 30_000 });
  await expect(done).toContainText('packed-menu-unpacked-unpacked.prg, $0801-$37ff, starting at $0810 (set as the program start).');
  await expect(bar).toHaveCount(0);
});

test('a VICE snapshot that still holds packed data: Sindri goes on from it, and Unpack gives the program', async ({ app, page }) => {
  // fixtures/vsf/packed-menu.vsf (make-packed-menu.mon): fixtures/prg/packed-menu.prg in x64sc 3.10, stopped where it
  // waits for a key at $07f8, in front of the demo packed by fakePack. Going on from there needs VICE's ROMs
  test.skip(!process.env.C64_ROMS && !existsSync('C:\\C64\\VICE'), 'needs VICE\'s ROMs');
  await waitForListing(page);
  await openSection(page, 'Files');
  const bar = page.locator('.pack-bar');
  const done = page.locator('.unpack-bar');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/vsf/packed-menu.vsf')] });
  await fromFileMenu(page, 'Open a VICE snapshot (.vsf)…');
  await expect(toast(page, 'Loaded packed-menu.prg at $0200')).toBeVisible();
  await expect(bar).toContainText('packed-menu.prg is packed.', { timeout: 30_000 });
  await expect(bar).toContainText(/Going on from the snapshot \(the CPU at \$07f8\), Sindri peels off 2 layers: an unknown mover at \$07f8 .*, then an unknown decoder at \$0340 .*; the packed data was at \$090e-\$390c; the program starts at \$0810/);
  await bar.getByRole('button', { name: 'Unpack', exact: true }).click();
  await expect(toast(page, 'Unpacked packed-menu.prg: 65024 bytes at $0200-$ffff')).toBeVisible({ timeout: 30_000 });
  await expect(done).toContainText('packed-menu-unpacked.prg, $0200-$ffff, starting at $0810 (set as the program start).');
  await done.getByText('Layer report').click();
  await expect(done.locator('.unpack-log')).toContainText('Snapshot: going on from where it was taken, the CPU at $07f8');
  await expect(bar).toHaveCount(0);
});

test('a file opened from a mounted disk is unpacked with the disk in a 1541', async ({ app, page }) => {
  // fixtures/d64/kernal-load.d64: BOOT loads PART2 ($c000) with LOAD "PART2",8,1 through the KERNAL and jumps to it.
  // The 1541 needs VICE's DOS ROM, which a machine without VICE does not have.
  const vice = 'C:\\C64\\VICE';
  const drives = () => { try { return readdirSync(vice).some(d => existsSync(join(vice, d, 'DRIVES'))); } catch { return false; } };
  test.skip(!process.env.C64_ROMS && !drives(), 'needs VICE\'s ROMs');
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/d64/kernal-load.d64')] });
  await fromFileMenu(page, 'Mount disk image (D64, G64)…');
  await openSection(page, 'Disk');
  await page.getByRole('list', { name: 'Files on kernal-load.d64' }).getByRole('listitem').filter({ hasText: 'BOOT' }).click();
  const bar = page.locator('.pack-bar');
  await expect(bar).toContainText('BOOT.prg is packed.', { timeout: 30_000 });
  await expect(bar).toContainText(/Sindri peels off 1 layer: an unknown decruncher at \$080d \(fingerprint [0-9a-f]{8}\); the program starts at \$c000/);
  // BOOT holds the KERNAL LOAD (jsr $ffd5 at $0821): opening it opened Loaders, and Program start for its SYS
  const expanded = (name: string) => page.getByRole('region', { name, exact: true }).locator('.sec-toggle');
  await expect(expanded('Loaders')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('region', { name: 'Loaders', exact: true }).getByLabel('KERNAL LOAD')).toBeVisible();
  await expect(expanded('Program start')).toHaveAttribute('aria-expanded', 'true');
  // folded up, to see what the unpacked program opens
  await expanded('Loaders').click();
  await expanded('Program start').click();
  await bar.getByRole('button', { name: 'Unpack', exact: true }).click();
  await expect(toast(page, 'Unpacked BOOT.prg: 609 bytes at $c000-$c260')).toBeVisible({ timeout: 30_000 });
  const done = page.locator('.unpack-bar');
  await expect(done).toContainText('BOOT-unpacked.prg, $c000-$c260, starting at $c000 (set as the program start).');
  await done.getByText('Layer report').click();
  await expect(done.locator('.unpack-log')).toContainText(/Drive: 1541 with "LOADER DISK" LD, \d+ bytes read/);
  // the unpacked program (PART2's loop at $c000) is a load: the start Sindri set opens Program start, and Loaders stays
  // folded up, for it has no loader
  await expect(expanded('Files')).toHaveAttribute('aria-expanded', 'false');
  await expect(expanded('Program start')).toHaveAttribute('aria-expanded', 'true');
  await expect(statusBar(page)).not.toContainText('analysing');
  await expect(expanded('Loaders')).toHaveAttribute('aria-expanded', 'false');
  await expectFiles(page, ['BOOT-unpacked.prg']);
});

test('file dialogs open in the folder they were last used in', async ({ app, page, userData }) => {
  await waitForListing(page);
  await openSection(page, 'Files');
  const prgDir = join(repoDir, 'fixtures', 'prg'), diskDir = join(repoDir, 'fixtures', 'd64');

  await stubDialogs(app, { open: [join(prgDir, 'packed-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded packed-demo.prg at $0801')).toBeVisible();
  // the disk dialog has no folder of its own yet: it starts where the PRG came from
  await stubDialogs(app, { open: [join(diskDir, 'mimir-demo.d64')] });
  await fromFileMenu(page, 'Mount disk image (D64, G64)…');
  await expect(toast(page, 'Mounted mimir-demo.d64')).toBeVisible();
  await stubDialogs(app, { open: [join(prgDir, 'raster-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  await stubDialogs(app, { open: [join(diskDir, 'mimir-demo.d64')] });
  await fromFileMenu(page, 'Mount disk image (D64, G64)…');
  await expect(toast(page, 'Mounted mimir-demo.d64')).toHaveCount(2);

  expect(await dialogOptions(app)).toEqual([
    { title: 'Open PRG files', defaultPath: undefined },
    { title: 'Mount disk image (D64, G64)', defaultPath: prgDir },
    { title: 'Open PRG files', defaultPath: prgDir },
    { title: 'Mount disk image (D64, G64)', defaultPath: diskDir },
  ]);
  // kept for the next start of the app
  expect(JSON.parse(readFileSync(join(userData, 'recent-folders.json'), 'utf8'))).toEqual({ prg: prgDir, disk: diskDir, last: diskDir });
});

test('merge a range into one block after confirming it', async ({ page }) => {
  await waitForListing(page);
  const headersIn = (rows: ListingRow[], from: number, to: number) => rows.filter(r => r.hdr && parseInt(r.adr, 16) >= from && parseInt(r.adr, 16) < to);
  const dialog = page.getByRole('dialog', { name: 'Merge range into one block' });
  const before = headersIn(await listingRows(page), 0x0939, 0x0ab5);
  expect(before.length).toBeGreaterThan(3);

  await test.step('in a block only the end is needed: the start and the type come from the block', async () => {
    await goTo(page, 'colors_0939');
    await page.keyboard.press('m');
    await expect(dialog).toContainText('The cursor is in the Table block at $0939 (colors_0939): the range starts there and the type is taken from it.');
    await expect(dialog.locator('#merge-start')).toHaveAttribute('placeholder', '$0939 (this block)');
    await expect(dialog.locator('#merge-type')).toHaveValue('table');
    await expect(dialog.getByRole('button', { name: 'Merge…' })).toBeDisabled();
    await dialog.locator('#merge-end').fill('$0ab4');
    await expect(dialog).toContainText(`${before.length} blocks become one Table (curve/values) block $0939–$0ab4 (380 bytes).`);
    await dialog.locator('#merge-type').selectOption('bytes');
    await expect(dialog).toContainText('one Bytes (.byte) block $0939–$0ab4');
  });

  await test.step('nothing changes before the summary is confirmed', async () => {
    await dialog.getByRole('button', { name: 'Merge…' }).click();
    await expect(dialog).toContainText('Merge $0939–$0ab4 into one Bytes (.byte) block?');
    await expect(dialog).toContainText(`This replaces ${before.length} blocks:`);
    await expect(dialog.locator('.merge-list li')).toHaveCount(before.length);
    await dialog.getByRole('button', { name: 'Back' }).click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(headersIn(await listingRows(page), 0x0939, 0x0ab5)).toHaveLength(before.length);
  });

  await test.step('confirming replaces every block in the range with one', async () => {
    await page.keyboard.press('m');
    await dialog.locator('#merge-end').fill('$0ab4');
    await dialog.locator('#merge-type').selectOption('bytes');
    await dialog.locator('#merge-end').press('Enter');
    await dialog.getByRole('button', { name: `Merge ${before.length} blocks` }).click();
    await expect(toast(page, `Merged ${before.length} blocks into one Bytes (.byte) block $0939–$0ab4`)).toBeVisible();
    const after = headersIn(await listingRows(page), 0x0939, 0x0ab5);
    expect(after).toEqual([expect.objectContaining({ adr: '0939', chip: 'Data', user: true })]);
    expect(after[0].text).toContain('$0939-$0ab4 (380 bytes)');
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
    await page.keyboard.press('Control+z');
    await expect.poll(async () => headersIn(await listingRows(page), 0x0939, 0x0ab5).length).toBe(before.length);
  });

  await test.step('a range that cuts a block says so, and one outside the file is refused', async () => {
    await goTo(page, 'txt_0949');
    await page.keyboard.press('m');
    await dialog.locator('#merge-end').fill('$096f');
    await expect(dialog.locator('.merge-list.cut')).toContainText('is cut: $0970–$0984 keeps its type');
    await dialog.locator('#merge-end').fill('$3900');
    await expect(dialog).toContainText('runs past the end of the file at $3800');
    await expect(dialog.getByRole('button', { name: 'Merge…' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});

test('real addresses instead of the hardware include file', async ({ page }) => {
  await waitForListing(page);
  const rows = async () => (await listingRows(page)).map(r => r.text.trimStart());
  const has = async (text: string) => (await rows()).some(t => t.startsWith(text));
  const choose = async (value: 'import' | 'none') => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Kick Assembler output' }).click();
    await page.locator('#set-hwInclude').selectOption(value);
    await page.getByRole('button', { name: 'Save settings' }).click();
    // keys reach the listing once the dialog is gone (an earlier "Settings saved" toast may still be showing)
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
  };
  await goTo(page, '$0801');
  expect(await has('#import "include/c64-hardware.asm"')).toBe(true);
  await goTo(page, 'sub_0866');
  expect(await has('sta VIC_BORDER_COLOR')).toBe(true);

  await test.step('Settings → Real addresses writes $d020, keeps the comment and drops the #import', async () => {
    await choose('none');
    await goTo(page, 'sub_0866');
    await expect.poll(() => has('sta $d020')).toBe(true);
    const row = listing(page).locator('.row', { hasText: 'sta $d020' }).first();
    await expect(row).toContainText('Border color');
    await expect(row.locator('.link', { hasText: '$d020' })).toHaveAttribute('title', /VIC_BORDER_COLOR — Border color/);
    await goTo(page, '$0801');
    expect(await has('#import')).toBe(false);
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('the names come back with the include file', async () => {
    await choose('import');
    await goTo(page, 'sub_0866');
    await expect.poll(() => has('sta VIC_BORDER_COLOR')).toBe(true);
  });
});

test('save a block as a binary file loaded with .import binary', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  const rows = async () => (await listingRows(page)).map(r => r.text.trimStart());
  const box = page.locator('.inspector').getByLabel('Save as a binary file');

  await test.step('the inspector saves the block as data/<label>.bin', async () => {
    await page.keyboard.press('Control+j');
    await goTo(page, 'sine_09b5');
    await expect(box).not.toBeChecked();
    await box.check();
    await expect(toast(page, '$09b5–$0ab4 is saved as data/sine_09b5.bin and loaded with .import binary')).toBeVisible();
    await expect(headerRow(page, '09b5').locator('.hdr-binary')).toHaveText(/binary/i);
    await expect(headerRow(page, '09b5')).toContainText('data/sine_09b5.bin');
    await expect.poll(async () => (await rows()).some(t => t.startsWith('.import binary "data/sine_09b5.bin"'))).toBe(true);
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('the export writes the file next to the source', async () => {
    const out = join(work, 'export');
    await stubDialogs(app, { open: [out] });
    await page.getByRole('button', { name: 'Export' }).click();
    await expect(toast(page, `Exported verified Kick Assembler project to ${out}`)).toBeVisible({ timeout: 90_000 });
    const bin = readFileSync(join(out, 'data', 'sine_09b5.bin'));
    const prg = readFileSync(join(repoDir, 'fixtures/prg/raster-demo.prg'));
    expect(bin.length).toBe(256);
    expect(bin.equals(prg.subarray(2 + 0x09b5 - 0x0801, 2 + 0x0ab5 - 0x0801))).toBe(true);
    expect(readFileSync(join(out, 'raster-demo.asm'), 'utf8')).toContain('.import binary "data/sine_09b5.bin"');
  });

  await test.step('unticking writes it in the source again', async () => {
    await box.uncheck();
    await expect(headerRow(page, '09b5').locator('.hdr-binary')).toHaveCount(0);
    await expect.poll(async () => (await rows()).some(t => t.startsWith('.import binary "data/sine_09b5.bin"'))).toBe(false);
  });
});

test('F7 right after an edit verifies that edit', async ({ page }) => {
  await waitForListing(page);
  // no waiting between the edit and F7: verification waits for the analysis of the edit itself
  for (const [range, key] of [['$091e-$0925', 'd'], ['$0960-$096f', 'w'], ['$0949-$0950', 't']] as const) {
    await goTo(page, range);
    await page.keyboard.press(key);
    await page.keyboard.press('F7');
    // the status must say so for this edit (a result for the state before it would show as stale: "not verified")
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
    await expect(headerRow(page, range.slice(1, 5)).locator('.hdr-user')).toBeVisible();
  }
});

test('rename a zero-page variable from its .label line', async ({ page }) => {
  await waitForListing(page);
  const rows = async () => (await listingRows(page)).map(r => r.text.trimStart());
  const has = async (text: string) => (await rows()).some(t => t.startsWith(text));
  const zpRow = (name: string) => listing(page).locator('.row', { hasText: `.label ${name} = $fb` });
  const editor = page.locator('.edit-pop');

  await test.step('the .label line is marked as zero page, and a double-click opens a marked editor', async () => {
    await goTo(page, '$0801');
    await expect(zpRow('ptr_fb').locator('.zp-tag')).toHaveText(/zero page/i);
    await zpRow('ptr_fb').dblclick();
    await expect(editor).toHaveClass(/zp/);
    await expect(editor.locator('label')).toContainText('Zero-page variable at $fb');
    await expect(editor.locator('.zp-tag')).toBeVisible();
    await expect(editor.locator('input')).toHaveValue('ptr_fb');
  });

  await test.step('a name in use is refused, a new one renames every access', async () => {
    await editor.locator('input').fill('start');
    await editor.locator('input').press('Enter');
    await expect(editor).toContainText('"start" is already used at $0810.');
    await editor.locator('input').fill('fx_ptr');
    await editor.locator('input').press('Enter');
    await expect(toast(page, 'Zero-page variable $fb renamed to fx_ptr; all references updated')).toBeVisible();
    await expect(zpRow('fx_ptr')).toHaveCount(1);
    await goTo(page, '$0905');
    await expect.poll(() => has('sta fx_ptr+1')).toBe(true);
    expect((await rows()).some(t => t.includes('ptr_fb'))).toBe(false);
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('N and the context menu rename it too', async () => {
    await goTo(page, '$0801');
    await zpRow('fx_ptr').click();
    await page.keyboard.press('n');
    await expect(editor.locator('input')).toHaveValue('fx_ptr');
    await editor.locator('input').press('Escape');
    await zpRow('fx_ptr').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename zero-page variable…' }).click();
    await editor.locator('input').fill('');
    await editor.locator('input').press('Enter');
    await expect(toast(page, 'Zero-page variable $fb: automatic name restored')).toBeVisible();
    await expect(zpRow('ptr_fb')).toHaveCount(1);
  });
});

test('click the +offset after a label to go to label + offset', async ({ page }) => {
  await waitForListing(page);
  await page.keyboard.press('Control+j');
  await goTo(page, 'smc_08ef');
  const row = () => listing(page).locator('.row', { hasText: 'inc smc_08ef+1' });
  await expect(row().locator('.link.offset')).toHaveAttribute('title', 'Go to $08f0 (smc_08ef+1)');
  // the label still goes to the label, the offset to the byte it names
  await row().locator('.link', { hasText: /^smc_08ef$/ }).click();
  await expect(statusBar(page)).toContainText('$08ef · smc_08ef');
  await row().locator('.link.offset').click();
  await expect(statusBar(page)).toContainText('$08f0 · smc_08ef+1');
});

test('bookmarks: notes on addresses, listed by address, a click shows the note and a double-click goes there', async ({ page }) => {
  await waitForListing(page);
  await page.keyboard.press('Control+j');
  const at = (adr: string) => listing(page).locator('.row', { has: page.locator('.adr', { hasText: new RegExp(`^${adr}$`) }) });
  const mark = (adr: string) => at(adr).locator('.bm-mark');
  const list = page.getByRole('list', { name: 'Bookmarks' });
  const item = (title: string) => list.locator('.bm-row', { hasText: title });

  await test.step('B opens the editor in the sidebar, beside the code, titled after the label', async () => {
    await goTo(page, 'start');
    await page.keyboard.press('b');
    const dialog = page.locator('aside.sidebar').getByRole('form', { name: 'Add bookmark' });
    await expect(dialog.getByLabel('Address', { exact: true })).toHaveValue('$0810');
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('start');
    await expect(dialog.getByLabel('Title', { exact: true })).toBeFocused();
    // the code stays in view: the bookmarked line and the editor do not overlap
    const code = listing(page).locator('.row', { hasText: 'jsr CLRSCR' });
    await expect(code).toBeVisible();
    const [box, line] = [await dialog.boundingBox(), await code.boundingBox()];
    expect(box!.x + box!.width).toBeLessThanOrEqual(line!.x);
    // a click in the listing and Cursor line take another place; Esc closes the editor without saving
    await listing(page).locator('.row', { hasText: 'jsr sub_0866' }).click();
    await dialog.getByRole('button', { name: 'Cursor line', exact: true }).click();
    await expect(dialog.getByLabel('Address', { exact: true })).toHaveValue('$0813');
    await dialog.getByLabel('Title', { exact: true }).press('Escape');
    await expect(dialog).toBeHidden();
    await expect(mark('0813')).toHaveCount(0);
    await goTo(page, 'start');
    await page.keyboard.press('b');
    // a bookmark marks a place in the code
    await dialog.getByLabel('Address', { exact: true }).fill('$0001');
    await expect(dialog.getByText('No loaded byte at $0001')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    await dialog.getByLabel('Address', { exact: true }).fill('$0810');
    await dialog.getByLabel('Title', { exact: true }).fill('Set up');
    await dialog.getByLabel('Note', { exact: true }).fill('clears the screen\nand starts the raster IRQ');
    await dialog.getByLabel('Note', { exact: true }).press('Control+Enter');
    await expect(dialog).toBeHidden();
    await expect(mark('0810')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Bookmarks', exact: true })).toContainText('1');
  });

  await test.step('right-click → Add bookmark… on another line', async () => {
    await goTo(page, 'sine_09b5');
    await listing(page).locator('.row.k-dat', { has: page.locator('.adr', { hasText: /^09b5$/ }) }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add bookmark…' }).click();
    const dialog = page.getByRole('form', { name: 'Add bookmark' });
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('sine_09b5');
    await dialog.getByLabel('Title', { exact: true }).press('Enter');
    await expect(dialog).toBeHidden();
    await expect(mark('09b5')).toHaveCount(1);
  });

  await test.step('Ctrl+B lists them by address; a click shows the whole note, another click hides it', async () => {
    await listing(page).focus();
    await page.keyboard.press('Control+b');
    await expect(list.locator('.bm-row')).toHaveText(['$0810Set up', '$09b5sine_09b5']);
    await expect(list.locator('.bm-text')).toHaveCount(0);
    await item('Set up').click();
    await expect(list.locator('.bm-text')).toContainText('clears the screen');
    await expect(list.locator('.bm-text')).toContainText('and starts the raster IRQ');
    await item('Set up').click();
    await expect(list.locator('.bm-text')).toHaveCount(0);
  });

  await test.step('a double-click goes there in the code', async () => {
    await goTo(page, 'start');
    await expect(statusBar(page)).toContainText('$0810');
    await item('sine_09b5').dblclick();
    await expect(statusBar(page)).toContainText('$09b5 · sine_09b5');
    await expect(list.locator('.bm-item.open')).toContainText('No note');
  });

  await test.step('F2 and Shift+F2 go to the next and the previous bookmark', async () => {
    await page.keyboard.press('F2');
    await expect(statusBar(page)).toContainText('$0810 · start');
    await page.keyboard.press('F2');
    await expect(statusBar(page)).toContainText('$09b5 · sine_09b5');
    await page.keyboard.press('Shift+F2');
    await expect(statusBar(page)).toContainText('$0810 · start');
  });

  await test.step('the mark in the margin opens the note in the list', async () => {
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await expect(list).toBeHidden();
    await mark('0810').click();
    await expect(list.locator('.bm-item.open')).toContainText('clears the screen');
  });

  await test.step('B on a bookmarked line edits it; Delete removes it and Ctrl+Z brings it back', async () => {
    await goTo(page, 'start');
    await page.keyboard.press('b');
    const dialog = page.getByRole('form', { name: 'Edit bookmark' });
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Set up');
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(dialog).toBeHidden();
    await expect(mark('0810')).toHaveCount(0);
    await expect(list.locator('.bm-row')).toHaveText(['$09b5sine_09b5']);
    await page.keyboard.press('Control+z');
    await expect(mark('0810')).toHaveCount(1);
    await expect(list.locator('.bm-row')).toHaveCount(2);
  });

  await test.step('a colour: a preset or one of your own, which the mark, its line and the list show', async () => {
    const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    const token = (name: string) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
    const dialog = page.getByRole('form', { name: 'Edit bookmark' });
    const presets = dialog.getByRole('group', { name: 'Preset colours' }), own = dialog.getByRole('group', { name: 'Your colours' });
    const icon = (title: string) => list.locator('.bm-item', { hasText: title }).locator('.bm-ic');
    // without a colour a bookmark is amber, as before there were colours
    await expect(mark('0810')).toHaveCSS('color', rgb(await token('--bm-amber')));
    await goTo(page, 'start');
    await page.keyboard.press('b');
    await expect(presets.getByRole('button', { name: 'Amber' })).toHaveAttribute('aria-pressed', 'true');
    await presets.getByRole('button', { name: 'Teal' }).click();
    await expect(dialog.locator('.bm-color-name')).toHaveText('Teal');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    const teal = rgb(await token('--bm-teal'));
    await expect(mark('0810')).toHaveCSS('color', teal);
    await expect(icon('Set up')).toHaveCSS('color', teal);
    // the line is tinted in it
    await expect(at('0810').filter({ has: page.locator('.bm-mark') })).toHaveClass(/\bbm\b/);

    // a colour of your own, made in an empty place: Esc closes only its editor, the bookmark's stays open
    await goTo(page, 'sine_09b5');
    await page.keyboard.press('b');
    await own.getByRole('button', { name: 'Make colour 1 of your own' }).click();
    const make = dialog.getByRole('group', { name: 'Make colour 1 of your own' });
    await expect(make.getByLabel('Colour as #rrggbb')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(make).toBeHidden();
    await expect(dialog).toBeVisible();
    await own.getByRole('button', { name: 'Make colour 1 of your own' }).click();
    await make.getByLabel('Colour as #rrggbb').fill('#FF00AA');
    await make.getByLabel('Colour as #rrggbb').press('Enter');
    await expect(make).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(own.getByRole('button', { name: 'Your colour 1: #ff00aa' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.locator('.bm-color-name')).toHaveText('Your colour 1 · #ff00aa');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(mark('09b5')).toHaveCSS('color', 'rgb(255, 0, 170)');
    await expect(icon('sine_09b5')).toHaveCSS('color', 'rgb(255, 0, 170)');

    // the colours of your own are there for every bookmark; Ctrl+Z takes the colour back
    await goTo(page, 'start');
    await page.keyboard.press('b');
    await expect(presets.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true');
    await expect(own.getByRole('button', { name: 'Your colour 1: #ff00aa' })).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await listing(page).focus();
    await page.keyboard.press('Control+z');
    await expect(icon('sine_09b5')).toHaveCSS('color', rgb(await token('--bm-amber')));
    await expect(icon('Set up')).toHaveCSS('color', teal);
  });
});

test('a bookmark on an area: B on a selection keeps its end, the area has a stripe in its colour and a jump goes to its first line', async ({ page }) => {
  await waitForListing(page);
  await page.keyboard.press('Control+j');
  // the instruction's line (the block header and the label above it have its address too)
  const at = (adr: string) => listing(page).locator('.row.k-ins', { has: page.locator('.adr', { hasText: new RegExp(`^${adr}$`) }) });
  const stripe = (adr: string) => at(adr).locator('.bm-area');
  const list = page.getByRole('list', { name: 'Bookmarks' });
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  const token = (name: string) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

  await test.step('B on a selection of three lines: the editor has its first address and its last', async () => {
    await goTo(page, 'start');
    await at('0810').click();
    await at('0816').click({ modifiers: ['Shift'] });
    await page.keyboard.press('b');
    const dialog = page.locator('aside.sidebar').getByRole('form', { name: 'Add bookmark' });
    await expect(dialog.getByLabel('Address', { exact: true })).toHaveValue('$0810');
    await expect(dialog.getByLabel('End address', { exact: true })).toHaveValue('$0816');
    await expect(dialog.getByText('The listing shows the area $0810–$0816.')).toBeVisible();
    // the listing selects the area while the editor is open
    await expect(at('0813')).toHaveClass(/\bsel\b/);
    await dialog.getByLabel('Title', { exact: true }).fill('Set up');
    await dialog.getByLabel('Title', { exact: true }).press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.locator('.toasts .toast', { hasText: 'Bookmark added at $0810–$0816' })).toBeVisible();
  });

  await test.step('the area has a stripe in the bookmark\'s colour in the left margin, from its mark to its last line', async () => {
    await expect(at('0810').locator('.bm-mark')).toHaveCount(1);
    for (const adr of ['0810', '0813', '0816']) await expect(stripe(adr)).toHaveCSS('background-color', rgb(await token('--bm-amber')));
    await expect(stripe('0810')).toHaveClass(/\bfirst\b/);
    await expect(stripe('0816')).toHaveClass(/\blast\b/);
    await expect(stripe('0817')).toHaveCount(0);
    await expect(list.locator('.bm-row')).toHaveText(['$0810–0816Set up']);
    // in the bookmark's colour when it gets another
    await goTo(page, 'start');
    await page.keyboard.press('b');
    const dialog = page.getByRole('form', { name: 'Edit bookmark' });
    await expect(dialog.getByLabel('End address', { exact: true })).toHaveValue('$0816');
    await dialog.getByRole('group', { name: 'Preset colours' }).getByRole('button', { name: 'Violet' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(stripe('0813')).toHaveCSS('background-color', rgb(await token('--bm-violet')));
  });

  await test.step('a jump to it goes to its first line', async () => {
    await goTo(page, 'sine_09b5');
    await page.keyboard.press('F2');
    await expect(statusBar(page)).toContainText('$0810 · start');
    await expect(at('0810')).toBeInViewport();
    await goTo(page, 'sine_09b5');
    await list.locator('.bm-row', { hasText: 'Set up' }).dblclick();
    await expect(statusBar(page)).toContainText('$0810 · start');
  });

  await test.step('the end: before the address it is refused; Cursor line ends it there; empty, it is one line again', async () => {
    await goTo(page, 'start');
    await page.keyboard.press('b');
    const dialog = page.getByRole('form', { name: 'Edit bookmark' }), end = dialog.getByLabel('End address', { exact: true });
    await end.fill('$0800');
    await expect(dialog.getByText('The area ends before it starts at $0810.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    await at('0819').click();
    await dialog.getByRole('button', { name: 'Cursor line as the end' }).click();
    // the last byte of the line: the instruction at $0819 is three bytes
    await expect(end).toHaveValue('$081b');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(stripe('0819')).toHaveClass(/\blast\b/);
    await expect(stripe('0816')).not.toHaveClass(/\blast\b/);
    await goTo(page, 'start');
    await page.keyboard.press('b');
    await end.fill('');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(listing(page).locator('.bm-area')).toHaveCount(0);
    await expect(at('0810').locator('.bm-mark')).toHaveCount(1);
    // Ctrl+Z brings the area back
    await listing(page).focus();
    await page.keyboard.press('Control+z');
    await expect(stripe('0819')).toHaveClass(/\blast\b/);
  });
});

test('the export writes NOTES.html, or NOTES.txt when set, with the bookmarks and comments', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  await page.keyboard.press('Control+j');
  await goTo(page, 'start');
  await page.keyboard.press('b');
  await page.locator('#bm-title').fill('Set up');
  await page.locator('#bm-text').fill('clears the screen\nand starts the <raster> IRQ');
  await page.locator('#bm-text').press('Control+Enter');
  await page.keyboard.press('/');
  await page.getByLabel('Comment line above $0810').fill('entry from the BASIC stub');
  await page.getByLabel('Comment line above $0810').press('Enter');

  const out = join(work, 'export');
  await stubDialogs(app, { open: [out] });
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(toast(page, `Exported verified Kick Assembler project to ${out}`)).toBeVisible({ timeout: 90_000 });
  const doc = readFileSync(join(out, 'NOTES.html'), 'utf8');
  const src = readFileSync(join(out, 'raster-demo.asm'), 'utf8');
  const line = src.split('\n').findIndex(l => l.trimStart().startsWith('jsr CLRSCR')) + 1;
  expect(doc).toContain('<h3>Set up</h3>');
  expect(doc).toContain('clears the screen\nand starts the &lt;raster&gt; IRQ');
  expect(doc).toContain(`raster-demo.asm, line ${line}`);
  expect(doc).toMatch(/<dt>Exported<\/dt><dd>\d{4}-\d\d-\d\d \d\d:\d\d<\/dd>/);
  expect(doc).toContain('<span class="tag">Comment line</span>');
  expect(doc).toContain('entry from the BASIC stub');
  // the bookmark is not in the source, the comment is
  expect(src).not.toContain('Set up');
  expect(src).toContain('// entry from the BASIC stub');
  expect(readFileSync(join(out, 'README.md'), 'utf8')).toContain('NOTES.html');

  await test.step('Settings → NOTES.txt writes the plain-text document instead', async () => {
    await page.keyboard.press('Control+,');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('tab', { name: 'Kick Assembler output' }).click();
    await dialog.getByLabel('Bookmarks and comments in the export').selectOption('txt');
    await dialog.getByRole('button', { name: 'Save settings' }).click();
    await expect(dialog).toBeHidden();
    const out2 = join(work, 'export-txt');
    await stubDialogs(app, { open: [out2] });
    await page.getByRole('button', { name: 'Export' }).click();
    await expect(toast(page, `Exported verified Kick Assembler project to ${out2}`)).toBeVisible({ timeout: 90_000 });
    expect(existsSync(join(out2, 'NOTES.html'))).toBe(false);
    const txt = readFileSync(join(out2, 'NOTES.txt'), 'utf8');
    expect(txt.startsWith('raster-demo: bookmarks and comments\n')).toBe(true);
    expect(txt).toContain(`$0810  Set up\n  start · Code · start · $0810-$0865 (86 bytes) · raster-demo.asm, line ${line}`);
    expect(txt).toContain('  clears the screen\n  and starts the <raster> IRQ');
    expect(txt).toMatch(new RegExp(`^  > +${line}  0810  20 44 e5 +jsr CLRSCR`, 'm'));
    expect(txt).toContain('Comment line');
    expect(readFileSync(join(out2, 'README.md'), 'utf8')).toContain('NOTES.txt');
  });
});

test('the installed app unpacks with Sindri: no unp64 comes with it', async ({ app, page }) => {
  // only an installed (packaged) app has resources\: run with MIMIR_E2E_EXE
  const installed = process.env.MIMIR_E2E_EXE;
  test.skip(!installed, 'needs the installed app (MIMIR_E2E_EXE)');
  expect(existsSync(join(dirname(installed!), 'resources', 'unp64'))).toBe(false);
  await waitForListing(page);
  await openSection(page, 'Files');

  await test.step('a fresh profile has no external unpacker', async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.locator('#set-unpackerPath')).toHaveValue('');
    await expect(page.locator('#set-unpackerArgs')).toHaveValue('{in}');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  await test.step('it unpacks the packed demo', async () => {
    await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/packed-demo.prg')] });
    await page.keyboard.press('Control+o');
    const bar = page.locator('.pack-bar');
    await bar.getByRole('button', { name: 'Unpack', exact: true }).click();
    await expect(toast(page, 'Unpacked packed-demo.prg: 12287 bytes at $0801-$37ff')).toBeVisible({ timeout: 30_000 });
    const done = page.locator('.unpack-bar');
    await expect(done).toContainText('starting at $0810 (set as the program start).');
    await expect(done.locator('.unpack-log')).toContainText('saved layer 2: $0801-$37ff (12.0 KB), start with SYS 2064 = $0810');
    await expectFiles(page, ['packed-demo-unpacked.prg']);
  });
});

test('timing code: a delay a timer sets the branch into is marked, and what it reads gets no label', async ({ workDir: work, app, page }) => {
  // 10 SYS2061, then lda $dc06 / eor #$07 / sta smc+1 / smc: bpl * / lda #$a9 / lda #$a9 / lda $eaa5 / rts, loaded
  // up to $eaff so that $eaa5 is part of the program
  const prg = new Uint8Array(2 + 0xeb00 - 0x0801);
  prg.set([0x01, 0x08]);
  prg.set([0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0x00, 0x00, 0x00], 2);
  prg.set([0xad, 0x06, 0xdc, 0x49, 0x07, 0x8d, 0x16, 0x08, 0x10, 0x00, 0xa9, 0xa9, 0xa9, 0xa9, 0xad, 0xa5, 0xea, 0x60], 2 + 0x080d - 0x0801);
  const file = join(work, 'stable.prg');
  writeFileSync(file, prg);
  await waitForListing(page);
  await stubDialogs(app, { open: [file] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded stable.prg at $0801')).toBeVisible();
  await goTo(page, '$0815');
  const rows = listing(page);
  await expect(rows.locator('.row', { hasText: 'bpl delay_0817' })).toContainText('0-7 bytes into the delay, by CIA1_TB_LO ($dc06)');
  await expect(rows.locator('.row.k-cmt', { hasText: 'delay: the bpl at $0815 goes 0-7 bytes into it by CIA1_TB_LO ($dc06), so it takes 8 down to 0 cycles' })).toBeVisible();
  await expect(rows.locator('.row.delay')).toHaveCount(3);
  await expect(rows.locator('.row.delay .delay-tag')).toHaveCount(3);
  await expect(rows.locator('.row.delay', { hasText: 'lda $eaa5' })).toBeVisible();
  await expect(rows.locator('.row', { hasText: 'data_eaa5' })).toHaveCount(0);
  await page.keyboard.press('F7');
  await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
});

test('relocate code the program copies elsewhere: Problems finds the copy, the listing reads it where it runs, names go along', async ({ app, page }) => {
  // fixtures/prg/moved-demo.prg (packages/core/test/reloc.test.ts): 10 SYS2061, a loop that copies $1000-$1010 to $2000
  // and jumps there, and at $1000 code assembled to run at $2000
  await waitForListing(page);
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/moved-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded moved-demo.prg at $0801')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: /^Relocate/ });

  await test.step('Problems says what the loop copies and where the code goes; Relocate… fills in the dialog', async () => {
    await page.getByRole('tab', { name: /Problems/ }).click();
    const row = page.locator('.loglist .logrow', { hasText: 'The loop at $080f copies $1000-$1010 to $2000-$2010' });
    await expect(row).toContainText('the jmp at $0818 goes there');
    await row.getByRole('button', { name: 'Relocate…' }).click();
    await expect(dialog.getByLabel('Start (loaded at)')).toHaveValue('$1000');
    await expect(dialog.getByLabel('End (included)')).toHaveValue('$1010');
    await expect(dialog.getByLabel('Runs at')).toHaveValue('$2000');
    await expect(dialog).toContainText('The loop at $080f copies these bytes to $2000, and the jmp at $0818 goes there.');
    // nothing may be loaded where it runs
    await dialog.getByLabel('Runs at').fill('$0900');
    await expect(dialog).toContainText('$0900 is loaded from moved-demo.prg: a relocated block runs where nothing is loaded.');
    await expect(dialog.getByRole('button', { name: 'Relocate', exact: true })).toBeDisabled();
    await dialog.getByLabel('Runs at').fill('$2000');
    await dialog.getByRole('button', { name: 'Relocate', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page, '$1000–$1010 runs at $2000–$2010: traced and named there')).toBeVisible();
    await expect(row).toHaveCount(0);
  });

  await test.step('the code is traced and named where it runs, and written inside .pseudopc where it is loaded', async () => {
    const rows = await listingRows(page);
    expect(rowAt(rows, '080f')?.text).toMatch(/^lda reloc_1000,x/);
    expect(rowAt(rows, '0812')?.text).toMatch(/^sta l_2000,x/);
    expect(rowAt(rows, '0818')?.text).toMatch(/^jmp l_2000/);
    expect(headerAt(rows, '1000')).toMatchObject({ chip: 'Relocated', user: true });
    expect(headerAt(rows, '1000')?.text).toContain('runs at $2000-$2010');
    expect(rows.find(r => r.adr === '1000' && /^\.pseudopc \$2000 \{/.test(r.text))).toBeTruthy();
    expect(rowAt(rows, '2000')?.text).toMatch(/^inc VIC_BORDER_COLOR/);
    expect(rowAt(rows, '2003')?.text).toMatch(/^jsr sub_2009/);
    expect(rows.some(r => /^\}\s*\/\/ end of reloc_1000/.test(r.text))).toBe(true);
    await goTo(page, '$2003');
    await expect(listing(page).locator('.row.cur')).toHaveClass(/in-reloc/);
    await expect(page.locator('.inspector')).toContainText('It runs here because the program copies the relocated block reloc_1000 ($1000–$1010) to $2000–$2010.');
  });

  await test.step('the Relocated tab lists the block, where it is loaded and where it runs', async () => {
    const tab = page.getByRole('tab', { name: /^Relocated/ });
    await expect(tab.locator('.count')).toHaveText('1');
    await tab.click();
    const row = page.getByRole('table', { name: 'Relocated blocks' }).locator('tbody tr');
    await expect(row).toHaveCount(1);
    await expect(row.locator('td')).toHaveText(['reloc_1000', '$1000–$1010', '$2000–$2010', '17', 'moved-demo.prg', /Runs at…\s*Stop relocating/]);
    // the copy loop is relocated: none is left to suggest
    await expect(page.getByRole('table', { name: 'Copy loops found' })).toHaveCount(0);
    // a click on the row goes to where it runs
    await row.click();
    await expect(statusBar(page)).toContainText('$2000');
  });

  await test.step('a name given where it runs goes along when it runs elsewhere, and back when it is not relocated', async () => {
    await goTo(page, '$2009');
    await page.keyboard.press('n');
    const input = page.getByLabel('Label at $2009');
    await input.fill('blink');
    await input.press('Enter');
    await expect.poll(async () => rowAt(await listingRows(page), '2003')?.text).toMatch(/^jsr blink/);
    // R on the relocated block: where it runs
    await page.keyboard.press('r');
    await expect(dialog).toContainText('The program copies $1000–$1010 to $2000–$2010 and runs it there.');
    await dialog.getByLabel('Runs at').fill('$c000');
    await expect(dialog).toContainText('Going along to $c000: 1 name.');
    await dialog.getByRole('button', { name: 'Run it there' }).click();
    await expect(toast(page, '$1000–$1010 runs at $c000–$c010 now')).toBeVisible();
    // the loop still copies it to $2000: there nothing is loaded now, and the Relocated tab says so (the listing follows
    // once the analysis of the edit is in)
    await expect.poll(async () => (await listingRows(page)).find(r => r.text === 'blink:')?.adr).toBe('c009');
    expect(rowAt(await listingRows(page), '0818')?.text).toMatch(/^jmp \$2000/);
    const copy = page.getByRole('table', { name: 'Copy loops found' }).locator('tbody tr');
    await expect(copy).toContainText('relocated to run at $c000');
    await expect(copy.getByRole('button', { name: 'Run it there…' })).toBeVisible();
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
    // Ctrl+Z: at $2000 again
    await page.keyboard.press('Control+z');
    await expect.poll(async () => rowAt(await listingRows(page), '2003')?.text).toMatch(/^jsr blink/);
    // the right-click menu stops relocating it: the name goes back to $1009
    await goTo(page, '$2000');
    await listing(page).locator('.row.cur').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Program', exact: true }).hover();
    await page.getByRole('menuitem', { name: /^Stop relocating \$1000–\$1010/ }).click();
    await expect(toast(page, '$1000–$1010 is read where it is loaded again')).toBeVisible();
    await expect.poll(async () => (await listingRows(page)).find(r => r.text === 'blink:')?.adr).toBe('1009');
    expect((await listingRows(page)).some(r => /\.pseudopc/.test(r.text))).toBe(false);
  });

  await test.step('the Relocated tab offers the copy loop again, and its Relocate… fills in the dialog', async () => {
    // F7 showed the build output
    await page.getByRole('tab', { name: /^Relocated/ }).click();
    await expect(page.getByRole('table', { name: 'Relocated blocks' })).toHaveCount(0);
    await expect(page.locator('.relocs')).toContainText('Nothing is relocated.');
    const copy = page.getByRole('table', { name: 'Copy loops found' }).locator('tbody tr');
    await expect(copy.locator('td')).toHaveText(['loop_080f', '$1000–$1010', '$2000–$2010', 'jmp at $0818', 'Relocate…']);
    await copy.getByRole('button', { name: 'Relocate…' }).click();
    await expect(dialog.getByLabel('Start (loaded at)')).toHaveValue('$1000');
    await expect(dialog.getByLabel('Runs at')).toHaveValue('$2000');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});

test('Problems warns when bank tracking is off and I/O is written as labels, and turns it on', async ({ workDir: work, app, page }) => {
  // a memory dump from $0801 over $d000-$d02f: 10 SYS2061, then lda #$00 / sta $d020 / sta $d021 / rts
  const prg = new Uint8Array(2 + 0xd030 - 0x0801);
  prg.set([0x01, 0x08]);
  prg.set([0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0x00, 0x00, 0x00], 2);
  prg.set([0xa9, 0x00, 0x8d, 0x20, 0xd0, 0x8d, 0x21, 0xd0, 0x60], 2 + 0x080d - 0x0801);
  const file = join(work, 'dump.prg');
  writeFileSync(file, prg);
  await waitForListing(page);
  await stubDialogs(app, { open: [file] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded dump.prg at $0801')).toBeVisible();
  const border = listing(page).locator('.row', { hasText: /sta (VIC_BORDER_COLOR|\S+_d020)\b/ });

  await test.step('with bank tracking off the registers become labels, and Problems says why', async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Analysis', exact: true }).click();
    await page.getByLabel('Follow the memory configuration ($01) and VIC bank').uncheck();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
    await goTo(page, '$080d');
    await expect(border).toContainText(/sta \w+_d020/);
    await page.getByRole('tab', { name: /Problems/ }).click();
    const row = page.locator('.loglist .logrow', { hasText: 'Bank tracking is off' });
    await expect(row).toContainText('accesses to 2 I/O addresses inside the loaded bytes are written as labels');
    await expect(row.locator('.addr-link')).toHaveText('$d020');
  });

  await test.step('Turn on names them as registers again, and Ctrl+Z undoes it', async () => {
    const row = page.locator('.loglist .logrow', { hasText: 'Bank tracking is off' });
    await row.getByRole('button', { name: 'Turn on' }).click();
    await expect(toast(page, 'Following the memory configuration ($01) and VIC bank')).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect(border).toContainText('sta VIC_BORDER_COLOR');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Analysis', exact: true }).click();
    await expect(page.getByLabel('Follow the memory configuration ($01) and VIC bank')).toBeChecked();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.keyboard.press('Control+z');
    await expect(page.locator('.loglist .logrow', { hasText: 'Bank tracking is off' })).toHaveCount(1);
  });
});

test('cycle counting: cycles per line, a block\'s total, and branches taken or not', async ({ page }) => {
  await waitForListing(page);
  await page.keyboard.press('Control+j');
  const toggle = page.getByRole('button', { name: 'Cycles' });
  const row = (text: string) => listing(page).locator('.row', { hasText: text });
  const section = page.getByRole('region', { name: 'Cycles' });

  await test.step('the Cycles button shows the cycles of every instruction', async () => {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await goTo(page, 'irq_08b7');
    await expect(row('inc VIC_IRQ_STATUS').locator('.cy-n')).toHaveText('6');
    await expect(row('lda colors_0939,y').locator('.cy-n')).toHaveText('4+');
    await expect(row('beq loop_08c2').locator('.cy-br')).toHaveText('2/3');
  });

  await test.step('a block header counts the block; a taken forward branch skips lines and changes the total', async () => {
    await goTo(page, 'sub_0866');
    await headerRow(page, '0866').click();
    await expect(section).toContainText('$0866–$08ad');
    await expect(section.locator('.cyc-total b')).toHaveText('104');
    await expect(statusBar(page)).toContainText('104 cycles');
    const beq = row('beq skip_0895').locator('.cy-br');
    await expect(beq).toHaveAttribute('aria-pressed', 'false');
    await expect(section).toContainText('taken: 95');
    await beq.click();
    await expect(beq).toHaveAttribute('aria-pressed', 'true');
    await expect(section.locator('.cyc-total b')).toHaveText('95');
    await expect(section).toContainText('104 with no branch taken');
    await expect(statusBar(page)).toContainText('95 cycles');
    await expect(section.getByLabel('Branch at $088d taken')).toBeChecked();
    // the lines the branch jumps over are not counted
    await expect(listing(page).locator('.row.cy-skip').first()).toBeVisible();
    // the box in the inspector does the same: back to not taken
    await section.getByLabel('Branch at $088d taken').uncheck();
    await expect(section.locator('.cyc-total b')).toHaveText('104');
    await expect(listing(page).locator('.row.cy-skip')).toHaveCount(0);
  });

  await test.step('turned off, the column and the section go away', async () => {
    await toggle.click();
    await expect(listing(page).locator('.cyc')).toHaveCount(0);
    await expect(section).toHaveCount(0);
  });
});

test('open a VICE snapshot like a PRG', async ({ app, page }) => {
  // fixtures/vsf/raster-demo.vsf: x64sc 3.10 stopped in the demo's raster IRQ ($08c7)
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/vsf/raster-demo.vsf')] });
  await fromFileMenu(page, 'Open a VICE snapshot (.vsf)…');
  await expect(toast(page, 'Loaded raster-demo.prg at $0200 from a VICE 3.10 snapshot of a C64SC, PC $08c7, $01 = $37; traced from $08c7, $08b7; program start $0810')).toBeVisible();
  await openSection(page, 'Files');
  await expect(page.locator('.file-row', { hasText: 'raster-demo.prg' })).toContainText('$0200–$ffff');
  // the BASIC stub inside the RAM is the program start the analysis traces from; Build & Run restarts the snapshot
  const start = await openSection(page, 'Program start');
  await expect(start).toContainText(/\$0810\s*start/);
  await expect(start).toContainText('set by you');
  await expect(start).toContainText('VICE restarts the snapshot as it was taken (PC $08c7, $01 = $37); the start is for the analysis');
  await goTo(page, 'irq_08b7');
  await expect(statusBar(page)).toContainText('$08b7 · irq_08b7');
  await page.keyboard.press('F7');
  await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });

  await test.step('with the setting, the zero page and the stack come along: from $0002', async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('tab', { name: 'Analysis', exact: true }).click();
    await settings.getByLabel('VICE snapshots: include the zero page and the stack').check();
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings).toBeHidden();
    await stubDialogs(app, { open: [join(repoDir, 'fixtures/vsf/raster-demo.vsf')] });
    await fromFileMenu(page, 'Open a VICE snapshot (.vsf)…');
    await expect(toast(page, 'Loaded raster-demo.prg at $0002 from a VICE 3.10 snapshot')).toBeVisible();
    await openSection(page, 'Files');
    await expect(page.locator('.file-row', { hasText: 'raster-demo.prg' })).toContainText('$0002–$ffff');
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });
});

test('pack a VICE snapshot: Pack from leaves out the start of its RAM, so the decruncher has room', async ({ app, page }) => {
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/vsf/raster-demo.vsf')] });
  await fromFileMenu(page, 'Open a VICE snapshot (.vsf)…');
  await expect(toast(page, 'Loaded raster-demo.prg at $0200')).toBeVisible();
  await page.locator('nav.activity').getByRole('button', { name: 'Pack' }).click();
  for (const name of ['What to pack', 'Packed file', 'Self-extracting', 'Command']) await openSection(page, name);
  const view = page.locator('.pack-view'), cmd = view.getByLabel('Brokkr command'), from = view.getByLabel('Pack from');
  const failed = view.getByRole('status').filter({ hasText: 'Brokkr failed' }), card = view.getByRole('status', { name: 'Packed file' });

  await test.step('all of its RAM from $0200 leaves the decruncher no room: the view says so before and after Pack', async () => {
    await expect(from).toHaveValue('');
    await expect(from).toHaveAttribute('placeholder', '$0200');
    await expect(view).toContainText("The build fills memory from $0200 up, as a snapshot's RAM does, where a self-extracting file's decruncher works: there is no room for it.");
    await expect(cmd).toHaveText('brokkr sfx --start sys -o raster-demo-brokkr.prg raster-demo.prg');
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    await expect(failed).toContainText('There is no room for the decruncher', { timeout: 120_000 });
    await expect(failed).toContainText('next to the program $0200–$ffff. The program fills memory from $0200 up, where the decruncher works: leave out its start with Pack from, under What to pack');
  });

  await test.step('Pack from $0800 in the failure leaves out $0200–$07ff, and the file decrunches to the rest', async () => {
    await failed.getByRole('button', { name: 'Pack from $0800' }).click();
    await expect(from).toHaveValue('$0800');
    await expect(view).toContainText('Leaves out $0200–$07ff (1536 bytes): after decrunching the program finds there what the decruncher left.');
    await expect(view).not.toContainText('there is no room for it');
    await expect(cmd).toHaveText('brokkr sfx --start sys -o raster-demo-brokkr.prg raster-demo.prg,$0800,1536,63488');
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    await expect(card).toContainText('raster-demo-brokkr.prg', { timeout: 120_000 });
    await expect(card).toContainText("Decrunched in Brokkr's emulated C64: $0800–$ffff has the same 63488 bytes, and it starts at $0810");
  });

  await test.step('a Pack from that leaves out the SYS line, or all of it, says so; emptied, it packs all of it', async () => {
    await from.fill('$0900');
    await from.press('Enter');
    await expect(view).toContainText('Pack from $0900 leaves out the BASIC line, so there is no SYS to start from');
    await from.fill('$ffff');
    await from.press('Enter');
    await expect(view).toContainText('Leaves out $0200–$fffe');
    await from.fill('');
    await from.press('Enter');
    await expect(cmd).toHaveText('brokkr sfx --start sys -o raster-demo-brokkr.prg raster-demo.prg');
    await expect(view.getByRole('button', { name: 'Pack from $0800' })).toBeVisible();
  });
});

test('deep analysis from the Problems tab: a snapshot\'s ROM calls are not traced into the RAM below', async ({ app, page }) => {
  // the snapshot's RAM covers the KERNAL and BASIC ROM: the normal analysis traces their calls into it
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/vsf/raster-demo.vsf')] });
  await fromFileMenu(page, 'Open a VICE snapshot (.vsf)…');
  await expect(toast(page, 'Loaded raster-demo.prg at $0200')).toBeVisible();
  const tab = page.getByRole('tab', { name: /Problems/ });
  await tab.click();
  // a new project has the deep analysis on: off, the normal analysis traces the ROM calls into the RAM below
  const box = page.getByRole('checkbox', { name: 'Deep analysis' });
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(tab.locator('.count')).toHaveText('4');
  await expect(page.locator('.loglist .logrow', { hasText: 'BRK at $ffd2 ends the code path' })).toBeVisible();
  const result = page.getByRole('status', { name: 'Deep analysis result' });
  await expect(result).toContainText('analyses again until the problems are at a minimum');

  await box.check();
  // the four BRKs in the RAM below the ROM are solved: the calls reach the ROM
  await expect(result).toHaveText(/^4 → 0 problems in 3 rounds, \d+\.\d s: 4 solved, 0 decided · the Log tells what it left out$/, { timeout: 30_000 });
  await expect(tab.locator('.count')).toHaveText('0');
  await expect(page.locator('.bottom-body')).toContainText('No problems found.');
  await page.getByRole('tab', { name: /Analysis log/ }).click();
  await expect(page.locator('.loglist .logrow', { hasText: 'The JSR at $088f to $ffd2 reaches the KERNAL ROM there, so the RAM below it is not traced' })).toBeVisible();
  await page.keyboard.press('F7');
  await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });

  // the setting is the project's, in Settings too; off again, the problems are back
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Analysis', exact: true }).click();
  await expect(settings.getByLabel('Deep analysis (slower)')).toBeChecked();
  await settings.getByLabel('Deep analysis (slower)').uncheck();
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(tab.locator('.count')).toHaveText('4');
});

test('the listing, Graphics and Memory open where the one before was in memory, unless a jump is newer', async ({ app, page }) => {
  // spec 14.6b, on fixtures/vsf/raster-demo.vsf: all the RAM from $0200 is loaded, so every tab has every address
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/vsf/raster-demo.vsf')] });
  await fromFileMenu(page, 'Open a VICE snapshot (.vsf)…');
  await expect(toast(page, /^Loaded raster-demo\.prg at \$0200/)).toBeVisible();
  // the snapshot's analysis is in (a new project starts the place over)
  await expect(statusBar(page)).toContainText(/1 file · 6\d KB/);
  const scroller = page.locator('.gfxv-scroll'), dump = page.getByLabel('Memory dump');
  // the address at the top of each tab
  const listTop = () => listing(page).evaluate(el => {
    const rows = [...el.querySelectorAll<HTMLElement>('.row')].filter(r => r.querySelector('.adr')?.textContent?.trim()).sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
    return parseInt(rows.find(r => parseFloat(r.style.top) >= el.scrollTop - 1)?.querySelector('.adr')?.textContent ?? '', 16);
  });
  const gfxTop = () => scroller.evaluate(el => {
    const rows = [...el.querySelectorAll<HTMLElement>('.gfxv-row')];
    return parseInt(rows.find(r => r.offsetTop <= el.scrollTop + 1 && r.offsetTop + r.offsetHeight > el.scrollTop + 1)?.dataset.addr ?? '', 16);
  });
  const memTop = () => dump.evaluate(el => {
    const row = [...el.querySelectorAll<HTMLElement>('.mon-row')].find(r => parseFloat(r.style.top) <= el.scrollTop + 1 && parseFloat(r.style.top) + 20 > el.scrollTop + 1);
    return parseInt(/C:([0-9a-f]{4})/.exec(row?.textContent ?? '')?.[1] ?? '', 16);
  });
  const tab = (name: string) => page.getByRole('tab', { name, exact: true }).click();

  await test.step('Graphics scrolled to $7d00: the listing opens with it at the top', async () => {
    await tab('Graphics');
    // 40 characters of 8 bytes at zoom 2: a row is 320 bytes and 16 pixels, so 1600 pixels down is $7d00
    await scroller.evaluate(el => { el.scrollTop = 1600; });
    await expect.poll(gfxTop).toBe(0x7d00);
    await tab('Listing');
    await expect.poll(async () => { const a = await listTop(); return a <= 0x7d00 && a > 0x7d00 - 0x40; }).toBe(true);
  });

  let at = 0;
  await test.step('the listing scrolled further: Memory opens with that row at the top, and Graphics after it', async () => {
    await listing(page).evaluate(el => { el.scrollTop += 2000; });
    await expect.poll(async () => { at = await listTop(); return at > 0x7d00; }).toBe(true);
    await tab('Memory');
    await expect.poll(async () => { const a = await memTop(); return a <= at && at < a + 16; }).toBe(true);
    // Memory scrolled on: Graphics opens there, and the listing too, as Graphics was not scrolled
    await dump.evaluate(el => { el.scrollTop += 4000; });
    await expect.poll(async () => { at = await memTop(); return at >= 0x8000; }).toBe(true);
    await tab('Graphics');
    await expect.poll(gfxTop).toBe(Math.floor(at / 320) * 320);
    await tab('Listing');
    await expect.poll(async () => { const a = await listTop(); return a <= at && a > at - 0x40; }).toBe(true);
  });

  await test.step('back from a tab not scrolled, the listing is exactly where it was', async () => {
    const before = await listing(page).evaluate(el => el.scrollTop);
    await tab('Memory');
    await tab('Listing');
    await expect.poll(() => listing(page).evaluate(el => el.scrollTop)).toBe(before);
  });

  await test.step('a jump is newer: a byte clicked in Memory is what the listing shows', async () => {
    await tab('Memory');
    await dump.evaluate(el => { el.scrollTop = 0; });
    await expect.poll(memTop).toBe(0x0200);
    await dump.locator('[data-a="528"].mon-b').click();
    await expect(statusBar(page)).toContainText('$0210');
    await tab('Listing');
    await expect(listing(page).locator('.row.cur')).toBeInViewport();
  });
});

test('the Graphics tab keeps the address you scrolled to at the top when the view changes', async ({ page }) => {
  await waitForListing(page);
  await page.getByRole('tab', { name: 'Graphics' }).click();
  const view = page.getByLabel('Memory as graphics'), scroller = view.locator('.gfxv-scroll');
  // the address of the gutter row at the top of the picture
  const top = () => scroller.evaluate(el => {
    const rows = [...el.querySelectorAll<HTMLElement>('.gfxv-row')];
    return rows.find(r => r.offsetTop <= el.scrollTop + 1 && r.offsetTop + r.offsetHeight > el.scrollTop + 1)?.dataset.addr ?? null;
  });
  const mode = (name: string) => view.getByRole('button', { name, exact: true }).click();

  // 40 characters of 8 bytes at zoom 2: a row is 320 bytes and 16 pixels, so 1600 pixels down is $7d00
  await scroller.evaluate(el => { el.scrollTop = 1600; });
  await expect.poll(top).toBe('7d00');
  await mode('Sprites');
  await expect.poll(async () => { const a = parseInt((await top()) ?? '-1', 16); return a <= 0x7d00 && a > 0x7d00 - 0x800; }).toBe(true);
  await mode('Bitmaps');
  await expect.poll(top).toBe('6000');
  await mode('Screens');
  await expect.poll(top).toBe('7c00');
  // back from them all, at the same row as before
  await mode('Characters');
  await expect.poll(top).toBe('7d00');
  await view.getByLabel('Cells per row').selectOption('16');
  await expect.poll(top).toBe('7d00');
  // scrolling sets a new one: 16 characters a row are 128 bytes
  await scroller.evaluate(el => { el.scrollTop = 160; });
  await expect.poll(top).toBe('0500');
  await mode('Sprites');
  await mode('Characters');
  await expect.poll(top).toBe('0500');
});

test('the Graphics tab shows memory as characters, sprites or bitmaps, and marks what it finds', async ({ page }) => {
  await waitForListing(page);
  await page.keyboard.press('Control+j');
  await page.getByRole('tab', { name: 'Graphics' }).click();
  const view = page.getByLabel('Memory as graphics');
  const go = async (to: string) => { await view.getByLabel('Go to address, label or range').fill(to); await view.getByLabel('Go to address, label or range').press('Enter'); };
  const sel = view.getByRole('status');
  const canvas = view.locator('.gfxv-canvas');

  await test.step('characters: go to $3000, take the whole 2 KB charset and mark it', async () => {
    await expect(view.getByRole('button', { name: 'Characters' })).toHaveAttribute('aria-pressed', 'true');
    // 40 characters a row (a screen's width) by default
    await expect(view.getByLabel('Cells per row')).toHaveValue('40');
    await go('$3000');
    await expect(sel).toContainText('$3000–$3007 (8 bytes) · Charset charset_3000');
    await view.getByRole('button', { name: 'Whole charset (2 KB)' }).click();
    await expect(sel).toContainText('$3000–$37ff (2048 bytes)');
    // character 1536 is column 16 of a row: 24, 5 rows of 40 and 32 characters
    await expect(canvas.locator('.gfxv-selrect')).toHaveCount(7);
    await view.getByRole('button', { name: 'Mark as Charset' }).click();
    await expect(toast(page, '$3000–$37ff marked as Charset')).toBeVisible();
  });

  await test.step('characters per row: 16, 32, 40 or 64, or any count typed in after Other…', async () => {
    const picture = canvas.locator('canvas');
    await expect(picture).toHaveCSS('width', `${40 * 8 * 2}px`);
    await view.getByLabel('Cells per row').selectOption('other');
    const count = view.getByLabel('Characters per row');
    await count.fill('48');
    await count.press('Enter');
    await expect(picture).toHaveCSS('width', `${48 * 8 * 2}px`);
    await count.press('ArrowDown');
    await expect(picture).toHaveCSS('width', `${47 * 8 * 2}px`);
    // a count outside 1-128 is not taken
    await count.fill('500');
    await count.press('Enter');
    await expect(count).toHaveClass(/bad/);
    await expect(picture).toHaveCSS('width', `${47 * 8 * 2}px`);
    await view.getByLabel('Cells per row').selectOption('16');
    await expect(count).toBeHidden();
    await expect(picture).toHaveCSS('width', `${16 * 8 * 2}px`);
    await view.getByLabel('Cells per row').selectOption('40');
  });

  await test.step('sprites: a click selects a sprite, Shift+click more; hovering names its sprite pointer', async () => {
    await view.getByRole('button', { name: 'Sprites', exact: true }).click();
    await go('$2000');
    const box = (await canvas.boundingBox())!;
    // 8 sprites per row at zoom 2: $2000 is row 16, column 0; $2040 column 1
    const at = (col: number, row: number) => ({ x: box.x + (col * 26 + 12) * 2, y: box.y + (row * 23 + 10) * 2 });
    await page.mouse.move(at(0, 16).x, at(0, 16).y);
    await expect(view.locator('.gfxv-info')).toContainText('sprite pointer $80 in VIC bank 0 · Sprites spr_2000');
    await page.mouse.click(at(0, 16).x, at(0, 16).y);
    await expect(sel).toContainText('$2000–$203f (64 bytes)');
    await page.keyboard.down('Shift');
    await page.mouse.click(at(1, 16).x, at(1, 16).y);
    await page.keyboard.up('Shift');
    await expect(sel).toContainText('$2000–$207f (128 bytes)');
    await view.getByRole('button', { name: 'Mark as Sprite data' }).click();
    await expect(toast(page, '$2000–$207f marked as Sprite data')).toBeVisible();
    // any count of sprites a row from 1 to 24
    const picture = canvas.locator('canvas');
    await expect(view.getByLabel('Cells per row').locator('option')).toHaveCount(24);
    await view.getByLabel('Cells per row').selectOption('24');
    await expect(picture).toHaveCSS('width', `${24 * 26 * 2}px`);
    await view.getByLabel('Cells per row').selectOption('1');
    await expect(picture).toHaveCSS('width', `${26 * 2}px`);
    await view.getByLabel('Cells per row').selectOption('8');
  });

  await test.step('bitmaps: 8 KB frames; Show in listing goes there, and the marks verify', async () => {
    await view.getByRole('button', { name: 'Bitmaps' }).click();
    await go('$2000');
    await expect(sel).toContainText('$2000–$3f3f (8000 bytes)');
    await view.getByRole('button', { name: 'Show in listing' }).click();
    await expect(page.getByRole('tab', { name: 'Listing' })).toHaveAttribute('aria-selected', 'true');
    await expect(headerRow(page, '2000').locator('.hdr-user')).toBeVisible();
    await expect(headerRow(page, '2000')).toContainText('Sprite');
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });
});

test('the Graphics tab draws bitmaps of fewer rows: a click selects those rows, Whole bitmap draws it whole again', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  await page.getByRole('tab', { name: 'Graphics' }).click();
  const view = page.getByLabel('Memory as graphics');
  const go = async (to: string) => { await view.getByLabel('Go to address, label or range').fill(to); await view.getByLabel('Go to address, label or range').press('Enter'); };
  const sel = view.getByRole('status'), canvas = view.locator('.gfxv-canvas'), height = view.getByLabel('Bitmap height in character rows');
  const whole = view.getByRole('button', { name: 'Whole bitmap (8000 bytes)' }), mode = view.getByRole('button', { name: 'Bitmaps' });
  /** a point of the picture (pixels at zoom 2), where it is now */
  const point = async (x: number, y: number) => { const b = (await canvas.boundingBox())!; return [b.x + x * 2, b.y + y * 2] as const; };

  await test.step('a whole bitmap: a click already selects all of it, so there is no Whole bitmap', async () => {
    await mode.click();
    await expect(height).toHaveValue('25');
    await expect(mode).toContainText('320×200');
    await go('$2000');
    await expect(sel).toContainText('$2000–$3f3f (8000 bytes)');
    await expect(whole).toBeHidden();
  });

  await test.step('10 rows: each 8 KB is drawn 80 pixels high, and a click selects its 3200 bytes', async () => {
    await height.selectOption('10');
    await expect(view.locator('.view-now')).toContainText('3200 bytes each');
    await expect(view.locator('.view-now')).toContainText('10 rows');
    await expect(mode).toContainText('320×80');
    // 8 frames of 80 rows and a gap of 8, at zoom 2
    await expect(canvas).toHaveCSS('height', `${8 * 88 * 2}px`);
    // the whole bitmap selected before is more than is drawn: Whole bitmap draws it
    await expect(whole).toBeVisible();
    await go('$2000');
    await expect(sel).toContainText('$2000–$2c7f (3200 bytes)');
    await expect(canvas.locator('.gfxv-selrect')).toHaveCSS('height', `${80 * 2}px`);
    // the frame at $2000 is the second: 88 pixels down
    await page.mouse.click(...await point(10, 88 + 5));
    await expect(sel).toContainText('$2000–$2c7f (3200 bytes)');
    await page.keyboard.down('Shift');
    await page.mouse.click(...await point(10, 2 * 88 + 5));
    await page.keyboard.up('Shift');
    await expect(sel).toContainText('$2000–$4c7f (11392 bytes)');
    await expect(canvas.locator('.gfxv-selrect')).toHaveCount(2);
    await page.mouse.click(...await point(10, 88 + 5));
  });

  await test.step('hovering names the row and column; below the rows is no bitmap', async () => {
    await page.mouse.move(...await point(8 * 3 + 1, 88 + 8 * 9 + 5));
    await expect(view.locator('.gfxv-info')).toContainText(`$${(0x2000 + (9 * 40 + 3) * 8 + 5).toString(16)} = $`);
    await expect(view.locator('.gfxv-info')).toContainText('row 9, column 3 of the bitmap at $2000');
    await page.mouse.move(...await point(8 * 3 + 1, 88 + 80 + 4));
    await expect(view.locator('.gfxv-info')).not.toContainText('of the bitmap');
  });

  await test.step('saved as an image of those rows, and the height is kept with the other settings', async () => {
    await stubDialogs(app, { save: join(work, 'logo.png') });
    await view.getByRole('button', { name: 'Save…' }).click();
    await view.getByRole('menu', { name: 'Save the selection as' }).getByRole('menuitem', { name: /\.png/ }).click();
    await expect(toast(page, `Saved ${join(work, 'logo.png')}`)).toBeVisible();
    const png = readFileSync(join(work, 'logo.png'));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 80]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kr.gfx') ?? '{}').bitmapRows)).toBe(10);
  });

  await test.step('Whole bitmap selects all 8000 bytes and draws all 25 rows again, that bitmap at the top', async () => {
    await whole.click();
    await expect(sel).toContainText('$2000–$3f3f (8000 bytes)');
    await expect(height).toHaveValue('25');
    await expect(canvas.locator('.gfxv-selrect')).toHaveCSS('height', `${200 * 2}px`);
    await expect.poll(() => view.locator('.gfxv-scroll').evaluate(el => el.scrollTop)).toBe(208 * 2);
    await expect(whole).toBeHidden();
  });
});

test('a bitmap of fewer rows marked where the VIC shows a whole one is a block of those rows, the rest one of its own', async ({ page }) => {
  await waitForListing(page);
  // the showcase: a bitmap at $4000 the VIC shows ($d011, $d018), 8000 bytes
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await expect(toast(page, /^Showcase loaded/)).toBeVisible();
  await waitForListing(page);
  await expect(listing(page)).toContainText('LoadSid("music/music_1800.sid")');
  await goTo(page, '$4000');
  await expect(headerRow(page, '4000')).toContainText('$4000-$5f3f (8000 bytes)');
  await page.getByRole('tab', { name: 'Graphics' }).click();
  const view = page.getByLabel('Memory as graphics');
  await view.getByRole('button', { name: 'Bitmaps' }).click();
  await view.getByLabel('Bitmap height in character rows').selectOption('10');
  await view.getByLabel('Go to address, label or range').fill('$4000');
  await view.getByLabel('Go to address, label or range').press('Enter');
  await expect(view.getByRole('status')).toContainText('$4000–$4c7f (3200 bytes)');
  await view.getByRole('button', { name: 'Mark as Bitmap' }).click();
  await expect(toast(page, '$4000–$4c7f marked as Bitmap')).toBeVisible();
  await view.getByRole('button', { name: 'Show in listing' }).click();
  await expect(page.getByRole('tab', { name: 'Listing' })).toHaveAttribute('aria-selected', 'true');
  // the marked rows, and after them the rest of what the VIC shows
  await expect(headerRow(page, '4000')).toContainText('$4000-$4c7f (3200 bytes)');
  await expect(headerRow(page, '4000').locator('.hdr-user')).toBeVisible();
  await expect(headerRow(page, '4c80')).toContainText('$4c80-$5f3f (4800 bytes)');
  // drawn 80 pixels high: 10 rows
  await expect(listing(page).locator('.gfx-strip.gfx-bitmap').first()).toHaveCSS('height', '80px');
});

test('edit build.bat in the source view: the export writes it, Restore generated takes it back', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  await page.getByRole('tab', { name: 'raster-demo.asm' }).click();
  const file = page.getByLabel('File', { exact: true });
  const note = page.locator('.source .tb-note');
  const editor = page.locator('.mon-host .view-lines');
  await expect(editor).toBeVisible();
  await expect(note).toContainText('read-only');

  await test.step('build.bat can be edited, and the edit is kept in the project', async () => {
    await file.selectOption('build.bat');
    await expect(note).toContainText('Editable');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('rem my own step');
    await expect(note).toContainText('Edited by you');
    await expect(page.getByRole('button', { name: 'Restore generated' })).toBeVisible();
  });

  await test.step('the export writes it; build.sh stays generated', async () => {
    const out = join(work, 'export');
    await stubDialogs(app, { open: [out] });
    await page.getByRole('button', { name: 'Export…', exact: true }).click();
    await expect(toast(page, `Exported verified Kick Assembler project to ${out}`)).toBeVisible({ timeout: 90_000 });
    expect(readFileSync(join(out, 'build.bat'), 'utf8')).toMatch(/\r?\nrem my own step$/);
    expect(readFileSync(join(out, 'build.sh'), 'utf8')).toContain('# Build script generated by Mimir Studio');
    expect(readFileSync(join(out, 'raster-demo.mimir.json'), 'utf8')).toContain('rem my own step');
  });

  await test.step('the source stays read-only; Restore generated brings the generated script back', async () => {
    await file.selectOption('raster-demo.asm');
    await expect(note).toContainText('read-only');
    await file.selectOption('build.bat');
    await page.getByRole('button', { name: 'Restore generated' }).click();
    await expect(toast(page, 'build.bat is generated again from the toolchain settings')).toBeVisible();
    await expect(editor).not.toContainText('rem my own step');
    await expect(note).toContainText('Editable');
  });
});

test('pack with Brokkr: checked in an emulated C64, effort max on threads, and crunched data', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  const view = page.locator('.pack-view');
  const cmd = view.getByLabel('Brokkr command');
  const card = view.getByRole('status', { name: 'Packed file' });
  const packedSize = async () => Number(/packed to (\d+)/.exec(await card.innerText())?.[1]);

  await test.step('Brokkr packs by default: the view shows its command, Pack builds, packs and checks it', async () => {
    await page.locator('nav.activity').getByRole('button', { name: 'Pack' }).click();
    // the view's sections are closed when the app starts
    for (const name of ['What to pack', 'Packed file', 'Self-extracting', 'Command']) await openSection(page, name);
    await expect(view.getByRole('tab', { name: 'Brokkr' })).toHaveAttribute('aria-selected', 'true');
    await expect(cmd).toHaveText('brokkr sfx --start sys -o raster-demo-brokkr.prg raster-demo.prg');
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    await expect(card).toContainText('raster-demo-brokkr.prg', { timeout: 90_000 });
    await expect(card).toContainText("Decrunched in Brokkr's emulated C64: $0801–$37ff has the same 12287 bytes, and it starts at $0810");
    await expect(card).toContainText('Decruncher');
    await expect(toast(page, /^Packed \d+ bytes into raster-demo-brokkr\.prg \(\d+ bytes\), decrunch verified/)).toBeVisible();
    await page.getByRole('tab', { name: 'Build output' }).click();
    await expect(page.locator('.build-log')).toContainText('> brokkr sfx --start sys -o raster-demo-brokkr.prg raster-demo.prg');
    await expect(page.locator('.build-log')).toContainText('checked in an emulated C64');
  });

  await test.step('only the settings that take effect are shown: no $01 with RUN, the border flash on or off', async () => {
    const flash = view.getByLabel('Flash the border while decrunching');
    await expect(view.getByLabel('More options')).toHaveCount(0);
    await expect(view.getByLabel('Load address')).toHaveCount(0);
    await view.getByLabel('Start', { exact: true }).selectOption('basic');
    await expect(view.getByLabel('$01 after')).toHaveCount(0);
    await flash.uncheck();
    await expect(cmd).toHaveText('brokkr sfx --start basic --no-effect -o raster-demo-brokkr.prg raster-demo.prg');
    await flash.check();
    await view.getByLabel('Start', { exact: true }).selectOption('sys');
    await expect(view.getByLabel('$01 after')).toBeVisible();
    await expect(cmd).toHaveText('brokkr sfx --start sys -o raster-demo-brokkr.prg raster-demo.prg');
    await expect(card).not.toContainText('Out of date');
  });

  await test.step('effort max searches on threads and gives no larger file', async () => {
    const normal = await packedSize();
    await view.getByLabel('Effort').selectOption('max');
    await expect(cmd).toHaveText('brokkr sfx --start sys --effort max -o raster-demo-brokkr.prg raster-demo.prg');
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    // while it packs: the steps and the time in a card, the button says so, and the Pack view's button spins
    const progress = view.getByRole('status', { name: 'Packing' });
    await expect(progress).toBeVisible();
    await expect(progress).toContainText('Build and verify the program');
    await expect(progress).toContainText('Crunch and check with Brokkr');
    await expect(progress).toContainText("Exomizer's format, effort Max, on threads; then the file runs in Brokkr's emulated C64");
    await expect(view.getByRole('button', { name: 'Packing…' })).toBeDisabled();
    await expect(page.locator('nav.activity').getByRole('button', { name: 'Pack' })).toHaveAttribute('aria-busy', 'true');
    await expect(card).not.toContainText('Out of date', { timeout: 120_000 });
    await expect(progress).toHaveCount(0);
    await expect(page.locator('nav.activity').getByRole('button', { name: 'Pack' })).not.toHaveAttribute('aria-busy');
    await expect(card).toContainText("Decrunched in Brokkr's emulated C64");
    expect(await packedSize()).toBeLessThanOrEqual(normal);
  });

  await test.step('crunched data with its decruncher, a PRG and source, which decrunches it in an emulated C64', async () => {
    await view.getByLabel('Effort').selectOption('normal');
    await view.getByRole('tab', { name: 'Crunched data' }).click();
    await openSection(page, 'Crunched data');
    const decruncher = ['brokkr decruncher -o raster-demo-brokkr-decrunch.asm', 'brokkr decruncher -o raster-demo-brokkr-decrunch.prg'];
    await expect(cmd).toHaveText(['brokkr mem -o raster-demo-brokkr.prg raster-demo.prg', ...decruncher].join('\n'));
    // no start and nothing after decrunching: your own code decrunches it
    await expect(view.getByLabel('Start', { exact: true })).toHaveCount(0);
    await expect(view.getByLabel('Flash the border while decrunching')).toHaveCount(0);
    await expect(view.getByLabel(/Write the decruncher too/)).toBeChecked();
    // where the decruncher written goes: its own defaults, or as set
    const section = await openSection(page, "Decruncher's memory");
    const line = (id: string) => section.locator(`#${id} ~ small`);
    await expect(line('pack-dec-at')).toHaveText(/^Takes \d+ bytes: \$c000–\$c[0-9a-f]{3} in the PRG; the source goes where you #import it\.$/);
    await expect(line('pack-tables-at')).toHaveText('Takes 156 bytes: $0334–$03cf.');
    await expect(line('pack-zp')).toHaveText('Takes 9 bytes: $f7–$ff.');
    await expect(view.getByLabel('Keep free', { exact: true })).toHaveCount(0);
    await view.getByLabel('No literal sequences (-T 5)').check();
    await expect(cmd).toHaveText(['brokkr mem -T 5 -o raster-demo-brokkr.prg raster-demo.prg', ...decruncher.map(c => c.replace(' -o', ' --no-literal-sequences -o'))].join('\n'));
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    await expect(card).toContainText("Decrunched by raster-demo-brokkr-decrunch.prg in Brokkr's emulated C64: $0801–$37ff has the same 12287 bytes", { timeout: 90_000 });
    const written = card.getByRole('list', { name: 'Files written' });
    await expect(written.getByRole('listitem')).toHaveCount(3);
    await expect(written).toContainText(/raster-demo-brokkr-decrunch\.prg.*the decruncher at \$c000–\$c[0-9a-f]{3}: set stream \(\$c[0-9a-f]{3}\) to the address after a file's last byte, then jsr \$c000/);
    await expect(written).toContainText('the decruncher as Kick Assembler source, to #import (it goes where it is imported)');
    // without it, Brokkr decrunches the stream again
    await view.getByLabel(/Write the decruncher too/).uncheck();
    await expect(cmd).toHaveText('brokkr mem -T 5 -o raster-demo-brokkr.prg raster-demo.prg');
    await expect(page.getByRole('region', { name: "Decruncher's memory", exact: true })).toHaveCount(0);
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    await expect(card).toContainText(/Brokkr decrunched the stream again: the same 12287 bytes\. In place it loads at \$0[0-9a-f]{3} or lower\./, { timeout: 90_000 });
    await view.getByLabel(/Write the decruncher too/).check();
  });

  await test.step('a file for each block, with one decruncher for all, and each file saved on its own', async () => {
    const ranges = view.getByRole('list', { name: 'Ranges to pack' });
    await view.getByRole('tab', { name: 'Chosen blocks' }).click();
    await goTo(page, '$0900-$0fff');
    await view.getByRole('button', { name: /^Selection \$0900–\$0fff$/ }).click();
    await goTo(page, '$2000-$27ff');
    await view.getByRole('button', { name: /^Selection \$2000–\$27ff$/ }).click();
    await expect(ranges).toHaveText('$0900–$0fff$2000–$27ff');
    const split = view.getByLabel(/A file for each block/);
    await expect(view.getByText('— 2 files, one decruncher for all, instead of one')).toBeVisible();
    await split.check();
    await expect(cmd).toHaveText([
      'brokkr mem -T 5 -o raster-demo-brokkr-0900.prg raster-demo.prg,$0900,255,1792', 'brokkr mem -T 5 -o raster-demo-brokkr-2000.prg raster-demo.prg,$2000,6143,2048',
      'brokkr decruncher --no-literal-sequences -o raster-demo-brokkr-decrunch.asm', 'brokkr decruncher --no-literal-sequences -o raster-demo-brokkr-decrunch.prg',
    ].join('\n'));
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    await expect(card).toContainText('each of the 2 files gives the same bytes', { timeout: 90_000 });
    await expect(card.locator('.pack-result-head')).toHaveText('2 crunched files');
    await expect(toast(page, /^Packed 3840 bytes into 2 files \(\d+ bytes\) with the decruncher, decrunch verified$/)).toBeVisible();
    const written = card.getByRole('list', { name: 'Files written' });
    await expect(written.getByRole('listitem')).toHaveCount(4);
    await expect(written).toContainText(/raster-demo-brokkr-2000\.prg.*\$2000–\$27ff, loaded at \$[0-9a-f]{4}–\$[0-9a-f]{4}: stream \$[0-9a-f]{4}/);
    await expect(card.getByRole('button', { name: 'Save as…', exact: true })).toHaveCount(0);
    const out = join(work, 'level2.prg');
    await stubDialogs(app, { save: out });
    await card.getByRole('button', { name: 'Save raster-demo-brokkr-2000.prg as…' }).click();
    await expect(toast(page, `Saved ${out}`)).toBeVisible();
    expect((await dialogOptions(app)).pop()).toMatchObject({ title: 'Save raster-demo-brokkr-2000.prg', defaultPath: expect.stringMatching(/raster-demo-brokkr-2000\.prg$/) });
    expect(readFileSync(out).length).toBeGreaterThan(2);
    await split.uncheck();
    await view.getByRole('tab', { name: 'Whole build' }).click();
  });

  await test.step("Brokkr's own format: a self-extracting file with its probabilities, checked the same way", async () => {
    await view.getByLabel('Format').selectOption('brokkr');
    // decrunched backward by Brokkr's own decruncher: no forward, no literal sequences to leave out
    await expect(view.getByLabel(/Crunch forward/)).toHaveCount(0);
    await expect(view.getByLabel(/No literal sequences/)).toHaveCount(0);
    await expect(cmd).toHaveText(['brokkr mem --format brokkr -o raster-demo-brokkr.prg raster-demo.prg',
      'brokkr decruncher --format brokkr -o raster-demo-brokkr-decrunch.asm', 'brokkr decruncher --format brokkr -o raster-demo-brokkr-decrunch.prg'].join('\n'));
    await view.getByRole('tab', { name: 'Self-extracting' }).click();
    // the -T 5 ticked for crunched data takes no effect in a self-extracting file
    await expect(cmd).toHaveText('brokkr sfx --format brokkr --start sys -o raster-demo-brokkr.prg raster-demo.prg');
    await expect(view).toContainText('decrunching takes about 9 times as long');
    await expect(view.getByLabel('Flash the border while decrunching')).toBeChecked();
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    await expect(card).not.toContainText('Out of date', { timeout: 120_000 });
    await expect(card).toContainText("Decrunched in Brokkr's emulated C64: $0801–$37ff has the same 12287 bytes, and it starts at $0810");
    await expect(card).toContainText('Probabilities');
  });

  await test.step("Brokkr's fast format: whole bytes, the decruncher in the stack page, checked the same way", async () => {
    await view.getByLabel('Format').selectOption('fast');
    await expect(cmd).toHaveText('brokkr sfx --format fast --start sys -o raster-demo-brokkr.prg raster-demo.prg');
    await expect(view).toContainText('decrunched about twice as fast, without a border flash');
    await expect(view.getByLabel('Flash the border while decrunching')).toHaveCount(0);
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    await expect(card).not.toContainText('Out of date', { timeout: 120_000 });
    await expect(card).toContainText("Decrunched in Brokkr's emulated C64: $0801–$37ff has the same 12287 bytes, and it starts at $0810");
    await expect(card).toContainText('$0100–$01d2');
  });

  await test.step('format auto: a file in each format, the smallest of those that decrunch within the time set', async () => {
    await view.getByLabel('Format').selectOption('auto');
    await expect(view).toContainText('Packs in all three formats and keeps the smallest file');
    await expect(cmd).toHaveText('brokkr sfx --format auto --start sys -o raster-demo-brokkr.prg raster-demo.prg');
    const time = view.getByLabel('At most, seconds to decrunch');
    await time.fill('0');
    await expect(view).toContainText('A time in seconds, above 0 and at most 3600.');
    await time.fill('2');
    await time.press('Enter');
    await expect(cmd).toHaveText('brokkr sfx --format auto --max-seconds 2 --start sys -o raster-demo-brokkr.prg raster-demo.prg');
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    const tried = card.getByRole('list', { name: 'What auto tried' });
    await expect(tried.getByRole('listitem')).toHaveCount(3, { timeout: 120_000 });
    await expect(tried).toContainText(/Exomizer's format: \d+ bytes, \d+\.\d s to decrunch/);
    await expect(tried.locator('li.on')).toHaveText(/\(taken\)$/);
    // crunched data takes one format: Exomizer's, as auto is not one
    await view.getByRole('tab', { name: 'Crunched data' }).click();
    await expect(view.getByLabel('Format')).toHaveValue('exomizer');
    await expect(view.locator('#pack-format option[value="auto"]')).toHaveCount(0);
    await view.getByRole('tab', { name: 'Self-extracting' }).click();
    await view.getByLabel('Format').selectOption('fast');
  });

  await test.step('a folder for the packed file: chosen in a dialog, the file goes there each time, and can be cleared', async () => {
    const out = join(work, 'release');
    mkdirSync(out);
    const folder = view.getByLabel('Folder', { exact: true });
    await expect(folder).toHaveText(/^Not set: the file stays in the app's pack folder/);
    await stubDialogs(app, { open: [out] });
    await view.getByRole('button', { name: 'Choose…' }).click();
    await expect(folder).toHaveText(out);
    expect((await dialogOptions(app)).pop()).toMatchObject({ title: 'Folder for the packed file' });
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    await expect(card).toContainText(`Written to ${out}`, { timeout: 90_000 });
    await expect(toast(page, `Packed 12287 bytes into ${join(out, 'raster-demo-brokkr.prg')}`)).toBeVisible();
    const b = readFileSync(join(out, 'raster-demo-brokkr.prg'));
    expect([b[0], b[1]]).toEqual([0x01, 0x08]);
    await view.getByRole('button', { name: 'Clear the folder' }).click();
    await expect(folder).toHaveText(/^Not set/);
  });

  await test.step("the decruncher's memory: places that suit it or one's own, the bytes each takes and where it ends", async () => {
    await view.getByLabel('Format').selectOption('exomizer');
    const section = await openSection(page, "Decruncher's memory");
    const line = (id: string) => section.locator(`#${id} ~ small`);
    const dec = view.getByLabel('Decruncher at', { exact: true });
    await expect(line('pack-dec-at')).toHaveText('Takes 201 to 229 bytes, where Brokkr finds room.');
    await dec.selectOption({ label: '$0334: tape buffer' });
    await expect(line('pack-dec-at')).toHaveText('It takes up to 229 bytes, and the tape buffer has 204.');
    await dec.selectOption({ label: '$c000: free RAM' });
    await expect(line('pack-dec-at')).toHaveText('Takes 201 to 229 bytes: $c000–$c0e4 at most.');
    const tables = view.getByLabel('Tables at', { exact: true });
    await tables.selectOption({ label: 'An address of your own…' });
    await expect(line('pack-tables-at')).toHaveText('Type the address below.');
    await view.getByLabel('Tables address', { exact: true }).fill('$c080');
    await view.getByLabel('Tables address', { exact: true }).press('Enter');
    await expect(line('pack-tables-at')).toHaveText('It overlaps the decruncher ($c000–$c0e4).');
    await view.getByLabel('Tables address', { exact: true }).fill('$c400');
    await view.getByLabel('Tables address', { exact: true }).press('Enter');
    await expect(line('pack-tables-at')).toHaveText('Takes 156 bytes: $c400–$c49b.');
    await view.getByLabel('Zero page at', { exact: true }).selectOption({ label: '$22: BASIC temp pointers' });
    await expect(line('pack-zp')).toHaveText('Takes 9 bytes: $22–$2a.');
    const keep = view.getByLabel('Keep free', { exact: true });
    await keep.fill('$d000-$c000');
    await expect(view).toContainText('the last address comes before the first');
    await keep.fill('$0334-$03ff');
    await keep.press('Enter');
    await expect(section).toContainText('Keeps 204 bytes free');
    await expect(cmd).toHaveText('brokkr sfx --start sys --zp $22 --at $c000 --table $c400 --keep $0334-$03ff -o raster-demo-brokkr.prg raster-demo.prg');
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    await expect(card).not.toContainText('Out of date', { timeout: 120_000 });
    await expect(card).toContainText("Decrunched in Brokkr's emulated C64");
    await expect(card).toContainText('$c000–$c0c8');
    await expect(card).toContainText('$c400–$c49b');
  });
});

test('pack with Exomizer: the whole build or chosen blocks, checked with desfx, saved with a dialog', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  const view = page.locator('.pack-view');
  const cmd = view.getByLabel('Exomizer command');
  const card = view.getByRole('status', { name: 'Packed file' });

  await test.step('Settings points at an Exomizer (the installed app at its own)', async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    const installed = process.env.MIMIR_E2E_EXE;
    if (installed) await expect(page.locator('#set-exomizerPath')).toHaveValue(join(dirname(installed), 'resources', 'exomizer', 'exomizer.exe'));
    else await expect(page.locator('#set-exomizerPath')).toHaveValue(/exomizer(\.exe)?$/i);
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  await test.step('the whole build: the Pack view shows the command, Pack builds, packs and checks it', async () => {
    await page.locator('nav.activity').getByRole('button', { name: 'Pack' }).click();
    for (const name of ['What to pack', 'Packed file', 'Self-extracting', 'Command']) await openSection(page, name);
    await view.getByRole('tab', { name: 'Exomizer' }).click();
    await expect(cmd).toHaveText(/^exomizer(\.exe)? sfx sys -o raster-demo-exo\.prg raster-demo\.prg$/);
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    await expect(card).toContainText('raster-demo-exo.prg', { timeout: 90_000 });
    await expect(card).toContainText(/Decrunched by desfx: \$0801–\$[0-9a-f]{4} has the same \d+ bytes, and it starts at \$0810/);
    await expect(card).toContainText('Decrunched data');
    await expect(toast(page, /^Packed \d+ bytes into raster-demo-exo\.prg \(\d+ bytes\), decrunch verified/)).toBeVisible();
    await page.getByRole('tab', { name: 'Build output' }).click();
    await expect(page.locator('.build-log')).toContainText(/> "?[^\n]*exomizer(\.exe)?"? sfx sys -o raster-demo-exo\.prg raster-demo\.prg/i);
  });

  await test.step('Save as… writes the packed PRG', async () => {
    const saved = join(work, 'release.prg');
    await stubDialogs(app, { save: saved });
    await card.getByRole('button', { name: 'Save as…' }).click();
    await expect(toast(page, `Saved ${saved}`)).toBeVisible();
    const b = readFileSync(saved);
    expect([b[0], b[1]]).toEqual([0x01, 0x08]);
    expect((await dialogOptions(app)).pop()).toMatchObject({ title: 'Save the packed file', defaultPath: expect.stringMatching(/raster-demo-exo\.prg$/) });
  });

  await test.step('chosen blocks: from the listing, a selection and ticks, jumping to the code, packed again', async () => {
    const ranges = view.getByRole('list', { name: 'Ranges to pack' });
    await view.getByRole('tab', { name: 'Chosen blocks' }).click();
    await expect(view).toContainText('Nothing chosen yet');
    await expect(view.getByRole('button', { name: 'Pack', exact: true })).toBeDisabled();
    await expect(card).toContainText('Out of date');
    // the code block at $0810 from the listing's menu
    await headerRow(page, '0810').click({ button: 'right' });
    await fromSubmenu(page, 'Program', 'Pack block with Exomizer');
    await expect(toast(page, /is packed with the chosen blocks/)).toBeVisible();
    await expect(ranges).toHaveText('$0810–$0865');
    // without the BASIC line there is no SYS to start from
    await expect(view.getByText(/The chosen blocks leave out the BASIC line/)).toBeVisible();
    // the rest of the program as a selection in the listing
    await goTo(page, '$0810-$37ff');
    await view.getByRole('button', { name: /^Selection \$0810–\$37ff$/ }).click();
    await expect(ranges).toHaveText('$0810–$37ff');
    // a block unticked and ticked again
    await view.getByRole('checkbox', { name: 'Pack $0810-$0865' }).uncheck();
    await expect(ranges).toHaveText('$0866–$37ff');
    await view.getByRole('checkbox', { name: 'Pack $0810-$0865' }).check();
    await expect(ranges).toHaveText('$0810–$37ff');
    await view.getByLabel('Start', { exact: true }).selectOption('jmp');
    await expect(view.getByLabel('Jump to')).toHaveValue('$0810');
    await view.getByLabel('Decrunch effect').selectOption('none');
    await expect(cmd).toHaveText(/ sfx \$0810 -n -o raster-demo-exo\.prg raster-demo\.prg,\$0810,15,12272$/);
    await view.getByRole('button', { name: 'Pack', exact: true }).click();
    await expect(card).toContainText('Decrunched by desfx: $0810–$37ff has the same 12272 bytes, and it starts at $0810', { timeout: 90_000 });
    await expect(card).not.toContainText('Out of date');
  });

  await test.step('the pack settings are undoable and kept in the project', async () => {
    await listing(page).click();
    await page.keyboard.press('Control+z');
    await expect(cmd).toHaveText(/ sfx \$0810 -o /);
    // without a project, a copy of the project file (Save makes a project of the work)
    const out = join(work, 'packed.mimir.json');
    await stubDialogs(app, { save: out });
    await page.getByRole('button', { name: 'No project' }).click();
    await page.getByRole('menuitem', { name: 'Save a copy of the project file…' }).click();
    await expect(toast(page, `A copy of the project saved to ${out}`)).toBeVisible();
    expect(JSON.parse(readFileSync(out, 'utf8')).pack).toMatchObject({ mode: 'sfx', start: 'jmp', jmp: 0x0810, effect: 'default' });
  });
});

test('comment a zero-page variable on its .label line, with the keys, the menu and the inspector', async ({ page }) => {
  await waitForListing(page);
  const zpRow = () => listing(page).locator('.row', { hasText: '.label ptr_fb = $fb' });
  const editor = page.locator('.edit-pop');
  const insp = page.getByRole('region', { name: 'Zero-page variable' });
  const rowsAbove = async () => {
    const all = (await listingRows(page)).map(r => r.text.trim());
    const i = all.findIndex(t => t.startsWith('.label ptr_fb = $fb'));
    return { line: all[i], above: all.slice(Math.max(0, i - 3), i) };
  };

  await test.step('; comments the end of the .label line', async () => {
    await goTo(page, '$0801');
    await zpRow().click();
    await expect(insp).toBeVisible();
    await expect(insp).toContainText('$fb');
    await page.keyboard.press(';');
    await expect(editor).toHaveClass(/zp/);
    await expect(editor.locator('label')).toContainText('Comment at $fb');
    await editor.locator('input').fill('screen pointer');
    await editor.locator('input').press('Enter');
    await expect(zpRow().locator('.cmt.user')).toHaveText('// screen pointer');
  });

  await test.step('/ adds a comment line above it, and the inspector shows both', async () => {
    await zpRow().click();
    await page.keyboard.press('/');
    await expect(editor.locator('label')).toContainText('Comment line above $fb');
    await editor.locator('input').fill('set by the raster irq');
    await editor.locator('input').press('Enter');
    await expect.poll(async () => (await rowsAbove()).above.at(-1)).toBe('// set by the raster irq');
    await zpRow().click();
    await expect(insp.getByLabel('Comment above the .label line')).toHaveValue('set by the raster irq');
    await expect(insp.getByLabel('Comment at the end of the .label line')).toHaveValue('screen pointer');
  });

  await test.step('the inspector edits them like a block comment', async () => {
    await insp.getByLabel('Comment above the .label line').fill('set by the raster irq\nread by the scroller');
    await insp.getByLabel('Comment at the end of the .label line').click();
    await expect.poll(async () => (await rowsAbove()).above.slice(-2)).toEqual(['// set by the raster irq', '// read by the scroller']);
    await insp.getByLabel('Comment at the end of the .label line').fill('points at the screen');
    await insp.getByLabel('Comment at the end of the .label line').press('Enter');
    await expect(zpRow().locator('.cmt.user')).toHaveText('// points at the screen');
  });

  await test.step('the menu on the .label line edits the comment block, and the export verifies', async () => {
    await zpRow().click({ button: 'right' });
    await fromSubmenu(page, 'Comment above the .label line', 'Comment block…');
    await expect(editor.locator('label')).toContainText('Comment block above $fb');
    await expect(editor.locator('textarea')).toHaveValue('set by the raster irq\nread by the scroller');
    await editor.locator('textarea').press('Escape');
    await page.getByRole('tab', { name: 'raster-demo.asm' }).click();
    // the source opens at the listing's cursor: the file's head (its .label lines) is at the top
    await page.locator('.mon-host .view-lines').click();
    await page.keyboard.press('Control+Home');
    await expect(page.locator('.mon-host .view-lines')).toContainText('.label ptr_fb = $fb');
    await page.getByRole('tab', { name: 'Listing' }).click();
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('Ctrl+Z takes the comments back one by one', async () => {
    await listing(page).click();
    await page.keyboard.press('Control+z');
    await expect(zpRow().locator('.cmt.user')).toHaveText('// screen pointer');
  });
});

test('Ctrl+C copies the selected lines of the listing as source, and the line at the cursor without one', async ({ app, page }) => {
  await waitForListing(page);
  const clipboard = async () => (await app.evaluate(({ clipboard: c }) => c.readText())).replace(/\r\n/g, '\n');
  // fx_091e is a jump-table routine: lda SID_OSC3 / and #$0f / sta COLOR_RAM+24*40+39 / rts
  await goTo(page, 'fx_091e');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
  await expect(statusBar(page)).toContainText('sel $091e–$0926 (9 B)');
  await page.keyboard.press('Control+c');
  // the whole block is selected, so its header comes along
  await expect(toast(page, 'Copied 6 lines to the clipboard')).toBeVisible();
  const lines = (await clipboard()).split('\n');
  expect(lines).toHaveLength(6);
  expect(lines[0]).toMatch(/^\/\/ ---- Code · fx_091e · \$091e-\$0926 \(9 bytes\) -+$/);
  expect(lines[1]).toBe('fx_091e:');
  expect(lines[2]).toMatch(/^ {8}lda SID_OSC3 +\/\/ Voice 3 oscillator output/);
  expect(lines[3]).toBe('        and #$0f');
  expect(lines[4]).toMatch(/^ {8}sta COLOR_RAM\+24\*40\+39\b/);
  expect(lines[5]).toBe('        rts');

  // the context menu inside the selection offers the same
  await listing(page).locator('.row', { has: page.locator('.adr', { hasText: /^0921$/ }) }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Copy 6 selected lines/ }).click();
  await expect(toast(page, 'Copied 6 lines to the clipboard')).toHaveCount(2);

  // without a selection, the line at the cursor
  await goTo(page, '$0923');
  await page.keyboard.press('Control+c');
  await expect(toast(page, 'Copied to clipboard')).toBeVisible();
  expect(await clipboard()).toMatch(/^sta COLOR_RAM\+24\*40\+39\b/);
});

test('Ctrl over a line peeks at its block the other way: code as bytes and text, data as code', async ({ page }) => {
  await waitForListing(page);
  const peek = page.locator('.peek');
  const row = (adr: string) => listing(page).locator('.row', { has: page.locator('.adr', { hasText: new RegExp(`^${adr}$`) }) }).last();
  const hover = async (r: Locator) => { const b = (await r.locator('.src').boundingBox())!; await page.mouse.move(b.x + 60, b.y + b.height / 2); return b; };

  await test.step('code: its bytes from the line on, with them as PETSCII and as screen codes', async () => {
    // fx_091e: lda SID_OSC3 / and #$0f / sta COLOR_RAM+24*40+39 / rts
    await goTo(page, 'fx_091e');
    const at = await hover(row('091e'));
    await page.keyboard.down('Control');
    await expect(peek).toBeVisible();
    await expect(peek).toContainText('as bytes and text');
    await expect(peek.locator('.peek-head')).toContainText('fx_091e · $091e–$0926');
    await expect(peek.locator('.p-hex').nth(1)).toHaveText('ad 1b d4 29 0f 8d e7 db');
    await expect(peek.locator('.p-hex').nth(2)).toHaveText('60');
    // the line's bytes are marked; the box is beside the line, from its top, right of the pointer and of the code of
    // the lines it lies over, so that code stays in sight
    await expect(peek.locator('.p-hex .on')).toHaveText(['ad', ' 1b', ' d4']);
    const box = (await peek.boundingBox())!;
    expect(Math.abs(box.y - at.y)).toBeLessThanOrEqual(1);
    expect(box.x).toBeGreaterThan(at.x + 60);
    for (const adr of ['091e', '0921', '0923', '0926']) {
      const cp = (await row(adr).locator('.src > .cp').boundingBox())!;
      expect(box.x, `the code of ${adr}`).toBeGreaterThanOrEqual(cp.x + cp.width);
    }
    // with Ctrl held it follows the pointer onto the lines under it, and on its way right into the box it stays
    const adr = (await row('0921').locator('.adr').boundingBox())!;
    await page.mouse.move(adr.x + adr.width / 2, adr.y + adr.height / 2);
    await expect(peek.locator('.p-hex').nth(1)).toHaveText('29 0f 8d e7 db 60');
    await page.keyboard.up('Control');
    await expect(peek).toBeHidden();
  });

  await test.step('with Ctrl held the mouse wheel scrolls the box through the file, block after block, and neither the listing nor the window', async () => {
    const before = peek.locator('.peek-more.before'), head = peek.locator('.peek-head');
    const divider = (text: string) => peek.locator('.peek-blk', { hasText: text });
    const bytesAt = (adr: string) => peek.locator('.peek-row', { has: page.locator('.p-adr', { hasText: new RegExp(`^${adr}$`) }) }).locator('.p-hex');
    const view = async () => page.evaluate(() => ({ top: document.querySelector('.listing')!.scrollTop, zoom: window.devicePixelRatio }));
    // code as bytes: from $0921, three bytes of the block above it; under the block's end the next block
    await hover(row('0921'));
    await page.keyboard.down('Control');
    await expect(peek.locator('.p-hex').nth(1)).toHaveText('29 0f 8d e7 db 60');
    await expect(before).toHaveText('… 3 bytes before, from $091e');
    await expect(peek.locator('.peek-blk').first()).toContainText('$0927–');
    const was = await view();
    // up: the block's first bytes, a row of their own, and above them the block before it
    await page.mouse.wheel(0, -100);
    await expect(bytesAt('091e')).toHaveText('ad 1b d4');
    await expect(divider('fx_091e · $091e–$0926')).toBeVisible();
    await expect(head).not.toContainText('fx_091e');
    expect(await view()).toEqual(was);
    // down: past the block's end, the head names the block at the top
    await page.mouse.wheel(0, 200);
    await page.mouse.wheel(0, 100);
    await expect(head).not.toContainText('fx_091e');
    await expect(bytesAt('0921')).toHaveCount(0);
    expect(await view()).toEqual(was);

    // a click in the box goes there in the listing; Alt+Left comes back
    await page.waitForTimeout(400);
    const far = peek.locator('.peek-row .p-hex [data-a]').first();
    const a = Number(await far.getAttribute('data-a')), at = `$${a.toString(16).padStart(4, '0')}`;
    expect(a).toBeGreaterThan(0x0926);
    const b = (await far.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.down();
    await page.mouse.up();
    await expect(statusBar(page)).toContainText(`sel ${at}–${at} (1 B)`);
    await expect(peek).toBeVisible();
    await page.keyboard.up('Control');
    await expect(peek).toBeHidden();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(statusBar(page)).toContainText('$091e');

    // data as code: an instruction a row; up into the block before it; shown again, the box starts at the line again
    await goTo(page, '$0985');
    await hover(row('0985'));
    await page.keyboard.down('Control');
    await expect(peek).toContainText('as code');
    const first = peek.locator('.peek-row[data-a] .p-adr').first();
    await expect(first).toHaveText('0985');
    await page.mouse.wheel(0, 100);
    await expect(first).not.toHaveText('0985');
    await expect(before).toContainText('before, from $0985');
    await page.mouse.wheel(0, -300);
    await expect(divider('$0985–$09b4')).toBeVisible();
    await expect(head).not.toContainText('$0985–$09b4');
    await page.mouse.move(10, 10);
    await expect(peek).toBeHidden();
    await hover(row('0985'));
    await expect(first).toHaveText('0985');
    await page.keyboard.up('Control');
    await expect(peek).toBeHidden();
  });

  await test.step('a click in the box into a folded block unfolds it', async () => {
    await goTo(page, '$0985');
    await page.keyboard.press('f');
    await expect(listing(page).locator('.row:not(.hdr)', { has: page.locator('.adr', { hasText: /^0985$/ }) })).toHaveCount(0);
    const h = (await headerRow(page, '0985').boundingBox())!;
    await page.mouse.move(h.x + 200, h.y + h.height / 2);
    await page.keyboard.down('Control');
    await expect(peek).toContainText('as code');
    await page.waitForTimeout(400);
    const ora = peek.locator('.peek-row[data-a="2438"]'); // $0986: ora $0c
    const b = (await ora.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.down();
    await page.mouse.up();
    await expect(statusBar(page)).toContainText('sel $0986–$0986 (1 B)');
    await expect(listing(page).locator('.row:not(.hdr)', { has: page.locator('.adr', { hasText: /^0985$/ }) })).not.toHaveCount(0);
    await page.keyboard.up('Control');
    await expect(peek).toBeHidden();
    await goTo(page, 'fx_091e');
  });

  await test.step('in the box a click picks a byte (or a character) in the listing, and Shift+click picks up to another', async () => {
    await hover(row('091e'));
    await page.keyboard.down('Control');
    await expect(peek).toBeVisible();
    // the pointer rests on the line a moment: then the box stays when it goes into it
    await page.waitForTimeout(400);
    const press = async (target: Locator) => { const b = (await target.boundingBox())!; await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); await page.mouse.down(); await page.mouse.up(); };
    const sta = peek.locator('.p-hex [data-a="2339"]'); // $0923, the 8d of sta
    await press(sta);
    await expect(statusBar(page)).toContainText('sel $0923–$0923 (1 B)');
    await expect(statusBar(page)).toContainText('$0923');
    await expect(sta).toHaveClass(/\bpicked\b/);
    await expect(peek.locator('.peek-head')).toContainText('fx_091e');
    await page.keyboard.down('Shift');
    await press(peek.locator('.p-txt [data-a="2342"]').first()); // $0926, the rts, in the PETSCII column
    await page.keyboard.up('Shift');
    await expect(statusBar(page)).toContainText('sel $0923–$0926 (4 B)');
    await expect(peek).toBeVisible();
    await page.keyboard.up('Control');
    await expect(peek).toBeHidden();
  });

  await test.step('data shown as code in the box: a click on an instruction picks its first byte, and C makes code from there', async () => {
    await goTo(page, '$0985');
    await hover(row('0985'));
    await page.keyboard.down('Control');
    await expect(peek).toContainText('as code');
    await page.waitForTimeout(400);
    const ora = peek.locator('.peek-row[data-a="2438"]'); // $0986: ora $0c
    const b = (await ora.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.down();
    await page.mouse.up();
    await expect(statusBar(page)).toContainText('sel $0986–$0986 (1 B)');
    await page.keyboard.up('Control');
    await page.keyboard.press('c');
    await expect(toast(page, '$0986–$09b4 marked as Code')).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(listing(page).locator('.row.hdr', { hasText: '$0985-$09b4 (48 bytes)' })).toHaveCount(1);
  });

  await test.step('data: as code, from the block\'s start, with each instruction\'s bytes as PETSCII and as screen codes', async () => {
    // "HELLO FROM THE MIMIR STUDIO DEMO!" in screen codes: H ($08) is php, E L ($05 $0c) ora $0c
    await goTo(page, '$0985');
    await hover(row('0985'));
    await page.keyboard.down('Control');
    await expect(peek).toContainText('as code');
    await expect(peek.locator('.peek-row.cols')).toHaveText(/bytes\s*PETSCII\s*screen\s*code/);
    const first = peek.locator('.peek-row[data-a]').first(), second = peek.locator('.peek-row[data-a]').nth(1);
    await expect(first.locator('.p-adr')).toHaveText('0985');
    await expect(first.locator('.p-src')).toHaveText('php');
    await expect(second.locator('.p-src')).toHaveText('ora $0c');
    // the text the bytes are: as screen codes the H and the EL, as PETSCII control codes
    await expect(first.locator('.p-txt').nth(1)).toHaveText('H');
    await expect(second.locator('.p-txt').nth(1)).toHaveText('EL');
    await expect(second.locator('.p-txt').nth(0)).toHaveText('..');
    await expect(first).toHaveClass(/\bon\b/);
    await page.keyboard.up('Control');
    await expect(peek).toBeHidden();
  });

  await test.step('a key pressed with Ctrl closes it until Ctrl is let go', async () => {
    await hover(row('0985'));
    await page.keyboard.down('Control');
    await expect(peek).toBeVisible();
    await page.keyboard.press('Shift');
    await expect(peek).toBeHidden();
    await page.mouse.move(10, 10);
    await hover(row('0985'));
    await page.waitForTimeout(300);
    await expect(peek).toBeHidden();
    await page.keyboard.up('Control');
    await page.keyboard.down('Control');
    await expect(peek).toBeVisible();
    await page.keyboard.up('Control');
  });
});

test('V shows each line\'s bytes as PETSCII and as screen codes at its right; with Data as code every block is code with its text', async ({ page }) => {
  await waitForListing(page);
  const row = (adr: string) => listing(page).locator('.row', { has: page.locator('.adr', { hasText: new RegExp(`^${adr}$`) }) }).last();

  await test.step('V turns the Text columns on: a code line has a character for each of its bytes, a text line its text', async () => {
    await expect(listing(page).locator('.tcol')).toHaveCount(0);
    await page.keyboard.press('v');
    await expect(page.getByRole('button', { name: /^Text/ })).toHaveAttribute('aria-pressed', 'true');
    // fx_091e: lda SID_OSC3, three bytes
    await goTo(page, 'fx_091e');
    await expect(row('091e').locator('.tcol')).toHaveCount(2);
    await expect(row('091e').locator('.tcol-pet > span')).toHaveCount(3);
    await expect(row('091e').locator('.tcol-scr > span')).toHaveCount(3);
    // "HELLO FROM THE MIMIR STUDIO DEMO!" in screen codes: the first ten, the rest in the tooltip
    await goTo(page, '$0985');
    await expect(row('0985').locator('.tcol-scr')).toHaveText('HELLO FROM…');
    await expect(row('0985').locator('.tcol-scr')).toHaveAttribute('title', /HELLO FROM THE MIMIR STUDIO DEMO!/);
    await expect(row('0985').locator('.tcol-pet')).toHaveAttribute('title', /^As PETSCII, \$0985-/);
  });

  await test.step('with Data as code every block is code, each instruction with its text', async () => {
    await page.getByRole('button', { name: 'Data as code' }).click();
    await expect(row('0985').locator('.src')).toContainText('php');
    await expect(row('0985').locator('.tcol-scr')).toHaveText('H');
    await expect(row('0986').locator('.src')).toContainText('ora $0c');
    await expect(row('0986').locator('.tcol-scr')).toHaveText('EL');
    await page.getByRole('button', { name: 'Data as code' }).click();
    await expect(row('0985').locator('.tcol-scr')).toHaveText('HELLO FROM…');
  });

  await test.step('a selection of part of a data line marks its characters; V turns the columns off', async () => {
    await goTo(page, 'colors_0939');
    await row('0939').locator('.cell[data-a="2363"]').click(); // $093b, the third byte
    await expect(statusBar(page)).toContainText('sel $093b–$093b (1 B)');
    await expect(row('0939').locator('.tcol-scr .on')).toHaveCount(1);
    await expect(row('0939').locator('.tcol-pet .on')).toHaveCount(1);
    await listing(page).focus();
    await page.keyboard.press('v');
    await expect(listing(page).locator('.tcol')).toHaveCount(0);
  });
});

test('the Memory tab shows the program as the VICE monitor does: m, i and ii', async ({ app, page }) => {
  await waitForListing(page);
  const dump = page.getByLabel('Memory dump');
  const row = (a: string) => dump.locator('.mon-row', { has: page.locator('.mon-adr', { hasText: new RegExp(`C:${a}`) }) });
  const info = page.locator('.monv .gfxv-info');
  const bar = page.locator('.monv .gfxv-sel[role="status"]');
  const command = async (c: string) => { await page.getByLabel('Monitor command').fill(c); await page.getByLabel('Monitor command').press('Enter'); };

  await test.step('m: a row is the address, 16 bytes in groups of four and the same bytes as text', async () => {
    await page.getByRole('tab', { name: 'Memory' }).click();
    expect(await row('0801').textContent()).toBe('>C:0801  0b 08 0a 00  9e 32 30 36  34 00 00 00  00 00 00 20   .....2064...... ');
    // further down, past what the window shows
    await dump.evaluate(el => { el.scrollTop = 200; });
    await expect(row('0941')).toContainText('MIMIR ST');
    await dump.evaluate(el => { el.scrollTop = 0; });
  });

  await test.step('a click puts the cursor on a byte, the arrow keys move it, Shift selects', async () => {
    await row('0801').locator('[data-a="2064"].mon-b').click();
    await expect(info).toContainText('$0810 = $20 · 32 · %00100000');
    await expect(statusBar(page)).toContainText('$0810');
    await page.keyboard.press('ArrowRight');
    await expect(info).toContainText('$0811 = $44');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(bar).toContainText('$0811–$0821 (17 bytes)');
    await page.keyboard.press('Escape');
    await expect(bar).not.toContainText('$0811–');
  });

  await test.step('a VICE command selects a range, and Copy writes the rows as VICE does', async () => {
    await command('m 0985 09a4');
    await expect(bar).toContainText('$0985–$09a4 (32 bytes) · Text txt_0985');
    await page.getByRole('button', { name: 'Copy selection' }).click();
    await expect(toast(page, 'Copied to clipboard')).toBeVisible();
    // (the Windows clipboard has \r\n line ends)
    const copied = (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n');
    expect(copied.split('\n')).toEqual([
      '>C:0985  08 05 0c 0c  0f 20 06 12  0f 0d 20 14  08 05 20 0d   ..... .... ... .',
      expect.stringMatching(/^>C:0995 {2}([0-9a-f]{2} ){3}[0-9a-f]{2} {2}/),
    ]);
  });

  await test.step('ii shows screen codes, in the lower case set too; i shows PETSCII 40 to a row', async () => {
    await command('ii 0985');
    await expect(page.getByRole('button', { name: 'Screen codes (ii)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(row('0985')).toHaveText(/^\*C:0985 {2}HELLO FROM THE MIMIR STUDIO DEMO/);
    await page.getByText('Lower case', { exact: true }).click();
    await expect(row('0985')).toHaveText(/^\*C:0985 {2}hello from the mimir studio demo/);
    await page.getByText('Lower case', { exact: true }).click();
    await command('i 0801');
    await expect(row('0801')).toHaveText(/^>C:0801 {2}\.{5}2064/);
    await expect(row('0829')).toBeVisible();
    await command('m nowhere');
    await expect(page.locator('.monv [role="alert"]')).toContainText('neither a hex address nor a label');
  });

  await test.step('Enter marks a selection as the text the dump shows, named by its first word', async () => {
    await command('ii 0985 0995');
    await expect(page.getByRole('button', { name: /Mark as Text \(screen codes\)/ })).toHaveClass(/primary/);
    await dump.focus();
    await page.keyboard.press('Enter');
    await expect(toast(page, '$0985–$0995 marked as Text (screen codes), named hello')).toBeVisible();
    await expect(bar).toContainText('Text hello ($0985–$0995)');
    await page.keyboard.press('Control+z');
    await expect(bar).toContainText('Text txt_0985');
  });

  await test.step('a selection is marked from here, and a double-click shows the byte in the listing', async () => {
    await command('m 3000 3007');
    await page.getByRole('button', { name: 'Mark as Bytes' }).click();
    await expect(toast(page, '$3000–$3007 marked as Bytes')).toBeVisible();
    await page.keyboard.press('Control+z');
    // m 0810 starts the rows at $0810, as in VICE
    await command('m 0810');
    await expect(row('0810')).toHaveText(/^>C:0810 {2}20 44 e5 20/);
    await row('0810').locator('[data-a="2064"].mon-b').dblclick();
    await expect(page.getByRole('tab', { name: 'Listing' })).toHaveAttribute('aria-selected', 'true');
    await expect(statusBar(page)).toContainText('$0810');
  });
});

test('the Demo button opens the showcase: every block type and a guided tour in the Bookmarks view', async ({ page }) => {
  await waitForListing(page);
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await expect(toast(page, 'Showcase loaded: the Bookmarks view is a tour of it, F2 goes to the next stop')).toBeVisible();
  await waitForListing(page);

  await test.step('the tour is in the Bookmarks view, and F2 goes from stop to stop', async () => {
    const list = page.getByRole('list', { name: 'Bookmarks' });
    await expect(list.getByRole('listitem')).toHaveCount(15);
    await expect(list.getByRole('listitem').first()).toContainText('Welcome to the showcase');
    await listing(page).click();
    await page.keyboard.press('F2');
    await expect(toast(page, /^Bookmark \$[0-9a-f]{4}: /)).toBeVisible();
  });

  await test.step('the Blocks view has a folder for every type, with how many blocks of it there are', async () => {
    await page.locator('nav.activity').getByRole('button', { name: 'Blocks' }).click();
    const folders = page.getByRole('list', { name: 'Block types' }).locator('.blk-folder-head');
    const types = (await folders.locator('.blk-folder-name').allTextContents()).map(x => x.trim());
    for (const t of ['BASIC', 'Code', 'Text', 'Data', 'Word table', 'Table', 'Lo/Hi table', 'Sprites', 'Charset', 'Bitmap', 'Screen matrix', 'Music (SID)', 'Fill'])
      expect(types, t).toContain(t);
    // the counts add up to every block, the folders are closed until one is clicked
    const counts = (await folders.locator('.blk-folder-n').allTextContents()).map(Number);
    expect(counts.every(n => n > 0)).toBe(true);
    await expect(page.locator('.side-title')).toContainText(`Blocks ${counts.reduce((a, b) => a + b, 0)}`);
    await expect(page.locator('.blk-folder-body')).toHaveCount(0);
    const music = folders.filter({ hasText: 'Music (SID)' });
    await music.click();
    await expect(music).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('group', { name: 'Music (SID) blocks' }).locator('.blk-row')).toHaveCount(Number(await music.locator('.blk-folder-n').textContent()));
  });

  await test.step('it verifies byte for byte', async () => {
    await listing(page).click();
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
    await page.locator('nav.activity').getByRole('button', { name: 'Explorer' }).click();
    await openSection(page, 'Files');
    await expectFiles(page, ['mimir-showcase.prg']);
  });
});

test('Shift+click on a block in the Blocks view shows it, selected, in its type\'s own view', async ({ page }) => {
  await waitForListing(page);
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await expect(toast(page, 'Showcase loaded: the Bookmarks view is a tour of it, F2 goes to the next stop')).toBeVisible();
  await waitForListing(page);
  await page.locator('nav.activity').getByRole('button', { name: 'Blocks' }).click();
  const types = page.getByRole('list', { name: 'Block types' });
  /** the row of block `name` in the folder of `type` (the folder opened) */
  const block = async (type: string, name: string) => {
    const head = types.locator('.blk-folder-head').filter({ has: page.locator('.blk-folder-name', { hasText: new RegExp(`^${type.replace(/[()]/g, '\\$&')}$`) }) });
    if (await head.getAttribute('aria-expanded') !== 'true') await head.click();
    return page.getByRole('group', { name: `${type} blocks` }).locator('.blk-row', { hasText: name });
  };
  const shiftClick = async (type: string, name: string) => (await block(type, name)).click({ modifiers: ['Shift'] });
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  const gfx = page.getByLabel('Memory as graphics'), gfxScroll = gfx.locator('.gfxv-scroll');
  // the address of the gutter row at the top of the picture, and of the dump's row at the top
  const gfxTop = () => gfxScroll.evaluate(el => [...el.querySelectorAll<HTMLElement>('.gfxv-row')].find(r => r.offsetTop <= el.scrollTop + 1 && r.offsetTop + r.offsetHeight > el.scrollTop + 1)?.dataset.addr ?? null);
  const dump = page.getByLabel('Memory dump');
  const dumpTop = () => dump.evaluate(el => {
    const row = [...el.querySelectorAll<HTMLElement>('.mon-row')].find(r => parseFloat(r.style.top) <= el.scrollTop + 1 && parseFloat(r.style.top) + 20 > el.scrollTop + 1);
    return row?.textContent?.slice(0, 7) ?? null;
  });
  const mem = page.getByLabel('Memory as the VICE monitor shows it');

  await test.step('a row\'s tip says where Shift+click shows it', async () => {
    await expect(await block('Bitmap', 'bitmap_4000')).toHaveAttribute('title', 'Go to it in the listing.\nShift+click: show it in Graphics, drawn as a bitmap');
    await expect(await block('Text', 'txt_0f95')).toHaveAttribute('title', 'Go to it in the listing.\nShift+click: show it in Memory as screen codes (ii)');
    await expect(await block('Code', 'setup_screen')).toHaveAttribute('title', 'Go to it in the listing.\nShift+click: select it in the listing');
  });

  await test.step('a bitmap opens Graphics as a multicolour bitmap, selected, at the top', async () => {
    await shiftClick('Bitmap', 'bitmap_4000');
    await expect(tab('Graphics')).toHaveAttribute('aria-selected', 'true');
    await expect(gfx.getByRole('button', { name: 'Bitmaps', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(gfx.getByRole('checkbox', { name: 'Multicolor' })).toBeChecked();
    await expect(gfx.getByRole('status')).toContainText('$4000–$5f3f (8000 bytes) · Bitmap bitmap_4000');
    await expect.poll(gfxTop).toBe('4000');
    await expect(statusBar(page)).toContainText('sel $4000–$5f3f');
  });

  await test.step('with Graphics open, the sprites are drawn as sprites there', async () => {
    await shiftClick('Sprites', 'spr_2000');
    await expect(gfx.getByRole('button', { name: 'Sprites', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(gfx.getByRole('status')).toContainText('$2000–$20ff (256 bytes) · Sprites spr_2000');
    await expect.poll(gfxTop).toBe('2000');
    await shiftClick('Charset', 'charset_2800');
    await expect(gfx.getByRole('button', { name: 'Characters', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(gfx.getByRole('status')).toContainText('$2800–$2fff (2048 bytes) · Charset charset_2800');
  });

  await test.step('a text opens Memory as screen codes or PETSCII, its rows starting at it', async () => {
    await shiftClick('Text', 'txt_0f95');
    await expect(tab('Memory')).toHaveAttribute('aria-selected', 'true');
    await expect(mem.getByRole('button', { name: 'Screen codes (ii)' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(dumpTop).toBe('*C:0f95');
    await expect(mem.locator('.gfxv-sel')).toContainText('$0f95–$0fbc (40 bytes) · Text txt_0f95');
    await shiftClick('Text', 'txt_0f51');
    await expect(mem.getByRole('button', { name: 'PETSCII (i)' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(dumpTop).toBe('>C:0f51');
    // other data as hex and text
    await shiftClick('Word table', 'fx_table');
    await expect(mem.getByRole('button', { name: 'Hex and text (m)' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(dumpTop).toBe('>C:0b5a');
  });

  await test.step('code is selected in the listing; a plain click still only goes to a block', async () => {
    await shiftClick('Code', 'setup_screen');
    await expect(tab('Listing')).toHaveAttribute('aria-selected', 'true');
    await expect(statusBar(page)).toContainText('sel $087d–$0902');
    await (await block('Bitmap', 'bitmap_4000')).click();
    await expect(tab('Listing')).toHaveAttribute('aria-selected', 'true');
    await expect(statusBar(page)).toContainText('$4000');
    await expect(statusBar(page)).not.toContainText('sel $');
  });
});

test('a music block plays in VICE: from its right-click menu, the inspector, the command palette and the Blocks view', async ({ page }) => {
  // VICE itself is not started: a Windows program that ends at once stands in for it (the player's PRG playing in the
  // real VICE is tested in packages/core/test/sidplayer.test.ts)
  const standIn = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe');
  test.skip(!existsSync(standIn), 'needs where.exe');
  await waitForListing(page);
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await expect(toast(page, 'Showcase loaded: the Bookmarks view is a tour of it, F2 goes to the next stop')).toBeVisible();
  await waitForListing(page);
  await page.evaluate(v => (window as unknown as { kr: { setSettings(p: object): Promise<unknown> } }).kr.setSettings({ vicePath: v }), standIn);
  await listing(page).click();
  // (no label at $1800: the source calls it as music.init, through LoadSid; the export's file is music_1800.sid)
  const played = /^VICE plays music_1800 \(\$1800-\$19cc\): init \$1800 with song \$00, then play \$1803 each frame\. Keys 1-9 and 0 start songs \$00-\$09/;
  const newest = () => {
    const dirs = readdirSync(tmpdir()).filter(d => d.startsWith('mimir-play-')).map(d => join(tmpdir(), d)).filter(d => existsSync(join(d, 'music_1800.prg')));
    return dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  };
  const seen: string[] = [];

  await test.step('the music block\'s right-click menu plays it', async () => {
    await goTo(page, '1800');
    await expect(statusBar(page)).toContainText('$1800 · Music (SID)');
    await expect(headerRow(page, '1800')).toBeVisible();
    await headerRow(page, '1800').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Play music in VICE ($1800)' }).click();
    await expect(toast(page, played)).toBeVisible();
    // the PRG VICE was given: RUN starts it at $0801, and the block's bytes (JMP init) are in it from $0c00
    const dir = newest();
    seen.push(dir);
    const prg = readFileSync(join(dir, 'music_1800.prg'));
    expect(prg[0] | (prg[1] << 8)).toBe(0x0801);
    const at = 2 + 0x0c00 - 0x0801, table = prg.subarray(at, at + 6);
    expect([table[0], table[2], table[3], table[5]]).toEqual([0x4c, 0x18, 0x4c, 0x18]);
    expect(prg.length).toBe(at + 0x19cd - 0x1800);
  });

  await test.step('so does the inspector\'s Play in VICE, and the command palette', async () => {
    // the cursor is still on the block
    await expect(statusBar(page)).toContainText('$1800 · Music (SID)');
    await page.locator('aside.insp-col').getByRole('button', { name: 'Play in VICE' }).click();
    await expect(toast(page, played)).toHaveCount(2);
    seen.push(newest());
    await page.keyboard.press('Control+Shift+P');
    const q = page.getByRole('textbox', { name: 'Command' });
    await q.fill('Play music ($1800-$19cc) in VICE');
    await q.press('Enter');
    await expect(toast(page, played)).toHaveCount(3);
    seen.push(newest());
  });

  await test.step('and the play button beside the block in the Blocks view, wherever the cursor is', async () => {
    await listing(page).click();
    await goTo(page, '0801');
    await expect(statusBar(page)).not.toContainText('Music (SID)');
    await page.locator('nav.activity').getByRole('button', { name: 'Blocks' }).click();
    const folder = page.getByRole('list', { name: 'Block types' }).locator('.blk-folder-head').filter({ hasText: 'Music (SID)' });
    if (await folder.getAttribute('aria-expanded') !== 'true') await folder.click();
    const play = page.getByRole('group', { name: 'Music (SID) blocks' }).getByRole('button', { name: 'Play music_1800 in VICE' });
    await expect(play).toHaveAttribute('title', /^Play music_1800 in VICE: init with song \$00, then play each frame\. Settings → Toolchain picks VICE or DeepSID$/);
    // the toasts before it go first, so the one it brings is its own
    await expect(toast(page, played)).toHaveCount(0, { timeout: 15_000 });
    const before = newest();
    await play.click();
    await expect(toast(page, played)).toBeVisible();
    await expect.poll(newest).not.toBe(before);
    seen.push(newest());
    // the cursor stays where it was
    await expect(statusBar(page)).not.toContainText('Music (SID)');
  });
  for (const d of new Set(seen)) rmSync(d, { recursive: true, force: true });
});

test('with DeepSID chosen in Settings, a music block plays there: its .sid goes to DeepSID\'s Load SID, in a window of its own', async ({ app, page }) => {
  // a stand-in for DeepSID's page (fixtures/deepsid/index.html): its Load SID input and its list of songs, without the
  // internet (the real page's input, handler and list are checked by hand; nothing is sent to DeepSID in the tests)
  const standIn = pathToFileURL(join(repoDir, 'fixtures/deepsid/index.html')).href;
  await app.evaluate((_e, url) => { process.env.MIMIR_DEEPSID_URL = url; }, standIn);
  await waitForListing(page);
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await expect(toast(page, 'Showcase loaded: the Bookmarks view is a tour of it, F2 goes to the next stop')).toBeVisible();
  await waitForListing(page);

  await test.step('Settings → Toolchain picks DeepSID for music blocks (VICE until then)', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Toolchain' }).click();
    const player = page.locator('#set-musicPlayer');
    await expect(player).toHaveValue('vice');
    await player.selectOption('deepsid');
    await page.getByRole('button', { name: 'Save settings' }).click();
  });

  /** what DeepSID's window got: the file Load SID was given, and the row clicked */
  const deepSid = () => app.evaluate(async ({ BrowserWindow }, url) => {
    const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL() === url);
    return w ? await w.webContents.executeJavaScript('({ received: window.received, played: window.played })') as { received: { name: string; magic: string; load: number; init: number; play: number; songs: number; title: string } | null; played: string | null } : null;
  }, standIn);

  await test.step('the right-click menu plays the block in DeepSID: the .sid the export writes, under a name of its own', async () => {
    await listing(page).click();
    await goTo(page, '1800');
    await expect(statusBar(page)).toContainText('$1800 · Music (SID)');
    await expect(headerRow(page, '1800')).toBeVisible();
    await headerRow(page, '1800').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Play music in DeepSID ($1800)' }).click();
    await expect(toast(page, /^DeepSID plays music_1800 \(\$1800-\$19cc\): the \.sid with init \$1800 and play \$1803, as music_1800-[0-9a-f]{6}\.sid$/)).toBeVisible({ timeout: 30_000 });
    const got = await deepSid();
    expect(got?.received).toMatchObject({ magic: 'PSID', load: 0x1800, init: 0x1800, play: 0x1803, songs: 1, title: 'mimir-showcase 1800' });
    expect(got?.received?.name).toMatch(/^music_1800-[0-9a-f]{6}\.sid$/);
    expect(got?.played).toBe(got?.received?.name);
  });

  await test.step('the inspector\'s button says DeepSID and plays it in the same window', async () => {
    await page.locator('aside.insp-col').getByRole('button', { name: 'Play in DeepSID' }).click();
    await expect(toast(page, /^DeepSID plays music_1800/)).toHaveCount(2, { timeout: 30_000 });
    expect(await app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL() === url).length, standIn)).toBe(1);
  });

  await test.step('the Blocks view\'s play button beside the block says DeepSID too, and plays it there', async () => {
    await page.locator('nav.activity').getByRole('button', { name: 'Blocks' }).click();
    const folder = page.getByRole('list', { name: 'Block types' }).locator('.blk-folder-head').filter({ hasText: 'Music (SID)' });
    if (await folder.getAttribute('aria-expanded') !== 'true') await folder.click();
    const play = page.getByRole('group', { name: 'Music (SID) blocks' }).getByRole('button', { name: 'Play music_1800 in DeepSID' });
    await expect(play).toHaveAttribute('title', /^Play music_1800 in DeepSID: the \.sid the export writes, in DeepSID's window\. Settings → Toolchain picks VICE or DeepSID$/);
    // the toasts before it go first, so the one it brings is its own
    await expect(toast(page, /^DeepSID plays music_1800/)).toHaveCount(0, { timeout: 15_000 });
    await play.click();
    await expect(toast(page, /^DeepSID plays music_1800/)).toBeVisible({ timeout: 30_000 });
    expect(await app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL() === url).length, standIn)).toBe(1);
  });

  // the .sid files given to DeepSID, kept in build folders of their own
  for (const d of readdirSync(tmpdir()).filter(x => x.startsWith('mimir-deepsid-'))) rmSync(join(tmpdir(), d), { recursive: true, force: true });
});

test('a VICE quicksave (Alt+F11 in VICE) opens by itself, F9 opens it again, Ctrl+Z goes back; the newest are kept, named, saved and made favourites', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  // a file of its own instead of VICE's settings folder: the user's quicksaves are never touched
  const qs = join(work, 'C64SC.vsf'), snapshot = join(repoDir, 'fixtures/vsf/raster-demo.vsf');
  await openSection(page, 'Files');
  const section = await openSection(page, 'VICE quicksave');
  const status = section.getByRole('status', { name: 'Latest VICE quicksave' });
  const open = section.getByRole('button', { name: /Open the latest quicksave/ });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#set-viceQuicksave').fill(qs);
  await page.getByRole('button', { name: 'Save settings' }).click();

  await test.step('the Explorer says how to make one in VICE, and that there is none yet', async () => {
    await expect(section).toContainText('In VICE press Alt+F11 (Snapshot → Quicksave snapshot): the snapshot opens here by itself');
    await expect(status).toContainText('None yet. VICE writes it as C64SC.vsf in its settings folder.');
    await expect(open).toBeDisabled();
  });

  await test.step('F9 before VICE has saved one says where it will be', async () => {
    await listing(page).click();
    await page.keyboard.press('F9');
    await expect(toast(page, `No VICE quicksave yet: in VICE, Snapshot → Quicksave snapshot (Alt+F11) writes ${qs}`)).toBeVisible();
  });

  await test.step('VICE writing a quicksave opens it', async () => {
    // as VICE does: a new file, saved now
    writeFileSync(qs, readFileSync(snapshot));
    await expect(toast(page, /^Opened the VICE quicksave from .+: VICE 3\.10 snapshot of a C64SC.*, traced from \$08c7, \$08b7\. Ctrl\+Z goes back to the project before$/)).toBeVisible({ timeout: 15_000 });
    await expectFiles(page, ['quicksave.prg']);
    await expect(status).toContainText(/^Latest: today \d{1,2}[:.]\d{2}[:.]\d{2}.* C64SC\.vsf$/);
    await expect(open).toBeEnabled();
  });

  await test.step('Ctrl+Z brings the project before back, Ctrl+Y the quicksave', async () => {
    await listing(page).click();
    await page.keyboard.press('Control+z');
    await expectFiles(page, ['raster-demo.prg']);
    await page.keyboard.press('Control+y');
    await expectFiles(page, ['quicksave.prg']);
  });

  await test.step('with following off a new quicksave is only announced, and F9 opens it', async () => {
    await page.getByLabel('Open each new VICE quicksave').uncheck();
    await expect(section).toContainText('the snapshot opens here with F9');
    writeFileSync(qs, readFileSync(snapshot));
    utimesSync(qs, new Date(), new Date(Date.now() + 5000));
    await expect(toast(page, 'VICE saved a new quicksave: F9 opens it')).toBeVisible({ timeout: 15_000 });
    await open.click();
    // (the toast of the first one may still be there)
    await expect(toast(page, /^Opened the VICE quicksave from /).last()).toBeVisible();
    await page.getByLabel('Open each new VICE quicksave').check();
  });

  await test.step('both quicksaves are kept, the newest first; one is named, saved in a folder, and the other opened', async () => {
    const kept = section.getByRole('list', { name: 'Kept VICE quicksaves' }).getByRole('listitem');
    const stamp = /^quicksave \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;
    await expect(kept).toHaveCount(2);
    await expect(kept.locator('.qs-name-text')).toHaveText([stamp, stamp]);
    const [newest, older] = await kept.locator('.qs-name-text').allTextContents();
    await section.getByRole('button', { name: `Rename the quicksave ${newest}` }).click();
    const input = section.getByLabel(`Name of the quicksave ${newest}`);
    await expect(input).toBeFocused();
    await input.fill('intro');
    await input.press('Enter');
    await expect(kept.locator('.qs-name-text')).toHaveText(['intro', older]);
    const file = join(work, 'saved', 'intro.vsf');
    mkdirSync(join(work, 'saved'), { recursive: true });
    await stubDialogs(app, { save: file });
    await section.getByRole('button', { name: 'Save the quicksave intro' }).click();
    await expect(toast(page, `The quicksave "intro" saved to ${file}`)).toBeVisible();
    expect(readFileSync(file)).toEqual(readFileSync(snapshot));
    expect((await dialogOptions(app)).pop()).toMatchObject({ title: 'Save the quicksave "intro"', defaultPath: expect.stringMatching(/intro\.vsf$/) });
    await kept.nth(1).getByRole('button', { name: new RegExp(`^${older.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click();
    await expect(toast(page, `Opened the quicksave "${older}": VICE 3.10 snapshot of a C64SC`)).toBeVisible();
    await expectFiles(page, [`${older.replace(/:/g, '-')}.prg`]);
  });

  await test.step('the star makes one a favourite, in a list of its own above the newest, and takes it back', async () => {
    const lists = section.getByRole('list');
    const favourites = section.getByRole('list', { name: 'Favourite VICE quicksaves' }).getByRole('listitem');
    const kept = section.getByRole('list', { name: 'Kept VICE quicksaves' }).getByRole('listitem');
    const older = await kept.nth(1).locator('.qs-name-text').textContent() ?? '';
    await expect(favourites).toHaveCount(0);
    const star = section.getByRole('button', { name: 'Add the quicksave intro to the favourites' });
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
    await expect(toast(page, '"intro" is a favourite: it stays when VICE saves new quicksaves')).toBeVisible();
    await expect(favourites.locator('.qs-name-text')).toHaveText(['intro']);
    await expect(kept.locator('.qs-name-text')).toHaveText([older]);
    expect(await lists.evaluateAll(l => l.map(e => e.getAttribute('aria-label')))).toEqual(['Favourite VICE quicksaves', 'Kept VICE quicksaves']);
    await expect(section).toContainText('Favourites, always kept');
    // it opens, is named and saved there as well
    await favourites.getByRole('button', { name: /^intro/ }).click();
    await expect(toast(page, 'Opened the quicksave "intro": VICE 3.10 snapshot of a C64SC')).toBeVisible();
    await expectFiles(page, ['intro.prg']);
    const off = section.getByRole('button', { name: 'Remove the quicksave intro from the favourites' });
    await expect(off).toHaveAttribute('aria-pressed', 'true');
    await off.click();
    await expect(toast(page, '"intro" is no favourite now: it goes when VICE saves a new quicksave, unless it is among the newest 5')).toBeVisible();
    await expect(favourites).toHaveCount(0);
    await expect(kept.locator('.qs-name-text')).toHaveText(['intro', older]);
  });
});

test('the Graphics tab saves its selection: bytes, with a load address, a Koala picture, a PNG image and .byte source', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  await page.getByRole('tab', { name: 'Graphics' }).click();
  const view = page.getByLabel('Memory as graphics');
  const go = async (to: string) => { await view.getByLabel('Go to address, label or range').fill(to); await view.getByLabel('Go to address, label or range').press('Enter'); };
  const demo = readFileSync(join(repoDir, 'fixtures/prg/raster-demo.prg'));
  const at = (a: number, n: number) => demo.subarray(2 + a - 0x0801, 2 + a - 0x0801 + n);
  /** Save… → `item`, the save dialog answering `file`; returns what was written */
  const saveAs = async (item: string | RegExp, file: string) => {
    await stubDialogs(app, { save: join(work, file) });
    await view.getByRole('button', { name: 'Save…' }).click();
    await view.getByRole('menu', { name: 'Save the selection as' }).getByRole('menuitem', { name: item }).click();
    await expect(toast(page, `Saved ${join(work, file)}`)).toBeVisible();
    return readFileSync(join(work, file));
  };

  await test.step('the whole charset: the menu, raw bytes, .64c and .byte source', async () => {
    await go('$3000');
    await view.getByRole('button', { name: 'Whole charset (2 KB)' }).click();
    await view.getByRole('button', { name: 'Save…' }).click();
    await expect(view.getByRole('menu', { name: 'Save the selection as' }).getByRole('menuitem')).toHaveText([
      'Raw bytes (.bin)', 'Charset with its load address (.64c)', 'Image as shown here (.png)', 'Kick Assembler source, .byte rows (.asm)',
    ]);
    await page.keyboard.press('Escape');
    expect((await dialogOptions(app)).length).toBe(0);
    expect(await saveAs('Raw bytes (.bin)', 'font.bin')).toEqual(at(0x3000, 2048));
    expect((await dialogOptions(app)).pop()).toMatchObject({ title: 'Save graphics', defaultPath: expect.stringMatching(/charset_3000\.bin$/) });
    const c64 = await saveAs(/\.64c/, 'font.64c');
    expect([c64[0], c64[1]]).toEqual([0x00, 0x30]);
    expect(c64.subarray(2)).toEqual(at(0x3000, 2048));
    const asm = (await saveAs(/\.asm/, 'font.asm')).toString('utf8');
    expect(asm).toMatch(/^\/\/ charset_3000: \$3000-\$37ff, 2048 bytes \(256 characters\), saved by Mimir Studio/);
    expect(asm).toMatch(/charset_3000:\n {8}\/\/ char 0 at \$3000\n {8}\.byte %[01]{8}\n/);
  });

  await test.step('a sprite as an image', async () => {
    await view.getByRole('button', { name: 'Sprites', exact: true }).click();
    await go('$2000');
    const png = await saveAs(/\.png/, 'ball.png');
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR: 24 x 21
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([24, 21]);
  });

  await test.step('a bitmap as a Koala Painter picture with the colours shown', async () => {
    await view.getByRole('button', { name: 'Bitmaps' }).click();
    await view.getByLabel('Multicolor').check();
    await go('$2000');
    const kla = await saveAs(/Koala Painter/, 'pic.kla');
    expect(kla.length).toBe(10003);
    expect([kla[0], kla[1]]).toEqual([0x00, 0x60]);
    // the demo ends at $37ff: the rest of the 8000 bytes is memory that is not loaded (zeros)
    expect(kla.subarray(2, 2 + 0x1800)).toEqual(at(0x2000, 0x1800));
    expect(kla.subarray(2 + 0x1800, 2 + 8000).every(b => b === 0)).toBe(true);
    // the tab's colours: MC1 light grey (15) and MC2 grey (12) in the screen matrix, white (1) in colour RAM, black
    expect([kla[8002], kla[9002], kla[10002]]).toEqual([0xfc, 0x01, 0x00]);
  });
});

test('a byte in the wrong block is dragged by its address into the block next to it', async ({ page }) => {
  await waitForListing(page);
  await page.keyboard.press('Control+j');
  await expect(page.locator('section.bottom')).toHaveClass(/collapsed/);
  await goTo(page, '$0951');
  /** the data line at `adr` (not its label line) */
  const line = (adr: string) => listing(page).locator('.row.k-dat', { has: page.locator('.adr', { hasText: new RegExp(`^${adr}$`) }) });
  const chip = listing(page).locator('.move-chip');
  /** press on `part` of line `from`, move onto row `to`, then (after `hold`) let go */
  const drag = async (from: Locator, to: Locator, part = '.adr', hold?: () => Promise<void>) => {
    const a = (await from.locator(part).boundingBox())!, b = (await to.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 300, b.y + b.height / 2, { steps: 8 });
    if (hold) await hold();
    await page.mouse.up();
  };

  await test.step('lines at a block edge can be dragged, the others not', async () => {
    await expect(line('0960')).toHaveClass(/\bmovable\b/);
    await expect(line('0960').locator('.adr')).toHaveAttribute('title', 'Drag the address or the bytes into the block next to it:\n↑ $0960 into the Text block above');
    await expect(line('09bd')).toHaveCount(1);
    await expect(line('09bd')).not.toHaveClass(/\bmovable\b/);
  });

  await test.step('while dragging, the block it goes into is marked; Esc cancels', async () => {
    await drag(line('0960'), headerRow(page, '0949'), '.adr', async () => {
      await expect(chip).toHaveText('↑ Move $0960 into the Text block above');
      await expect(headerRow(page, '0949')).toHaveClass(/\bdrop-into\b/);
      await expect(line('0960')).toHaveClass(/\bmoving-src\b/);
      await page.keyboard.press('Escape');
      await expect(chip).toHaveCount(0);
    });
    await expect(headerRow(page, '0949')).toContainText('$0949-$095f (23 bytes)');
  });

  await test.step('dropped in the block above, the first byte joins it', async () => {
    await drag(line('0960'), headerRow(page, '0949'));
    await expect(toast(page, '$0960 moved into the Text block, now $0949–$0960')).toBeVisible();
    await expect(headerRow(page, '0949')).toContainText('$0949-$0960 (24 bytes)');
    await expect(headerRow(page, '0961')).toContainText('$0961-$0984 (36 bytes)');
  });

  await test.step('dragged by its bytes into the block below, the last byte of the table joins the text', async () => {
    await drag(line('0941'), headerRow(page, '0949'), '.hex');
    await expect(toast(page, '$0948 moved into the Text block, now $0948–$0960')).toBeVisible();
    await expect(headerRow(page, '0939')).toContainText('Color table');
    await expect(headerRow(page, '0939')).toContainText('$0939-$0947 (15 bytes)');
    await expect(headerRow(page, '0948')).toContainText('$0948-$0960 (25 bytes)');
  });

  await test.step('dropped anywhere else nothing moves; dragging the source text still selects', async () => {
    await drag(line('0939'), headerRow(page, '0985'));
    await expect(headerRow(page, '0939')).toContainText('$0939-$0947 (15 bytes)');
    await drag(line('0939'), headerRow(page, '0948'), '.src');
    await expect(statusBar(page)).toContainText('sel $0939–$0960 (40 B)');
    await expect(headerRow(page, '0939')).toContainText('$0939-$0947 (15 bytes)');
  });

  await test.step('the context menu does the same, and Ctrl+Z undoes it', async () => {
    await line('0961').click({ button: 'right' });
    await fromSubmenu(page, 'Block', 'Move $0961 into the previous block (Text)');
    await expect(toast(page, '$0961 moved into the Text block, now $0948–$0961')).toBeVisible();
    await expect(headerRow(page, '0962')).toContainText('$0962-$0984 (35 bytes)');
    for (const head of ['$0948-$0960 (25 bytes)', '$0949-$0960 (24 bytes)', '$0949-$095f (23 bytes)']) {
      await page.keyboard.press('Control+z');
      await expect(listing(page).locator('.row.hdr', { hasText: head })).toHaveCount(1);
    }
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });
});

test('a block is split, re-typed and joined from any byte of a line, and given a size of its own', async ({ app, page }) => {
  await waitForListing(page);
  await page.keyboard.press('Control+j');
  await expect(page.locator('section.bottom')).toHaveClass(/collapsed/);
  await goTo(page, '$0939');
  /** the byte (cell) at `adr` in a data line */
  const cell = (adr: string) => listing(page).locator(`.cell[data-a="${parseInt(adr, 16)}"]`);
  const hdr = (text: string) => listing(page).locator('.row.hdr', { hasText: text });
  const undo = async (back: string) => { await page.keyboard.press('Control+z'); await expect(hdr(back)).toHaveCount(1); };

  await test.step('a click picks one byte of a line; Shift, the arrows and a drag over the line pick more', async () => {
    await cell('093c').click();
    await expect(statusBar(page)).toContainText('sel $093c–$093c (1 B)');
    await expect(cell('093c')).toHaveClass(/\bcur\b/);
    await page.keyboard.press('Shift+ArrowRight');
    await expect(statusBar(page)).toContainText('sel $093c–$093d (2 B)');
    await expect(cell('093d')).toHaveClass(/\bon\b/);
    await cell('093a').click({ modifiers: ['Shift'] });
    await expect(statusBar(page)).toContainText('sel $093a–$093c (3 B)');
    // on from the last byte of a line to the first of the next
    await cell('0940').click();
    await page.keyboard.press('ArrowRight');
    await expect(statusBar(page)).toContainText('sel $0941–$0941 (1 B)');
    await expect(cell('0941')).toHaveClass(/\bcur\b/);
    const a = (await cell('0939').boundingBox())!, b = (await cell('093d').boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(statusBar(page)).toContainText('sel $0939–$093d (5 B)');
  });

  await test.step('W on one byte makes it a word with the byte after it; the bytes around it stay a color table', async () => {
    await cell('093c').click();
    await page.keyboard.press('w');
    await expect(toast(page, '$093c–$093d marked as Words (.word)')).toBeVisible();
    await expect(hdr('$0939-$093b (3 bytes)')).toContainText('Color table');
    await expect(hdr('$093c-$093d (2 bytes)')).toContainText('Word table');
    await expect(hdr('$093e-$0948 (11 bytes)')).toContainText('Color table');
    await undo('$0939-$0948 (16 bytes)');
  });

  await test.step('J joins the bytes from the one clicked to the end of the block with the next block, Shift+J its start with the one before', async () => {
    await cell('093c').click();
    await page.keyboard.press('j');
    await expect(toast(page, '$093c–$0948 moved into the Text block, now $093c–$095f')).toBeVisible();
    await expect(hdr('$0939-$093b (3 bytes)')).toContainText('Color table');
    await undo('$0939-$0948 (16 bytes)');
    await cell('094c').click();
    await page.keyboard.press('Shift+J');
    await expect(toast(page, '$0949–$094c moved into the Table block, now $0939–$094c')).toBeVisible();
    await expect(hdr('$094d-$095f (19 bytes)')).toContainText('Text');
    await undo('$0949-$095f (23 bytes)');
  });

  await test.step('the context menu on a byte splits the block there, and S splits it at the cursor line', async () => {
    await cell('0950').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Block', exact: true }).hover();
    await expect(page.getByRole('menuitem', { name: 'Join $0950-$095f with the next block (Text)' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Split block at $0950' }).click();
    await expect(toast(page, 'Split the Text block in two: $0949–$094f and $0950–$095f')).toBeVisible();
    await expect(hdr('$0949-$094f (7 bytes)')).toHaveCount(1);
    await expect(hdr('$0950-$095f (16 bytes)')).toHaveCount(1);
    await undo('$0949-$095f (23 bytes)');
    await listing(page).locator('.row.k-dat', { has: page.locator('.adr', { hasText: /^0941$/ }) }).locator('.src').click({ position: { x: 4, y: 8 } });
    await page.keyboard.press('s');
    await expect(toast(page, 'Split the Table block in two: $0939–$0940 and $0941–$0948')).toBeVisible();
    await undo('$0939-$0948 (16 bytes)');
  });

  await test.step('in a low window Mark … as opens its submenu beside it, inside the window, and the mouse gets there across the menu', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1366, 600));
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThan(600);
    await cell('093c').click({ button: 'right' });
    const menu = page.locator('.ctx:not(.sub)');
    await menu.getByText('Mark $093c as').hover();
    const sub = page.getByRole('menu', { name: 'Mark $093c as' });
    const box = (await sub.boundingBox())!, inner = await page.evaluate(() => window.innerHeight);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(inner);
    // the mouse where the submenu is drawn, as a hand would, crossing the menu's other items on its way: the open
    // submenu waits for it (a click on the locator would go straight there)
    const words = (await page.getByRole('menuitem', { name: 'Words (.word)' }).boundingBox())!;
    await page.mouse.move(words.x + words.width / 2, words.y + words.height / 2, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();
    await expect(toast(page, '$093c–$093d marked as Words (.word)')).toBeVisible();
    await undo('$0939-$0948 (16 bytes)');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 920));
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeGreaterThan(800);
  });

  await test.step('L sets where the block ends: the bytes it gives up join the next block, or stay a block of their own', async () => {
    await cell('0939').click();
    await page.keyboard.press('l');
    const dialog = page.getByRole('dialog', { name: 'Block size' });
    await expect(dialog).toContainText('The Table block colors_0939 is $0939–$0948 (16 bytes).');
    await dialog.getByLabel('Size (bytes)').fill('12');
    await expect(dialog.getByLabel('End (included)')).toHaveValue('$0944');
    await expect(dialog).toContainText('$0945–$0948 join the Text block after it.');
    await dialog.getByLabel('stay a Table block of their own').check();
    await expect(dialog).toContainText('$0945–$0948 stay a Table block of their own.');
    await dialog.getByLabel('End (included)').fill('$4000');
    await expect(dialog).toContainText('$0939-$4000 runs past the end of the file at $3800.');
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await dialog.getByLabel('End (included)').fill('$0944');
    await dialog.getByLabel('join the block next to them').check();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page, 'The Table block is $0939–$0944 (12 bytes)')).toBeVisible();
    await expect(hdr('$0945-$095f (27 bytes)')).toContainText('Text');
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });
});

test('the Graphics tab finds screens: drawn with a charset, the grid starting where it goes to, and saved like the other graphics', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  await page.keyboard.press('Control+j');
  await page.getByRole('tab', { name: 'Graphics' }).click();
  const view = page.getByLabel('Memory as graphics');
  const go = async (to: string) => { await view.getByLabel('Go to address, label or range').fill(to); await view.getByLabel('Go to address, label or range').press('Enter'); };
  const sel = view.getByRole('status');
  const charset = view.getByLabel('Draw screens with');
  const demo = readFileSync(join(repoDir, 'fixtures/prg/raster-demo.prg'));
  const at = (a: number, n: number) => demo.subarray(2 + a - 0x0801, 2 + a - 0x0801 + n);
  const saveAs = async (item: string | RegExp, file: string) => {
    await stubDialogs(app, { save: join(work, file) });
    await view.getByRole('button', { name: 'Save…' }).click();
    await view.getByRole('menu', { name: 'Save the selection as' }).getByRole('menuitem', { name: item }).click();
    await expect(toast(page, `Saved ${join(work, file)}`)).toBeVisible();
    return readFileSync(join(work, file));
  };

  await test.step('Screens: a screen per 1 KB, drawn with the C64 ROM, the built-in letters or a charset in memory', async () => {
    await view.getByRole('button', { name: 'Screens', exact: true }).click();
    await expect(view.getByRole('button', { name: 'Screens', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(view.getByLabel('Memory as screens')).toBeVisible();
    await expect(charset.locator('option')).toContainText(['C64 ROM, upper case', 'C64 ROM, lower case', 'Built-in letters and digits', '$3000 charset_3000', '$0000']);
    await charset.selectOption({ label: 'Built-in letters and digits' });
    await expect(charset).toHaveValue('builtin');
    await charset.selectOption('$3000');
    await expect(charset).toHaveValue('$3000');
  });

  await test.step('going to the text at $0985 moves the grid so that a screen starts there; hovering names the row and column', async () => {
    await go('txt_0985');
    await expect(sel).toContainText('$0985–$0d6c (1000 bytes) · Text txt_0985');
    await expect(view.getByText('Offset')).toBeVisible();
    await expect(view.locator('.gfxv-field .mono')).toHaveText(String(0x0985 % 0x400));
    const r = (await view.locator('.gfxv-selrect').first().boundingBox())!;
    // zoom 2: the third code of the first row
    await page.mouse.move(r.x + 2 * 8 * 2 + 4, r.y + 4);
    await expect(view.locator('.gfxv-info')).toContainText(`$0987 = $${at(0x0987, 1)[0].toString(16).padStart(2, '0')} · row 0, column 2 of the screen at $0985 · Text txt_0985`);
    await go('$0400');
    await page.mouse.move(r.x + 4, r.y + 4);
    await expect(view.locator('.gfxv-info')).toContainText('of the screen at $0400 ($d018 = $1x in VIC bank 0)');
  });

  await test.step('saved as bytes, with its load address, as an image and as .byte rows of 40', async () => {
    await go('txt_0985');
    await view.getByRole('button', { name: 'Save…' }).click();
    await expect(view.getByRole('menu', { name: 'Save the selection as' }).getByRole('menuitem')).toHaveText([
      'Raw bytes (.bin)', 'With its load address (.prg)', 'Image as shown here (.png)', 'Kick Assembler source, .byte rows (.asm)',
    ]);
    await page.keyboard.press('Escape');
    expect(await saveAs('Raw bytes (.bin)', 'screen.bin')).toEqual(at(0x0985, 1000));
    expect((await dialogOptions(app)).pop()).toMatchObject({ defaultPath: expect.stringMatching(/txt_0985\.bin$/) });
    const prg = await saveAs(/\.prg/, 'screen.prg');
    expect([prg[0], prg[1], prg.length]).toEqual([0x85, 0x09, 1002]);
    const png = await saveAs(/\.png/, 'screen.png');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 200]);
    const asm = (await saveAs(/\.asm/, 'screen.asm')).toString('utf8');
    expect(asm).toMatch(/^\/\/ txt_0985: \$0985-\$0d6c, 1000 bytes \(1 screen\), saved by Mimir Studio/);
    expect(asm.split('\n').filter(l => l.includes('.byte'))).toHaveLength(25);
    await view.getByRole('button', { name: 'With the sprite pointers (1 KB)' }).click();
    await expect(sel).toContainText('$0985–$0d84 (1024 bytes)');
    await expect(view.getByRole('button', { name: 'Mark as Screen matrix' })).toBeVisible();
  });
});

test('the Graphics tab draws a font per row: the same 40 screen codes, each character row with the next font', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  await page.keyboard.press('Control+j');
  await page.getByRole('tab', { name: 'Graphics' }).click();
  const view = page.getByLabel('Memory as graphics');
  const sel = view.getByRole('status');
  const picture = view.getByLabel('A font per row');
  const demo = readFileSync(join(repoDir, 'fixtures/prg/raster-demo.prg'));
  const at = (a: number) => demo[2 + a - 0x0801];
  const field = async (label: string, to: string) => { await view.getByLabel(label).fill(to); await view.getByLabel(label).press('Enter'); };

  await test.step('the codes come from the first row of the screen (0-39 when it is not loaded), the fonts 2 KB apart', async () => {
    await view.getByRole('button', { name: 'Font per row' }).click();
    await expect(picture).toBeVisible();
    await expect(view.getByText('not loaded: 0–39')).toBeVisible();
    // the codes are picked from the blocks the analysis knows (or typed)
    const pick = view.getByLabel('Screen codes from a block');
    await expect(pick).toHaveValue(String(0x0400));
    await expect(pick.locator('optgroup').first()).toHaveAttribute('label', 'Text');
    await expect(pick.locator('optgroup').last()).toHaveAttribute('label', 'Code');
    await pick.selectOption({ label: '$0985 txt_0985 · 48 bytes' });
    await expect(view.getByLabel('First row of the screen')).toHaveValue('$0985');
    // the arrows and the mouse wheel step through the list: $0400, then the texts $0949, $0960, $0985, then the data …
    const codesAt = view.getByLabel('First row of the screen');
    for (const a of ['$0960', '$0949', '$0400']) { await view.getByRole('button', { name: 'Previous block' }).click(); await expect(codesAt).toHaveValue(a); }
    await expect(view.getByRole('button', { name: 'Previous block' })).toBeDisabled();
    await view.getByRole('button', { name: 'Next block' }).click();
    await expect(codesAt).toHaveValue('$0949');
    const p = (await pick.boundingBox())!;
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await page.mouse.wheel(0, 100);
    await expect(codesAt).toHaveValue('$0960');
    await page.waitForTimeout(100);
    await page.mouse.wheel(0, -100);
    await expect(codesAt).toHaveValue('$0949');
    await field('First row of the screen', '$0990');
    await expect(pick).toHaveValue('');
    await field('First row of the screen', 'txt_0985');
    await expect(pick).toHaveValue(String(0x0985));
    await view.getByRole('button', { name: 'Next block' }).click();
    await expect(codesAt).toHaveValue('$092d');
    await field('First row of the screen', 'txt_0985');
    await expect(view.getByText('not loaded: 0–39')).toHaveCount(0);
    await field('Font of the first row', '$3000');
    // 25 rows asked for, 22 fit before $ffff: $9000, $9800, $d000 and $d800 are passed over
    await expect(picture).toHaveAttribute('height', String(22 * 8));
    await expect(view.getByText('skipped $9000, $9800, $d000, $d800')).toBeVisible();
    await view.getByLabel('Rows').selectOption('4');
    await expect(picture).toHaveAttribute('height', String(4 * 8));
    await expect(view.locator('.gfxv-row span')).toHaveText(['$3000', '$3800', '$4000', '$4800']);
  });

  await test.step('hovering names the character and its font; a click selects the row font', async () => {
    // the picture moves when the selection bar grows: where it is now, at zoom 2
    const point = async (x: number, y: number) => { const b = (await picture.boundingBox())!; return [b.x + x * 2, b.y + y * 2] as const; };
    // column 0, the second line of row 0 is 'H' (screen code 8) of the font at $3000
    await page.mouse.move(...await point(2, 1.5));
    await expect(view.locator('.gfxv-info')).toContainText(`$3041 = $${at(0x3041).toString(16).padStart(2, '0')} · row 0, column 0: char $08 of the font at $3000 · Charset charset_3000`);
    await page.mouse.click(...await point(50, 8 + 2));
    await expect(sel).toContainText('$3800–$3fff (2048 bytes) · not loaded');
    await page.mouse.click(...await point(50, 2));
    await expect(sel).toContainText('$3000–$37ff (2048 bytes) · Charset charset_3000');
    await view.getByRole('button', { name: 'All 4 rows' }).click();
    await expect(sel).toContainText('$3000–$4fff (8192 bytes)');
  });

  await test.step('saved as the fonts or as the picture', async () => {
    const b = (await picture.boundingBox())!;
    await page.mouse.click(b.x + 100, b.y + 4);
    await expect(sel).toContainText('$3000–$37ff (2048 bytes)');
    await view.getByRole('button', { name: 'Save…' }).click();
    await expect(view.getByRole('menu', { name: 'Save the selection as' }).getByRole('menuitem')).toHaveText([
      'Raw bytes (.bin)', 'With its load address (.prg)', 'Image as shown here (.png)', 'Kick Assembler source, .byte rows (.asm)',
    ]);
    await stubDialogs(app, { save: join(work, 'row.png') });
    await view.getByRole('menu', { name: 'Save the selection as' }).getByRole('menuitem', { name: /\.png/ }).click();
    await expect(toast(page, `Saved ${join(work, 'row.png')}`)).toBeVisible();
    const png = readFileSync(join(work, 'row.png'));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 8]);
    expect((await dialogOptions(app)).pop()).toMatchObject({ defaultPath: expect.stringMatching(/charset_3000\.png$/) });
  });

  await test.step('rows pass over memory where no font can be (the VIC sees the character ROM at $1000-$1fff), unless told not to', async () => {
    const field = view.getByLabel('Font of the first row');
    await field.fill('$0800'); await field.press('Enter');
    await expect(view.locator('.gfxv-row span')).toHaveText(['$0800', '$2000', '$2800', '$3000']);
    await expect(view.getByText('skipped $1000, $1800')).toBeVisible();
    await view.getByLabel('Skip where no font can be').uncheck();
    await expect(view.locator('.gfxv-row span')).toHaveText(['$0800', '$1000', '$1800', '$2000']);
    await expect(view.getByText(/^skipped/)).toHaveCount(0);
    await view.getByLabel('Skip where no font can be').check();
    await field.fill('$1000'); await field.press('Enter');
    // a first font where none can be: the picture starts at the next one
    await expect(view.locator('.gfxv-row span').first()).toHaveText('$2000');
  });
});

test('Build & Run restarts a VICE snapshot as it was taken, with the built program in its RAM', async ({ app, page }) => {
  // VICE itself is not started here: a Windows program that ends at once stands in for it (the real VICE restarting
  // a snapshot is tested in packages/core/test/vice.integration.test.ts)
  const standIn = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe');
  test.skip(!existsSync(standIn), 'needs where.exe');
  await waitForListing(page);
  const vsf = join(repoDir, 'fixtures/vsf/raster-demo.vsf');
  await page.evaluate(v => (window as unknown as { kr: { setSettings(p: object): Promise<unknown> } }).kr.setSettings({ vicePath: v }), standIn);
  const build = page.getByRole('button', { name: 'Build & Run' });
  await expect(build).toHaveAttribute('title', 'Build with KickAss.jar and run in VICE (F5)');
  await stubDialogs(app, { open: [vsf] });
  await openSection(page, 'Files');
  await fromFileMenu(page, 'Open a VICE snapshot (.vsf)…');
  await expect(toast(page, 'Loaded raster-demo.prg at $0200 from a VICE 3.10 snapshot')).toBeVisible();
  await expect(build).toHaveAttribute('title', /restart the snapshot in VICE as it was taken/);
  await page.keyboard.press('F5');
  await expect(toast(page, 'VICE restarted the snapshot as it was taken (PC $08c7, $01 = $37), with the built program in its RAM')).toBeVisible({ timeout: 120_000 });
  await page.getByRole('tab', { name: 'Build output' }).click();
  const log = await page.locator('.build-log').innerText();
  const started = /> VICE started \(pid -?\d+\): (.+?\.vsf)(?: with labels|,)/.exec(log);
  expect(started, log.slice(-600)).toBeTruthy();
  expect(log).toContain('the snapshot restarted as it was taken (PC $08c7, $01 = $37), the built program in its RAM');
  // the program is byte-identical, so the snapshot VICE gets is the one that was opened
  expect(readFileSync(started![1])).toEqual(readFileSync(vsf));
});

test('the side panel\'s sections say what they hold, start closed, stay open for the run and are closed again after a restart', async ({ page }) => {
  await waitForListing(page);
  const views = page.getByRole('navigation', { name: 'Views' });
  const sections = page.locator('.side-sec');
  const loaders = page.getByRole('region', { name: 'Loaders' });
  const toggle = loaders.getByRole('button', { name: 'Loaders' });
  /** every section of the view shown is closed: its title and what it holds, nothing more */
  const allClosed = async (count: number) => {
    await expect(sections).toHaveCount(count);
    await expect(sections.locator('.sec-toggle[aria-expanded="false"]')).toHaveCount(count);
    await expect(sections.locator('.sec-body')).toHaveCount(0);
  };
  await expect(page.getByRole('region', { name: 'Files' }).locator('.sec-sum')).toHaveText('1 file');
  await expect(loaders.locator('.sec-sum')).toHaveText('none found');
  await expect(page.getByRole('region', { name: 'Program start' }).locator('.sec-sum')).toHaveText('$0810');
  // Files, VICE quicksave, Scripts, Loaders, Program start and Memory map
  await allClosed(6);
  await expect(loaders).not.toContainText('No fast, IRQ or tape loader found');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(loaders).toContainText('No fast, IRQ or tape loader found, and no KERNAL LOAD.');
  // another view and back: still open for the rest of the run
  await views.getByRole('button', { name: 'Blocks' }).click();
  await views.getByRole('button', { name: 'Explorer' }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(loaders).not.toContainText('No fast, IRQ or tape loader found');
  await expect(loaders.locator('.sec-sum')).toHaveText('none found');

  // the Pack view's sections (What to pack, Packed file, Self-extracting, Decruncher's memory, Command) are closed too
  await views.getByRole('button', { name: 'Pack' }).click();
  await allClosed(5);
  await openSection(page, 'Command');

  // a restart (the reload starts the window afresh, its saved preferences read again): every section closed again,
  // also the ones that were open
  await views.getByRole('button', { name: 'Explorer' }).click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await waitForListing(page);
  await allClosed(6);
  await expect(loaders).not.toContainText('No fast, IRQ or tape loader found');
  await views.getByRole('button', { name: 'Pack' }).click();
  await allClosed(5);
});

test('the side panel collapses so the listing gets its room, and comes back with a view\'s button or Ctrl+Shift+B; it stays collapsed after a restart', async ({ page }) => {
  await waitForListing(page);
  const side = page.locator('aside.sidebar');
  const title = side.locator('.side-title');
  const views = page.getByRole('navigation', { name: 'Views' });
  const explorer = views.getByRole('button', { name: 'Explorer' });
  const collapse = page.getByRole('button', { name: 'Collapse side panel' });
  const width = async () => Math.round((await listing(page).boundingBox())!.width);
  await expect(explorer).toHaveAttribute('aria-pressed', 'true');
  const open = await width();

  await test.step('its button collapses it: the listing is wider by the panel, and no view\'s button is on', async () => {
    await collapse.click();
    await expect(side).toBeHidden();
    await expect(collapse).toBeHidden();
    await expect(explorer).toHaveAttribute('aria-pressed', 'false');
    // the panel (272 px) and its splitter
    await expect.poll(width).toBe(open + 276);
  });

  await test.step('a view\'s button brings it back with that view, and the listing is as wide as before', async () => {
    await views.getByRole('button', { name: 'Blocks' }).click();
    await expect(side).toBeVisible();
    await expect(title).toContainText('Blocks');
    await expect(views.getByRole('button', { name: 'Blocks' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(width).toBe(open);
  });

  await test.step('the button of the view shown collapses it, Ctrl+Shift+B too; Ctrl+B still shows the bookmarks', async () => {
    await views.getByRole('button', { name: 'Blocks' }).click();
    await expect(side).toBeHidden();
    await listing(page).click();
    await page.keyboard.press('Control+Shift+B');
    await expect(side).toBeVisible();
    await expect(title).toContainText('Blocks');
    await page.keyboard.press('Control+Shift+B');
    await expect(side).toBeHidden();
    await page.keyboard.press('Control+b');
    await expect(side).toBeVisible();
    await expect(title).toContainText('Bookmarks');
  });

  await test.step('the command palette collapses it and brings it back', async () => {
    const palette = async () => { await page.keyboard.press('Control+Shift+P'); const q = page.getByRole('textbox', { name: 'Command' }); await q.fill('Toggle side panel'); await q.press('Enter'); };
    await palette();
    await expect(side).toBeHidden();
    await expect.poll(width).toBe(open + 276);
    await palette();
    await expect(side).toBeVisible();
  });

  await test.step('collapsed, it is collapsed after a restart; the Explorer\'s button brings it back', async () => {
    await collapse.click();
    await expect(side).toBeHidden();
    await page.reload();
    await waitForListing(page);
    await expect(side).toBeHidden();
    await expect.poll(width).toBe(open + 276);
    await explorer.click();
    await expect(side).toBeVisible();
    await expect(title).toContainText('Explorer');
    await expect.poll(width).toBe(open);
  });
});

test('the inspector folds into a strip at the right edge (Settings → General): it opens over the editor when needed and folds in at a click outside it', async ({ page }) => {
  await waitForListing(page);
  const insp = page.locator('aside.insp-col');
  const rail = page.getByRole('button', { name: 'Inspector', exact: true });
  const width = async () => Math.round((await listing(page).boundingBox())!.width);
  const settings = async () => {
    await page.keyboard.press('Control+,');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('tab', { name: 'General' }).click();
    return dialog;
  };
  const choose = async (mode: 'open' | 'auto') => {
    const dialog = await settings();
    await dialog.getByLabel('Inspector (the panel on the right)').selectOption(mode);
    await dialog.getByRole('button', { name: 'Save settings' }).click();
    await expect(dialog).toBeHidden();
  };
  await expect(insp).toBeVisible();
  await expect(rail).toBeHidden();
  const open = await width();

  await test.step('Settings folds it in: a strip at the right edge, and the listing gets its room', async () => {
    await choose('auto');
    await expect(insp).toBeHidden();
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAttribute('aria-expanded', 'false');
    // the inspector (312 px) and its splitter, less the strip (28 px)
    await expect.poll(width).toBe(open + 288);
  });

  await test.step('a click on the strip opens it over the editor, and a click inside it keeps it open', async () => {
    await rail.click();
    await expect(insp).toBeVisible();
    await expect(rail).toHaveAttribute('aria-expanded', 'true');
    await expect(insp).toContainText('Memory map');
    expect(await width()).toBe(open + 288);
    const bytes = insp.getByRole('button', { name: 'Bytes', exact: true });
    await bytes.click();
    await expect(bytes).toHaveAttribute('aria-pressed', 'true');
    await expect(insp).toBeVisible();
  });

  await test.step('a click outside folds it in and still does what it does there: the cursor goes to the line clicked', async () => {
    await listing(page).locator('.row', { hasText: 'jsr sub_0866' }).click();
    await expect(insp).toBeHidden();
    await expect(rail).toHaveAttribute('aria-expanded', 'false');
    await expect(statusBar(page)).toContainText('$0813');
  });

  await test.step('Esc folds it in; the strip again, and the command palette, open it', async () => {
    await rail.click();
    await expect(insp).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(insp).toBeHidden();
    // Esc folded it in, and only that: the listing did not go back
    await expect(statusBar(page)).toContainText('$0813');
    await page.keyboard.press('Control+Shift+P');
    const q = page.getByRole('textbox', { name: 'Command' });
    await q.fill('Show the inspector');
    await q.press('Enter');
    await expect(insp).toBeVisible();
    await rail.click();
    await expect(insp).toBeHidden();
  });

  await test.step('a click on the start of a block, its header, opens it with that block; another header keeps it open, another line folds it in', async () => {
    await goTo(page, '$0949');
    await headerRow(page, '0949').click();
    await expect(insp).toBeVisible();
    await expect(insp).toContainText('$0949–');
    await headerRow(page, '0939').click();
    await expect(insp).toBeVisible();
    await expect(insp).toContainText('$0939–$0948');
    await listing(page).locator('.row:not(.hdr)', { has: page.locator('.adr', { hasText: /^0949$/ }) }).first().click();
    await expect(insp).toBeHidden();
  });

  await test.step('its pin keeps it open beside the editor, and its button at the top folds it in again', async () => {
    await rail.click();
    await insp.getByRole('button', { name: 'Keep the inspector open', exact: true }).click();
    await expect(rail).toBeHidden();
    await expect(insp).toBeVisible();
    await expect.poll(width).toBe(open);
    await insp.getByRole('button', { name: 'Fold in the inspector', exact: true }).click();
    await expect(insp).toBeHidden();
    await expect(rail).toBeVisible();
    await expect.poll(width).toBe(open + 288);
  });

  await test.step('folded in, it is folded in after a restart, as Settings says; Always open brings it back', async () => {
    await page.reload();
    await waitForListing(page);
    await expect(insp).toBeHidden();
    await expect(rail).toBeVisible();
    const dialog = await settings();
    await expect(dialog.getByLabel('Inspector (the panel on the right)')).toHaveValue('auto');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await choose('open');
    await expect(insp).toBeVisible();
    await expect(rail).toBeHidden();
    await expect.poll(width).toBe(open);
  });
});

test('the memory map zooms with the wheel around the pointer, a right-drag moves it and Whole map shows it all again', async ({ page }) => {
  await waitForListing(page);
  const insp = page.locator('.inspector');
  const map = insp.getByRole('img', { name: /^Memory map/ });
  const tip = insp.locator('.heat-tip b');
  const whole = insp.getByRole('button', { name: 'Whole map' });
  const box = (await map.boundingBox())!;
  // whole pixels, as a mouse has them
  const at = (fx: number, fy: number) => ({ x: Math.round(box.x + box.width * fx), y: Math.round(box.y + box.height * fy) });
  /** the zoom and the first and last byte in view, as the map's label says them; null for the whole map */
  const shown = async () => {
    const m = /zoomed ×([\d.]+) on \$([0-9a-f]{4})–\$([0-9a-f]{4})$/.exec((await map.getAttribute('aria-label')) ?? '');
    return m ? { z: +m[1], first: parseInt(m[2], 16), last: parseInt(m[3], 16) } : null;
  };
  // the view is a rectangle of pages and columns
  const inView = (s: Awaited<ReturnType<typeof shown>>, a: number) => !!s && a >> 8 >= s.first >> 8 && a >> 8 <= s.last >> 8 && (a & 255) >= (s.first & 255) && (a & 255) <= (s.last & 255);
  const axis = () => insp.locator('.heat-axis span').allTextContents();
  const under = async (p: { x: number; y: number }) => { await page.mouse.move(p.x, p.y); return (await tip.textContent())!; };

  await test.step('at first the whole map, $0800–$37ff with Zoom to the loaded pages, with four addresses down its side', async () => {
    expect(await shown()).toBeNull();
    expect(await axis()).toEqual(['$0800', '$1400', '$2000', '$2c00']);
    await expect(whole).toBeHidden();
  });

  await test.step('the wheel zooms in around the pointer: the byte under it stays under it, and the inspector does not scroll', async () => {
    const p = at(0.3, 0.12), a = await under(p);
    const top = await page.locator('.insp-col').evaluate(e => e.scrollTop);
    await page.mouse.wheel(0, -200);
    await expect.poll(async () => (await shown())?.z ?? 1).toBeGreaterThan(1);
    await expect(tip).toHaveText(a);
    await expect(whole).toBeVisible();
    await expect(insp.locator('.heat-zoom')).toContainText('×');
    expect(await page.locator('.insp-col').evaluate(e => e.scrollTop)).toBe(top);
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await shown())?.z).toBe(32);
    await expect(tip).toHaveText(a);
    await expect(insp.locator('.heat-zoom')).toContainText('×32');
    // close up each row has its address beside it, a page apart: the byte at the map's left edge
    const rows = (await axis()).map(t => parseInt(t.slice(1), 16));
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < rows.length; i++) expect(rows[i] - rows[i - 1]).toBe(0x100);
    expect(rows[0] & 255).toBe((await shown())!.first & 255);
  });

  await test.step('a right-drag moves the map with the pointer and does not jump, on a slow machine too', async () => {
    const before = (await shown())!, p = at(0.5, 0.5), a = await under(p);
    // a slow CPU: React renders a move after the next event has come, and the byte let go over was read on the view a
    // move before (a byte or a row off, on a busy machine in the full run only)
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(p.x - 70, p.y - 40, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    // the byte grabbed is under the pointer where it was let go: the map moved two or three bytes left and a row up
    await expect(tip).toHaveText(a);
    const after = (await shown())!;
    expect((after.first & 255) - (before.first & 255)).toBeGreaterThanOrEqual(2);
    expect((after.first >> 8) - (before.first >> 8)).toBeGreaterThanOrEqual(1);
    await expect(statusBar(page)).toContainText('$0810 · start');
    await expect(page.locator('.ctx')).toBeHidden();
  });

  await test.step('a right-click that does not drag jumps there, as before', async () => {
    const p = at(0.4, 0.6), a = await under(p);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await expect(statusBar(page)).toContainText(a);
    await expect(page.locator('.ctx')).toBeHidden();
  });

  await test.step('the left button still jumps with a click and selects with a drag', async () => {
    const p = at(0.15, 0.3), q = at(0.7, 0.45), a = await under(p);
    await page.mouse.click(p.x, p.y);
    await expect(statusBar(page)).toContainText(a);
    await page.mouse.down();
    await page.mouse.move(q.x, q.y, { steps: 4 });
    const b = (await tip.textContent())!;
    await page.mouse.up();
    await expect(statusBar(page)).toContainText(`sel ${a}–${b}`);
  });

  await test.step('zoomed in, the map follows the cursor when it moves out of view', async () => {
    await goTo(page, 'charset_3000');
    await expect.poll(async () => inView(await shown(), 0x3000)).toBe(true);
    await goTo(page, 'start');
    await expect.poll(async () => inView(await shown(), 0x0810)).toBe(true);
    expect((await shown())!.z).toBe(32);
  });

  await test.step('Zoom to the loaded pages off and on keeps the zoom and what is in view', async () => {
    const before = await shown(), fit = insp.getByLabel('Zoom to the loaded pages');
    await fit.uncheck();
    await expect.poll(shown).toEqual(before);
    await fit.check();
    await expect.poll(shown).toEqual(before);
  });

  await test.step('Whole map shows it all again, and so does the wheel turned back', async () => {
    await whole.click();
    await expect(whole).toBeHidden();
    expect(await shown()).toBeNull();
    const p = at(0.5, 0.5);
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, -300);
    await expect(whole).toBeVisible();
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 300);
    await expect(whole).toBeHidden();
    expect(await shown()).toBeNull();
    expect(await axis()).toEqual(['$0800', '$1400', '$2000', '$2c00']);
  });
});

test('loaders: the Explorer names the loader and lists its parts, which the listing and the source mark', async ({ app, page }) => {
  await waitForListing(page);
  await openSection(page, 'Files');
  const section = await openSection(page, 'Loaders');
  await expect(section).toContainText('No fast, IRQ or tape loader found, and no KERNAL LOAD.');

  // fixtures/prg/loader-demo.prg (packages/core/test/loaders.test.ts): an installer that sends drive code with M-W and
  // starts it with M-E, the drive code, and a Spindle 3 resident page at $0c00 that the program calls
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/loader-demo.prg')] });
  await fromFileMenu(page, 'Open PRG files…');
  await expect(toast(page, 'Loaded loader-demo.prg at $0801')).toBeVisible();
  const spindle = section.getByLabel('Spindle (lft)');
  await expect(spindle).toContainText('2-bit + ATN, synchronous; one resident page that the program calls with jsr, the VIC bank set through $dd02');
  await expect(spindle.locator('li')).toHaveText([/installer$/, /drive command$/, /drive command$/, /^\$0c00–\$0cff\s*on the C64$/, /^\$3000–\$302[0-9a-f]\s*drive code$/]);
  await expect(spindle.getByRole('button', { name: '$0c00–$0cff' })).toHaveAttribute('title', 'resident page (jsr here to load the next part)\nClick to go there');

  await test.step('a part goes to the listing, where it is marked', async () => {
    await spindle.getByRole('button', { name: '$0c00–$0cff' }).click();
    await expect(statusBar(page)).toContainText('$0c00');
    await expect(listing(page).locator('.row .syn-comment.mark', { hasText: '// ==== Spindle (lft): resident page (jsr here to load the next part) ====' })).toBeVisible();
    await expect(listing(page).locator('.row.hdr .hdr-loader').first()).toHaveText('Spindle');
    await spindle.getByRole('button', { name: /^\$3000–/ }).click();
    await expect(listing(page).locator('.row .syn-comment.mark', { hasText: '// ==== Spindle (lft): code for the 1541' })).toBeVisible();
  });

  await test.step('the analysis log says it too, and the build still verifies', async () => {
    await page.getByRole('tab', { name: 'Analysis log' }).click();
    await expect(page.locator('.loglist .logrow', { hasText: 'Loader: Spindle (lft): 2-bit + ATN' })).toBeVisible();
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });
});

test('the Spindle script: a tab when Pefchain drivers are in memory, a row per script line that goes to its driver', async ({ app, page }) => {
  await waitForListing(page);
  await openSection(page, 'Files');
  await expect(page.getByRole('tab', { name: /Spindle script/ })).toHaveCount(0);

  // fixtures/prg/spindle-demo.prg (packages/core/test/spindle.test.ts): the drivers pefchain 3.1 built for five small
  // parts, `space`, `f0 = 05`, `| f0 = 20`, `-`, `@` and its blank part that stays
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/spindle-demo.prg')] });
  await fromFileMenu(page, 'Open PRG files…');
  await expect(toast(page, 'Loaded spindle-demo.prg at $0400')).toBeVisible();
  await page.getByRole('tab', { name: /Spindle script/ }).click();
  await expect(page.getByRole('tab', { name: /Spindle script/ })).toContainText('6');
  const table = page.getByRole('table', { name: 'Spindle script' });
  await expect(table.locator('tbody td.script-line')).toHaveText(['part1.pef space', 'part2.pef f0 = 05', '| f0 = 20', 'part3.pef -', 'part4.pef @', '- stay']);
  await expect(table.locator('tbody tr').nth(1).locator('td').last()).toHaveText('its | line');
  await expect(table.locator('tbody tr').last().locator('td').last()).toHaveText('the end of the demo');

  await test.step('a row goes to its driver, marked in the listing; a routine goes to the routine', async () => {
    await table.locator('tbody tr').nth(3).locator('td').first().click();
    await expect(statusBar(page)).toContainText('$1201 · part3_driver');
    await expect(listing(page).locator('.row .syn-comment.mark', { hasText: '// ==== Spindle part 3: its driver (script line "part3.pef -") ====' })).toBeVisible();
    await table.locator('tbody tr').nth(4).getByRole('button', { name: 'part4_fadeout' }).click();
    await expect(statusBar(page)).toContainText('$1314 · part4_fadeout');
  });

  await test.step('it copies the script as Pefchain reads it, and the build still verifies', async () => {
    await page.getByRole('button', { name: 'Copy script' }).click();
    await expect(toast(page, 'Copied the Spindle script')).toBeVisible();
    const text = (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n');
    expect(text.split('\n').slice(2, 4)).toEqual([
      'part1.pef     space      # driver $108c: prepare $1000, setup $1001, irq $1006, fadeout $1013, cleanup $1015; loads',
      'part2.pef     f0 = 05    # driver $1115: setup $1100, irq $1105, main $1112',
    ]);
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('a program without drivers has no such tab, and the panel goes back to the log', async () => {
    await page.getByRole('tab', { name: /Spindle script/ }).click();
    await page.getByRole('button', { name: 'Demo', exact: true }).click();
    await expect(page.getByRole('tab', { name: /Spindle script/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Analysis log/ })).toHaveAttribute('aria-selected', 'true');
  });
});

test('a mounted Spindle 3 disk: its load script in the Spindle script tab, each chunk opened as a PRG', async ({ app, page }) => {
  // fixtures/d64/spindle-demo.d64 (packages/core/test/spindle-disk.test.ts): 4 jobs, labels 01, 02 and 1f, a jump after
  // the last one, and the boot program going to $0800
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/d64/spindle-demo.d64')] });
  await fromFileMenu(page, 'Mount disk image (D64, G64)…');
  await expect(toast(page, 'Mounted spindle-demo.d64: "SPINDLE DEMO", 1 file, a Spindle 3 disk with 4 jobs')).toBeVisible();
  await openSection(page, 'Disk');
  await expect(page.locator('.disk-spindle')).toContainText('Spindle 3 disk: 4 jobs the loader reads, not files');

  await test.step('the Explorer opens the load script, a row per chunk', async () => {
    await page.locator('.disk-spindle').getByRole('button', { name: 'Load script' }).click();
    await expect(page.getByRole('tab', { name: /Spindle script/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.spindle-head').first()).toContainText('Load script of spindle-demo.d64 (Spin, Spindle 3): 4 jobs, 6 chunks');
    const table = page.getByRole('table', { name: 'Spindle load script' });
    await expect(table.locator('tbody tr td:nth-child(4)')).toHaveText(['job01_0800.bin', 'job01_1000.bin', 'job02_4000.bin', 'job02_6000.bin', 'job03_2000.bin', 'job04_cf00.bin']);
    await expect(table.locator('tbody tr').nth(4).locator('td').first()).toHaveText('302:1f:');
    await expect(table.locator('tbody tr').nth(5).locator('td').nth(4)).toHaveText('then jumps to $307a · loads under I/O');
  });

  await test.step('a row opens its chunk as a PRG, + adds one', async () => {
    const table = page.getByRole('table', { name: 'Spindle load script' });
    await table.getByRole('row', { name: /job01_0800/ }).click();
    await expect(toast(page, 'Loaded job01_0800.prg at $0800')).toBeVisible();
    await table.getByRole('button', { name: 'Add job02_4000.bin to this project' }).click();
    await expectFiles(page, ['job01_0800.prg', 'job02_4000.prg']);
    await expect(listing(page).locator('.row', { hasText: 'sta VIC_BORDER_COLOR' }).first()).toBeVisible();
  });

  await test.step('it copies the script as Spin reads it', async () => {
    await page.getByRole('button', { name: 'Copy script' }).click();
    await expect(toast(page, 'Copied the load script')).toBeVisible();
    const text = (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n');
    expect(text.split('\n').slice(2, 6)).toEqual(['# spin -e 0800', '', 'job01_0800.bin     0800    # $0800-$080a, 11 bytes', 'job01_1000.bin     1000    # $1000-$1257, 600 bytes']);
  });

  await test.step('ejecting the disk takes the tab away', async () => {
    await page.getByRole('button', { name: 'Eject disk' }).click();
    await expect(page.getByRole('tab', { name: /Spindle script/ })).toHaveCount(0);
  });
});

test('a mounted Bitfire disk: its files in the Bitfire script tab, unpacked, and d64write\'s command line', async ({ app, page }) => {
  // fixtures/d64/bitfire-demo.d64 (packages/core/test/bitfire-disk.test.ts): the raster demo packed with an end, a table
  // that is not packed, and a file packed in place that unpacks to $2ed4-$2fff
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/d64/bitfire-demo.d64')] });
  await fromFileMenu(page, 'Mount disk image (D64, G64)…');
  await expect(toast(page, 'Mounted bitfire-demo.d64: "BITFIRE DEMO", 2 files, a Bitfire disk with 3 files of its own')).toBeVisible();
  await openSection(page, 'Disk');
  await expect(page.locator('.disk-spindle')).toContainText('Bitfire disk: 3 files the loader reads, not in the directory');
  const table = page.getByRole('table', { name: 'Bitfire files' });

  await test.step('the Explorer opens the tab, a row per file in the order they load', async () => {
    await page.locator('.disk-spindle').getByRole('button', { name: 'Bitfire script' }).click();
    await expect(page.getByRole('tab', { name: /Bitfire script/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /Bitfire script/ })).toContainText('3');
    await expect(page.locator('.spindle-head').first()).toContainText('Files of bitfire-demo.d64 (Bitfire 1.2 or later, side 1): 3 files, 2 unpacked');
    await expect(table.locator('tbody tr td:nth-child(5)')).toHaveText(['file00_0801.lz', 'file01_4000.lz', 'file02_2ed4.lz']);
    await expect(table.locator('tbody tr td:nth-child(3)')).toHaveText(['$0801–$37ff', '—', '$2ed4–$2fff']);
    await expect(table.locator('tbody tr').nth(1).locator('td').nth(1)).toHaveText('$4000–$40ff');
    await expect(table.locator('tbody tr').nth(1).locator('td').nth(5)).toHaveText(/^not packed · from 1\/\d+ byte \d+$/);
    await expect(table.locator('tbody tr').nth(2).locator('td').nth(5)).toContainText('packed with dali, in place');
  });

  await test.step('a row opens its file unpacked, as a PRG where it unpacks to; + adds one as it loads', async () => {
    await table.getByRole('row', { name: /file00_0801/ }).click();
    await expect(toast(page, 'Loaded file00_0801.prg at $0801')).toBeVisible();
    // the raster demo, as it was before it was packed
    await expect(listing(page).locator('.row', { hasText: 'BasicUpstart2(start)' }).first()).toBeVisible();
    await expect(listing(page).locator('.row', { hasText: 'jsr music.init' }).first()).toBeVisible();
    await table.getByRole('button', { name: 'Add file01_4000.lz to this project' }).click();
    await expectFiles(page, ['file00_0801.prg', 'file01_4000.prg']);
  });

  await test.step('it copies d64write\'s command line, each file in a comment above it', async () => {
    await page.getByRole('button', { name: 'Copy script' }).click();
    await expect(toast(page, 'Copied the d64write command line')).toBeVisible();
    const text = (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n').split('\n');
    expect(text[0]).toBe('# d64write command line, rebuilt by Mimir Studio from bitfire-demo.d64 (Bitfire 1.2 or later): 3 files on side 1.');
    expect(text).toContain('#   file01_4000.lz   loads at $4000-$40ff (256 bytes), not packed');
    expect(text.slice(text.indexOf(''))).toEqual(['', 'd64write -c bitfire-demo.d64 -h "bitfire demo" -i bf --side 1 \\', '  --boot boot.prg \\',
      '  -b file00_0801.lz \\', '  -b file01_4000.lz \\', '  -b file02_2ed4.lz \\', '  -s note.prg']);
  });

  await test.step('ejecting the disk takes the tab away', async () => {
    await page.getByRole('button', { name: 'Eject disk' }).click();
    await expect(page.getByRole('tab', { name: /Bitfire script/ })).toHaveCount(0);
  });
});

test('a mounted Pirate Slayer disk: the files outside its directory in the Pirate Slayer tab, opened decoded and re-assembled, and saved', async ({ app, page, workDir }) => {
  // fixtures/d64/pirateslayer-demo.d64 (packages/core/test/pirateslayer.test.ts): EA and LOADER with the boot's text, the
  // raster demo on 3/0 and a sine table on 9/0, both stored XOR $EA as EA's loader reads them
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/d64/pirateslayer-demo.d64')] });
  await fromFileMenu(page, 'Mount disk image (D64, G64)…');
  await expect(toast(page, 'Mounted pirateslayer-demo.d64: "ELECTRONIC ARTS", 2 files; Pirate Slayer V2 (Electronic Arts): no key track (a D64 has none: the check fails); boot EA → LOADER; 2 files outside the directory')).toBeVisible();
  await openSection(page, 'Disk');
  await expect(page.locator('.disk-spindle')).toContainText('Pirate Slayer: a D64 has no key track: the boot fails its check; boot EA → LOADER; 2 files outside the directory');
  const table = page.getByRole('table', { name: 'Pirate Slayer files' });

  await test.step('the Explorer opens the tab, a row per file in disk order', async () => {
    await page.locator('.disk-spindle').getByRole('button', { name: 'Pirate Slayer' }).click();
    await expect(page.getByRole('tab', { name: /Pirate Slayer/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.spindle-head').nth(1)).toContainText('Files outside the directory: 2');
    await expect(page.locator('.spindle-head').nth(1)).toContainText('stored XOR $EA on the disk');
    await expect(table.locator('tbody tr td:nth-child(1)')).toHaveText(['3/0', '9/0']);
    await expect(table.locator('tbody tr td:nth-child(5)')).toHaveText(['t3s0_0801.prg', 't9s0_4000.prg']);
    await expect(table.locator('tbody tr td:nth-child(3)')).toHaveText(['$0801–$37ff', '$4000–$40ff']);
    await expect(table.locator('tbody tr').first().locator('td').nth(5)).toHaveText('the first file: the drive sends it as soon as it has found the key, and the boot starts it at its load address · XOR $EA');
  });

  await test.step('a row opens its file decoded, as a PRG at its load address; + adds one; the source builds the same bytes', async () => {
    await table.getByRole('row', { name: /t3s0_0801/ }).click();
    await expect(toast(page, 'Loaded t3s0_0801.prg at $0801')).toBeVisible();
    // the raster demo, as it was before it was stored XOR $EA
    await expect(listing(page).locator('.row', { hasText: 'BasicUpstart2(start)' }).first()).toBeVisible();
    await expect(listing(page).locator('.row', { hasText: 'jsr music.init' }).first()).toBeVisible();
    await table.getByRole('button', { name: 'Add t9s0_4000.prg to this project' }).click();
    await expectFiles(page, ['t3s0_0801.prg', 't9s0_4000.prg']);
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('Save files… saves every file decoded, with files.txt; Copy list copies that list', async () => {
    await page.getByRole('tab', { name: /Pirate Slayer/ }).click();
    const out = join(workDir, 'pirateslayer-files');
    mkdirSync(out, { recursive: true });
    await stubDialogs(app, { open: [out] });
    await page.getByRole('button', { name: 'Save files…' }).click();
    await expect(toast(page, /^Saved 2 files of pirateslayer-demo\.d64 to .*, decoded, and files\.txt that lists them$/)).toBeVisible();
    expect(readdirSync(out).sort()).toEqual(['files.txt', 't3s0_0801.prg', 't9s0_4000.prg']);
    expect(readFileSync(join(out, 't3s0_0801.prg'))).toEqual(readFileSync(join(repoDir, 'fixtures/prg/raster-demo.prg')));
    const list = readFileSync(join(out, 'files.txt'), 'utf8').split('\r\n');
    expect(list[0]).toBe('; Pirate Slayer files of pirateslayer-demo.d64, read by Mimir Studio: 2 files outside the directory.');
    expect(list[4]).toMatch(/^t9s0_4000\.prg {6}; 9\/0, 2 blocks, loads at \$4000-\$40ff \(256 bytes\), XOR \$ea: /);
    await page.getByRole('button', { name: 'Copy list' }).click();
    await expect(toast(page, 'Copied the file list')).toBeVisible();
    expect((await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n').split('\n')).toEqual(list.slice(0, -1));
  });

  await test.step('ejecting the disk takes the tab away', async () => {
    await page.getByRole('button', { name: 'Eject disk' }).click();
    await expect(page.getByRole('tab', { name: /Pirate Slayer/ })).toHaveCount(0);
  });
});

test('a tape in the datasette: its files in the Explorer and the Tape tab, TapeTool\'s command lines, the boot file with its header, Build & Run and Sindri reading the tape', async ({ app, page, workDir }) => {
  // fixtures/tap/mimir-demo.tap (packages/core/test/tap.test.ts): a KERNAL boot file whose loader, in the tape buffer,
  // reads the raster demo (TapeTool's TinyHeader format) from the tape and starts it; a sine table in two blocks in
  // reverse order and a file of RLE packed blocks after it. VICE is not started: a Windows program stands in for it
  const standIn = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe');
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/tap/mimir-demo.tap')] });
  await fromFileMenu(page, 'Insert tape image (TAP, T64)…');
  await expect(toast(page, /^Inserted mimir-demo\.tap \(\d+ s\): 4 files \(1 KERNAL, 3 TapeTool\)$/)).toBeVisible();
  const files = page.getByRole('list', { name: 'Files on mimir-demo.tap' });

  await test.step('the Explorer lists its files in tape order, with where each starts', async () => {
    await expect(page.getByRole('region', { name: 'Tape' }).locator('.sec-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(files.getByRole('listitem')).toHaveText([/0:00\s*"MIMIR TAPE"\s*\+header\s*PRG/, /0:\d\d\s*TinyHeader file\s*TapeTool/, /0:\d\d\s*file 1\s*TapeTool/, /0:\d\d\s*file 2\s*TapeTool/]);
    await expect(page.locator('.disk-spindle')).toContainText('TapeTool tape: 3 turbo files its boot loader reads');
    await expect(page.locator('.side-inner')).toContainText('4 files · TAP v1 · in the datasette on Build & Run');
  });

  await test.step('the Tape tab: every file, a row opens one; TapeTool\'s command lines', async () => {
    await page.locator('.disk-spindle').getByRole('button', { name: 'TapeTool script' }).click();
    await expect(page.getByRole('tab', { name: /^Tape/ })).toHaveAttribute('aria-selected', 'true');
    const table = page.getByRole('table', { name: 'Tape files' });
    await expect(table.locator('tbody tr td:nth-child(4)')).toHaveText(['"MIMIR TAPE"', 'TinyHeader file', 'file 1', 'file 2']);
    await expect(table.locator('tbody tr td:nth-child(5)')).toHaveText(['$02a7–$0303', '$0801–$37ff', '$4000–$41ff', '$5000–$5257']);
    await expect(table.locator('tbody tr').nth(2).locator('td').nth(6)).toHaveText('name byte 1, 2 blocks, in random order');
    await expect(table.locator('tbody tr').nth(3).locator('td').nth(6)).toHaveText('name byte 2, 3 blocks (3 RLE packed)');
    await table.getByRole('row', { name: /TinyHeader file/ }).click();
    await expect(toast(page, 'Loaded tinyheader.prg at $0801')).toBeVisible();
    await expect(listing(page).locator('.row', { hasText: 'BasicUpstart2(start)' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Copy script' }).click();
    await expect(toast(page, 'Copied the TapeTool command lines')).toBeVisible();
    const text = (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n').split('\n');
    expect(text.filter(l => !l.startsWith('rem'))).toEqual([
      'TapeTool.exe wn "mimir-demo.tap" ocb1 "boot.bin" $2a7 0 16 16 187 187 280 c',
      'TapeTool.exe w "mimir-demo.tap" a otl$c0 otft "tinyheader.prg" c',
      'TapeTool.exe n 1 w "mimir-demo.tap" a otl$40 otfb "file1.prg" 1 c',
      'TapeTool.exe w "mimir-demo.tap" a otl$40 otfbr "file2.prg" 2 c',
      'TapeTool.exe w "mimir-demo.tap" a otl$40 c',
    ]);
  });

  await test.step('Save files… saves every file, boot.bin and build.bat', async () => {
    const out = join(workDir, 'tape-files');
    mkdirSync(out, { recursive: true });
    await stubDialogs(app, { open: [out] });
    await page.getByRole('button', { name: 'Save files…' }).click();
    await expect(toast(page, /^Saved 6 files of mimir-demo\.tap to .*: build\.bat writes the tape again with TapeTool$/)).toBeVisible();
    expect(readdirSync(out).sort()).toEqual(['MIMIR TAPE.prg', 'boot.bin', 'build.bat', 'file1.prg', 'file2.prg', 'tinyheader.prg']);
    expect(readFileSync(join(out, 'tinyheader.prg'))).toEqual(readFileSync(join(repoDir, 'fixtures/prg/raster-demo.prg')));
  });

  await test.step('the boot file opens with its header, the tape buffer, as a second file', async () => {
    await openSection(page, 'Tape');
    await files.getByRole('listitem').filter({ hasText: 'MIMIR TAPE' }).click();
    await expect(toast(page, "MIMIR TAPE's header holds code: it is in the project too, as MIMIR TAPE-header.prg at $033c-$03fb (the tape buffer)")).toBeVisible();
    await expectFiles(page, ['MIMIR TAPE.prg', 'MIMIR TAPE-header.prg']);
  });

  await test.step('Build & Run: VICE loads the tape with the built boot file and its header on it', async () => {
    test.skip(!existsSync(standIn), 'needs where.exe');
    await page.evaluate(v => (window as unknown as { kr: { setSettings(p: object): Promise<unknown> } }).kr.setSettings({ vicePath: v }), standIn);
    await page.keyboard.press('F5');
    await expect(toast(page, /^VICE loads .+\.tap: the built .+ and its header \(.+\) as its first file, then mimir-demo\.tap from after "MIMIR TAPE"$/)).toBeVisible({ timeout: 120_000 });
    await page.getByRole('tab', { name: 'Build output' }).click();
    const log = await page.locator('.build-log').innerText();
    const started = /> VICE started \(pid -?\d+\): (.+?\.tap) autostarted/.exec(log);
    expect(started, log.slice(-600)).toBeTruthy();
    const tap = readFileSync(started![1]);
    expect(tap.subarray(0, 12).toString('latin1')).toBe('C64-TAPE-RAW');
    // the boot file written again in front of the turbo part, which is the tape's own
    const orig = readFileSync(join(repoDir, 'fixtures/tap/mimir-demo.tap'));
    expect(tap.subarray(tap.length - 50000)).toEqual(orig.subarray(orig.length - 50000));
  });

  await test.step('Sindri plays the tape for the boot file: its loader loads the raster demo, which Unpack takes', async () => {
    const bar = page.locator('.pack-bar');
    await expect(bar).toContainText('MIMIR TAPE.prg is packed.', { timeout: 60_000 });
    await expect(bar).toContainText(/the program starts at \$0810/);
    await bar.getByRole('button', { name: 'Unpack', exact: true }).click();
    await expect(toast(page, /^Unpacked MIMIR TAPE\.prg: \d+ bytes at \$0801-\$37ff$/)).toBeVisible({ timeout: 60_000 });
    const done = page.locator('.unpack-bar');
    await done.getByText('Layer report').click();
    await expect(done.locator('.unpack-log')).toContainText(/Tape: datasette: the tape stood after the file \([\d.]+ s\), played [\d.]+ s/);
    await expectFiles(page, ['MIMIR TAPE-unpacked.prg', 'MIMIR TAPE-header.prg']);
  });

  await test.step('ejecting the tape takes the section and the tab away', async () => {
    await page.getByRole('button', { name: 'Eject tape' }).click();
    await expect(files).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^Tape/ })).toHaveCount(0);
  });
});

test('a T64 in the datasette: its directory in the Explorer and the Tape tab, Save files…, Build & Run writing it again and Sindri reading it', async ({ app, page, workDir }) => {
  // fixtures/t64/mimir-demo.t64 (packages/core/test/t64.test.ts): a boot file at $0801 whose LOAD from the tape loads
  // the raster demo and starts it, the demo, and a sine table whose directory entry ends at $c3c6. VICE is not
  // started: a Windows program stands in for it
  const standIn = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe');
  const demo = readFileSync(join(repoDir, 'fixtures/prg/raster-demo.prg'));
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/t64/mimir-demo.t64')] });
  await fromFileMenu(page, 'Insert tape image (TAP, T64)…');
  await expect(toast(page, 'Inserted mimir-demo.t64 (a T64, "MIMIR T64"): 3 files')).toBeVisible();
  const files = page.getByRole('list', { name: 'Files on mimir-demo.t64' });

  await test.step('the Explorer lists its directory, each file by its entry', async () => {
    await expect(page.getByRole('region', { name: 'Tape' }).locator('.sec-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(files.getByRole('listitem')).toHaveText([/^1\s*"MIMIR BOOT"\s*PRG/, /^2\s*"MIMIR DEMO"\s*PRG/, /^3\s*"MIMIR SINE"\s*PRG/]);
    await expect(files.getByRole('listitem').nth(2)).toHaveAttribute('title', /the directory's end \$c3c6 is wrong .*Open MIMIR SINE \(T64, \$4000-\$41ff\)/);
    await expect(page.locator('.side-inner')).toContainText('3 files · T64 "MIMIR T64" · in the datasette on Build & Run');
  });

  await test.step('the Tape tab: the directory, a row a file', async () => {
    await page.getByRole('tab', { name: /^Tape/ }).click();
    const table = page.getByRole('table', { name: 'Tape files' });
    await expect(page.locator('.xref-head').first()).toContainText('mimir-demo.t64 (a T64 "MIMIR T64", version $0101, C64S tape image file): 3 files');
    await expect(table.locator('thead th').first()).toHaveText('Entry');
    await expect(table.locator('tbody tr td:nth-child(1)')).toHaveText(['1', '2', '3']);
    await expect(table.locator('tbody tr td:nth-child(3)')).toHaveText(['T64 PRG', 'T64 PRG', 'T64 PRG']);
    await expect(table.locator('tbody tr td:nth-child(4)')).toHaveText(['"MIMIR BOOT"', '"MIMIR DEMO"', '"MIMIR SINE"']);
    await expect(table.locator('tbody tr td:nth-child(5)')).toHaveText([/^\$0801–\$08[0-9a-f]{2}$/, '$0801–$37ff', '$4000–$41ff']);
    await expect(table.locator('tbody tr').nth(2).locator('td').nth(6)).toContainText('the directory\'s end $c3c6 is wrong');
  });

  await test.step('Save files… saves every file as a PRG', async () => {
    const out = join(workDir, 't64-files');
    mkdirSync(out, { recursive: true });
    await stubDialogs(app, { open: [out] });
    await page.getByRole('button', { name: 'Save files…' }).click();
    await expect(toast(page, /^Saved 3 files of mimir-demo\.t64 to /)).toBeVisible();
    expect(readdirSync(out).sort()).toEqual(['MIMIR BOOT.prg', 'MIMIR DEMO.prg', 'MIMIR SINE.prg']);
    expect(readFileSync(join(out, 'MIMIR DEMO.prg'))).toEqual(demo);
  });

  await test.step('Build & Run: VICE autostarts a T64 of the built boot file and the files after it', async () => {
    await openSection(page, 'Tape');
    await files.getByRole('listitem').filter({ hasText: 'MIMIR BOOT' }).click();
    await expect(toast(page, 'Loaded MIMIR BOOT.prg at $0801')).toBeVisible();
    await expectFiles(page, ['MIMIR BOOT.prg']);
    test.skip(!existsSync(standIn), 'needs where.exe');
    await page.evaluate(v => (window as unknown as { kr: { setSettings(p: object): Promise<unknown> } }).kr.setSettings({ vicePath: v }), standIn);
    await page.keyboard.press('F5');
    await expect(toast(page, /^VICE autostarts .+\.t64: the built .+ as its first file, then the files of mimir-demo\.t64 after "MIMIR BOOT"$/)).toBeVisible({ timeout: 120_000 });
    await page.getByRole('tab', { name: 'Build output' }).click();
    const log = await page.locator('.build-log').innerText();
    const started = /> VICE started \(pid -?\d+\): (.+?\.t64) autostarted/.exec(log);
    expect(started, log.slice(-600)).toBeTruthy();
    const t64 = readFileSync(started![1]);
    expect(t64.subarray(0, 20).toString('latin1')).toBe('C64S tape image file');
    // three entries, the demo's bytes as they were, the sine table's end set right ($4200)
    expect(t64.readUInt16LE(0x24)).toBe(3);
    expect(t64.indexOf(demo.subarray(2))).toBeGreaterThan(0);
    expect(t64.readUInt16LE(0x40 + 2 * 32 + 4)).toBe(0x4200);
  });

  await test.step('Sindri runs the boot file with the T64 in its datasette: LOAD from the tape loads the demo, which Unpack takes', async () => {
    const bar = page.locator('.pack-bar');
    await expect(bar).toContainText('MIMIR BOOT.prg is packed.', { timeout: 60_000 });
    await expect(bar).toContainText(/the program starts at \$0810/);
    await bar.getByRole('button', { name: 'Unpack', exact: true }).click();
    await expect(toast(page, /^Unpacked MIMIR BOOT\.prg: \d+ bytes at \$[0-9a-f]{4}-\$37ff$/)).toBeVisible({ timeout: 60_000 });
    const done = page.locator('.unpack-bar');
    await done.getByText('Layer report').click();
    await expect(done.locator('.unpack-log')).toContainText('Tape: datasette: a T64 of 3 files, the tape stood after the file (before file 2), now before file 3');
  });

  await test.step('ejecting the tape takes the section and the tab away', async () => {
    await page.getByRole('button', { name: 'Eject tape' }).click();
    await expect(files).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^Tape/ })).toHaveCount(0);
  });
});

test('a mounted BoozeLoader disk: its files in the Booze script tab, unpacked, and the script of the program that loads them', async ({ app, page }) => {
  // fixtures/d64/booze-demo.d64 (packages/core/test/booze-disk.test.ts): a boot program whose code loads files 0-2 by
  // number, the raster demo packed with ByteBoozer 2, a table that is not packed, and a file packed in place
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/d64/booze-demo.d64')] });
  await fromFileMenu(page, 'Mount disk image (D64, G64)…');
  await expect(toast(page, 'Mounted booze-demo.d64: "BOOZE DEMO", 1 file, a BoozeLoader disk with 3 files of its own')).toBeVisible();
  await openSection(page, 'Disk');
  await expect(page.locator('.disk-spindle')).toContainText('BoozeLoader disk: 3 files the loader reads, not in the directory');
  const files = page.getByRole('table', { name: 'BoozeLoader files' }), script = page.getByRole('table', { name: 'BoozeLoader script' });

  await test.step('the Explorer opens the tab, a row per file by its number', async () => {
    await page.locator('.disk-spindle').getByRole('button', { name: 'Booze script' }).click();
    await expect(page.getByRole('tab', { name: /Booze script/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /Booze script/ })).toContainText('3');
    await expect(page.locator('.spindle-head').first()).toContainText('Files of booze-demo.d64 (BoozeLoader, side 1, packed with ByteBoozer 2): 3 files, 2 unpacked');
    await expect(files.locator('tbody tr td:nth-child(1)')).toHaveText(['$00', '$01', '$02']);
    await expect(files.locator('tbody tr td:nth-child(5)')).toHaveText(['file00_0801.prg', 'file01_4000.prg', 'file02_4c18.prg']);
    await expect(files.locator('tbody tr td:nth-child(3)')).toHaveText(['$0801–$37ff', '—', '$4c18–$4fff']);
    await expect(files.locator('tbody tr').nth(1).locator('td').nth(5)).toHaveText('not packed · from 3/5, 2 sectors');
    await expect(script).toHaveCount(0);
  });

  await test.step('a row opens its file unpacked, as a PRG where it unpacks to', async () => {
    await files.getByRole('row', { name: /file00_0801/ }).click();
    await expect(toast(page, 'Loaded file00_0801.prg at $0801')).toBeVisible();
    // the raster demo, as it was before it was packed
    await expect(listing(page).locator('.row', { hasText: 'BasicUpstart2(start)' }).first()).toBeVisible();
  });

  await test.step('the boot program\'s code is its script: its loads, with what each file unpacks to on the disk', async () => {
    await page.getByRole('list', { name: 'Files on booze-demo.d64' }).getByRole('listitem').filter({ hasText: 'BOOT' }).click();
    await expect(toast(page, 'Loaded BOOT.prg at $0801')).toBeVisible();
    await expect(page.getByRole('tab', { name: /Booze script/ })).toContainText('6');
    await expect(page.locator('.spindle-head').nth(1)).toContainText('BoozeLoader script: 3 loads from the code that calls the loader at $082a');
    await expect(script.locator('tbody tr td:nth-child(2)')).toHaveText(['side 1', 'load $00', 'call $1000', 'load $01', 'load $02', 'call $2000 x=$05']);
    await expect(script.locator('tbody tr').nth(1).locator('td').nth(2)).toHaveText('file00_0801.prg → $0801–$37ff');
    await expect(script.locator('tbody tr').nth(2).locator('td').nth(2)).toHaveText('—');
    // the Loaders section knows it
    await openSection(page, 'Loaders');
    await expect(page.locator('.loader-name').first()).toHaveText('BoozeLoader (HCL/Booze Design)');
  });

  await test.step('it copies the script, each load with its file', async () => {
    await page.getByRole('button', { name: 'Copy script' }).click();
    await expect(toast(page, 'Copied the BoozeLoader script')).toBeVisible();
    const text = (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n').split('\n');
    expect(text[0]).toBe('; BoozeLoader script, read back by Mimir Studio from the code that calls the loader at $082a: 3 loads.');
    expect(text).toContain('  load $00                   ; $0812, file00_0801.prg, unpacks to $0801-$37ff');
    expect(text).toContain('  load $01                   ; $081a, file01_4000.prg');
  });

  await test.step('a row of the script goes to its code; a load\'s file opens from its row', async () => {
    await script.getByRole('row', { name: /call \$2000/ }).click();
    await expect(statusBar(page)).toContainText('$0824');
    await script.getByRole('button', { name: 'Open file02_4c18.prg' }).click();
    await expect(toast(page, 'Loaded file02_4c18.prg at $4c18')).toBeVisible();
  });

  await test.step('ejecting the disk takes its files away; the program\'s script stays', async () => {
    await page.getByRole('list', { name: 'Files on booze-demo.d64' }).getByRole('listitem').filter({ hasText: 'BOOT' }).click();
    await expectFiles(page, ['BOOT.prg']);
    await page.getByRole('button', { name: 'Eject disk' }).click();
    await expect(files).toHaveCount(0);
    await expect(script.locator('tbody tr td:nth-child(3)')).toHaveText(['—', '—', '—', '—', '—', '—']);
    await expect(page.getByRole('tab', { name: /Booze script/ })).toContainText('3');
  });
});

test('a mounted Sparkle disk: its bundles in the Sparkle script tab, their files open, the loader script copied and saved', async ({ workDir, app, page }) => {
  // fixtures/d64/sparkle-demo.d64 (packages/core/test/sparkle-disk.test.ts): Memento Mori's layout with the raster demo as
  // the first bundle, a bundle with a file under the I/O area, and a small one in the block where that one ends
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/d64/sparkle-demo.d64')] });
  await fromFileMenu(page, 'Mount disk image (D64, G64)…');
  await expect(toast(page, 'Mounted sparkle-demo.d64: "SPARKLE DEMO", 1 file, a Sparkle disk with 3 bundles of files (side 1)')).toBeVisible();
  await openSection(page, 'Disk');
  await expect(page.locator('.disk-spindle')).toContainText('Sparkle disk: 3 bundles of files the loader reads, not in the directory');
  const bundles = page.getByRole('table', { name: 'Sparkle bundles' });

  await test.step('the Explorer opens the tab, a row per file of each bundle', async () => {
    await page.locator('.disk-spindle').getByRole('button', { name: 'Sparkle script' }).click();
    await expect(page.getByRole('tab', { name: /Sparkle script/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /Sparkle script/ })).toContainText('3');
    await expect(page.locator('.spindle-head').first()).toContainText('Bundles of sparkle-demo.d64 (Sparkle, side 1): 3 bundles, 4 files');
    await expect(page.locator('.spindle-head').first()).toContainText('a part loads the next bundle with jsr $01f9, or picks one by its number first (lda #number / jsr $0160');
    await expect(bundles.locator('tbody tr td:nth-child(1)')).toHaveText(['$00', '$01', '', '$02']);
    await expect(bundles.locator('tbody tr td:nth-child(2)')).toHaveText(['$0801–$37ff', '$3000–$34af', '$d000–$d1f3', '$0400–$0427']);
    await expect(bundles.locator('tbody tr td:nth-child(4)')).toHaveText(['bundle00_0801.prg', 'bundle01_3000.prg', 'bundle01_d000.prg', 'bundle02_0400.prg']);
    await expect(bundles.locator('tbody tr td:nth-child(5)')).toHaveText([/^from 1\/0, \d+ blocks · the boot program goes to \$0810 after it$/, /^from 1\/\d+, \d+ blocks?$/, 'under the I/O area', /^from 1\/\d+, in the block before it$/]);
  });

  await test.step('a row opens its file as a PRG at its address; + adds one', async () => {
    await bundles.getByRole('row', { name: /bundle00_0801/ }).click();
    await expect(toast(page, 'Loaded bundle00_0801.prg at $0801')).toBeVisible();
    // the raster demo, as it was before it was packed into the bundle
    await expect(listing(page).locator('.row', { hasText: 'BasicUpstart2(start)' }).first()).toBeVisible();
    await bundles.getByRole('button', { name: 'Add bundle01_3000.prg to this project' }).click();
    await expectFiles(page, ['bundle00_0801.prg', 'bundle01_3000.prg']);
  });

  await test.step('Graphics opens at the start of the file opened last, in every view; one opened while it is open goes there at once', async () => {
    const view = page.getByLabel('Memory as graphics'), scroller = view.locator('.gfxv-scroll');
    // the address of the gutter row at the top of the picture
    const top = () => scroller.evaluate(el => [...el.querySelectorAll<HTMLElement>('.gfxv-row')].find(r => r.offsetTop <= el.scrollTop + 1 && r.offsetTop + r.offsetHeight > el.scrollTop + 1)?.dataset.addr ?? null);
    const mode = (name: string) => view.getByRole('button', { name, exact: true }).click();
    await page.getByRole('tab', { name: 'Graphics', exact: true }).click();
    // 40 characters of 8 bytes a row: $3000 is in the row from $2f80
    await expect.poll(top).toBe('2f80');
    // the file's first byte stays at the top, not the start of its row ($2f80 would be the screen at $2c00)
    await mode('Screens');
    await expect.poll(top).toBe('3000');
    await mode('Bitmaps');
    await expect.poll(top).toBe('2000');
    await mode('Sprites');
    await expect.poll(top).toBe('3000');
    await mode('Characters');
    await expect.poll(top).toBe('2f80');
    // with Graphics open: a file added from the script is at the top at once ($0400 is in the row from $03c0)
    await bundles.getByRole('button', { name: 'Add bundle02_0400.prg to this project' }).click();
    await expectFiles(page, ['bundle00_0801.prg', 'bundle01_3000.prg', 'bundle02_0400.prg']);
    await expect.poll(top).toBe('03c0');
    await mode('Screens');
    await expect.poll(top).toBe('0400');
    await mode('Characters');
    await page.getByRole('tab', { name: 'Listing', exact: true }).click();
  });

  await test.step('it copies the loader script: the disk\'s entries, a paragraph per bundle, * under the I/O area', async () => {
    await page.getByRole('button', { name: 'Copy script' }).click();
    await expect(toast(page, 'Copied the loader script')).toBeVisible();
    const text = (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n').split('\n');
    expect(text[0]).toBe('# Sparkle loader script, rebuilt by Mimir Studio from sparkle-demo.d64 (Sparkle): 3 bundles, 4 files.');
    expect(text).toContain('Start:\t0810');
    expect(text).toContain('IL0:\t4');
    expect(text.filter(l => l.startsWith('File:'))).toEqual(['File:\t"bundle00_0801.prg"', 'File:\t"bundle01_3000.prg"', 'File:\t"bundle01_d000.prg*"', 'File:\t"bundle02_0400.prg"']);
  });

  await test.step('Save files… saves every file as a PRG, with the loader script that loads them', async () => {
    const out = join(workDir, 'sparkle-files');
    mkdirSync(out, { recursive: true });
    await stubDialogs(app, { open: [out] });
    await page.getByRole('button', { name: 'Save files…' }).click();
    await expect(toast(page, /^Saved 4 files of sparkle-demo\.d64's bundles to .*, and sparkle-demo\.sls, the loader script that loads them$/)).toBeVisible();
    expect(readdirSync(out).sort()).toEqual(['bundle00_0801.prg', 'bundle01_3000.prg', 'bundle01_d000.prg', 'bundle02_0400.prg', 'sparkle-demo.sls']);
    expect(readFileSync(join(out, 'bundle00_0801.prg'))).toEqual(readFileSync(join(repoDir, 'fixtures/prg/raster-demo.prg')));
    expect(readFileSync(join(out, 'sparkle-demo.sls'), 'utf8').split('\r\n')).toContain('File:\t"bundle01_d000.prg*"');
  });

  await test.step('ejecting the disk takes the tab away', async () => {
    await page.getByRole('button', { name: 'Eject disk' }).click();
    await expect(page.getByRole('tab', { name: /Sparkle script/ })).toHaveCount(0);
  });
});

test("a mounted disk for Krill's loader: its files in the Krill script tab, unpacked, cc1541's command line copied and saved", async ({ workDir, app, page }) => {
  // fixtures/d64/krill-demo.d64 (packages/core/test/krill-disk.test.ts): a BASIC boot program, the raster demo packed
  // with the loader's ZX0 (with an end), a file packed in place under a dirart name, and a line of the dirart
  await waitForListing(page);
  await openSection(page, 'Files');
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/d64/krill-demo.d64')] });
  await fromFileMenu(page, 'Mount disk image (D64, G64)…');
  await expect(toast(page, 'Mounted krill-demo.d64: "KRILL DEMO", 4 files, a disk for Krill\'s loader with 2 files packed with its ZX0')).toBeVisible();
  await openSection(page, 'Disk');
  await expect(page.locator('.disk-spindle')).toContainText("Krill's loader: 2 files in the directory packed with its ZX0, loaded in the directory's order");
  const files = page.getByRole('table', { name: 'Krill files' });

  await test.step('the Explorer opens the tab, a row per file in the directory\'s order', async () => {
    await page.locator('.disk-spindle').getByRole('button', { name: 'Krill script' }).click();
    await expect(page.getByRole('tab', { name: /Krill script/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /Krill script/ })).toContainText('3');
    await expect(page.locator('.spindle-head').first()).toContainText("Files of krill-demo.d64 (Krill's loader, its ZX0): 3 files, 2 unpacked");
    await expect(page.locator('.spindle-head').first()).toContainText('a part loads a file by its name, or the next file in the directory with an empty name');
    await expect(files.locator('tbody tr td:nth-child(1)')).toHaveText(['$00', '$01', '$02']);
    await expect(files.locator('tbody tr td:nth-child(2)')).toHaveText(['"KRILL DEMO"', '"----------------"', '"mn·· Aa#"@[]"']);
    await expect(files.locator('tbody tr td:nth-child(3)')).toHaveText(['$0801–$080d', '$597b–$5fff', '$cdc2–$cfff']);
    await expect(files.locator('tbody tr td:nth-child(4)')).toHaveText(['—', '$0801–$37ff', '$c830–$cfff']);
    await expect(files.locator('tbody tr td:nth-child(6)')).toHaveText(['file00_0801.prg', 'file01_0801.zx0', 'file02_c830.zx0']);
    await expect(files.locator('tbody tr td:nth-child(7)')).toHaveText([
      'a BASIC program: loaded with LOAD and RUN · from 1/0 · the directory shows 0 blocks (1)', 'packed with its ZX0, with an end · from 1/1 · the directory shows 0 blocks (7)', 'packed with its ZX0, in place · from 1/8 · the directory shows 0 blocks (3)',
    ]);
  });

  await test.step('a row opens its file unpacked, as a PRG at where it unpacks to; + adds one', async () => {
    await files.getByRole('row', { name: /file01_0801/ }).click();
    await expect(toast(page, 'Loaded file01_0801.prg at $0801')).toBeVisible();
    // the raster demo, as it was before it was packed
    await expect(listing(page).locator('.row', { hasText: 'BasicUpstart2(start)' }).first()).toBeVisible();
    await files.getByRole('button', { name: 'Add file02_c830.zx0 to this project' }).click();
    await expectFiles(page, ['file01_0801.prg', 'file02_c830.prg']);
  });

  await test.step("it copies cc1541's command line: the directory in order, with its names, blocks and dirart line", async () => {
    await page.getByRole('button', { name: 'Copy script' }).click();
    await expect(toast(page, 'Copied the cc1541 command line')).toBeVisible();
    const text = (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n').split('\n');
    expect(text[0]).toBe("# cc1541 command line, rebuilt by Mimir Studio from krill-demo.d64 (Krill's loader, its ZX0): 3 files, 2 of them packed.");
    expect(text.slice(text.indexOf(''))).toEqual(['', 'cc1541 -n "krill demo" -i "24#a02a" -S 1 \\', '  -f "krill demo" -B 0 -w file00_0801.prg \\', '  -f "----------------" -B 0 -w file01_0801.zx0 \\',
      '  -f "#6d#6e#bb#9f a#c1#23#22#40#5b#5d" -B 0 -w file02_c830.zx0 \\', '  -T DEL -f "#60#60#60#60" -L \\', '  krill-demo.d64']);
  });

  await test.step('Save files… saves every file as it is on the disk and unpacked, with the command line', async () => {
    const out = join(workDir, 'krill-files');
    mkdirSync(out, { recursive: true });
    await stubDialogs(app, { open: [out] });
    await page.getByRole('button', { name: 'Save files…' }).click();
    await expect(toast(page, /^Saved 3 files of krill-demo\.d64 to .* \(2 of them unpacked as well\), and krill-demo-cc1541\.sh, cc1541's command line that writes the disk again$/)).toBeVisible();
    expect(readdirSync(out).sort()).toEqual(['file00_0801.prg', 'file01_0801.prg', 'file01_0801.zx0', 'file02_c830.prg', 'file02_c830.zx0', 'krill-demo-cc1541.sh']);
    expect(readFileSync(join(out, 'file01_0801.prg'))).toEqual(readFileSync(join(repoDir, 'fixtures/prg/raster-demo.prg')));
    expect([...readFileSync(join(out, 'file01_0801.zx0')).subarray(0, 4)]).toEqual([0x7b, 0x59, 0x08, 0x01]);
    expect(readFileSync(join(out, 'krill-demo-cc1541.sh'), 'utf8').split('\n')).toContain('  -f "----------------" -B 0 -w file01_0801.zx0 \\');
  });

  await test.step('ejecting the disk takes the tab away', async () => {
    await page.getByRole('button', { name: 'Eject disk' }).click();
    await expect(page.getByRole('tab', { name: /Krill script/ })).toHaveCount(0);
  });
});

test('the tab row fits a small window: the listing tools lose their labels, then move into the ⋯ menu', async ({ app, page }) => {
  await waitForListing(page);
  const row = page.locator('main.main > .tabs');
  const fits = () => row.evaluate(el => el.scrollWidth <= el.clientWidth);
  const size = (w: number) => app.evaluate(({ BrowserWindow }, width) => { BrowserWindow.getAllWindows()[0].setSize(width, 860); }, w);
  const more = page.getByRole('button', { name: 'Listing tools' });

  await test.step('the default window: every tool in the row, with its name for the screen reader and the tooltip', async () => {
    expect(await fits()).toBe(true);
    await expect(page.getByRole('button', { name: 'Cycles' })).toBeVisible();
    await expect(more).toBeHidden();
  });

  await test.step('a 1366 px laptop screen: the tools are in the ⋯ menu, every tab keeps its name', async () => {
    await size(1366);
    await expect(more).toBeVisible();
    expect(await fits()).toBe(true);
    await expect(page.getByRole('button', { name: 'Cycles' })).toBeHidden();
    await more.click();
    await page.getByRole('menuitemcheckbox', { name: 'Cycles' }).click();
    await more.click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Cycles' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('menuitemcheckbox', { name: 'Left column: address' })).toHaveAttribute('aria-checked', 'true');
    // the ⋯ button closes its menu again
    await more.click();
    await expect(page.getByRole('menu')).toBeHidden();
  });

  await test.step('every width between: the row fits, nothing is cut off', async () => {
    for (let w = 2000; w >= 1100; w -= 20) {
      await size(w);
      await expect.poll(fits, { message: `a ${w} px window` }).toBe(true);
    }
  });

  await test.step('narrower: the other tabs show only their icons and still open by name', async () => {
    await size(1100);
    expect(await fits()).toBe(true);
    await page.getByRole('tab', { name: 'Graphics' }).click();
    await expect(page.getByRole('tab', { name: 'Graphics' })).toHaveAttribute('aria-selected', 'true');
  });
});

test('the Raster IRQs panel lists every IRQ handler with its $d012 and $d011 and goes to it', async ({ page }) => {
  await waitForListing(page);
  await page.getByRole('tab', { name: /Raster IRQs/ }).click();
  const table = page.getByRole('table', { name: 'Raster IRQs' });
  await expect(page.locator('.raster .xref-head')).toContainText('1 raster interrupt, 1 handler');
  const row = table.locator('tbody tr').first();
  await expect(row.locator('td')).toHaveText(['98 ($062)', '$62', '$1b', 'irq_08b7', '$0836', 'main code via $0314']);
  await row.getByRole('button', { name: 'irq_08b7' }).click();
  await expect(statusBar(page)).toContainText('$08b7 · irq_08b7');
  await row.getByRole('button', { name: '$0836' }).click();
  await expect(statusBar(page)).toContainText('$0836');
});

test('the inspector writes a table in binary or decimal and words as numbers, several a row', async ({ page }) => {
  await waitForListing(page);
  const format = page.getByRole('group', { name: 'Number format' });
  await goTo(page, 'colors_0939');
  await expect(format.getByRole('button', { name: 'Hex' })).toHaveAttribute('aria-pressed', 'true');

  await test.step('a table: binary, then 4 bytes a row', async () => {
    await format.getByRole('button', { name: 'Bin' }).click();
    await expect(format.getByRole('button', { name: 'Bin' })).toHaveAttribute('aria-pressed', 'true');
    expect(rowAt(await listingRows(page), '0939')?.text).toMatch(/^\.byte %00000110, %00001110, %00000011/);
    await page.getByLabel('Bytes per row').fill('4');
    await page.getByLabel('Bytes per row').press('Enter');
    expect(rowAt(await listingRows(page), '0939')?.text).toBe('.byte %00000110, %00001110, %00000011, %00000001');
    expect(rowAt(await listingRows(page), '093d')?.text).toMatch(/^\.byte %00000011/);
  });

  await test.step('the same bytes as words: addresses by default, then decimal, 4 a row; F7 verifies', async () => {
    await listing(page).focus();
    await page.keyboard.press('w');
    await expect(format.getByRole('button', { name: 'Addr' })).toHaveAttribute('aria-pressed', 'true');
    expect(rowAt(await listingRows(page), '0939')?.text).toBe('.word $0e06');
    await format.getByRole('button', { name: 'Dec' }).click();
    await page.getByLabel('Words per row').fill('4');
    await page.getByLabel('Words per row').press('Enter');
    expect(rowAt(await listingRows(page), '0939')?.text).toBe('.word 3590, 259, 3587, 6');
    await listing(page).focus();
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
    // Ctrl+Z goes back to addresses
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(rowAt(await listingRows(page), '0939')?.text).toBe('.word $0e06');
  });
});

test('the Memory tab finds text as PETSCII and as screen codes, and bytes, and steps through the hits', async ({ page }) => {
  await waitForListing(page);
  await page.getByRole('tab', { name: 'Memory' }).click();
  const q = page.getByLabel('Find in memory'), status = page.getByLabel('Find result');
  const bar = page.getByLabel('Memory as the VICE monitor shows it').locator('.gfxv-sel');

  await test.step('text: the title in PETSCII and the greeting in screen codes, Enter and Shift+Enter step', async () => {
    await q.fill('mimir');
    await expect(status).toHaveText('2 matches');
    await q.press('Enter');
    await expect(status).toHaveText('1 of 2 matches · PETSCII');
    await expect(bar).toContainText('$0949–$094d');
    await q.press('Enter');
    await expect(status).toHaveText('2 of 2 matches · screen codes');
    await expect(bar).toContainText('$0994–$0998');
    await q.press('Shift+Enter');
    await expect(status).toHaveText('1 of 2 matches · PETSCII');
    await expect(page.locator('.mon-b.hit, .mon-b.hit-cur')).toHaveCount(10);
  });

  await test.step('bytes: hex pairs with ?? for any byte, and an error for what is no byte', async () => {
    await page.getByRole('group', { name: 'Find as' }).getByRole('button', { name: 'Bytes' }).click();
    await q.fill('8d ?? d0');
    await expect(status).toContainText('matches');
    await page.getByRole('button', { name: 'Next match' }).click();
    await expect(status).toContainText('1 of');
    await q.fill('8d 2');
    await expect(status).toContainText('is not a byte');
    await expect(q).toHaveClass(/bad/);
    await q.press('Escape');
    await expect(q).toHaveValue('');
  });
});

test('the Memory tab selects from the start of a text to the 0 that ends it, with 0 or the button', async ({ page }) => {
  await waitForListing(page);
  await page.getByRole('tab', { name: 'Memory' }).click();
  const view = page.getByLabel('Memory as the VICE monitor shows it'), bar = view.locator('.gfxv-sel[role="status"]');
  const byte = (a: number) => view.locator(`.mon-b[data-a="${a}"]`);
  const go = async (cmd: string) => { const c = page.getByLabel('Monitor command'); await c.fill(cmd); await c.press('Enter'); };
  const toZero = view.getByRole('button', { name: /Select to the next 0/ });

  await test.step('0 on the first letter of the title selects it to its 0, and again the next text too', async () => {
    await go('m 0949');
    await byte(0x0949).click();
    await expect(toZero).toBeVisible();
    await page.keyboard.press('0');
    await expect(bar).toContainText('$0949–$095f (23 bytes)');
    await expect(view.locator('.gfxv-info')).toContainText('$095f = $00');
    await page.keyboard.press('0');
    await expect(bar).toContainText('$0949–$0984 (60 bytes)');
  });

  await test.step('the button does the same from the cursor', async () => {
    await byte(0x0960).click();
    await toZero.click();
    await expect(bar).toContainText('$0960–$0984 (37 bytes)');
    await expect(page.getByLabel('Memory dump')).toBeFocused();
  });

  await test.step('no 0 before the loaded bytes end: it says so, and the cursor stays', async () => {
    await go('m 37f0');
    await byte(0x37fe).click();
    await page.keyboard.press('0');
    await expect(view.getByRole('alert')).toHaveText('No 0 byte from $37fe on before the loaded bytes end.');
    await expect(view.locator('.gfxv-info')).toContainText('$37fe = $81');
    await page.keyboard.press('ArrowLeft');
    await expect(view.getByRole('alert')).toHaveCount(0);
  });

  await test.step('Mark as Text makes the selection one text block, the 0 in it', async () => {
    await go('m 0949');
    await byte(0x0949).click();
    await page.keyboard.press('0');
    await page.keyboard.press('0');
    await view.getByRole('button', { name: /^Mark as Text\s*Enter$/ }).click();
    await page.getByRole('tab', { name: 'Listing' }).click();
    await goTo(page, '$0949');
    await expect(headerRow(page, '0949')).toContainText('$0949-$0984');
  });
});

test('patch: new code over the selected lines, marked as patched, saved as a PRG, exported, removed', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  const dialog = page.getByRole('dialog');
  const code = dialog.locator('#patch-code');
  const patchedRow = (adr: string) => listing(page).locator('.row.patched', { has: page.locator('.adr', { hasText: adr }) });

  await test.step('P on a selection opens the patch dialog with the lines\' code', async () => {
    // fx_091e: lda SID_OSC3 / and #$0f / sta COLOR_RAM+999 (8 bytes), then rts
    await goTo(page, 'fx_091e');
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowDown');
    await expect(statusBar(page)).toContainText('sel $091e–$0925 (8 B)');
    await page.keyboard.press('p');
    await expect(dialog).toHaveAccessibleName('Patch $091e–$0925');
    await expect(code).toHaveValue(/^fx_091e:\n\s*lda SID_OSC3 .*\n\s*and #\$0f\n\s*sta COLOR_RAM\+24\*40\+39 /);
    await expect(dialog.getByRole('status')).toContainText('8 of 8 bytes');
    // each line's address and bytes beside it, as in an assembler listing
    await expect(dialog.locator('.pe-gl')).toHaveText([/^091e$/, /^091e\s*ad 1b d4$/, /^0921\s*29 0f$/, /^0923\s*8d e7 db$/]);
  });

  await test.step('the cursor starts on the first instruction; Tab goes to the next, Shift+Tab back, Enter keeps the indent', async () => {
    const caret = () => code.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionStart + 3));
    await expect(code).toBeFocused();
    expect(await caret()).toBe('lda');
    await expect(dialog.locator('.pe-gl.cur')).toHaveText(/^091e\s*ad 1b d4$/);
    await page.keyboard.press('Tab');
    expect(await caret()).toBe('and');
    await page.keyboard.press('Tab');
    expect(await caret()).toBe('sta');
    await page.keyboard.press('Tab');
    expect(await caret()).toBe('lda');
    await page.keyboard.press('Shift+Tab');
    expect(await caret()).toBe('sta');
    await expect(code).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('nop');
    await expect(code).toHaveValue(/\n        nop$/);
    // one byte too many: the line past the range is marked
    await expect(dialog.locator('.pe-gl').last()).toHaveText(/^0926\s*ea$/);
    await expect(dialog.locator('.pe-gl.past')).toHaveCount(1);
  });

  await test.step('writing over an original instruction moves it to the Original column, out of the code', async () => {
    const original = dialog.getByLabel('Original instructions written over');
    await expect(original).toHaveCount(0);
    // Tab from the new last line goes round to the first instruction: typing there writes over all of `lda SID_OSC3`
    await page.keyboard.press('Tab');
    await page.keyboard.type('lda #$02');
    await expect(original.locator('.pe-wl')).toHaveText(['', 'lda SID_OSC3', '', '', '']);
    // editing inside a line changes just that, and the original moves over too
    await page.keyboard.press('Tab');
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('1');
    await expect(code).toHaveValue(/^fx_091e:\n        lda #\$02\n        and #\$01\n        sta COLOR_RAM\+24\*40\+39 .*\n        nop$/);
    await expect(original.locator('.pe-wl')).toHaveText(['', 'lda SID_OSC3', 'and #$0f', '', '']);
    await expect(dialog.locator('.pe-gl').nth(1)).toHaveText(/^091e\s*a9 02$/);
    await expect(dialog.getByRole('status').first()).toContainText('8 of 8 bytes');
  });

  await test.step('keeping the cycle count: the cycles of each line, how many are left at the bottom, fixed times only', async () => {
    // the original: lda SID_OSC3 (4) / and #$0f (2) / sta COLOR_RAM+999 (4) = 10 cycles
    const bar = dialog.getByRole('status', { name: 'Cycles' });
    await expect(bar).toHaveCount(0);
    await dialog.locator('#patch-cycles').check();
    // lda #$02 (2) / and #$01 (2) / sta (4) / nop (2): the same
    await expect(bar).toContainText('Cycles 10 of 10');
    await expect(bar).toContainText('the same as the original');
    await expect(dialog.locator('.pe-gl .pe-cy')).toHaveText(['', '2', '2', '4', '2']);
    await expect(dialog.getByRole('button', { name: 'Apply patch' })).toBeEnabled();
    // 2 + 4, and 3 NOPs of fill
    await code.fill('  lda #$02\n  sta $d020');
    await expect(bar).toContainText('Cycles 12 of 10');
    await expect(bar).toContainText('2 too many');
    await expect(dialog.getByRole('alert')).toHaveText('The patch takes 12 cycles, 2 more than the 10 of the original.');
    await code.fill('  lda #0\n  lda #0\n  lda #0\n  lda #0');
    await expect(bar).toContainText('2 left to use');
    // a branch takes 2 or 3
    await code.fill('  bne *+2\n  sta $d020\n  lda #0');
    await expect(dialog.locator('.pe-gl .pe-cy.varies')).toHaveText(['2/3']);
    await expect(dialog.getByRole('alert')).toHaveText(/^Line 1: bne \*\+2 takes 2 or 3 cycles \(a branch, not taken or taken\), and the original has none\./);
    await expect(dialog.getByRole('button', { name: 'Apply patch' })).toBeDisabled();
    await dialog.locator('#patch-cycles').uncheck();
    await expect(bar).toHaveCount(0);
  });

  await test.step('longer code needs "Overwrite past the range"; shorter code is filled with NOPs', async () => {
    await code.fill('  lda #$02\n  sta $d020\n  sta $d021\n  nop');
    await expect(dialog.getByRole('alert')).toHaveText('The code is 9 bytes, 1 more than the 8 of the original. Tick "Overwrite past the range" to write over the bytes after it.');
    await expect(dialog.getByRole('button', { name: 'Apply patch' })).toBeDisabled();
    await dialog.locator('#patch-over').check();
    await expect(dialog.getByRole('status')).toContainText('9 of 8 bytes; 1 byte past the range, over $0926.');
    await dialog.locator('#patch-over').uncheck();
    await code.fill('  lda #$02\n  sta $d020');
    await expect(dialog.getByRole('status')).toContainText('5 of 8 bytes; the other 3 become NOP ($ea).');
    await expect(dialog.getByRole('status')).toContainText('a9 02 8d 20 d0 ea ea ea');
    await dialog.locator('#patch-name').fill('red border');
    await dialog.getByRole('button', { name: 'Apply patch' }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page, 'Patch "red border" written over $091e–$0925 (8 bytes)')).toBeVisible();
  });

  await test.step('the listing marks the patched bytes, the Explorer lists the patch, F7 verifies', async () => {
    const rows = await listingRows(page);
    expect(rowAt(rows, '091e')?.text).toMatch(/^lda #\$02/);
    expect(rowAt(rows, '0923')?.text).toBe('nop');
    expect(rows.some(r => r.text === '// ==== patch "red border": $091e-$0925, 8 bytes written over the original ====')).toBe(true);
    await expect(patchedRow('091e')).toContainText('patch red border');
    await expect(listing(page).locator('.row.patched')).toHaveCount(5);
    await openSection(page, 'Patches');
    const list = page.getByRole('list', { name: 'Patches' });
    await expect(list.getByRole('listitem')).toHaveText([/red border\s*\$091e–\$0925$/]);
    await page.keyboard.press('F7');
    await expect(statusBar(page)).toContainText('✓ round-trip verified', { timeout: 90_000 });
  });

  await test.step('P on a patched line edits the patch', async () => {
    await goTo(page, '$091e');
    await page.keyboard.press('p');
    await expect(dialog).toHaveAccessibleName('Edit patch "red border"');
    await expect(code).toHaveValue('  lda #$02\n  sta $d020');
    await code.fill('  inc $d020');
    await dialog.getByRole('button', { name: 'Save patch' }).click();
    await expect(dialog).toBeHidden();
    expect(rowAt(await listingRows(page), '091e')?.text).toMatch(/^inc /);
    await expect(listing(page).locator('.row.patched')).toHaveCount(6);
  });

  await test.step('the switch in the Explorer turns the patch off (the original bytes) and on again', async () => {
    const sw = page.getByRole('switch', { name: 'Patch red border on' });
    const section = page.locator('.side-sec', { hasText: 'Patches' });
    await expect(sw).toBeChecked();
    await sw.uncheck();
    await expect(toast(page, 'Patch "red border" is off: $091e–$0925 has its original bytes')).toBeVisible();
    await expect(listing(page).locator('.row.patched')).toHaveCount(0);
    expect(rowAt(await listingRows(page), '091e')?.text).toMatch(/^lda SID_OSC3/);
    await expect(section.locator('.sec-sum')).toHaveText('0 of 1 on');
    await sw.check();
    await expect(listing(page).locator('.row.patched')).toHaveCount(6);
    expect(rowAt(await listingRows(page), '091e')?.text).toMatch(/^inc /);
    await expect(section.locator('.sec-sum')).toHaveText('1 on');
  });

  await test.step('saved as a PRG, and exported to patches/ as a source of its own, with the original files kept', async () => {
    const want = [0x1e, 0x09, 0xee, 0x20, 0xd0, 0xea, 0xea, 0xea, 0xea, 0xea];
    const file = join(work, 'red_border.prg');
    await stubDialogs(app, { save: file });
    await page.getByRole('button', { name: 'Save patch red border as PRG' }).click();
    await expect(toast(page, `Patch "red border" saved to ${file} (loads at $091e)`)).toBeVisible();
    expect([...readFileSync(file)]).toEqual(want);
    const out = join(work, 'export');
    await stubDialogs(app, { open: [out] });
    await page.keyboard.press('Control+e');
    await expect(toast(page, `Exported verified Kick Assembler project to ${out}`)).toBeVisible({ timeout: 90_000 });
    expect(readdirSync(join(out, 'patches'))).toEqual(['red_border.asm']);
    expect(readFileSync(join(out, 'patches', 'red_border.asm'), 'utf8')).toContain('.pc = $091e "red border"\n  inc $d020\n  .fill 5, $ea');
    expect(readFileSync(join(out, 'original', 'raster-demo.prg'))).toEqual(readFileSync(join(repoDir, 'fixtures/prg/raster-demo.prg')));
    expect(readFileSync(join(out, 'raster-demo.asm'), 'utf8')).toContain('// ==== patch "red border": $091e-$0925, 8 bytes written over the original ====');
    expect(readFileSync(join(out, 'README.md'), 'utf8')).toContain('`patches/red_border.asm`');
  });

  await test.step('removed from the Explorer: the original bytes are back; Ctrl+Z brings the patch back', async () => {
    await page.getByRole('button', { name: 'Remove patch red border' }).click();
    await expect(toast(page, 'Patch "red border" removed: $091e–$0925 has its bytes back')).toBeVisible();
    expect(rowAt(await listingRows(page), '091e')?.text).toMatch(/^lda SID_OSC3/);
    await expect(listing(page).locator('.row.patched')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Patches' })).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(listing(page).locator('.row.patched')).toHaveCount(6);
  });
});

test('patch with the cycle count kept, where the original has a branch: the code must have the same branch', async ({ page }) => {
  await waitForListing(page);
  const dialog = page.getByRole('dialog');
  const bar = dialog.getByRole('status', { name: 'Cycles' });
  // the first `inx` / `bne` loop of the program (it colours the screen)
  const rows = await listingRows(page);
  const i = rows.findIndex((r, k) => /^inx\b/.test(r.text) && /^bne\b/.test(rows[k + 1]?.text ?? ''));
  expect(i).toBeGreaterThan(0);
  const from = parseInt(rows[i].adr, 16);
  await goTo(page, `$${from.toString(16)}-$${(from + 2).toString(16)}`);
  await page.keyboard.press('p');
  await expect(dialog).toHaveAccessibleName(/^Patch \$/);
  await dialog.locator('#patch-cycles').check();
  await expect(bar).toContainText('the same as the original');
  await expect(bar).toContainText(/varies as the original: bne \(2\/[34]\)/);
  // back in the code (the cursor is still on the first instruction): inx written over with iny, the branch is still there
  await dialog.locator('#patch-code').focus();
  await page.keyboard.type('iny');
  await expect(dialog.locator('#patch-code')).toHaveValue(/^\s*iny\n\s*bne /);
  await expect(bar).toContainText('the same as the original');
  await expect(dialog.getByRole('button', { name: 'Apply patch' })).toBeEnabled();
  // the branch written over with a nop: it is missing
  await page.keyboard.press('Tab');
  await page.keyboard.type('nop');
  await expect(dialog.locator('#patch-code')).toHaveValue(/^\s*iny\n\s*nop$/);
  await expect(bar).toContainText(/the code needs bne \(2\/[34]\), as the original has/);
  await expect(dialog.getByRole('alert')).toHaveText(/^The original has bne \(2\/[34]\), whose time varies: keeping the cycle count, the code must have the same\. It has no bne/);
  await expect(dialog.getByRole('button', { name: 'Apply patch' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('graphics as pictures in the listing: characters to click, how many sprites follow one another, and off in Settings', async ({ page }) => {
  await waitForListing(page);

  await test.step('a charset is rows of characters by screen code; a click picks one, → the next', async () => {
    await goTo(page, 'charset_3000');
    const strip = listing(page).locator('.gfx-strip.gfx-chars').first();
    await expect(strip).toBeVisible();
    // drawn twice as big: 16 px a character, so "D" (screen code 4) is the fifth
    await strip.click({ position: { x: 4 * 16 + 8, y: 8 } });
    await expect(statusBar(page)).toContainText('sel $3020–$3027 (8 B)');
    await page.keyboard.press('ArrowRight');
    await expect(statusBar(page)).toContainText('sel $3028–$302f (8 B)');
  });

  await test.step('the header of a sprite block gives it one sprite more, with its label under the first', async () => {
    await goTo(page, 'spr_2000');
    const hdr = headerRow(page, '2000');
    await expect(hdr.locator('.hdr-sprites')).toHaveText(/1 sprite\b/);
    await hdr.getByRole('button', { name: 'One sprite more' }).click();
    await expect(hdr).toContainText('$2000-$207f (128 bytes)');
    await expect(hdr.locator('.hdr-sprites')).toContainText('2 sprites');
    await expect(listing(page).locator('.gfx-sprite .gfx-cap')).toHaveText(['spr_2000', '2040']);
    await page.keyboard.press('Control+z');
    await expect(hdr).toContainText('$2000-$203f (64 bytes)');
  });

  await test.step('Settings → General turns the pictures off: the .byte rows are back', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'General' }).click();
    await page.getByLabel(/Show graphics as pictures in the listing/).uncheck();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(listing(page).locator('.gfx-strip')).toHaveCount(0);
    await expect(listing(page).locator('.row .src', { hasText: /^\s*\.byte %[01]{8}, %[01]{8}, %[01]{8}/ }).first()).toBeVisible();
  });
});

test('scripts: Kick Assembler that runs in Mimir; what it changes goes into the program, its code does not; a scratchpad saved as a log; the library', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  const check = page.locator('.scr-check');
  const run = page.getByRole('button', { name: /^Run/ });
  const editor = page.locator('.scr-editor');
  const changes = page.getByRole('list', { name: 'Changed in the program' });
  const tag = listing(page).locator('.patch-tag', { hasText: 'script brighter' });
  /** the script's code replaced, as if pasted */
  const code = async (text: string) => {
    await editor.locator('.view-lines').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(text);
  };
  const runIt = async () => { await editor.locator('.view-lines').click(); await page.keyboard.press('Control+Enter'); await expect(page.locator('.scr-end')).toContainText('Returned'); };

  await test.step('a script from a block of the listing: its code in free memory, no scratchpad', async () => {
    await goTo(page, 'fx_091e');
    await listing(page).locator('.row.k-ins', { has: page.locator('.adr', { hasText: /^091e$/ }) }).click({ button: 'right' });
    await fromSubmenu(page, 'Program', 'New script from block (runs in Mimir on a copy of the program)');
    await expect(page.getByRole('tab', { name: 'Scripts' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', { name: 'script' })).toHaveAttribute('aria-selected', 'true');
    await expect(editor.locator('.view-lines')).toContainText('lda SID_OSC3');
    await expect(editor.locator('.view-lines')).not.toContainText('* =');
    await expect(page.getByText('None. Add one to keep data outside the program')).toBeVisible();
    // plain words: it can run, and what Run does
    await expect(check).toHaveText('Ready to run');
    await expect(page.getByRole('note')).toContainText('What it changes in the program\'s bytes goes into the program and its .asm');
  });

  await test.step('typing: no suggestion for the index register, names that start with what is typed, Enter ends the line', async () => {
    const suggest = page.locator('.suggest-widget.visible');
    await editor.locator('.view-lines').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.keyboard.type('        lda colors_0939,x');
    await expect(suggest).toHaveCount(0);
    await page.keyboard.press('Enter');
    await page.keyboard.type('sta col');
    await expect(suggest).toContainText('colors_0939');
    await expect(suggest).not.toContainText('SID_POT_X');
    await page.keyboard.press('Enter');
    await page.keyboard.type('rts');
    await expect.poll(async () => (await editor.locator('.view-lines').innerText()).replace(/ /g, ' ')).toMatch(/lda colors_0939,x\n\s*sta col\n\s*rts/);
    await expect(editor.locator('.view-lines')).not.toContainText('SID_POT_X');
  });

  await test.step('an unknown name is an error on its line, and the script cannot run', async () => {
    await code('        lda no_such_label\n        rts\n');
    await expect(check).toHaveText('Line 1: Unknown symbol "no_such_label"');
    await expect(run).toBeDisabled();
  });

  let after = '';
  await test.step('a run changes a table of the program: the change is in the program, the listing marks it', async () => {
    const name = page.getByLabel('Script name');
    await name.fill('brighter');
    await name.press('Enter');
    await code(['        ldx #3', '!:      inc colors_0939,x      // the table of the program', '        dex', '        bpl !-', '        rts'].join('\n'));
    await expect(check).toHaveText('Ready to run');
    // Mimir found the code a place the program does not use
    await expect(check).toHaveAttribute('title', /Its code: 9 bytes at \$c000-\$c008, in memory the program does not use/);
    await runIt();
    await expect(page.getByRole('note')).toHaveCount(0);
    await expect(changes.getByRole('button')).toHaveText(['$0939-$093c · 4 bytes']);
    await expect(changes.getByRole('switch')).toBeChecked();
    await changes.getByRole('button').click();
    await expect(page.locator('.scr-view-title')).toHaveText('brighter · $0939-$093c · 4 bytes');
    await expect(page.locator('.scr-view-head')).toContainText('4 differ from the original');
    after = (await page.locator('.scr-dump').textContent()) ?? '';
    await page.getByRole('button', { name: 'Show in listing' }).click();
    await expect(tag).toBeVisible();
    await expect(statusBar(page)).toContainText('sel $0939–$093c (4 B)');
  });

  await test.step('a run again starts from the program as it was: the same bytes, not one more', async () => {
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await runIt();
    await expect(changes.getByRole('button')).toHaveText(['$0939-$093c · 4 bytes']);
    await changes.getByRole('button').click();
    await expect(page.locator('.scr-dump')).toHaveText(after);
  });

  await test.step('a change switched off is left out, and stays out when the script runs again', async () => {
    await changes.getByRole('switch').uncheck();
    await runIt();
    await expect(changes.getByRole('switch')).not.toBeChecked();
    await page.getByRole('tab', { name: 'Listing' }).click();
    await goTo(page, 'colors_0939');
    await expect(tag).toHaveCount(0);
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await changes.getByRole('switch').check();
  });

  await test.step('a scratchpad keeps a log outside the program, saved as a text file', async () => {
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByLabel('Scratchpad name')).toHaveValue('pad1');
    await code(['        ldx #3', '!:      inc colors_0939,x', '        lda msg,x', '        sta pad1,x', '        dex', '        bpl !-', '        rts', 'msg:    .byte $48, $49, $21, $0d'].join('\n'));
    await runIt();
    await page.locator('.pad-row:not(.pad-head)').first().click({ position: { x: 4, y: 4 } });
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(page.locator('.scr-dump')).toContainText('HI!');
    const log = join(work, 'brighter_pad1.txt');
    await stubDialogs(app, { save: log });
    await page.getByRole('button', { name: 'Save .txt…' }).click();
    await expect(toast(page, `Saved ${log}`)).toBeVisible();
    expect(readFileSync(log, 'utf8')).toBe('HI!\n');
  });

  await test.step('the library keeps the script for every project; deleted, the script takes its change out of the program', async () => {
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(toast(page, '"brighter" saved in the library')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Library' })).toContainText('brighter');
    await page.getByRole('button', { name: 'Delete script' }).click();
    await expect(page.getByText('No scripts yet')).toBeVisible();
    await page.getByRole('tab', { name: 'Listing' }).click();
    await goTo(page, 'colors_0939');
    await expect(tag).toHaveCount(0);
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await page.getByRole('button', { name: 'Add brighter to the project' }).click();
    await expect(page.getByRole('option', { name: 'brighter' })).toHaveAttribute('aria-selected', 'true');
    await expect(editor.locator('.view-lines')).toContainText('inc colors_0939,x');
    await expect(page.getByLabel('Scratchpad name')).toHaveValue('pad1');
    await page.getByRole('button', { name: 'Remove brighter from the library' }).click();
    await expect(page.getByRole('list', { name: 'Library' })).not.toContainText('brighter');
  });
});

test('scripts: the debugger goes an instruction at a time with the registers and the stack, stops at a breakpoint, and at the end is a run', async ({ app, page }) => {
  await waitForListing(page);
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'New script' }).first().click();
  const editor = page.locator('.scr-editor');
  await editor.locator('.view-lines').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(['        ldx #1', '!:      lda colors_0939,x', '        jsr twice', '        sta colors_0939,x', '        dex', '        bpl !-', '        rts', 'twice:  asl', '        rts'].join('\n'));
  await expect(page.locator('.scr-check')).toHaveText('Ready to run');
  const panel = page.getByRole('complementary', { name: 'Debugger' });
  const where = panel.getByRole('status');
  const regs = panel.getByRole('table', { name: 'Registers' });
  const stack = panel.getByRole('table', { name: 'Stack' });

  await test.step('Debug stops before the first instruction: its line, the registers, the stack with the return of the SYS', async () => {
    await page.getByRole('button', { name: /^Debug/ }).click();
    await expect(where).toHaveText('Line 1 ($c000)');
    await expect(regs.locator('tr').first()).toContainText('$c000');
    await expect(stack).toContainText('the end of the run (the return of its SYS)');
    await expect(page.getByRole('group', { name: 'Debugging' })).toBeVisible();
    await expect(page.getByRole('note')).toContainText('the code cannot be changed until you stop');
  });

  await test.step('F8 steps: X changes and is marked, a JSR puts its return address on the stack', async () => {
    await page.keyboard.press('F8');
    await expect(where).toHaveText('Line 2 ($c002)');
    await expect(regs.locator('tr.chg', { hasText: /^X/ })).toContainText('$01');
    await page.keyboard.press('F8');
    await page.keyboard.press('F8');
    await expect(where).toHaveText('Line 8 ($c00f)');
    await expect(regs.locator('tr').first()).toContainText('twice');
    await expect(stack).toContainText('return to line 4 ($c008), from the script');
  });

  await test.step('Shift+F6 steps out of the routine, back to the line after the JSR', async () => {
    await page.keyboard.press('Shift+F6');
    await expect(where).toHaveText('Line 4 ($c008)');
    await expect(stack).not.toContainText('return to line 4');
  });

  await test.step('a click left of a line number sets a breakpoint; Continue stops there', async () => {
    const box = await editor.locator('.line-numbers', { hasText: /^5$/ }).boundingBox();
    const glyph = await editor.locator('.glyph-margin').boundingBox();
    await page.mouse.click(glyph!.x + glyph!.width / 2, box!.y + box!.height / 2);
    await expect(editor.locator('.scr-bp')).toHaveCount(1);
    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect(where).toHaveText('Line 5 ($c00b)');
    // the loop comes round to it once more
    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect(where).toHaveText('Line 5 ($c00b)');
    await expect(regs.locator('tr', { hasText: /^X/ })).toContainText('$00');
  });

  await test.step('at the end it is a run: the debugger closes and the changes are in the program', async () => {
    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator('.scr-end')).toContainText('Returned');
    await expect(page.getByRole('list', { name: 'Changed in the program' }).getByRole('button')).toHaveText(['$0939-$093a · 2 bytes']);
    // the breakpoint stays, and the code can be changed again
    await expect(editor.locator('.scr-bp')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Debug/ })).toBeEnabled();
  });
});

test('scripts in the Explorer: made, run, shown with what they changed or what is wrong, opened in the Scripts tab, deleted', async ({ app, page }) => {
  await waitForListing(page);
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  const section = page.getByRole('region', { name: 'Scripts' });
  await section.getByRole('button', { name: 'Scripts' }).click();
  const rows = section.getByRole('list', { name: 'Scripts in the project' }).getByRole('listitem');
  const editor = page.locator('.scr-editor');
  const code = async (text: string) => {
    await editor.locator('.view-lines').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(text);
  };

  await test.step('+ makes a script and opens it in the Scripts tab', async () => {
    await expect(section).toContainText('none');
    await section.getByRole('button', { name: 'New script' }).first().click();
    await expect(page.getByRole('tab', { name: 'Scripts' })).toHaveAttribute('aria-selected', 'true');
    await code(['        ldx #3', '!:      inc colors_0939,x', '        dex', '        bpl !-', '        rts'].join('\n'));
    await expect(page.locator('.scr-check')).toHaveText('Ready to run');
    await page.getByRole('tab', { name: 'Listing' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('script');
    await expect(rows.first()).toContainText('ready to run');
  });

  await test.step('Run in the Explorer: the change goes into the program, and the row says so', async () => {
    await rows.first().getByRole('button', { name: 'Run script' }).click();
    await expect(toast(page, /script: Returned .* It changed 4 bytes of the program in 1 place/)).toBeVisible();
    await expect(rows.first()).toContainText('4 bytes changed in the program');
    await expect(page.getByRole('tab', { name: 'Listing' })).toHaveAttribute('aria-selected', 'true');
  });

  await test.step('a script that does not check out says why, and cannot run from here', async () => {
    await section.getByRole('button', { name: 'New script' }).first().click();
    await code('        lda no_such_label\n        rts\n');
    await expect(page.locator('.scr-check')).toContainText('Unknown symbol');
    await page.getByRole('tab', { name: 'Listing' }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('Line 1: Unknown symbol "no_such_label"');
    await expect(rows.nth(1).getByRole('button', { name: 'Run script2' })).toBeDisabled();
  });

  await test.step('a click on a row opens it in the Scripts tab', async () => {
    await rows.first().click();
    await expect(page.getByRole('tab', { name: 'Scripts' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', { name: 'script', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Listing' }).click();
  });

  await test.step('delete takes the script and its change out of the program; Ctrl+Z brings both back', async () => {
    await rows.first().getByRole('button', { name: 'Delete script' }).click();
    await expect(toast(page, 'Script "script" deleted, and what it changed taken out of the program')).toBeVisible();
    await expect(rows).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('4 bytes changed in the program');
  });
});

test('scripts: safe mode runs without changing the program or its .asm, lists what a run would change, and writes it in when asked', async ({ app, page }) => {
  await waitForListing(page);
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'New script' }).first().click();
  const editor = page.locator('.scr-editor');
  await editor.locator('.view-lines').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(['        ldx #3', '!:      inc colors_0939,x', '        dex', '        bpl !-', '        rts'].join('\n'));
  await expect(page.locator('.scr-check')).toHaveText('Ready to run');
  const safe = page.getByRole('switch', { name: 'Safe mode' });
  const would = page.getByRole('list', { name: 'Would change in the program' });
  const changes = page.getByRole('list', { name: 'Changed in the program' });
  const tag = listing(page).locator('.patch-tag', { hasText: 'script' });
  const mark = listing(page).locator('.row .syn-comment', { hasText: 'changed by the script "script"' });
  const section = page.getByRole('region', { name: 'Scripts' });
  const row = section.getByRole('list', { name: 'Scripts in the project' }).getByRole('listitem').first();
  const runIt = async () => { await editor.locator('.view-lines').click(); await page.keyboard.press('Control+Enter'); };
  const inListing = async () => { await page.getByRole('tab', { name: 'Listing' }).click(); await goTo(page, 'colors_0939'); };

  await test.step('safe mode switched on: the note says a run leaves the program and its .asm as they are', async () => {
    await safe.check();
    await expect(toast(page, 'Safe mode on for "script"')).toBeVisible();
    await expect(page.getByRole('note')).toContainText('leaves the program and its .asm as they are');
    await expect(page.getByRole('option', { name: 'script' }).locator('.scr-safe-ico')).toBeVisible();
  });

  await test.step('a run in safe mode lists what it would change; the listing and the .asm have none of it', async () => {
    await runIt();
    await expect(toast(page, /script: Returned .* Safe mode: nothing went into the program\. It would change 4 bytes in 1 place/)).toBeVisible();
    await expect(would.getByRole('button')).toHaveText(['$0939-$093c · 4 bytes']);
    await expect(changes.getByRole('listitem')).toHaveCount(0);
    await expect(page.getByText('Nothing. Safe mode is on')).toBeVisible();
    await expect(page.locator('.scr-view-head')).toContainText('would change: not in the program');
    await expect(page.locator('.scr-view-head')).toContainText('4 differ from the original');
    await inListing();
    await expect(tag).toHaveCount(0);
    await expect(mark).toHaveCount(0);
    await section.getByRole('button', { name: 'Scripts' }).click();
    await expect(row).toContainText('safe mode: 4 bytes would change');
  });

  await test.step('Write into the program runs it once more and puts the change in; safe mode stays on', async () => {
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await page.getByRole('button', { name: 'Write into the program' }).click();
    await expect(toast(page, /script: Returned .* It changed 4 bytes of the program in 1 place/)).toBeVisible();
    await expect(changes.getByRole('button')).toHaveText(['$0939-$093c · 4 bytes']);
    await expect(would).toHaveCount(0);
    await expect(safe).toBeChecked();
    await inListing();
    await expect(tag).toBeVisible();
    await expect(mark).toHaveCount(1);
  });

  await test.step('a run in safe mode again leaves what was written as it is', async () => {
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await runIt();
    await expect(toast(page, /Safe mode: nothing went into the program\. It would change 4 bytes/)).toBeVisible();
    await expect(changes.getByRole('button')).toHaveText(['$0939-$093c · 4 bytes']);
    await expect(page.getByText('Written before safe mode was switched on')).toBeVisible();
    await expect(would.getByRole('button')).toHaveText(['$0939-$093c · 4 bytes']);
  });

  await test.step('the library keeps safe mode with the script', async () => {
    await page.getByRole('button', { name: 'Save to library' }).click();
    await page.getByRole('button', { name: 'Add script to the project' }).click();
    await expect(page.getByRole('option', { name: 'script2' })).toHaveAttribute('aria-selected', 'true');
    await expect(safe).toBeChecked();
    await page.getByRole('button', { name: 'Remove script from the library' }).click();
  });

  await test.step('safe mode off: a run writes into the program again', async () => {
    await page.getByRole('option', { name: 'script', exact: true }).click();
    await safe.uncheck();
    await expect(toast(page, 'Safe mode off for "script"')).toBeVisible();
    await runIt();
    await expect(toast(page, /script: Returned .* It changed 4 bytes of the program in 1 place/)).toBeVisible();
    await expect(would).toHaveCount(0);
  });
});

test('scripts: Init sets the registers, the flags and zero-page bytes a run starts with; the debugger starts there; the library keeps it; Reset', async ({ app, page }) => {
  await waitForListing(page);
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'New script' }).first().click();
  const editor = page.locator('.scr-editor');
  await editor.locator('.view-lines').click();
  await page.keyboard.press('Control+a');
  // nothing in the code sets A, X, Y, the carry, the pointer at $fb or $fd: Init does
  await page.keyboard.insertText(['        sta colors_0939', '        stx colors_0939+1', '        lda #0', '        adc #0', '        sta ($fb),y', '        lda $fd', '        sta colors_0939+3', '        rts'].join('\n'));
  await expect(page.locator('.scr-check')).toHaveText('Ready to run');
  const init = page.getByRole('region', { name: 'Init' });
  const field = async (label: string, text: string, nth = 0) => { const f = init.getByLabel(label).nth(nth); await f.fill(text); await f.press('Enter'); };

  await test.step('the registers, the carry and two zero-page bytes, a name for a value making one a word', async () => {
    await field('Init A', '$aa');
    await field('Init X', '3');
    await field('Init Y', '%10');
    await expect(init.getByLabel('Init X')).toHaveValue('$03');
    await expect(init.getByLabel('Init Y')).toHaveValue('$02');
    // a value too big for a register is not taken
    await field('Init Y', '300');
    await expect(init.getByLabel('Init Y')).toHaveValue('$02');
    await init.getByRole('button', { name: 'Carry' }).click();
    await expect(init.getByRole('button', { name: 'Carry' })).toHaveAttribute('aria-pressed', 'true');
    await expect(init.locator('.init-p')).toHaveText('P=$25');
    await init.getByRole('button', { name: 'Zero page' }).click();
    await field('Zero-page value', 'colors_0939');
    await expect(init.getByLabel('Zero-page size')).toHaveValue('word');
    await expect(init.getByLabel('Zero-page value')).toHaveValue('$0939');
    await expect(init.getByLabel('Zero-page address')).toHaveValue(/^(\$fb|\w+)$/i);
    await init.getByRole('button', { name: 'Zero page' }).click();
    await expect(init.getByLabel('Zero-page address').nth(1)).toHaveValue(/^(\$fd|\w+)$/i);
    await field('Zero-page value', '$7f', 1);
  });

  await test.step('a run starts with them: what it writes comes from Init', async () => {
    await editor.locator('.view-lines').click();
    await page.keyboard.press('Control+Enter');
    await expect(toast(page, /script: Returned .* It changed 4 bytes of the program in 1 place/)).toBeVisible();
    const changes = page.getByRole('list', { name: 'Changed in the program' });
    await expect(changes.getByRole('button')).toHaveText(['$0939-$093c · 4 bytes']);
    await changes.getByRole('button').click();
    await expect(page.locator('.scr-dump')).toHaveText(/^\$0939\s+aa 03 01 7f/i);
  });

  await test.step('the script still checks out though its run made the table no colours (colors_0939 is tbl_0939 now)', async () => {
    await page.getByRole('tab', { name: 'Listing' }).click();
    await goTo(page, 'tbl_0939');
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await expect(page.locator('.scr-check')).toHaveText('Ready to run');
  });

  await test.step('the debugger starts with them too', async () => {
    await page.getByRole('button', { name: /^Debug/ }).click();
    const regs = page.getByRole('complementary', { name: 'Debugger' }).getByRole('table', { name: 'Registers' });
    await expect(regs.locator('tr', { hasText: /^A/ })).toContainText(/\$aa/i);
    await expect(regs.locator('tr', { hasText: /^X/ })).toContainText('$03');
    await page.getByRole('button', { name: 'Stop' }).click();
  });

  await test.step('the library keeps the init with the script; Reset takes it all away', async () => {
    await page.getByRole('button', { name: 'Save to library' }).click();
    await page.getByRole('button', { name: 'Add script to the project' }).click();
    await expect(page.getByRole('option', { name: 'script2' })).toHaveAttribute('aria-selected', 'true');
    await expect(init.getByLabel('Init A')).toHaveValue('$aa');
    await expect(init.getByLabel('Zero-page value')).toHaveCount(2);
    await page.getByRole('button', { name: 'Remove script from the library' }).click();
    await init.getByRole('button', { name: 'Reset' }).click();
    await expect(init.getByLabel('Init A')).toHaveValue('$00');
    await expect(init.getByRole('button', { name: 'Carry' })).toHaveAttribute('aria-pressed', 'false');
    await expect(init.getByLabel('Zero-page value')).toHaveCount(0);
    await expect(init.getByRole('button', { name: 'Reset' })).toHaveCount(0);
  });
});

test('scripts: the output folds down; scratchpads filled from the .asm, set to start with Kick Assembler, hex or text, copied to one another and compared in a heat map', async ({ app, page }) => {
  await waitForListing(page);
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'New script' }).first().click();
  const bar = page.getByRole('button', { name: /^Output/ });
  const dump = page.locator('.scr-dump');
  const showAs = page.getByRole('group', { name: 'Show as' });
  const padRows = page.locator('.pad-row:not(.pad-head)');

  await test.step('the output folds down to its bar and up again', async () => {
    await expect(bar).toHaveAttribute('aria-expanded', 'true');
    await bar.click();
    await expect(page.locator('.scr-out')).toHaveCount(0);
    await expect(bar).toHaveAttribute('aria-expanded', 'false');
    await bar.click();
    await expect(page.locator('.scr-out')).toBeVisible();
  });

  await test.step('a line of the .asm copied into a new scratchpad: a run starts it with those bytes', async () => {
    await page.getByRole('tab', { name: 'Listing' }).click();
    await goTo(page, 'colors_0939');
    await page.locator('.tab.tab-source').click();
    const line = page.locator('.source .view-line', { hasText: '.byte $06, $0e, $03' });
    await line.click({ button: 'right' });
    // Monaco's menu takes no click in its first moments
    const item = page.getByRole('menuitem', { name: 'Copy into a scratchpad…' });
    await expect(item).toBeVisible();
    await page.waitForTimeout(400);
    await item.click();
    await expect(page.locator('.ctx')).toContainText(/Copy \d+ bytes into a scratchpad/);
    await page.locator('.ctx').getByRole('menuitem', { name: 'A new scratchpad in "script"' }).click();
    await expect(toast(page, /bytes from \$0939 copied into the new scratchpad pad1/)).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Scripts' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.scr-start-pill')).toContainText(/at the start · \d+ set/);
    await expect(dump).toHaveText(/^\$[0-9a-f]{4}\s+06 0e 03/i);
  });

  await test.step('the listing copies into a scratchpad there is: the bytes of its line go in', async () => {
    await page.getByRole('tab', { name: 'Listing' }).click();
    await goTo(page, 'colors_0939');
    await listing(page).locator('.row', { has: page.locator('.adr', { hasText: /^0939$/ }) }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Copy \d+ bytes? into a scratchpad/ }).hover();
    await page.getByRole('menuitem', { name: /^pad1 of "script" \(/ }).click();
    // the listing's row may hold more bytes than the source's line that made pad1: then the first of them go in
    await expect(toast(page, /copied into pad1 of "script"|pad1 holds \d+ bytes: the first \d+ of the \d+ went in/)).toBeVisible();
    await expect(dump).toHaveText(/^\$[0-9a-f]{4}\s+06 0e 03/i);
  });

  await test.step('what it starts with written as Kick Assembler: read as it is typed, Set keeps it', async () => {
    // made bigger, it keeps what it starts with
    const size = page.getByLabel('Scratchpad size');
    await size.fill('$40');
    await size.press('Enter');
    await expect(page.locator('.scr-view-title')).toContainText('64 bytes');
    await page.getByRole('button', { name: 'Edit start' }).click();
    const edit = page.getByRole('group', { name: 'What pad1 starts with' });
    // bytes copied in show as hex
    await expect(edit.getByRole('button', { name: 'Hex' })).toHaveAttribute('aria-pressed', 'true');
    await edit.getByRole('button', { name: 'Kick Assembler' }).click();
    const text = edit.getByLabel('pad1 at the start');
    await text.fill('        .byte $01, $02\n        .word colors_0939\n        nosuch');
    await expect(edit.getByRole('status')).toHaveText(/^Line 3: /);
    await expect(edit.getByRole('button', { name: /^Set/ })).toBeDisabled();
    await text.fill('        .byte $01, $02\n        .word colors_0939\n        .text "HI"');
    await expect(edit.getByRole('status')).toHaveText(/^6 of 64 bytes from \$[0-9a-f]{4}, the rest \$00$/i);
    await text.press('Control+Enter');
    await expect(edit).toHaveCount(0);
    await expect(dump).toHaveText(/^\$[0-9a-f]{4}\s+01 02 39 09 48 49 00/i);
  });

  await test.step('as text: PETSCII, a byte a character', async () => {
    await page.getByRole('button', { name: 'Edit start' }).click();
    const edit = page.getByRole('group', { name: 'What pad1 starts with' });
    await expect(edit.getByRole('button', { name: 'Kick Assembler' })).toHaveAttribute('aria-pressed', 'true');
    await edit.getByRole('button', { name: 'Text' }).click();
    await edit.getByLabel('pad1 at the start').fill('HELLO');
    await expect(edit.getByRole('status')).toHaveText(/^5 of 64 bytes/);
    await edit.getByRole('button', { name: /^Set/ }).click();
    await showAs.getByRole('button', { name: 'Text' }).click();
    await expect(dump).toContainText('HELLO');
    await showAs.getByRole('button', { name: 'Hex' }).click();
  });

  await test.step('copied to a new scratchpad, changed there and compared: the numbers, the heat map, the rows that differ', async () => {
    await page.getByRole('button', { name: 'Copy to a new pad' }).click();
    await expect(toast(page, 'pad1 copied to the new scratchpad pad2')).toBeVisible();
    await expect(page.getByLabel('Scratchpad name').nth(1)).toHaveValue('pad2');
    await showAs.getByRole('button', { name: 'Compare' }).click();
    await expect(page.getByLabel('Compare with')).toHaveValue('pad2');
    const stats = page.locator('.pad-cmp-stats');
    await expect(stats).toHaveText('The same: all 64 bytes.');
    // pad2 shown (compared with pad1) and changed in two bytes: an E that is an A, a zero that is $ff
    await padRows.nth(1).click({ position: { x: 4, y: 4 } });
    await expect(page.getByLabel('Compare with')).toHaveValue('pad1');
    await page.getByRole('button', { name: 'Edit start' }).click();
    const edit = page.getByRole('group', { name: 'What pad2 starts with' });
    await edit.getByRole('button', { name: 'Kick Assembler' }).click();
    await edit.getByLabel('pad2 at the start').fill('        .text "HALLO"\n        .fill 20, 0\n        .byte $ff');
    await edit.getByLabel('pad2 at the start').press('Control+Enter');
    await expect(stats).toHaveText(/^2 of 64 bytes differ \(3\.1 %\) in 2 places, the first at \+\$0001/);
    const heat = page.getByRole('img', { name: 'Heat map of 64 bytes: 2 differ' });
    await expect(heat).toBeVisible();
    const rows = page.getByRole('table', { name: 'Rows that differ' }).getByRole('row');
    await expect(rows).toHaveCount(2);
    // a cell says what both have there; a click goes to its row
    const box = (await heat.boundingBox())!, cell = box.width / 16;
    await heat.hover({ position: { x: cell * 1.5, y: cell * 0.5 } });
    await expect(page.locator('.pad-heat-tip')).toContainText('+$0001');
    await expect(page.locator('.pad-heat-tip')).toContainText('1 bit differs');
    await heat.click({ position: { x: cell * 9.5, y: cell * 1.5 } });
    await expect(page.locator('.pad-diff-row.on')).toHaveAttribute('data-row', '1');
  });

  await test.step('Copy to… puts one scratchpad into another: then they are the same', async () => {
    await padRows.first().click({ position: { x: 4, y: 4 } });
    await page.getByRole('button', { name: 'Copy to…' }).click();
    await page.getByRole('menuitem', { name: /^pad2 \(/ }).click();
    await expect(toast(page, 'pad1 copied to pad2')).toBeVisible();
    await expect(page.locator('.pad-cmp-stats')).toHaveText('The same: all 64 bytes.');
  });
});

test('scripts: names linked from the listing and the source, marked there, written in the code with a click; the editor suggests the program\'s names; the scratchpad follows the debugger', async ({ app, page }) => {
  await waitForListing(page);
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  const labelRow = (name: string) => listing(page).locator('.row.k-lbl', { has: page.locator('.syn-label', { hasText: new RegExp(`^${name}:$`) }) });
  const links = page.getByRole('list', { name: 'Links' }).getByRole('listitem');
  const editor = page.locator('.scr-editor');

  await test.step('a right-click on a label links it to a new script, which the listing marks', async () => {
    await goTo(page, 'colors_0939');
    await labelRow('colors_0939').click({ button: 'right' });
    await fromSubmenu(page, 'Link colors_0939 to a script', 'New script with colors_0939');
    await expect(page.getByRole('tab', { name: 'Scripts' })).toHaveAttribute('aria-selected', 'true');
    await expect(links).toHaveText(['colors_0939']);
    await page.getByRole('tab', { name: 'Listing' }).click();
    const tag = labelRow('colors_0939').locator('.script-tag');
    await expect(tag).toHaveText('script');
    await expect(tag).toHaveAttribute('title', /^Linked to the script "script"\n/);
  });

  await test.step('a byte of a table links as the label and how far on', async () => {
    await goTo(page, 'colors_0939');
    await listing(page).locator(`.cell[data-a="${0x093b}"]`).click({ button: 'right' });
    await fromSubmenu(page, 'Link colors_0939+2 to a script', '"script"');
    await expect(toast(page, 'colors_0939+2 is linked to the script "script"')).toBeVisible();
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await expect(links).toHaveText(['colors_0939', 'colors_0939+2']);
  });

  await test.step('a click on a link writes it in the code where the cursor is', async () => {
    await editor.locator('.view-lines').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('        ldx #3\n!:      lda ');
    await page.getByRole('list', { name: 'Links' }).getByRole('button', { name: 'colors_0939', exact: true }).click();
    await page.keyboard.insertText(',x\n        sta pad1,x\n        dex\n        bpl !-\n        rts');
    await expect(editor.locator('.view-lines')).toContainText('lda colors_0939,x');
    await page.locator('.scr-sec h4').getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.scr-check')).toHaveText('Ready to run');
  });

  await test.step('typing a name suggests the program\'s names that start with it, the links first, written out (no empty box)', async () => {
    await editor.locator('.view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('        lda col');
    const rows = editor.locator('.suggest-widget .monaco-list-row');
    await expect(rows.first()).toContainText('colors_0939');
    const name = await rows.first().locator('.label-name').boundingBox();
    expect(name!.width).toBeGreaterThan(40);
    await expect(rows.first()).toContainText('linked');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Shift+k');
    await expect(page.locator('.scr-check')).toHaveText('Ready to run');
  });

  await test.step('the listing says which line uses the name; a click on the mark opens the script there', async () => {
    await page.getByRole('tab', { name: 'Listing' }).click();
    await goTo(page, 'colors_0939');
    const tag = labelRow('colors_0939').locator('.script-tag');
    await expect(tag).toHaveAttribute('title', /^Linked to the script "script", which uses it on line 2\n/);
    await tag.click();
    await expect(page.getByRole('tab', { name: 'Scripts' })).toHaveAttribute('aria-selected', 'true');
    await expect(editor.locator('.line-numbers.active-line-number')).toHaveText('2');
  });

  await test.step('the source marks the linked lines too, and its right-click links the name under the pointer', async () => {
    await page.getByRole('tab', { name: 'Listing' }).click();
    await goTo(page, 'colors_0939');
    await page.locator('.tab.tab-source').click();
    const src = page.locator('.source');
    // the source opens at the listing's cursor: the table's first line holds colors_0939+2, which is linked
    await expect(src.locator('.view-line', { hasText: '.byte $06, $0e, $03' })).toContainText('⟩_ script');
    await expect(src.locator('.view-line', { hasText: /^txt_0949:/ })).not.toContainText('⟩_');
    await src.locator('.view-line', { hasText: /^txt_0949:/ }).locator('span', { hasText: 'txt_0949' }).first().click({ button: 'right' });
    // Monaco's menu takes no click in its first moments (the right-click's own release would choose an item)
    const item = page.getByRole('menuitem', { name: 'Link to a script…' });
    await expect(item).toBeVisible();
    await page.waitForTimeout(400);
    await item.click();
    await expect(page.locator('.ctx')).toContainText('Link txt_0949 to a script');
    await page.locator('.ctx').getByRole('menuitem', { name: '"script"' }).click();
    await expect(toast(page, 'txt_0949 is linked to the script "script"')).toBeVisible();
    await expect(src.locator('.view-line', { hasText: /^txt_0949:/ })).toContainText('⟩_ script');
  });

  await test.step('stepping in the debugger shows the scratchpad as the run has it, the byte a step wrote marked', async () => {
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await expect(links).toHaveText(['colors_0939', 'colors_0939+2', 'txt_0949']);
    await page.getByRole('button', { name: /^Debug/ }).click();
    const dump = page.locator('.scr-dump');
    await expect(page.locator('.scr-live')).toBeVisible();
    await expect(dump.locator('.pad-chg')).toHaveCount(0);
    for (let i = 0; i < 3; i++) await page.keyboard.press('F8');
    await expect(page.getByRole('complementary', { name: 'Debugger' }).getByRole('status')).toHaveText(/^Line 4 /);
    await expect(dump.locator('.pad-chg')).toHaveCount(1);
    // a step that writes nothing there marks nothing
    await page.keyboard.press('F8');
    await expect(dump.locator('.pad-chg')).toHaveCount(0);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.locator('.scr-live')).toHaveCount(0);
  });
});

test('scripts: an address the code writes where its own code is, is an error on the line; a run that wrote over its code says so', async ({ app, page }) => {
  await waitForListing(page);
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'New script' }).first().click();
  const editor = page.locator('.scr-editor');
  const code = async (text: string) => {
    await editor.locator('.view-lines').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(text);
  };
  const check = page.locator('.scr-check');

  await test.step('code at $0400 that clears the screen from $0400: the line says it would write over the code', async () => {
    await code(['* = $0400', '        ldx #$00', 'loop:   lda #$20', '        sta $0400,x', '        inx', '        bne loop', '        rts'].join('\n'));
    await expect(check).toContainText('Line 4: "sta $0400,x" writes $0400-$04ff of the program, but the script\'s own code is at');
    await expect(page.getByRole('button', { name: /^Run/ })).toBeDisabled();
  });

  await test.step('without * = Mimir puts the code elsewhere, and the loop goes all 256 rounds', async () => {
    await code(['        ldx #$00', 'loop:   lda #$20', '        sta $0400,x', '        inx', '        bne loop', '        rts'].join('\n'));
    await expect(check).toHaveText('Ready to run');
    await page.getByRole('button', { name: /^Run/ }).click();
    await expect(page.locator('.scr-end')).toContainText('Returned');
    await expect(page.locator('.scr-run-sec')).not.toContainText('It wrote over its own code');
  });

  await test.step('code that changes itself: Last run and the message say which line was written over', async () => {
    await code(['        ldx #2', '!:      inc ld+1', 'ld:     lda #0', '        dex', '        bne !-', '        rts'].join('\n'));
    await expect(check).toHaveText('Ready to run');
    await page.getByRole('button', { name: /^Run/ }).click();
    await expect(toast(page, /It wrote over its own code \(line 3\)/)).toBeVisible();
    await expect(page.locator('.scr-run-sec')).toContainText('It wrote over its own code: line 3 ($c006, 2 times)');
  });
});

test('scripts: the line a breakpoint stopped on is marked; a block goes into a scratchpad as its type is; a block\'s end is a name', async ({ app, page }) => {
  await waitForListing(page);
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'New script' }).first().click();
  const editor = page.locator('.scr-editor');
  await editor.locator('.view-lines').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(['        ldx #3', '!:      dex', '        bne !-', '        rts'].join('\n'));
  await expect(page.locator('.scr-check')).toHaveText('Ready to run');

  await test.step('stopped on a breakpoint: the line is marked red, and the debugger says so', async () => {
    const box = await editor.locator('.line-numbers', { hasText: /^2$/ }).boundingBox();
    const glyph = await editor.locator('.glyph-margin').boundingBox();
    await page.mouse.click(glyph!.x + glyph!.width / 2, box!.y + box!.height / 2);
    await expect(editor.locator('.scr-bp')).toHaveCount(1);
    await page.getByRole('button', { name: /^Debug/ }).click();
    const panel = page.getByRole('complementary', { name: 'Debugger' });
    await expect(panel.getByRole('status')).toHaveText(/^Line 1 /);
    await expect(editor.locator('.scr-pc-bp')).toHaveCount(0);
    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect(panel.getByRole('status')).toHaveText(/^Line 2 /);
    await expect(editor.locator('.scr-pc-bp')).toHaveCount(1);
    await expect(editor.locator('.scr-pc-bp-glyph')).toHaveCount(1);
    await expect(panel.locator('.dbg-bp')).toHaveText('Stopped at the breakpoint on line 2');    // a step off it: the usual mark
    await page.keyboard.press('F8');
    await expect(panel.getByRole('status')).toHaveText(/^Line 3 /);
    await expect(editor.locator('.scr-pc-bp')).toHaveCount(0);
    await expect(panel.locator('.dbg-bp')).toHaveCount(0);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
  });

  await test.step('From a block…: a table into a new scratchpad as hex, the charset into it as .byte lines of 8', async () => {
    await page.getByRole('button', { name: 'From a block…' }).click();
    const form = page.getByRole('group', { name: 'Copy a block into a scratchpad' });
    await form.getByLabel('Block').selectOption(String(0x0939));
    await expect(form).toContainText('As hex. A new scratchpad of 16 bytes.');
    await form.getByRole('button', { name: 'Copy' }).click();
    await expect(toast(page, /Block colors_0939 \(\$0939-\$0948, 16 bytes\) copied into the new scratchpad pad1 \(\$[0-9a-f]{4}\) of "script" as hex/)).toBeVisible();
    await page.getByRole('button', { name: 'From a block…' }).click();
    await form.getByLabel('Block').selectOption(String(0x3000));
    await form.getByLabel('Into').selectOption('0');
    await expect(form).toContainText('As .byte, 8 a line. pad1 becomes 2048 bytes, when there is room after it.');
    await form.getByRole('button', { name: 'Copy' }).click();
    await expect(toast(page, /copied into pad1 of "script" as characters, 8 bytes a line: a run starts it with them \(pad1 is 2048 bytes now\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Edit start' }).click();
    await expect(page.getByLabel('pad1 at the start')).toHaveValue(/^\/\/ char \$00\n {8}\.byte \$7c, \$c6, \$de, \$de, \$dc, \$c0, \$7c, \$00\n\/\/ char \$01\n/);
    await page.keyboard.press('Escape');
  });

  await test.step('the listing\'s right-click copies a code block as code', async () => {
    await page.getByRole('tab', { name: 'Listing' }).click();
    await goTo(page, 'sub_0866');
    await listing(page).locator('.row.k-lbl', { has: page.locator('.syn-label', { hasText: /^sub_0866:$/ }) }).click({ button: 'right' });
    await fromSubmenu(page, 'Copy block sub_0866 into a scratchpad (as code)', 'A new scratchpad in "script"');
    await expect(toast(page, /Block sub_0866 \(\$0866-\$08ad, 72 bytes\) copied into the new scratchpad pad2 \(\$[0-9a-f]{4}\) of "script" as code/)).toBeVisible();
  });

  await test.step('a block\'s end is a name the editor suggests: the address after it', async () => {
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await editor.locator('.view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('        lda colors_0939_e');
    const rows = editor.locator('.suggest-widget .monaco-list-row');
    await expect(rows.first()).toContainText('colors_0939_end');
    await expect(rows.first()).toContainText('$0949 · end of the table');
    // Tab takes it, and the code assembles with it
    await page.keyboard.press('Tab');
    await expect(editor.locator('.view-lines')).toContainText('lda colors_0939_end');
    await expect(page.locator('.scr-check')).toHaveText('Ready to run');
  });
});

test('scripts: the Scripts tab folds in the side panel, the inspector and the bottom panel, and another tab brings them back; the script list folds in to a strip', async ({ app, page }) => {
  await waitForListing(page);
  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/raster-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  const shell = page.locator('.app');
  const bottom = page.getByRole('region', { name: 'Panels' });
  // as the listing has them: all open
  await expect(shell).not.toHaveClass(/side-closed|insp-auto/);
  await expect(bottom).not.toHaveClass(/collapsed/);

  await test.step('the Scripts tab: the side panel, the inspector and the bottom panel fold in', async () => {
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await page.getByRole('button', { name: 'New script' }).first().click();
    await expect(shell).toHaveClass(/side-closed/);
    await expect(shell).toHaveClass(/insp-auto/);
    await expect(bottom).toHaveClass(/collapsed/);
  });

  await test.step('another tab: they come back as they were', async () => {
    await page.getByRole('tab', { name: 'Listing' }).click();
    await expect(shell).not.toHaveClass(/side-closed|insp-auto/);
    await expect(bottom).not.toHaveClass(/collapsed/);
  });

  await test.step('one closed by hand before stays closed, and one opened in the Scripts tab stays open', async () => {
    await bottom.getByRole('button', { name: 'Collapse panel' }).click();
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await expect(shell).toHaveClass(/side-closed/);
    await page.getByRole('button', { name: 'Expand panel' }).click();
    await expect(bottom).not.toHaveClass(/collapsed/);
    await page.getByRole('tab', { name: 'Listing' }).click();
    await expect(shell).not.toHaveClass(/side-closed|insp-auto/);
    await expect(bottom).not.toHaveClass(/collapsed/);
    await bottom.getByRole('button', { name: 'Collapse panel' }).click();
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await page.getByRole('tab', { name: 'Listing' }).click();
    await expect(bottom).toHaveClass(/collapsed/);
    await page.getByRole('button', { name: 'Expand panel' }).click();
  });

  await test.step('the script list folds in to a strip that still switches scripts, and stays folded', async () => {
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await page.getByRole('button', { name: 'New script' }).first().click();
    await expect(page.getByRole('listbox', { name: 'Scripts' }).getByRole('option')).toHaveCount(2);
    await page.getByRole('button', { name: 'Fold the script list' }).click();
    const rail = page.getByRole('navigation', { name: 'Scripts in the project, folded in' });
    await expect(rail).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Scripts' })).toHaveCount(0);
    await rail.getByRole('button', { name: 'script', exact: true }).click();
    await expect(page.getByLabel('Script name')).toHaveValue('script');
    await expect(rail.getByRole('button', { name: 'script', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(rail.locator('.scr-rail-name')).toHaveText(['s', 's2']);
    await page.getByRole('tab', { name: 'Listing' }).click();
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await expect(rail).toBeVisible();
    await rail.getByRole('button', { name: 'Unfold the script list' }).click();
    await expect(page.getByRole('listbox', { name: 'Scripts' }).getByRole('option')).toHaveCount(2);
  });
});

test('scripts: templates that decrypt and encrypt have a section of their own in the list, which folds in; a copy comes with its scratchpad and decrypts the program\'s bytes into it', async ({ app, page }) => {
  await waitForListing(page);
  const prg = join(repoDir, 'fixtures/prg/raster-demo.prg');
  await stubDialogs(app, { open: [prg] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
  await page.getByRole('tab', { name: 'Scripts' }).click();
  const list = page.getByRole('list', { name: 'Templates' });
  const fold = page.getByRole('button', { name: 'Templates', exact: true });

  await test.step('the templates are listed under the library, each with what it does and where it was seen', async () => {
    await expect(list.getByRole('listitem')).toHaveText(['XOR key byte', 'XOR key string', 'XOR rolling', 'XOR chain', 'Add/subtract', 'Several steps']);
    await expect(list.getByRole('listitem').first()).toHaveAttribute('title', /^Every byte EORed with one key byte[\s\S]*Seen in/);
  });

  await test.step('the heading folds them in, and they stay folded', async () => {
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await fold.click();
    await expect(list).toHaveCount(0);
    await page.getByRole('tab', { name: 'Listing' }).click();
    await page.getByRole('tab', { name: 'Scripts' }).click();
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(list).toHaveCount(0);
    await fold.click();
    await expect(list.getByRole('listitem')).toHaveCount(6);
  });

  await test.step('a copy in the project: its comment and settings, its scratchpad result placed, ready to run', async () => {
    await list.getByRole('button', { name: 'Add the template XOR key byte to the project' }).click();
    await expect(toast(page, /"xor_key" added from the templates: set its \.vars/)).toBeVisible();
    await expect(page.getByLabel('Script name')).toHaveValue('xor_key');
    await expect(page.locator('.scr-editor .view-lines')).toContainText('XOR with a key byte');
    await expect(page.locator('.scr-check')).toHaveText('Ready to run');
    await expect(page.getByRole('table', { name: 'Scratchpads' }).locator('.pad-row:not(.pad-head)')).toHaveCount(1);
    await expect(page.getByRole('table', { name: 'Scratchpads' }).getByLabel('Scratchpad name')).toHaveValue('result');
    await expect(page.getByRole('table', { name: 'Scratchpads' }).getByLabel('Scratchpad size')).toHaveValue(/^(\$0400|1024)$/);
  });

  await test.step('run as it comes: the program\'s first $100 bytes from $0801, EORed with $77, are in result; the program stays as it is', async () => {
    await page.getByRole('button', { name: /^Run/ }).click();
    await expect(page.locator('.scr-end')).toContainText('Returned');
    const bytes = readFileSync(prg).subarray(2, 18);
    const row = [...bytes].map(b => (b ^ 0x77).toString(16).padStart(2, '0')).join(' ');
    await expect(page.locator('.scr-dump')).toContainText(row);
    await expect(toast(page, /xor_key: Returned .* It changed none of the program's bytes/)).toBeVisible();
    // a second copy gets a name of its own
    await list.getByRole('button', { name: 'Add the template XOR key byte to the project' }).click();
    await expect(page.getByLabel('Script name')).toHaveValue('xor_key2');
  });
});
