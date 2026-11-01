/* Projects in the real Electron app: the start screen (continue, a new project, work without one), a project's folder
 * and what Mimir writes there, a project made afterwards from the work without one, and the next start going on with
 * it. Folder dialogs are stubbed: no test writes in the user's documents folder. */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, launchApp, repoDir, test } from './fixtures';
import { dialogOptions, goTo, listing, listingRows, occurrences, statusBar, stubDialogs, toast, waitForListing } from './helpers';

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
      // the dialog opens in a folder that is there (Documents\Mimir is not before the first project: Windows would ask
      // at once whether to create it)
      const shown = (await dialogOptions(app)).pop();
      expect(shown?.title).toBe('Folder for the new project');
      expect(existsSync(shown?.defaultPath ?? '')).toBe(true);
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

  test('the start screen turned off goes on with the project at the next start; Settings turns it on again', async ({ workDir: work, userData, app, page }) => {
    const toggle = page.getByRole('checkbox', { name: /^Show this window when Mimir starts/ });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(page.locator('.start-toggle')).toContainText('Settings → General turns it on again');
    await page.getByRole('button', { name: 'New project…' }).click();
    const form = page.getByRole('form', { name: 'New project' });
    await form.getByLabel('Name').fill('quiet');
    await stubDialogs(app, { open: [work] });
    await form.getByRole('button', { name: 'Change…' }).click();
    await form.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('button', { name: 'Project quiet' })).toBeVisible();
    await app.close();

    let again = await launchApp(userData);
    try {
      const page2 = await again.firstWindow();
      // straight into the project, without the start screen
      await expect(page2.getByRole('button', { name: 'Project quiet' })).toBeVisible();
      await expect(toast(page2, `Opened the project quiet (${join(work, 'quiet')})`)).toBeVisible();
      await expect(page2.getByRole('button', { name: 'New project…' })).toHaveCount(0);
      // the project button still shows it, with the box unticked
      await page2.getByRole('button', { name: 'Project quiet' }).click();
      await page2.getByRole('menuitem', { name: 'Close the project (start screen)' }).click();
      await expect(page2.getByRole('checkbox', { name: /^Show this window when Mimir starts/ })).not.toBeChecked();
      await page2.getByRole('button', { name: 'Continue with the project quiet' }).click();
      await expect(page2.getByRole('button', { name: 'Project quiet' })).toBeVisible();
      // Settings → General turns it on again (the title bar's button: the window that just opened may not listen for
      // Ctrl+, yet)
      await page2.getByRole('button', { name: 'Settings' }).click();
      const settings = page2.getByRole('dialog', { name: 'Settings' });
      await settings.getByRole('tab', { name: 'General' }).click();
      const on = settings.getByRole('checkbox', { name: /^Show the start screen when Mimir starts/ });
      await expect(on).not.toBeChecked();
      await on.check();
      await settings.getByRole('button', { name: 'Save settings' }).click();
      await expect(settings).toBeHidden();
    } finally {
      await again.close();
    }

    again = await launchApp(userData);
    try {
      const page3 = await again.firstWindow();
      await expect(page3.getByRole('button', { name: 'Continue with the project quiet' })).toBeVisible();
      await expect(page3.getByRole('checkbox', { name: /^Show this window when Mimir starts/ })).toBeChecked();
    } finally {
      await again.close();
    }
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

test('another program opened in a project is work without a project: the project stays as it was', async ({ workDir: work, app, page }) => {
  const file = join(work, 'keep', 'keep.mimir.json');
  await waitForListing(page);
  await page.keyboard.press('Control+s');
  const dialog = page.getByRole('dialog', { name: 'Create a project from this work' });
  await dialog.getByLabel('Name').fill('keep');
  await stubDialogs(app, { open: [work] });
  await dialog.getByRole('button', { name: 'Change…' }).click();
  await dialog.getByRole('button', { name: 'Create project and move the work' }).click();
  // the title bar can show the project a moment before the dialog has gone, and keys wait for that
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Project keep' })).toBeVisible();
  await rename(page, OLD, NEW);
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 10_000 }).toContain(NEW);

  await stubDialogs(app, { open: [join(repoDir, 'fixtures/prg/loader-demo.prg')] });
  await page.keyboard.press('Control+o');
  await expect(toast(page, 'Loaded loader-demo.prg at $0801; without a project (keep is saved as it was; Save makes a project of this)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'No project' })).toBeVisible();
  await page.waitForTimeout(1200);
  const kept = readFileSync(file, 'utf8');
  expect(kept).toContain(NEW);
  expect(kept).toContain('raster-demo.prg');
  expect(kept).not.toContain('loader-demo.prg');

  // the project opens as it was, from the start screen's list
  await page.getByRole('button', { name: 'No project' }).click();
  await page.getByRole('menuitem', { name: 'Start screen' }).click();
  await expect(page.getByRole('button', { name: 'Continue with the work without a project' })).toContainText('loader-demo');
  await page.getByRole('listitem').filter({ hasText: 'keep' }).getByRole('button', { name: /^keep/ }).click();
  await waitForListing(page);
  await expect(page.getByRole('button', { name: 'Project keep' })).toBeVisible();
  expect(occurrences(await listingRows(page), NEW)).toBeGreaterThanOrEqual(4);
});

test('work without a project, with changes, asks before a file takes its place: Cancel, Save as a project first, or not', async ({ workDir: work, app, page }) => {
  const loader = join(repoDir, 'fixtures/prg/loader-demo.prg');
  const dir = join(work, 'raster'), file = join(dir, 'raster.mimir.json');
  const work0 = page.locator('.cmd-search');
  await waitForListing(page);
  await expect(page.getByRole('button', { name: 'No project', exact: true })).toBeVisible();
  await rename(page, OLD, NEW);
  // the title bar marks it
  await expect(page.getByRole('button', { name: 'No project, changes not saved' })).toBeVisible();
  const ask = page.getByRole('dialog', { name: 'The work is not saved' });

  await test.step('Cancel: the work stays as it is', async () => {
    await stubDialogs(app, { open: [loader] });
    await page.keyboard.press('Control+o');
    await expect(ask).toContainText('raster-demo is work without a project, and its changes are in no project. Opening loader-demo.prg takes its place: the changes would be gone.');
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toBeHidden();
    await expect(work0).toContainText('raster-demo');
    expect(occurrences(await listingRows(page), NEW)).toBeGreaterThanOrEqual(4);
  });

  await test.step('Save as a project: the work is made a project, then the file opens without one', async () => {
    await page.keyboard.press('Control+o');
    await ask.getByRole('button', { name: 'Save as a project…' }).click();
    await expect(ask).toBeHidden();
    const create = page.getByRole('dialog', { name: 'Create a project from this work' });
    await create.getByLabel('Name').fill('raster');
    await stubDialogs(app, { open: [work] });
    await create.getByRole('button', { name: 'Change…' }).click();
    await create.getByRole('button', { name: 'Create project, then open loader-demo.prg' }).click();
    await expect(create).toBeHidden();
    await expect(toast(page, 'Loaded loader-demo.prg at $0801; without a project (raster is saved as it was; Save makes a project of this)')).toBeVisible();
    await expect(work0).toContainText('loader-demo');
    await expect(page.getByRole('button', { name: 'No project', exact: true })).toBeVisible();
    const saved = readFileSync(file, 'utf8');
    expect(saved).toContain(NEW);
    expect(saved).not.toContain('loader-demo.prg');
  });

  await test.step('the mark is kept over a reload', async () => {
    await expect(statusBar(page)).toContainText(/analysis [0-9]/);
    await rename(page, 'sub_0814', 'send_drive');
    await expect(page.getByRole('button', { name: 'No project, changes not saved' })).toBeVisible();
    await page.waitForTimeout(1000);
    await page.reload();
    await waitForListing(page);
    await expect(page.getByRole('button', { name: 'No project, changes not saved' })).toBeVisible();
  });

  await test.step('in a project, a file that leaves it asks for the work without a project the window keeps; Do not save opens it', async () => {
    await page.getByRole('button', { name: 'No project' }).click();
    await page.getByRole('menuitem', { name: 'Start screen' }).click();
    await page.getByRole('listitem').filter({ hasText: 'raster' }).getByRole('button', { name: /^raster/ }).click();
    await waitForListing(page);
    await expect(page.getByRole('button', { name: 'Project raster' })).toBeVisible();
    await stubDialogs(app, { open: [prg] });
    await page.keyboard.press('Control+o');
    const kept = page.getByRole('dialog', { name: 'The work without a project is not saved' });
    await expect(kept).toContainText('The work without a project Mimir keeps, loader-demo, has changes that are in no project. Opening raster-demo.prg leaves raster (saved as it is) and makes it the work without a project instead');
    await kept.getByRole('button', { name: 'Do not save' }).click();
    await expect(kept).toBeHidden();
    await expect(toast(page, 'Loaded raster-demo.prg at $0801; without a project (raster is saved as it was; Save makes a project of this)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'No project', exact: true })).toBeVisible();
    expect(occurrences(await listingRows(page), NEW)).toBe(0);
    expect(readFileSync(file, 'utf8')).toContain(NEW);
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
    await expect(dialog).toBeHidden();
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
