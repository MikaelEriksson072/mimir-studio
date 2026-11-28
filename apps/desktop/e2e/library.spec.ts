/* The library (spec 10.6): a music, sprite or charset block goes into the library as a file named after where it was
 * found (from the listing's right-click menu, the inspector, the command palette), in a folder of its kind; the
 * Library view (its button in the activity bar) and the Library tab list, show and play them; a file is renamed,
 * moved to the Recycle Bin, and one put in the folder by hand is in the library too. The library is in the test's
 * profile (fixtures.ts), never in the documents folder. */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { goTo, headerRow, listing, statusBar, toast, waitForListing } from './helpers';

test('blocks go into the library as files named after where they were found; the Library view and tab show and play them', async ({ app, page, userData }) => {
  // VICE itself is not started: a Windows program that ends at once stands in for it
  const standIn = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe');
  test.skip(!existsSync(standIn), 'needs where.exe');
  const lib = join(userData, 'library'), trash = join(userData, 'trash');
  // the Recycle Bin is a folder of the profile: nothing goes in the user's
  await app.evaluate((_e, dir) => {
    const req = (process as unknown as { mainModule: { require: (m: string) => any } }).mainModule.require; // eslint-disable-line @typescript-eslint/no-explicit-any
    const fs = req('node:fs'), path = req('node:path'), { shell } = req('electron');
    shell.trashItem = async (p: string) => { fs.mkdirSync(dir, { recursive: true }); fs.renameSync(p, path.join(dir, path.basename(p))); };
  }, trash);
  await waitForListing(page);
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await expect(toast(page, 'Showcase loaded: the Bookmarks view is a tour of it, F2 goes to the next stop')).toBeVisible();
  await waitForListing(page);
  await page.evaluate(v => (window as unknown as { kr: { setSettings(p: object): Promise<unknown> } }).kr.setSettings({ vicePath: v }), standIn);
  await listing(page).click();
  const dialog = page.getByRole('dialog', { name: 'Add to library' });
  const tuneFile = 'mimir-showcase - music_1800 ($1800-$19cc).sid';

  await test.step('the music block\'s right-click menu adds it as a .sid named after where it was found', async () => {
    await goTo(page, '1800');
    await expect(statusBar(page)).toContainText('$1800 · Music (SID)');
    await headerRow(page, '1800').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add to library (SIDs)…' }).click();
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('music_1800');
    await expect(dialog.getByLabel('Taken from')).toHaveValue('mimir-showcase');
    await expect(dialog).toContainText(`SIDs\\${tuneFile}`);
    await dialog.getByLabel('Author (optional)').fill('Mimir Studio');
    await dialog.getByRole('button', { name: 'Add to library' }).click();
    await expect(toast(page, `Added to the library: SIDs\\${tuneFile}`)).toBeVisible();
    const sid = readFileSync(join(lib, 'SIDs', tuneFile));
    const text = (o: number) => sid.subarray(o, o + 32).toString('latin1').replace(/\0.*$/s, '');
    expect([sid.subarray(0, 4).toString('latin1'), text(0x16), text(0x36), text(0x56)]).toEqual(['PSID', 'music_1800', 'Mimir Studio', 'mimir-showcase']);
    expect(sid[0x0a] << 8 | sid[0x0b]).toBe(0x1800);
    const index = JSON.parse(readFileSync(join(lib, 'library.json'), 'utf8'));
    expect(index.items[0]).toMatchObject({ kind: 'sid', file: tuneFile, name: 'music_1800', from: { text: 'mimir-showcase', file: 'mimir-showcase.prg', start: 0x1800, end: 0x19cd } });
  });

  await test.step('the inspector adds the charset, the command palette the sprites', async () => {
    await goTo(page, 'charset_2800');
    await expect(statusBar(page)).toContainText('charset_2800');
    await page.locator('aside.insp-col').getByRole('button', { name: 'Add to library' }).click();
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('charset_2800');
    await expect(dialog).toContainText('Chars\\mimir-showcase - charset_2800 ($2800-$2fff).64c');
    await dialog.getByLabel('Name', { exact: true }).press('Enter');
    await expect(toast(page, 'Added to the library: Chars\\mimir-showcase - charset_2800 ($2800-$2fff).64c')).toBeVisible();
    const font = readFileSync(join(lib, 'Chars', 'mimir-showcase - charset_2800 ($2800-$2fff).64c'));
    expect([font[0], font[1], font.length]).toEqual([0x00, 0x28, 2 + 2048]);

    await listing(page).click();
    await goTo(page, '2000');
    await page.keyboard.press('Control+Shift+P');
    const q = page.getByRole('textbox', { name: 'Command' });
    await q.fill('Add the block at the cursor to the library');
    await q.press('Enter');
    await expect(dialog).toContainText(/Sprites\\mimir-showcase - .+ \(\$2000-\$[0-9a-f]{4}\)\.spr/);
    await dialog.getByRole('button', { name: 'Add to library' }).click();
    await expect(toast(page, /^Added to the library: Sprites\\/)).toBeVisible();
    const [spr] = readdirSync(join(lib, 'Sprites'));
    expect(statSync(join(lib, 'Sprites', spr)).size % 64).toBe(0);
  });

  await test.step('the same tune again: the dialog says it is in the library already', async () => {
    await listing(page).click();
    await goTo(page, '1800');
    await headerRow(page, '1800').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add to library (SIDs)…' }).click();
    await expect(dialog.getByRole('status')).toContainText(`These bytes are in the library already, as ${tuneFile}`);
    await expect(dialog.getByRole('button', { name: 'Add again' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  const side = page.getByRole('list', { name: 'The library' });
  const cards = page.locator('.lib-tab .lib-card');
  await test.step('the Library button shows the view and the tab: each with its picture and where it was found', async () => {
    await page.locator('nav.activity').getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true');
    await expect(side.getByRole('listitem')).toHaveCount(3);
    await expect(side.getByRole('listitem').filter({ hasText: 'music_1800' })).toContainText('Mimir Studio · mimir-showcase · $1800-$19cc');
    await expect(cards).toHaveCount(3);
    await expect(page.locator('.lib-tab .lib-group-head')).toHaveText(['SIDs 1', 'Sprites 1', 'Chars 1']);
    // the kinds' buttons list one kind
    await page.locator('.lib-side').getByRole('tab', { name: /^Chars/ }).click();
    await expect(side.getByRole('listitem')).toHaveCount(1);
    await expect(cards).toHaveCount(1);
    await page.locator('.lib-side').getByRole('tab', { name: /^All/ }).click();
    // and the filter looks through names, sources and authors
    await page.locator('#lib-q').fill('mimir studio');
    await expect(side.getByRole('listitem')).toHaveCount(1);
    await page.locator('#lib-q').fill('');
  });

  await test.step('a SID plays from its row in VICE, and from the tab', async () => {
    const before = new Set(readdirSync(tmpdir()).filter(d => d.startsWith('mimir-play-')));
    await side.getByRole('button', { name: 'Play music_1800 in VICE' }).click();
    await expect(toast(page, /^VICE plays music_1800: init \$1800, then play \$1803 each frame/)).toBeVisible();
    const made = readdirSync(tmpdir()).filter(d => d.startsWith('mimir-play-') && !before.has(d) && existsSync(join(tmpdir(), d, 'library.prg')));
    expect(made.length).toBeGreaterThan(0);
    // the player's PRG: RUN starts it, the tune's bytes (JMP init) from $0c00
    const prg = readFileSync(join(tmpdir(), made[0], 'library.prg'));
    expect(prg[0] | (prg[1] << 8)).toBe(0x0801);
    expect(prg[2 + 0x0c00 - 0x0801]).toBe(0x4c);
    for (const d of made) rmSync(join(tmpdir(), d), { recursive: true, force: true });
    await cards.filter({ hasText: 'music_1800' }).click();
    const show = page.getByLabel('music_1800 in the library');
    await expect(show).toContainText('Mimir Studio');
    await expect(show).toContainText('$1800–$19cc');
    await expect(show.getByRole('button', { name: 'Play in VICE' })).toBeVisible();
  });

  await test.step('sprites and a charset are shown large; how they are drawn is kept for them', async () => {
    await cards.filter({ hasText: 'charset_2800' }).click();
    const show = page.getByLabel('charset_2800 in the library');
    await expect(show.getByRole('img', { name: 'charset_2800: 256 characters' })).toBeVisible();
    await show.getByRole('checkbox', { name: 'Multicolor' }).check();
    await expect.poll(() => JSON.parse(readFileSync(join(lib, 'library.json'), 'utf8')).items.find((e: { kind: string }) => e.kind === 'chars')?.mc).toBe(true);
    await show.getByRole('combobox', { name: 'Color bg' }).selectOption('6');
    await expect.poll(() => JSON.parse(readFileSync(join(lib, 'library.json'), 'utf8')).items.find((e: { kind: string }) => e.kind === 'chars')?.colors?.bg).toBe(6);
    // a click on a character shows its bytes
    const pic = show.getByRole('img', { name: /charset_2800/ });
    const box = (await pic.boundingBox())!;
    await page.mouse.click(box.x + 2, box.y + 2);
    await expect(show.getByRole('status')).toContainText('Char $00');
  });

  await test.step('rename: the file takes the new name; Move to the Recycle Bin takes it out', async () => {
    const show = page.getByLabel('charset_2800 in the library');
    await show.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('Its name').fill('Showcase font');
    await page.getByLabel('Its name').press('Enter');
    await expect(toast(page, 'Renamed: Chars\\mimir-showcase - Showcase font ($2800-$2fff).64c')).toBeVisible();
    expect(readdirSync(join(lib, 'Chars'))).toEqual(['mimir-showcase - Showcase font ($2800-$2fff).64c']);
    const shown = page.getByLabel('Showcase font in the library');
    await shown.getByRole('button', { name: 'Move to the Recycle Bin' }).click();
    await shown.getByRole('alertdialog').getByRole('button', { name: 'Move it' }).click();
    await expect(toast(page, 'mimir-showcase - Showcase font ($2800-$2fff).64c is in the Recycle Bin')).toBeVisible();
    expect(readdirSync(join(lib, 'Chars'))).toEqual([]);
    expect(readdirSync(trash)).toEqual(['mimir-showcase - Showcase font ($2800-$2fff).64c']);
    await expect(side.getByRole('listitem')).toHaveCount(2);
  });

  await test.step('a file put in a folder by hand is in the library too', async () => {
    writeFileSync(join(lib, 'Chars', 'my font.64c'), Buffer.concat([Buffer.from([0x00, 0x30]), Buffer.alloc(1024, 0x3c)]));
    await page.getByRole('button', { name: 'Read the library again' }).click();
    await expect(side.getByRole('listitem')).toHaveCount(3);
    await expect(side.getByRole('listitem').filter({ hasText: 'my font' })).toContainText('put in the folder by hand');
  });
});

test('a bitmap goes into the library as a picture in the format Settings picks, with the screen found for it', async ({ page, userData }) => {
  const lib = join(userData, 'library');
  await waitForListing(page);
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await expect(toast(page, 'Showcase loaded: the Bookmarks view is a tour of it, F2 goes to the next stop')).toBeVisible();
  await waitForListing(page);
  const dialog = page.getByRole('dialog', { name: 'Add to library' });

  await test.step('Settings → General → Library picks the format of multicolour bitmaps', async () => {
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings.getByRole('tab', { name: 'General', exact: true }).click();
    await expect(settings.getByLabel('Multicolour bitmaps are saved as')).toHaveValue('koala');
    await expect(settings.getByLabel('Hires bitmaps are saved as')).toHaveValue('art');
    await settings.getByLabel('Multicolour bitmaps are saved as').selectOption('ocp');
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings).toBeHidden();
  });

  await test.step('the Graphics tab adds the bitmap it shows', async () => {
    await page.getByRole('tab', { name: 'Graphics' }).click();
    const view = page.getByLabel('Memory as graphics');
    await view.getByRole('button', { name: 'Bitmaps' }).click();
    await view.getByLabel('Go to address, label or range').fill('$4000');
    await view.getByLabel('Go to address, label or range').press('Enter');
    await expect(view.getByRole('status')).toContainText('$4000–$5f3f (8000 bytes)');
    await view.getByRole('button', { name: 'Add to library' }).click();
    await expect(dialog.getByLabel('Screen matrix at')).toHaveValue('$6000');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step('the bitmap block\'s menu: its picture, with the screen the VIC shows with it and the colour RAM the program copies, in that format', async () => {
    await page.getByRole('tab', { name: 'Listing' }).click();
    await listing(page).click();
    await goTo(page, '4000');
    await headerRow(page, '4000').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add to library (Bitmaps)…' }).click();
    await expect(dialog.getByLabel('Screen matrix at')).toHaveValue('$6000');
    // logo_colors, which lda logo_colors,x / sta $d800,x copies to colour RAM
    const colours = dialog.getByLabel('Colour RAM at');
    await expect(colours).toHaveValue(/^\$[0-9a-f]{4}$/);
    const at = await colours.inputValue();
    await expect(dialog).toContainText(`The screen the VIC shows with the bitmap ($d018), at $6000; colour RAM from the table the program copies to $d800, at ${at}`);
    await expect(dialog.getByRole('img', { name: 'The picture as it goes in the library' })).toBeVisible();
    await expect(dialog.getByLabel('Picture format')).toHaveValue('ocp');
    await expect(dialog.locator('.lib-add-file')).toHaveText('File: Bitmaps\\mimir-showcase - bitmap_4000 ($4000-$5f3f).ocp');
    // an address that is none: nothing to add
    await colours.fill('xyz');
    await expect(dialog.getByRole('button', { name: 'Add to library' })).toBeDisabled();
    await colours.fill(at);
    // another format for this one picture
    await dialog.getByLabel('Picture format').selectOption('koala');
    await expect(dialog.locator('.lib-add-file')).toHaveText('File: Bitmaps\\mimir-showcase - bitmap_4000 ($4000-$5f3f).kla');
    await dialog.getByLabel('Picture format').selectOption('ocp');
    await dialog.getByRole('button', { name: 'Add to library' }).click();
    await expect(toast(page, 'Added to the library: Bitmaps\\mimir-showcase - bitmap_4000 ($4000-$5f3f).ocp')).toBeVisible();
    const [file] = readdirSync(join(lib, 'Bitmaps'));
    const b = readFileSync(join(lib, 'Bitmaps', file));
    // Advanced Art Studio: $2000, the bitmap, the screen ($61 a cell, from $6000) after it, colour RAM from $4338 (the
    // logo's first cells light red, 10)
    expect([b.length, b[0] | (b[1] << 8), b[2 + 8000], b[2 + 8319], b[2 + 9016]]).toEqual([10018, 0x2000, 0x61, 0x61, 10]);
    expect(JSON.parse(readFileSync(join(lib, 'library.json'), 'utf8')).items[0]).toMatchObject({ kind: 'bitmaps', file, mc: true, from: { start: 0x4000 } });
  });

  await test.step('the Library tab shows it as its picture; one put in the folder by hand too', async () => {
    writeFileSync(join(lib, 'Bitmaps', 'my picture.kla'), Buffer.concat([Buffer.from([0x00, 0x60]), Buffer.alloc(10001, 0x05)]));
    await page.locator('nav.activity').getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: 'Read the library again' }).click();
    const side = page.getByRole('list', { name: 'The library' });
    await expect(side.getByRole('listitem')).toHaveCount(2);
    await expect(side.getByRole('listitem').filter({ hasText: 'my picture' })).toContainText('multicolour bitmap, Koala Painter');
    await expect(page.locator('.lib-tab .lib-group-head')).toHaveText(['Bitmaps 2']);
    await page.locator('.lib-tab .lib-card').filter({ hasText: 'mimir-showcase' }).click();
    const show = page.getByLabel(/in the library$/);
    await expect(show).toContainText('Advanced Art Studio (.ocp), multicolour');
    await expect(show.getByRole('img', { name: /multicolour bitmap, Advanced Art Studio$/ })).toBeVisible();
  });
});
