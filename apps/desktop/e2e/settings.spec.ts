/* The Settings dialog: its pages in a list on the left, grouped as App, Project and Toolchain; each setting with a line
 * saying what it does and the rest behind More; a search over every page; and the dialog opening at the page it was
 * last on. */
import { expect, test } from './fixtures';
import { waitForListing } from './helpers';

test('Settings: pages by group, More, a search over every page, and the page it was on', async ({ page }) => {
  await waitForListing(page);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const search = dialog.getByRole('searchbox', { name: 'Search settings' });
  const tab = (name: string) => dialog.getByRole('tab', { name, exact: true });

  await test.step('the pages, General first, with the search focused', async () => {
    await expect(dialog.getByRole('tab')).toHaveText(['General', 'Analysis', 'Assembler output', 'Assemblers', 'VICE & music', 'Debuggers', 'Packers & editor']);
    await expect(dialog.locator('.set-group')).toHaveText(['App', 'Project', 'Toolchain']);
    await expect(tab('General')).toHaveAttribute('aria-selected', 'true');
    await expect(search).toBeFocused();
    const panel = dialog.getByRole('tabpanel');
    await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Starting and opening files', 'Listing', 'Panels']);
    await expect(panel).toContainText('Kept by the app, for every project.');
    await tab('Analysis').click();
    await expect(panel).toContainText('Saved in the project; a file you open next keeps them.');
  });

  await test.step('a page of the toolchain: More shows the rest of what a setting does, Less hides it; ↓ goes to the next page', async () => {
    await tab('Debuggers').click();
    const panel = dialog.getByRole('tabpanel');
    await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Retro Debugger', 'C64 Debugger']);
    await expect(panel).toContainText('Shift+F5 builds and verifies as F5 does');
    await expect(panel).not.toContainText('Retro Debugger 1.0.0 stops its emulation');
    await panel.getByRole('button', { name: 'More about Build & Run in a debugger (Shift+F5)' }).click();
    await expect(panel).toContainText('Retro Debugger 1.0.0 stops its emulation');
    await panel.getByRole('button', { name: 'Less about Build & Run in a debugger (Shift+F5)' }).click();
    await expect(panel).not.toContainText('Retro Debugger 1.0.0 stops its emulation');
    await tab('Debuggers').press('ArrowDown');
    await expect(tab('Packers & editor')).toBeFocused();
    await expect(tab('Packers & editor')).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Unpacking', 'Packing', 'Editor']);
  });

  await test.step('the search: the settings with every word typed, from every page, the words marked', async () => {
    const found = dialog.getByRole('region', { name: 'Settings found' });
    await search.fill('zero page');
    await expect(found.locator('.set-crumb')).toHaveText(['Project › Analysis']);
    await expect(found.getByRole('checkbox')).toHaveAccessibleName('Include the zero page and the stack');
    // the pages say how many they have; a page with none is dimmed
    await expect(dialog.locator('#set-tab-analysis .set-count')).toHaveText('1');
    await expect(dialog.locator('#set-tab-general .set-count')).toHaveCount(0);
    await expect(dialog.locator('#set-tab-general')).toHaveClass(/dim/);

    await search.fill('snapshot');
    await expect(found.locator('.set-crumb')).toHaveText(['Project › Analysis', 'Toolchain › VICE & music', 'Toolchain › Debuggers']);
    // the word only in what More says: it is open
    await expect(found).toContainText('A VICE snapshot is restarted in C64 Debugger');
    await expect(found.locator('mark').first()).toHaveText(/^snapshot$/i);

    await search.fill('no such setting');
    await expect(found).toContainText('No setting matches “no such setting”.');
    // Esc empties the search first, and leaves the dialog open
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(dialog).toBeVisible();
  });

  await test.step('a page heading in the search goes to its page; the dialog opens again at the page it was on', async () => {
    await search.fill('quicksave');
    await dialog.getByRole('region', { name: 'Settings found' }).getByRole('button', { name: 'Toolchain › VICE & music' }).click();
    await expect(search).toHaveValue('');
    await expect(tab('VICE & music')).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('tabpanel').getByRole('heading', { level: 2 })).toHaveText('VICE & music');
    await dialog.getByLabel('Play music blocks in').selectOption('deepsid');
    await dialog.getByRole('button', { name: 'Save settings' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(tab('VICE & music')).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByLabel('Play music blocks in')).toHaveValue('deepsid');
    // Esc with nothing searched closes it
    await search.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
