/* Git in the real Electron app (spec 13.10b): a new project made as a git repository, and the Git tab staging,
 * committing and pushing it (to a bare repository in the test's folder, through a file:// URL). git runs with a
 * configuration of the test's own, not the user's: the app takes the test's environment. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, repoDir, test } from './fixtures';
import { goTo, stubDialogs, toast, waitForListing } from './helpers';
import { findGit } from '../electron/main/git';

const GIT = findGit();
const prg = join(repoDir, 'fixtures/prg/raster-demo.prg');
const git = (cwd: string, ...args: string[]) => spawnSync(GIT!, args, { cwd, encoding: 'utf8' }).stdout.trim();

test.describe('git', () => {
  test.skip(!GIT, 'git is not installed');
  const saved: Record<string, string | undefined> = {};
  let config = '';
  test.beforeAll(() => {
    config = mkdtempSync(join(tmpdir(), 'mimir-e2e-git-'));
    writeFileSync(join(config, 'gitconfig'), '[user]\n\tname = Mimir Test\n\temail = test@example.invalid\n[commit]\n\tgpgsign = false\n');
    for (const [k, v] of Object.entries({ GIT_CONFIG_GLOBAL: join(config, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' })) { saved[k] = process.env[k]; process.env[k] = v; }
  });
  test.afterAll(() => {
    for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    rmSync(config, { recursive: true, force: true });
  });

  test.describe('a new project', () => {
    test.use({ start: 'none' });

    test('made as a git repository: the Git tab stages, commits and pushes it', async ({ workDir: work, app, page }) => {
      const dir = join(work, 'scroller'), bare = join(work, 'remote.git');
      git(work, 'init', '--bare', '-q', bare);

      await test.step('New project with Create a git repository ticked makes the folder a repository', async () => {
        await page.getByRole('button', { name: 'New project…' }).click();
        const form = page.getByRole('form', { name: 'New project' });
        await form.getByLabel('Name').fill('scroller');
        await stubDialogs(app, { open: [work] });
        await form.getByRole('button', { name: 'Change…' }).click();
        await expect(form).toContainText(`Creates ${dir}`);
        const box = form.getByRole('checkbox', { name: /Create a git repository/ });
        await expect(box).toBeEnabled();
        await expect(box).not.toBeChecked();
        await box.check();
        await form.getByRole('button', { name: 'Create project' }).click();
        await expect(toast(page, `Created the project scroller in ${dir}, as a git repository`)).toBeVisible();
        expect(existsSync(join(dir, '.git'))).toBe(true);
        expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('build/');
        expect(readFileSync(join(dir, '.gitattributes'), 'utf8')).toContain('*.prg binary');
        expect(git(dir, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
      });

      await test.step('a PRG opened in it, and the Git tab lists the new files', async () => {
        await stubDialogs(app, { open: [prg] });
        await page.locator('.empty-project').getByRole('button', { name: 'Open PRG…' }).click();
        await waitForListing(page);
        await page.getByRole('tab', { name: 'Git', exact: true }).click();
        const changes = page.getByRole('region', { name: 'Changes' });
        await expect(changes.locator('.git-file')).toHaveText([/\.gitattributes/, /\.gitignore/, /scroller\.mimir\.json/]);
        await expect(page.locator('.git-head')).toContainText('main');
        // a click shows the file's changes: a new file, whole
        await changes.locator('.git-file', { hasText: 'scroller.mimir.json' }).click();
        await expect(page.locator('.git-diff-head')).toContainText('scroller.mimir.json');
        await expect(page.locator('.git-diff-text')).toContainText('new file scroller.mimir.json');
      });

      await test.step('stage one file, then all; commit with Ctrl+Enter', async () => {
        const changes = page.getByRole('region', { name: 'Changes' }), staged = page.getByRole('region', { name: 'Staged' });
        await changes.getByRole('button', { name: 'Stage .gitignore' }).click();
        await expect(staged.locator('.git-file')).toHaveText([/\.gitignore/]);
        await expect(page.getByRole('button', { name: /^Commit/ })).toBeDisabled();
        await changes.getByRole('button', { name: 'Stage all' }).click();
        await expect(staged.locator('.git-file')).toHaveCount(3);
        // the file shown follows it into the staged list
        await expect(page.locator('.git-diff-head .pill')).toHaveText('staged');
        await page.getByLabel('Commit message').fill('The raster demo, re-assembled');
        await page.getByLabel('Commit message').press('Control+Enter');
        await expect(toast(page, /^Committed [0-9a-f]{7}: The raster demo, re-assembled$/)).toBeVisible();
        await expect(page.getByRole('region', { name: 'Commits' }).locator('li')).toHaveText([/The raster demo, re-assembled/]);
        await expect(page.getByLabel('Commit message')).toHaveValue('');
        expect(git(dir, 'log', '--format=%s')).toBe('The raster demo, re-assembled');
        expect(git(dir, 'status', '--porcelain')).toBe('');
      });

      await test.step('origin added, and Push sends the branch there, which it pushes to from then on', async () => {
        const remote = page.getByRole('region', { name: 'Remote' });
        await expect(page.locator('.git-head').getByRole('button', { name: 'Push' })).toHaveCount(0);
        const url = `file:///${bare.replace(/\\/g, '/')}`;
        await remote.getByLabel("origin's URL").fill(url);
        await remote.getByRole('button', { name: 'Add origin' }).click();
        await expect(remote.locator('.git-remote')).toContainText(url);
        const push = page.locator('.git-head').getByRole('button', { name: 'Push' });
        await expect(push).toBeEnabled();
        await push.click();
        await expect(toast(page, 'Pushed main to origin/main')).toBeVisible();
        await expect(page.locator('.git-head')).toContainText('→ origin/main');
        await expect(push).toBeDisabled();
        expect(git(bare, 'log', '--format=%s', 'main')).toBe('The raster demo, re-assembled');
      });

      await test.step('a change saved to the project file shows up as modified, and the next commit as one to push', async () => {
        await page.getByRole('tab', { name: 'Listing', exact: true }).click();
        await goTo(page, 'var_092d');
        await page.keyboard.press('n');
        await page.getByLabel(/^Label at \$/).fill('sine_pos');
        await page.getByLabel(/^Label at \$/).press('Enter');
        await expect.poll(() => readFileSync(join(dir, 'scroller.mimir.json'), 'utf8'), { timeout: 10_000 }).toContain('sine_pos');
        await page.getByRole('tab', { name: 'Git', exact: true }).click();
        const changes = page.getByRole('region', { name: 'Changes' });
        await expect(changes.locator('.git-file')).toHaveText([/^M\s*scroller\.mimir\.json/]);
        await changes.getByRole('button', { name: 'Stage all' }).click();
        await page.getByLabel('Commit message').fill('Name the sine position');
        await page.getByRole('button', { name: /^Commit/ }).click();
        await expect(page.locator('.git-head')).toContainText('↑1');
        await page.locator('.git-head').getByRole('button', { name: 'Push 1' }).click();
        await expect(page.locator('.git-head')).not.toContainText('↑');
        expect(git(bare, 'log', '--format=%s', 'main')).toBe('Name the sine position\nThe raster demo, re-assembled');
      });
    });
  });

  test('without a project the Git tab says git needs one, and offers to make one', async ({ page }) => {
    await page.getByRole('tab', { name: 'Git', exact: true }).click();
    await expect(page.locator('.git-empty')).toContainText("Git works in a project's folder");
    await page.getByRole('button', { name: 'Create a project from this work…' }).click();
    const form = page.getByRole('form', { name: 'New project' });
    await expect(form.getByRole('checkbox', { name: /Create a git repository/ })).toBeVisible();
  });
});
