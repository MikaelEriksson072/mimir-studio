/* Projects in the real Electron app: the start screen (continue, a new project, work without one), a project's folder
 * and what Mimir writes there, a project made afterwards from the work without one, and the next start going on with
 * it. Folder dialogs are stubbed: no test writes in the user's documents folder. */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, launchApp, repoDir, test } from './fixtures';
import { goTo, listing, listingRows, occurrences, statusBar, stubDialogs, toast, waitForListing } from './helpers';

const OLD = 'var_092d';
const NEW = 'sine_pos';
const prg = join(repoDir, 'fixtures/prg/raster-demo.prg');

async function rename(page: Page, from: string, to: string) {
  await goTo(page, from);
  await page.keyboard.press('n');
  await page.getByLabel(/^Label at \$/).fill(to);
  await page.getByLabel(/^Label at \$/).press('Enter');
  await expect(statusBar(page)).toContainText(`· ${to}`);
}

test.describe('the start screen', () => {
  test.use({ start: 'none' });

  test('a new project: its folder, the work saved there as it changes, and the next start goes on with it', async ({ workDir: work, userData, app, page }) => {
    const dir = join(work, 'scroller'), file = join(dir, 'scroller.mimir.json');

    await test.step('the first start offers a new project, opening one, or work without one', async () => {
      await expect(page.getByRole('button', { name: 'New project…' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open project…' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Without a project' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Continue/ })).toHaveCount(0);
    });

    await test.step('New project makes its folder with the project file in it', async () => {
      await page.getByRole('button', { name: 'New project…' }).click();
      const form = page.getByRole('form', { name: 'New project' });
      await expect(form.getByRole('button', { name: 'Create project' })).toBeDisabled();
      await form.getByLabel('Name').fill('a:b');
      await expect(form).toContainText('A folder name cannot have');
      await form.getByLabel('Name').fill('scroller');
      await stubDialogs(app, { open: [work] });
      await form.getByRole('button', { name: 'Change…' }).click();
      await expect(form).toContainText(`Creates ${dir}`);
      await form.getByRole('button', { name: 'Create project' }).click();
      await expect(toast(page, `Created the project scroller in ${dir}`)).toBeVisible();
      expect(existsSync(file)).toBe(true);
      await expect(page.getByRole('button', { name: 'Project scroller' })).toBeVisible();
      await expect(page.locator('.empty-project')).toContainText('scroller has no files yet');
    });

    await test.step('a PRG opened goes into the project, and every change is saved to its project file', async () => {
      await stubDialogs(app, { open: [prg] });
      await page.locator('.empty-project').getByRole('button', { name: 'Open PRG…' }).click();
      await expect(toast(page, 'Loaded raster-demo.prg at $0801')).toBeVisible();
      await waitForListing(page);
      await rename(page, OLD, NEW);
      await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 10_000 }).toContain(NEW);
    });

    await test.step('Ctrl+E exports into the project\'s source folder, without a dialog', async () => {
      await page.keyboard.press('Control+e');
      await expect(toast(page, `Exported verified Kick Assembler project to ${join(dir, 'source')}`)).toBeVisible({ timeout: 90_000 });
      expect(readFileSync(join(dir, 'source', 'raster-demo.asm'), 'utf8')).toContain(`ldx ${NEW}`);
    });

    await test.step('the next start offers to continue with it, and goes on where it was', async () => {
      await app.close();
      const again = await launchApp(userData);
      try {
        const page2 = await again.firstWindow();
        const go = page2.getByRole('button', { name: 'Continue with the project scroller' });
        await expect(go).toBeFocused();
        await expect(go).toContainText(dir);
        await page2.keyboard.press('Enter');
        await waitForListing(page2);
        await expect(page2.getByRole('button', { name: 'Project scroller' })).toBeVisible();
        expect(occurrences(await listingRows(page2), NEW)).toBeGreaterThanOrEqual(4);

        // a reloaded window goes on with the project, without the start screen
        await page2.reload();
        await waitForListing(page2);
        await expect(page2.getByRole('button', { name: 'Project scroller' })).toBeVisible();

        // the project button: back to the start screen, which lists it
        await page2.getByRole('button', { name: 'Project scroller' }).click();
        await page2.getByRole('menuitem', { name: 'Close the project (start screen)' }).click();
        await expect(page2.getByRole('button', { name: 'Continue with the project scroller' })).toBeVisible();
        await expect(page2.getByRole('button', { name: 'Without a project' })).toBeVisible();
      } finally {
        await again.close();
      }
    });
  });

  test('without a project as before; the work comes back at the next start, next to the project worked on last', async ({ workDir: work, userData, app, page }) => {
    await page.getByRole('button', { name: 'Without a project' }).click();
    await waitForListing(page);
    await expect(page.getByRole('button', { name: 'No project' })).toBeVisible();
    await rename(page, OLD, NEW);
    // the window keeps it (after a moment)
    await page.waitForTimeout(1200);
    await app.close();

    const again = await launchApp(userData);
    try {
      const page2 = await again.firstWindow();
      const go = page2.getByRole('button', { name: 'Continue with the work without a project' });
      await expect(go).toContainText('raster-demo');
      await go.click();
      await waitForListing(page2);
      expect(occurrences(await listingRows(page2), NEW)).toBeGreaterThanOrEqual(4);

      // a project opened from its file: the next start continues it, and offers the work without one beside it
      await page2.getByRole('button', { name: 'No project' }).click();
      await page2.getByRole('menuitem', { name: 'Start screen' }).click();
      await page2.getByRole('button', { name: 'New project…' }).click();
      await stubDialogs(again, { open: [work] });
      await page2.getByRole('form', { name: 'New project' }).getByRole('button', { name: 'Change…' }).click();
      await page2.getByRole('form', { name: 'New project' }).getByLabel('Name').fill('other');
      await page2.getByRole('form', { name: 'New project' }).getByRole('button', { name: 'Create project' }).click();
      await expect(page2.getByRole('button', { name: 'Project other' })).toBeVisible();
      await page2.getByRole('button', { name: 'Project other' }).click();
      await page2.getByRole('menuitem', { name: 'Close the project (start screen)' }).click();
      await expect(page2.getByRole('button', { name: 'Continue with the project other' })).toBeVisible();
      await page2.getByRole('button', { name: 'Go on with the work without a project' }).click();
      await waitForListing(page2);
      expect(occurrences(await listingRows(page2), NEW)).toBeGreaterThanOrEqual(4);
      await expect(page2.getByRole('button', { name: 'No project' })).toBeVisible();
    } finally {
      await again.close();
    }
  });
});

