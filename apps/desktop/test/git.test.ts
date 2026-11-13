/* Git for a project's folder (spec 13.10b): git's output read, the paths and URLs the renderer may name, and the
 * GitService against the real git in temp folders, with a git configuration of its own (not the user's). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHANGE_WORD, conflictFiles, GIT_ATTRIBUTES, gitPathProblem, parseLog, parseRemotes, parseStatus, remoteUrlProblem, stagedFiles, unstagedFiles } from '../shared/git';
import { findGit, GitService, initRepository } from '../electron/main/git';
import { gitCommitSchema, gitDiffSchema, gitPathsSchema, gitRemoteSchema, projectCreateSchema } from '../electron/main/schemas';
import { createProject } from '@mimir/core';

const tmp = () => mkdtempSync(join(tmpdir(), 'mimir-git-test-'));

describe('git status read', () => {
  it('reads the branch, its upstream and every kind of entry, paths with spaces too', () => {
    const out = [
      '# branch.oid 0123456789abcdef0123456789abcdef01234567',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 aaa bbb my demo.mimir.json',
      '1 .M N... 100644 100644 100644 aaa aaa source/main.asm',
      '1 MD N... 100644 100644 000000 aaa bbb packed/x.prg',
      '2 R. N... 100644 100644 100644 aaa aaa R100 source/new name.asm',
      'source/old name.asm',
      'u UU N... 100644 100644 100644 100644 a b c conflict.asm',
      '? build/out.prg',
      '! ignored.txt',
      '',
    ].join('\0');
    const s = parseStatus(out);
    expect(s).toMatchObject({ branch: 'main', head: '0123456789abcdef0123456789abcdef01234567', upstream: 'origin/main', ahead: 2, behind: 1 });
    expect(s.files).toEqual([
      { path: 'my demo.mimir.json', index: 'M', work: '.', kind: 'changed' },
      { path: 'source/main.asm', index: '.', work: 'M', kind: 'changed' },
      { path: 'packed/x.prg', index: 'M', work: 'D', kind: 'changed' },
      { path: 'source/new name.asm', from: 'source/old name.asm', index: 'R', work: '.', kind: 'changed' },
      { path: 'conflict.asm', index: 'U', work: 'U', kind: 'conflict' },
      { path: 'build/out.prg', index: '.', work: '?', kind: 'untracked' },
    ]);
    // a file with changes of both kinds is in both lists
    expect(stagedFiles(s.files).map(f => f.path)).toEqual(['my demo.mimir.json', 'packed/x.prg', 'source/new name.asm']);
    expect(unstagedFiles(s.files).map(f => f.path)).toEqual(['source/main.asm', 'packed/x.prg', 'build/out.prg']);
    expect(conflictFiles(s.files).map(f => f.path)).toEqual(['conflict.asm']);
    expect(CHANGE_WORD.R).toBe('renamed');
  });

  it('reads a repository without commits and a detached HEAD', () => {
    expect(parseStatus('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({ branch: 'main', head: null, upstream: null, ahead: 0, behind: 0, files: [] });
    expect(parseStatus('# branch.oid abc\0# branch.head (detached)\0')).toMatchObject({ branch: null, head: 'abc' });
  });

  it('reads the remotes, each once with the URL it pushes to, and the log', () => {
    expect(parseRemotes('origin\thttps://github.com/a/b.git (fetch)\norigin\tgit@github.com:a/b.git (push)\nbackup\t//nas/b.git (fetch)\nbackup\t//nas/b.git (push)\n'))
      .toEqual([{ name: 'origin', url: 'git@github.com:a/b.git' }, { name: 'backup', url: '//nas/b.git' }]);
    expect(parseLog('abc\x1fab\x1fMe\x1f1700000000\x1fFirst: a subject\x1e\ndef\x1fde\x1fYou\x1f1700000100\x1fSecond\x1e\n'))
      .toEqual([{ hash: 'abc', short: 'ab', author: 'Me', time: 1700000000000, subject: 'First: a subject' }, { hash: 'def', short: 'de', author: 'You', time: 1700000100000, subject: 'Second' }]);
    expect(parseLog('')).toEqual([]);
  });
});

describe('what the renderer may name', () => {
  it('only paths inside the repository, as they are', () => {
    for (const ok of ['a.asm', 'source/main.asm', 'source\\main.asm', 'my demo.mimir.json', 'a..b']) expect(gitPathProblem(ok)).toBeNull();
    for (const bad of ['', '../x', 'source/../../x', '/etc/passwd', '\\\\server\\x', 'C:/x', 'c:x', 'a\nb', 'a\0b']) expect(gitPathProblem(bad)).not.toBeNull();
  });

  it('only URLs git pushes to', () => {
    for (const ok of ['https://github.com/me/demo.git', 'ssh://git@host/x.git', 'git@github.com:me/demo.git', 'file:///C:/repos/demo.git']) expect(remoteUrlProblem(ok)).toBeNull();
    for (const bad of ['', '-oProxyCommand=calc', 'https://a b', 'demo', 'C:\\repos\\demo.git', 'ext::sh -c x']) expect(remoteUrlProblem(bad)).not.toBeNull();
  });

  it('checks the requests', () => {
    expect(gitPathsSchema.safeParse({}).success).toBe(true);
    expect(gitPathsSchema.safeParse({ paths: ['a'] }).success).toBe(true);
    expect(gitPathsSchema.safeParse({ paths: [] }).success).toBe(false);
    expect(gitPathsSchema.safeParse({ paths: ['a'], dir: 'C:/' }).success).toBe(false);
    expect(gitCommitSchema.safeParse({ message: '' }).success).toBe(false);
    expect(gitRemoteSchema.safeParse({ url: 'https://x/y.git', name: 'evil' }).success).toBe(false);
    expect(gitDiffSchema.safeParse({ path: 'a', staged: true }).success).toBe(true);
    const project = createProject({ name: 'x', files: [] });
    expect(projectCreateSchema.safeParse({ name: 'x', parent: 'C:/p', project, git: true }).success).toBe(true);
  });
});

describe('finding git', () => {
  it('looks on PATH, then where Git for Windows installs itself', () => {
    const d = tmp();
    try {
      mkdirSync(join(d, 'bin'));
      writeFileSync(join(d, 'bin', 'git.exe'), '');
      expect(findGit({ Path: `C:\\nowhere;"${join(d, 'bin')}"` }, 'win32')).toBe(join(d, 'bin', 'git.exe'));
      mkdirSync(join(d, 'Git', 'cmd'), { recursive: true });
      writeFileSync(join(d, 'Git', 'cmd', 'git.exe'), '');
      expect(findGit({ PATH: 'C:\\nowhere', ProgramFiles: d }, 'win32')).toBe(join(d, 'Git', 'cmd', 'git.exe'));
      expect(findGit({ PATH: 'C:\\nowhere' }, 'win32')).toBeNull();
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

const GIT = findGit();
describe.skipIf(!GIT)('the GitService with the real git', () => {
  const saved: Record<string, string | undefined> = {};
  let home: string;
  beforeAll(() => {
    // a git configuration of the test's own: neither the user's nor Git for Windows' (core.autocrlf)
    home = tmp();
    const config = join(home, 'gitconfig');
    writeFileSync(config, '[user]\n\tname = Mimir Test\n\temail = test@example.invalid\n[commit]\n\tgpgsign = false\n');
    for (const [k, v] of Object.entries({ GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: tmpdir() })) { saved[k] = process.env[k]; process.env[k] = v; }
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    rmSync(home, { recursive: true, force: true });
  });
  const git = (cwd: string, ...args: string[]) => spawnSync(GIT!, args, { cwd, encoding: 'utf8' }).stdout.trim();

  it('says what is there without a project, and in a folder that is no repository', async () => {
    const none = new GitService(() => null);
    expect(await none.status()).toMatchObject({ dir: null, repo: null, git: { path: GIT } });
    await expect(none.init()).rejects.toThrow(/No project is open/);
    const dir = tmp();
    try {
      const st = await new GitService(() => dir).status();
      expect(st).toMatchObject({ dir, repo: null });
      expect(st.git?.version).toMatch(/^\d+\.\d+/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('makes a repository on main with Mimir\'s .gitignore and .gitattributes, stages, unstages and commits', async () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, 'demo.mimir.json'), '{}\n');
      writeFileSync(join(dir, 'a b.txt'), 'one\n');
      writeFileSync(join(dir, 'ab.txt'), 'two\n');
      mkdirSync(join(dir, 'build'));
      writeFileSync(join(dir, 'build', 'demo.prg'), Buffer.from([1, 8, 0]));
      const svc = new GitService(() => dir);
      const r = await svc.init();
      expect(r.ok).toBe(true);
      expect(readFileSync(join(dir, '.gitattributes'), 'utf8')).toBe(GIT_ATTRIBUTES);
      const repo = r.status.repo!;
      expect(repo).toMatchObject({ branch: 'main', head: null, upstream: null, remotes: [], log: [] });
      // build\ is left out
      expect(repo.files.map(f => `${f.work} ${f.path}`).sort()).toEqual(['? .gitattributes', '? .gitignore', '? a b.txt', '? ab.txt', '? demo.mimir.json']);

      // a path is read as it is: a* is no wildcard
      expect((await svc.stage(['a*'])).ok).toBe(false);
      const s1 = await svc.stage(['a b.txt']);
      expect(s1.ok).toBe(true);
      expect(stagedFiles(s1.status.repo!.files).map(f => f.path)).toEqual(['a b.txt']);
      // before the first commit, unstaging takes it out of the index
      const u1 = await svc.unstage(['a b.txt']);
      expect(u1.ok).toBe(true);
      expect(stagedFiles(u1.status.repo!.files)).toEqual([]);
      await expect(svc.stage(['../x'])).rejects.toThrow(/above the repository/);

      expect((await svc.stage()).status.repo!.files.every(f => f.index === 'A')).toBe(true);
      await expect(svc.commit('  \n')).rejects.toThrow(/commit message/);
      const c = await svc.commit('First commit\r\n\r\n#1 stays, as a line of the message');
      expect(c.ok).toBe(true);
      expect(c.status.repo!.files).toEqual([]);
      expect(c.status.repo!.log.map(l => l.subject)).toEqual(['First commit']);
      expect(git(dir, 'log', '-1', '--format=%B')).toBe('First commit\n\n#1 stays, as a line of the message');

      // the changes of a file, staged and not; after the first commit unstaging goes back to HEAD
      writeFileSync(join(dir, 'ab.txt'), 'three\n');
      expect((await svc.diff({ path: 'ab.txt', staged: false })).text).toMatch(/-two\n\+three/);
      await svc.stage(['ab.txt']);
      expect((await svc.diff({ path: 'ab.txt', staged: true })).text).toMatch(/-two\n\+three/);
      expect((await svc.diff({ path: 'ab.txt', staged: false })).text).toBe('');
      const u2 = await svc.unstage();
      expect(u2.status.repo!.files).toEqual([{ path: 'ab.txt', index: '.', work: 'M', kind: 'changed' }]);

      // a file git does not track yet is shown whole; a binary one is not
      writeFileSync(join(dir, 'new.asm'), 'lda #0\r\nrts\r\n');
      expect(await svc.diff({ path: 'new.asm', staged: false })).toEqual({ text: 'new file new.asm\n@@ -0,0 +1,2 @@\n+lda #0\n+rts\n', truncated: false, binary: false });
      writeFileSync(join(dir, 'x.prg'), Buffer.from([0, 0x10, 0xa9, 0]));
      expect(await svc.diff({ path: 'x.prg', staged: false })).toMatchObject({ binary: true });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('adds origin, pushes the branch setting its upstream, then pushes to it', async () => {
    const dir = tmp(), bare = tmp();
    try {
      git(bare, 'init', '--bare', '-q');
      writeFileSync(join(dir, 'demo.mimir.json'), '{}\n');
      const svc = new GitService(() => dir);
      await svc.init();
      await expect(svc.push()).rejects.toThrow(/commit first/);
      await svc.stage();
      await svc.commit('First');
      await expect(svc.push()).rejects.toThrow(/no remote/);
      await expect(svc.remote('not a url')).rejects.toThrow();
      const url = `file:///${bare.replace(/\\/g, '/')}`;
      const a = await svc.remote(url);
      expect(a.status.repo!.remotes).toEqual([{ name: 'origin', url }]);
      const p1 = await svc.push();
      expect(p1.ok).toBe(true);
      expect(p1.argv[0].slice(1)).toEqual(['push', '-u', 'origin', 'HEAD']);
      expect(p1.status.repo).toMatchObject({ upstream: 'origin/main', ahead: 0 });
      writeFileSync(join(dir, 'demo.mimir.json'), '{"a":1}\n');
      await svc.stage();
      const c2 = await svc.commit('Second');
      expect(c2.status.repo!.ahead).toBe(1);
      const p2 = await svc.push();
      expect(p2.argv[0].slice(1)).toEqual(['push']);
      expect(p2.status.repo!.ahead).toBe(0);
      expect(git(bare, 'log', '--format=%s', 'main')).toBe('Second\nFirst');
      // origin changed
      const b = await svc.remote('https://github.com/me/demo.git');
      expect(b.status.repo!.remotes).toEqual([{ name: 'origin', url: 'https://github.com/me/demo.git' }]);
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(bare, { recursive: true, force: true }); }
  });

  it('makes a repository of its own inside another, and leaves one that is there as it is', async () => {
    const outer = tmp();
    try {
      git(outer, 'init', '-q');
      const inner = join(outer, 'my demo');
      mkdirSync(inner);
      writeFileSync(join(inner, '.gitignore'), 'mine\n');
      const r = await initRepository(GIT!, inner);
      expect(r.outcome).toMatchObject({ ok: true, root: inner });
      expect(r.outcome.nested?.toLowerCase()).toBe(outer.toLowerCase());
      expect(existsSync(join(inner, '.git'))).toBe(true);
      // a .gitignore of the user's stays
      expect(readFileSync(join(inner, '.gitignore'), 'utf8')).toBe('mine\n');
      expect(r.outcome.message).toMatch(/with \.gitattributes \(inside the repository/);
      const again = await initRepository(GIT!, inner);
      expect(again.runs).toEqual([]);
      expect(again.outcome.message).toMatch(/is a git repository already/);
    } finally { rmSync(outer, { recursive: true, force: true }); }
  });
});
