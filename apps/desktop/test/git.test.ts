/* Git for a project's folder (spec 13.10b): git's output read, the paths and URLs the renderer may name, and the
 * GitService against the real git in temp folders, with a git configuration of its own (not the user's). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addNumstat, CHANGE_WORD, conflictFiles, GIT_ATTRIBUTES, gitPathProblem, parseLog, parseNameStatus, parseRemotes, parseStatus, remoteUrlProblem, stagedFiles, unstagedFiles } from '../shared/git';
import { findGit, GitService, initRepository } from '../electron/main/git';
import { gitCommitSchema, gitDiffSchema, gitPathsSchema, gitRangeSchema, gitRemoteSchema, gitStatusSchema, projectCreateSchema } from '../electron/main/schemas';
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
    expect(parseLog('abc\x1fab\x1fMe\x1f1700000000\x1fdef\x1fFirst: a subject\x1fA body\r\n\r\nof two lines\n\x1e\ndef\x1fde\x1fYou\x1f1700000100\x1f\x1fSecond\x1f\x1e\n'))
      .toEqual([
        { hash: 'abc', short: 'ab', author: 'Me', time: 1700000000000, subject: 'First: a subject', parents: ['def'], body: 'A body\n\nof two lines' },
        { hash: 'def', short: 'de', author: 'You', time: 1700000100000, subject: 'Second', parents: [], body: '' },
      ]);
    // a merge has two parents
    expect(parseLog('m\x1fm\x1fMe\x1f1\x1fa b\x1fMerge\x1f\x1e')[0].parents).toEqual(['a', 'b']);
    expect(parseLog('')).toEqual([]);
  });

  it('reads the files between two points of the history, with their lines added and taken away', () => {
    const files = parseNameStatus('M\0a b.txt\0A\0new.asm\0D\0gone.asm\0R087\0old name.asm\0new name.asm\0C100\0x.asm\0y.asm\0T\0link\0');
    expect(files).toEqual([
      { path: 'a b.txt', change: 'M' }, { path: 'new.asm', change: 'A' }, { path: 'gone.asm', change: 'D' },
      { path: 'new name.asm', from: 'old name.asm', change: 'R' }, { path: 'y.asm', from: 'x.asm', change: 'C' }, { path: 'link', change: 'T' },
    ]);
    addNumstat(files, '3\t1\ta b.txt\x002\t0\tnew.asm\x000\t5\tgone.asm\x001\t1\t\0old name.asm\0new name.asm\0-\t-\tlink\0');
    expect(files.map(f => [f.path, f.added, f.removed, f.binary])).toEqual([
      ['a b.txt', 3, 1, undefined], ['new.asm', 2, 0, undefined], ['gone.asm', 0, 5, undefined],
      ['new name.asm', 1, 1, undefined], ['y.asm', undefined, undefined, undefined], ['link', undefined, undefined, true],
    ]);
    expect(parseNameStatus('')).toEqual([]);
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
    // commits by their hashes only: never a branch, a tag or a revision git would read as an option
    const h = '92b1f93c0ffee';
    expect(gitDiffSchema.safeParse({ path: 'a', range: { from: null, to: h } }).success).toBe(true);
    expect(gitRangeSchema.safeParse({ from: h, to: null }).success).toBe(true);
    for (const bad of ['main', 'HEAD~1', '--output=x', 'abc', `${h}^`, `${h}..main`]) expect(gitRangeSchema.safeParse({ from: bad, to: null }).success).toBe(false);
    expect(gitRangeSchema.safeParse({ from: h }).success).toBe(false);
    expect(gitStatusSchema.safeParse({ log: 40 }).success).toBe(true);
    expect(gitStatusSchema.safeParse({ log: 0 }).success).toBe(false);
    expect(gitStatusSchema.safeParse(undefined).success).toBe(true);
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

  it('shows what a commit changed, two commits compared and a commit compared with the folder', async () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, 'main.asm'), 'lda #0\nrts\n');
      writeFileSync(join(dir, 'old.asm'), 'one\ntwo\nthree\nfour\nfive\n');
      const svc = new GitService(() => dir);
      await svc.init();
      await svc.stage();
      await svc.commit('First');
      writeFileSync(join(dir, 'main.asm'), 'lda #1\nrts\n');
      writeFileSync(join(dir, 'x.prg'), Buffer.from([0, 0x10, 0xa9, 0]));
      renameSync(join(dir, 'old.asm'), join(dir, 'new.asm'));
      await svc.stage();
      const c2 = await svc.commit('Second\n\nWith a body');
      const [second, first] = c2.status.repo!.log;
      expect(second).toMatchObject({ subject: 'Second', body: 'With a body', parents: [first.hash] });
      expect(first.parents).toEqual([]);

      // what the second commit changed: from its parent
      const what = await svc.compare({ from: first.hash, to: second.hash });
      expect(what.files).toEqual([
        { path: 'main.asm', change: 'M', added: 1, removed: 1 },
        { path: 'new.asm', from: 'old.asm', change: 'R', added: 0, removed: 0 },
        { path: 'x.prg', change: 'A', binary: true },
      ]);
      expect((await svc.diff({ path: 'main.asm', range: { from: first.hash, to: second.hash } })).text).toMatch(/-lda #0\n\+lda #1/);
      expect((await svc.diff({ path: 'new.asm', from: 'old.asm', range: { from: first.hash, to: second.hash } })).text).toMatch(/rename from old\.asm\nrename to new\.asm/);
      expect(await svc.diff({ path: 'x.prg', range: { from: first.hash, to: second.hash } })).toMatchObject({ binary: true });

      // the first commit: from nothing, everything in it is new
      const all = await svc.compare({ from: null, to: first.hash });
      expect(all.files.map(f => `${f.change} ${f.path} +${f.added}`)).toEqual(['A .gitattributes +15', 'A .gitignore +2', 'A main.asm +2', 'A old.asm +5']);

      // the second commit compared with the folder: a change not staged, one staged and a file git does not track yet
      writeFileSync(join(dir, 'main.asm'), 'lda #2\nrts\n');
      writeFileSync(join(dir, 'new.asm'), 'six\n');
      await svc.stage(['new.asm']);
      writeFileSync(join(dir, 'later.asm'), 'nop\n');
      const work = await svc.compare({ from: second.hash, to: null });
      expect(work.files).toEqual([
        { path: 'later.asm', change: 'A', untracked: true },
        { path: 'main.asm', change: 'M', added: 1, removed: 1 },
        { path: 'new.asm', change: 'M', added: 1, removed: 5 },
      ]);
      expect((await svc.diff({ path: 'main.asm', range: { from: second.hash, to: null } })).text).toMatch(/-lda #1\n\+lda #2/);
      expect((await svc.diff({ path: 'later.asm', range: { from: second.hash, to: null } })).text).toBe('new file later.asm\n@@ -0,0 +1,1 @@\n+nop\n');
      // the first commit compared with the folder
      expect((await svc.diff({ path: 'main.asm', range: { from: first.hash, to: null } })).text).toMatch(/-lda #0\n\+lda #2/);

      // hashes only, and only of commits that are there
      await expect(svc.compare({ from: 'main', to: null })).rejects.toThrow(/not a commit's hash/);
      await expect(svc.compare({ from: 'deadbeefdeadbeef', to: null })).rejects.toThrow(/no commit deadbeefdeadbeef/);
      await expect(svc.compare({ from: first.hash.slice(0, 7), to: second.hash })).resolves.toMatchObject({ files: expect.any(Array) });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('lists as many commits as asked, and says when there are older ones', async () => {
    const dir = tmp();
    try {
      const svc = new GitService(() => dir);
      await svc.init();
      for (let i = 1; i <= 3; i++) { writeFileSync(join(dir, 'n.txt'), `${i}\n`); await svc.stage(); await svc.commit(`Commit ${i}`); }
      const st = await svc.status(2);
      expect(st.repo!.log.map(c => c.subject)).toEqual(['Commit 3', 'Commit 2']);
      expect(st.repo!.more).toBe(true);
      // a step's status lists as many as the last one asked for
      writeFileSync(join(dir, 'n.txt'), '4\n');
      expect((await svc.stage()).status.repo!.log).toHaveLength(2);
      const all = await svc.status(20);
      expect(all.repo!.log).toHaveLength(3);
      expect(all.repo!.more).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
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