test('a project made afterwards from the work without one: the work and its export move into the project\'s folder', async ({ workDir: work, app, page }) => {
  await waitForListing(page);
  await rename(page, OLD, NEW);
  const exported = join(work, 'export'), parent = join(work, 'projects'), dir = join(parent, 'raster');
  mkdirSync(parent);

  await test.step('an export to a folder of the user\'s, as before', async () => {
    await stubDialogs(app, { open: [exported] });
    await page.keyboard.press('Control+e');
    await expect(toast(page, `Exported verified Kick Assembler project to ${exported}`)).toBeVisible({ timeout: 90_000 });
  });

  await test.step('Save: the project is made and the work moves there', async () => {
    await page.getByRole('button', { name: 'No project' }).click();
    await page.getByRole('menuitem', { name: /^Create a project from this work…/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Create a project from this work' });
    await expect(dialog).toContainText(`Moves there: the project (its files, labels, comments, bookmarks and patches), the export (copied from ${exported})`);
    await dialog.getByLabel('Name').fill('raster');
    await stubDialogs(app, { open: [parent] });
    await dialog.getByRole('button', { name: 'Change…' }).click();
    await dialog.getByRole('button', { name: 'Create project and move the work' }).click();
    await expect(toast(page, `Created the project raster in ${dir}: the work is saved there, with the export`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Project raster' })).toBeVisible();
    expect(readFileSync(join(dir, 'raster.mimir.json'), 'utf8')).toContain(NEW);
    expect(readFileSync(join(dir, 'source', 'raster-demo.asm'), 'utf8')).toContain(`ldx ${NEW}`);
    // the folder the user picked stays as it was
    expect(existsSync(join(exported, 'raster-demo.asm'))).toBe(true);
  });

  await test.step('it goes on in the project: changes go to its file, Save writes it at once', async () => {
    await rename(page, NEW, 'wave_pos');
    await page.keyboard.press('Control+s');
    await expect(toast(page, `Project saved to ${join(dir, 'raster.mimir.json')}`)).toBeVisible();
    expect(readFileSync(join(dir, 'raster.mimir.json'), 'utf8')).toContain('wave_pos');
    // the work without a project went into it: the window keeps none
    await page.reload();
    await waitForListing(page);
    await expect(page.getByRole('button', { name: 'Project raster' })).toBeVisible();
    await expect(listing(page)).toBeVisible();
  });

  await test.step('a project of that name is not made twice', async () => {
    await page.getByRole('button', { name: 'Project raster' }).click();
    await page.getByRole('menuitem', { name: 'Close the project (start screen)' }).click();
    await page.getByRole('button', { name: 'New project…' }).click();
    const form = page.getByRole('form', { name: 'New project' });
    await form.getByLabel('Name').fill('raster');
    await stubDialogs(app, { open: [parent] });
    await form.getByRole('button', { name: 'Change…' }).click();
    await form.getByRole('button', { name: 'Create project' }).click();
    await expect(form.getByRole('alert')).toContainText(`There is a project called raster in ${parent} already`);
  });
});
