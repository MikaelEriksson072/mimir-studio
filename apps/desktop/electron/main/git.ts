/* Git for a project's folder (spec 13.10b). The git the user has installed (on PATH, or where Git for Windows installs
 * itself) runs with argument arrays, never through a shell, always in the repository of the project that is open: the
 * renderer names files in it, never a folder, a program, a remote or a branch. One command runs at a time. */
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import type { GitDiffRequest, GitDiffResult, GitInitOutcome, GitOpResult, GitRepo, GitStatus, GitVersion } from '../../shared/ipc';
import { GIT_ATTRIBUTES, GIT_IGNORE, gitPathProblem, LOG_FORMAT, parseLog, parseRemotes, parseStatus, remoteUrlProblem } from '../../shared/git';

/** how many commits the Git tab lists */
export const GIT_LOG = 20;
/** how much of a diff is shown */
export const DIFF_LIMIT = 512 * 1024;
/** how long a push may take (the credential manager may ask the user to sign in first) */
export const PUSH_MS = 5 * 60_000;
const RUN_MS = 60_000;

/** git.exe on PATH, else where Git for Windows installs itself; null: no git */
export function findGit(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string | null {
  const win = platform === 'win32', exe = win ? 'git.exe' : 'git';
  const path = env.PATH ?? env.Path ?? '';
  for (const d of path.split(win ? ';' : delimiter)) {
    const dir = d.trim().replace(/^"(.*)"$/, '$1');
    if (!dir) continue;
    const p = join(dir, exe);
    try { if (existsSync(p) && statSync(p).isFile()) return p; } catch { /* not readable */ }
  }
  if (win) {
    for (const base of [env.ProgramFiles, env['ProgramW6432'], env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')]) {
      if (!base) continue;
      const p = join(base, 'Git', 'cmd', 'git.exe');
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export interface GitRun { ok: boolean; code: number | null; stdout: string; stderr: string; argv: string[]; timedOut: boolean; truncated: boolean }

/** git with `args` in `cwd`: no terminal to ask for a password in (GIT_TERMINAL_PROMPT=0, the credential manager may
 *  still show its own window), `input` on stdin, at most `limit` characters of stdout kept */
export function runGit(exe: string, cwd: string, args: string[], opts: { input?: string; timeout?: number; limit?: number } = {}): Promise<GitRun> {
  const argv = [exe, ...args];
  return new Promise(done => {
    let stdout = '', stderr = '', truncated = false, timedOut = false, settled = false;
    const finish = (r: Omit<GitRun, 'argv' | 'stdout' | 'stderr' | 'timedOut' | 'truncated'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ ...r, argv, stdout, stderr, timedOut, truncated });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
    } catch (e) {
      stderr = (e as Error).message;
      done({ ok: false, code: null, stdout, stderr, argv, timedOut, truncated });
      return;
    }
    const limit = opts.limit ?? 8 * 1024 * 1024;
    child.stdout?.setEncoding('utf8').on('data', (s: string) => {
      if (stdout.length >= limit) { truncated = true; return; }
      stdout += s;
      if (stdout.length > limit) { stdout = stdout.slice(0, limit); truncated = true; }
    });
    child.stderr?.setEncoding('utf8').on('data', (s: string) => { if (stderr.length < 256 * 1024) stderr += s; });
    child.on('error', e => { stderr += e.message; finish({ ok: false, code: null }); });
    child.on('close', code => finish({ ok: code === 0, code }));
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(opts.input ?? '');
    const timer = setTimeout(() => { timedOut = true; child.kill(); finish({ ok: false, code: null }); }, opts.timeout ?? RUN_MS);
  });
}

const commandLine = (argv: string[]) => argv.map((a, i) => (i === 0 ? 'git' : /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');

/** Git for the project in `dir()` (its folder; null without a project). Commands wait for the one before them. */
export class GitService {
  private queue: Promise<unknown> = Promise.resolve();
  private found: { exe: string | null; version: string } | null = null;

  constructor(private readonly dir: () => string | null, private readonly exe: () => string | null = () => findGit()) {}

  /** one command after another: two at once would meet at git's index.lock */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** the git found, and its version (looked for again while there is none: it may be installed meanwhile) */
  async version(): Promise<GitVersion> {
    if (!this.found?.exe) {
      const exe = this.exe();
      if (!exe) { this.found = null; return null; }
      const r = await runGit(exe, process.cwd(), ['--version'], { timeout: 15_000 });
      if (!r.ok) return null;
      this.found = { exe, version: r.stdout.trim().replace(/^git version\s*/, '') };
    }
    return { path: this.found.exe!, version: this.found.version };
  }

  private async git(): Promise<string> {
    const v = await this.version();
    if (!v) throw new Error('Git is not installed: Mimir found no git.exe on PATH or in Program Files. Install Git for Windows (git-scm.com) and try again.');
    return v.path;
  }

  private project(): string {
    const d = this.dir();
    if (!d) throw new Error('No project is open: git works in a project\'s folder. Save the work as a project first (Ctrl+S).');
    return d;
  }

  /** the root of the repository `dir` is in; null: none */
  private async rootOf(exe: string, dir: string): Promise<string | null> {
    if (!existsSync(dir)) return null;
    const r = await runGit(exe, dir, ['rev-parse', '--show-toplevel'], { timeout: 15_000 });
    return r.ok && r.stdout.trim() ? resolve(r.stdout.trim()) : null;
  }

  status(): Promise<GitStatus> { return this.serial(() => this.readStatus()); }

  private async readStatus(): Promise<GitStatus> {
    const git = await this.version();
    const dir = this.dir();
    if (!git || !dir) return { git, dir, repo: null };
    const root = await this.rootOf(git.path, dir);
    if (!root) return { git, dir, repo: null };
    const [st, rem, log] = await Promise.all([
      runGit(git.path, root, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']),
      runGit(git.path, root, ['remote', '-v']),
      runGit(git.path, root, ['log', `-n${GIT_LOG}`, `--format=${LOG_FORMAT}`, '--no-color']),
    ]);
    if (!st.ok) throw new Error(`git status failed: ${(st.stderr || st.stdout).trim()}`);
    const s = parseStatus(st.stdout);
    const repo: GitRepo = { root, branch: s.branch, head: s.head, upstream: s.upstream, ahead: s.ahead, behind: s.behind, remotes: rem.ok ? parseRemotes(rem.stdout) : [], files: s.files, log: log.ok ? parseLog(log.stdout) : [] };
    return { git, dir, repo };
  }

  /** the commands of one step, one after another while they work, and the repository after them */
  private op(fn: (exe: string, root: string) => Promise<GitRun[]>): Promise<GitOpResult> {
    return this.serial(async () => {
      const exe = await this.git();
      const dir = this.project();
      const root = await this.rootOf(exe, dir);
      if (!root) throw new Error(`${dir} is not in a git repository: create one first`);
      const runs = await fn(exe, root);
      const status = await this.readStatus();
      return { ok: runs.every(r => r.ok), output: runs.map(r => `> ${commandLine(r.argv)}\n${[r.stdout, r.stderr].map(s => s.trim()).filter(Boolean).join('\n')}${r.timedOut ? '\n(stopped: it took too long)' : ''}`).join('\n\n'), argv: runs.map(r => r.argv), status };
    });
  }

  /** a repository in the project's folder (git init, on main unless the user's git says otherwise), with Mimir's
   *  .gitignore and .gitattributes where there are none */
  init(): Promise<GitOpResult> {
    return this.serial(async () => {
      const exe = await this.git();
      const dir = this.project();
      const { runs } = await initRepository(exe, dir);
      const status = await this.readStatus();
      return { ok: runs.every(r => r.ok), output: runs.map(r => `> ${commandLine(r.argv)}\n${[r.stdout, r.stderr].map(s => s.trim()).filter(Boolean).join('\n')}`).join('\n\n'), argv: runs.map(r => r.argv), status };
    });
  }

  /** `paths` staged (deleted files too), or every change */
  async stage(paths?: string[]): Promise<GitOpResult> {
    const list = checkPaths(paths);
    return this.op(async (exe, root) => [list
      ? await runGit(exe, root, ['--literal-pathspecs', 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: list.join('\0') })
      : await runGit(exe, root, ['add', '-A'])]);
  }

  /** `paths` taken out of what is staged (the folder keeps them as they are), or everything staged */
  async unstage(paths?: string[]): Promise<GitOpResult> {
    const list = checkPaths(paths);
    return this.op(async (exe, root) => {
      const born = (await runGit(exe, root, ['rev-parse', '--verify', '-q', 'HEAD'])).ok;
      // before the first commit there is no HEAD to go back to: the files leave the index
      if (!born) return [list
        ? await runGit(exe, root, ['--literal-pathspecs', 'rm', '--cached', '-r', '-q', '--ignore-unmatch', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: list.join('\0') })
        : await runGit(exe, root, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', '.'])];
      return [list
        ? await runGit(exe, root, ['--literal-pathspecs', 'reset', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: list.join('\0') })
        : await runGit(exe, root, ['reset', '-q'])];
    });
  }

  /** what is staged, committed with `message` (read from stdin: any text, any length) */
  async commit(message: string): Promise<GitOpResult> {
    const m = message.replace(/\r\n/g, '\n').trim();
    if (!m) throw new Error('Write a commit message first');
    return this.op(async (exe, root) => [await runGit(exe, root, ['commit', '-q', '--file=-', '--cleanup=whitespace'], { input: m + '\n' })]);
  }

  /** the branch pushed: to its upstream, else to origin (or the only remote) as a branch of the same name, which then
   *  becomes its upstream */
  push(): Promise<GitOpResult> {
    return this.op(async (exe, root) => {
      const st = parseStatus((await runGit(exe, root, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=no'])).stdout);
      if (!st.branch) throw new Error('HEAD is not on a branch (a detached HEAD): check a branch out to push it');
      if (!st.head) throw new Error('There is nothing to push yet: commit first');
      if (st.upstream) return [await runGit(exe, root, ['push'], { timeout: PUSH_MS })];
      const remotes = parseRemotes((await runGit(exe, root, ['remote', '-v'])).stdout);
      const remote = remotes.find(r => r.name === 'origin') ?? (remotes.length === 1 ? remotes[0] : null);
      if (!remote) throw new Error(remotes.length ? `The branch has no upstream and there is no origin among ${remotes.map(r => r.name).join(', ')}: push from a terminal` : 'There is no remote to push to: add one (the URL of a GitHub repository, say) first');
      return [await runGit(exe, root, ['push', '-u', remote.name, 'HEAD'], { timeout: PUSH_MS })];
    });
  }

  /** origin's URL: added, or changed when there is an origin */
  async remote(url: string): Promise<GitOpResult> {
    const problem = remoteUrlProblem(url);
    if (problem) throw new Error(problem);
    const u = url.trim();
    return this.op(async (exe, root) => {
      const has = parseRemotes((await runGit(exe, root, ['remote', '-v'])).stdout).some(r => r.name === 'origin');
      return [await runGit(exe, root, has ? ['remote', 'set-url', 'origin', '--', u] : ['remote', 'add', '--', 'origin', u])];
    });
  }

  /** the changes of one file: staged or not; an untracked one is shown whole, as new */
  async diff(req: GitDiffRequest): Promise<GitDiffResult> {
    const [path, from] = checkPaths([req.path, ...(req.from ? [req.from] : [])])!;
    return this.serial(async () => {
      const exe = await this.git();
      const root = await this.rootOf(exe, this.project());
      if (!root) throw new Error('The project is not in a git repository');
      if (!req.staged) {
        const tracked = await runGit(exe, root, ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', path]);
        if (!tracked.ok) return newFile(join(root, path), path);
      }
      const r = await runGit(exe, root, ['--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '-M', ...(req.staged ? ['--cached'] : []), '--', ...(from ? [from] : []), path], { limit: DIFF_LIMIT });
      if (!r.ok) throw new Error((r.stderr || r.stdout).trim() || 'git diff failed');
      return { text: r.stdout, truncated: r.truncated, binary: /^Binary files .* differ$/m.test(r.stdout) && !/^@@/m.test(r.stdout) };
    });
  }
}

/** the paths the renderer named, checked; undefined: none named (every change) */
function checkPaths(paths?: string[]): string[] | undefined {
  if (!paths) return undefined;
  if (!paths.length) throw new Error('No files named');
  for (const p of paths) { const problem = gitPathProblem(p); if (problem) throw new Error(`${p}: ${problem}`); }
  return paths.map(p => p.replace(/\\/g, '/'));
}

/** a file git does not track yet, as a diff that adds it whole */
async function newFile(full: string, path: string): Promise<GitDiffResult> {
  const fh = await open(full, 'r');
  try {
    const buf = Buffer.alloc(DIFF_LIMIT + 1);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const bytes = buf.subarray(0, Math.min(bytesRead, DIFF_LIMIT));
    if (bytes.includes(0)) return { text: `new file ${path}\nBinary file (${(await fh.stat()).size} bytes)\n`, truncated: false, binary: true };
    const lines = bytes.toString('utf8').replace(/\r\n/g, '\n').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return { text: `new file ${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => '+' + l).join('\n')}\n`, truncated: bytesRead > DIFF_LIMIT, binary: false };
  } finally { await fh.close(); }
}

/**
 * A repository in `dir`: git init (on main, unless the user's git names its own first branch with init.defaultBranch),
 * then Mimir's .gitignore and .gitattributes where there are none. `nested`: `dir` was in a repository already, whose
 * root this is (the new repository is one of its own inside it).
 */
export async function initRepository(exe: string, dir: string): Promise<{ runs: GitRun[]; outcome: GitInitOutcome }> {
  const above = await runGit(exe, dir, ['rev-parse', '--show-toplevel'], { timeout: 15_000 });
  const outer = above.ok && above.stdout.trim() ? resolve(above.stdout.trim()) : null;
  if (outer && outer.toLowerCase() === resolve(dir).toLowerCase()) {
    return { runs: [], outcome: { ok: true, root: outer, nested: null, message: `${dir} is a git repository already` } };
  }
  const named = await runGit(exe, dir, ['config', '--get', 'init.defaultBranch'], { timeout: 15_000 });
  const init = await runGit(exe, dir, ['init', ...(named.ok && named.stdout.trim() ? [] : ['-b', 'main'])], { timeout: 30_000 });
  if (!init.ok) return { runs: [init], outcome: { ok: false, root: dir, nested: outer, message: (init.stderr || init.stdout).trim() || 'git init failed' } };
  const wrote: string[] = [];
  for (const [name, text] of [['.gitignore', GIT_IGNORE], ['.gitattributes', GIT_ATTRIBUTES]] as const) {
    const p = join(dir, name);
    if (existsSync(p)) continue;
    await writeFile(p, text);
    wrote.push(name);
  }
  const message = `Created a git repository in ${dir}${wrote.length ? ` with ${wrote.join(' and ')}` : ''}${outer ? ` (inside the repository ${outer}, which sees it as a folder of its own)` : ''}`;
  return { runs: [init], outcome: { ok: true, root: dir, nested: outer, message } };
}
