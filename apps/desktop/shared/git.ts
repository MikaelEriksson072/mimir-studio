/* Git for a project's folder (spec 13.10b): what git's own output says, read the same way in the main process and in
 * the tests. The main process runs git (electron/main/git.ts); the renderer only shows what this reads. */
import type { GitChange, GitCommit, GitFile, GitRangeFile, GitRemote } from './ipc';

/** what a new repository made by Mimir leaves out: KickAss.jar's output, made again by every build */
export const GIT_IGNORE = `# Mimir: KickAss.jar's output, made again by every build (F7, F5)
build/
`;

/** What an Assembler project's .gitignore leaves out besides Mimir's (spec 10.7): what its builds write (out, beside the
 *  main file) and what Pack writes (packed). Each is added once: a line already there, or its comment (the line taken
 *  out by hand), is not added again. */
export const ASM_IGNORES: readonly { line: string; re: RegExp; comment: string }[] = [
  { line: 'out/', re: /^\/?out\/?\s*$/m, comment: '# Mimir: the Assembler\'s builds (Run, Build) write the program here' },
  { line: 'packed/', re: /^\/?packed\/?\s*$/m, comment: '# Mimir: Pack writes the packed program here' },
];
/** the .gitignore `text` with what an Assembler project leaves out (ASM_IGNORES) added; null: nothing to add */
export function asmGitIgnore(text: string): string | null {
  let out = text;
  for (const x of ASM_IGNORES) if (!x.re.test(out) && !out.includes(x.comment)) out = `${out}${out && !out.endsWith('\n') ? '\n' : ''}${x.comment}\n${x.line}\n`;
  return out === text ? null : out;
}

/** C64 files are bytes, never text: git on Windows (core.autocrlf) would otherwise turn a $0a in a .prg that happens to
 *  hold no zero byte into $0d $0a when it checks the file out */
export const GIT_ATTRIBUTES = `# Mimir: C64 files are binary, whatever bytes they hold
*.prg binary
*.PRG binary
*.bin binary
*.d64 binary
*.g64 binary
*.crt binary
*.tap binary
*.t64 binary
*.vsf binary
*.sid binary
*.kla binary
*.art binary
*.64c binary
*.png binary
`;

/** what `git status --porcelain=v2 --branch -z` says */
export interface StatusRead {
  /** the branch checked out; null: a detached HEAD */
  branch: string | null;
  /** the commit HEAD is at; null: no commit yet */
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
}

const CHANGES = new Set<GitChange>(['.', 'M', 'T', 'A', 'D', 'R', 'C', 'U']);
const change = (c: string | undefined): GitChange => (c && CHANGES.has(c as GitChange) ? (c as GitChange) : '.');

/**
 * `git status --porcelain=v2 --branch -z` read: the branch headers, then one entry per file. With -z every field ends in
 * a NUL, paths are as they are (no quoting), and a rename's old path is the field after its entry.
 */
export function parseStatus(out: string): StatusRead {
  const r: StatusRead = { branch: null, head: null, upstream: null, ahead: 0, behind: 0, files: [] };
  const f = out.split('\0');
  for (let i = 0; i < f.length; i++) {
    const e = f[i];
    if (!e) continue;
    if (e.startsWith('# ')) {
      const [, key, ...rest] = e.split(' ');
      const v = rest.join(' ');
      if (key === 'branch.oid') r.head = v === '(initial)' ? null : v;
      else if (key === 'branch.head') r.branch = v === '(detached)' ? null : v;
      else if (key === 'branch.upstream') r.upstream = v;
      else if (key === 'branch.ab') { const m = /^\+(\d+) -(\d+)$/.exec(v); if (m) { r.ahead = +m[1]; r.behind = +m[2]; } }
      continue;
    }
    const kind = e[0];
    if (kind === '?') { r.files.push({ path: e.slice(2), index: '.', work: '?', kind: 'untracked' }); continue; }
    if (kind === '!') continue;
    // 1 XY sub mH mI mW hH hI path / 2 XY sub mH mI mW hH hI Xscore path NUL from / u XY sub m1 m2 m3 mW h1 h2 h3 path
    const fields = kind === '1' ? 8 : kind === '2' ? 9 : kind === 'u' ? 10 : -1;
    if (fields < 0) continue;
    const parts = e.split(' ');
    const path = parts.slice(fields).join(' ');
    const xy = parts[1] ?? '..';
    if (kind === 'u') { r.files.push({ path, index: 'U', work: 'U', kind: 'conflict' }); continue; }
    const file: GitFile = { path, index: change(xy[0]), work: change(xy[1]), kind: 'changed' };
    if (kind === '2') { file.from = f[i + 1]; i++; }
    r.files.push(file);
  }
  return r;
}

/** `git remote -v` read: each remote once, with the URL it pushes to (else the one it fetches from) */
export function parseRemotes(out: string): GitRemote[] {
  const by = new Map<string, GitRemote>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\S+)\s+(.+?)\s+\((fetch|push)\)$/.exec(line.trim());
    if (!m) continue;
    const had = by.get(m[1]);
    if (!had || m[3] === 'push') by.set(m[1], { name: m[1], url: m[2] });
  }
  return [...by.values()];
}

/** the fields of LOG_FORMAT, apart (the message's body last: it may hold anything but the record separator); each
 *  commit ends in a record separator */
export const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%at%x1f%P%x1f%s%x1f%b%x1e';
export function parseLog(out: string): GitCommit[] {
  return out.split('\x1e').map(s => s.replace(/^\r?\n/, '')).filter(Boolean).map(s => {
    const [hash = '', short = '', author = '', at = '0', parents = '', subject = '', ...body] = s.split('\x1f');
    return { hash, short, author, time: (+at || 0) * 1000, subject, parents: parents.split(' ').filter(Boolean), body: body.join('\x1f').replace(/\r\n/g, '\n').trim() };
  }).filter(c => c.hash);
}

/**
 * `git diff --name-status -z` read: each file's change and path, a rename's or copy's old path before its new one
 * (R100, C075: the letter, then how alike the two are).
 */
export function parseNameStatus(out: string): GitRangeFile[] {
  const f = out.split('\0'), files: GitRangeFile[] = [];
  for (let i = 0; i < f.length; i++) {
    const code = f[i];
    if (!code) continue;
    const c = change(code[0]);
    if (code[0] === 'R' || code[0] === 'C') { const from = f[++i] ?? '', path = f[++i] ?? ''; if (path) files.push({ path, from, change: c }); continue; }
    const path = f[++i];
    if (path) files.push({ path, change: c === '.' ? 'M' : c });
  }
  return files;
}

/**
 * `git diff --numstat -z` read into `files` (by path): the lines added and taken away, `-` for both in a binary file.
 * A rename's entry has an empty path, then its old and its new path.
 */
export function addNumstat(files: GitRangeFile[], out: string): GitRangeFile[] {
  const by = new Map(files.map(x => [x.path, x]));
  const f = out.split('\0');
  for (let i = 0; i < f.length; i++) {
    const e = f[i];
    if (!e) continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(e);
    if (!m) continue;
    let path = m[3];
    if (!path) { i++; path = f[++i] ?? ''; }
    const file = by.get(path);
    if (!file) continue;
    if (m[1] === '-') file.binary = true;
    else { file.added = +m[1]; file.removed = +m[2]; }
  }
  return files;
}

/** What is wrong with `p` as a path in the repository the renderer names (relative, with / or \, nothing above the
 *  root), or null when it will do. git reads it as it is (--literal-pathspecs): no wildcards, no :(magic). */
export function gitPathProblem(p: string): string | null {
  if (!p || p.length > 4096) return 'no path';
  if (/[\0\r\n]/.test(p)) return 'a path cannot hold a line break or a NUL';
  if (/^[\\/]/.test(p) || /^[a-z]:/i.test(p)) return 'the path is not relative to the repository';
  if (p.split(/[\\/]/).some(s => s === '..')) return 'the path goes above the repository';
  return null;
}

/** What is wrong with `url` as a remote's URL (https, ssh, git or file URLs, or scp's user@host:path), or null. */
export function remoteUrlProblem(url: string): string | null {
  const u = url.trim();
  if (!u) return 'Give the URL of the repository (for GitHub: https://github.com/<you>/<repository>.git)';
  if (u.length > 2048 || /\s/.test(u)) return 'A URL has no spaces';
  if (u.startsWith('-')) return 'A URL does not start with -';
  if (/^(https?|ssh|git|file):\/\/[^\s]+$/i.test(u)) return null;
  if (/^[\w.-]+@[\w.-]+:[^\s]+$/.test(u)) return null;
  return 'Not a URL git pushes to: https://…, ssh://… or git@host:path';
}

/** a change's letter in words */
export const CHANGE_WORD: Record<GitChange | '?', string> = {
  '.': 'unchanged', M: 'modified', T: 'type changed', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'in conflict', '?': 'untracked',
};

/** what is staged (index) and what is not (work tree): a file can be in both, with changes of each */
export const stagedFiles = (files: GitFile[]): GitFile[] => files.filter(f => f.kind === 'changed' && f.index !== '.');
export const unstagedFiles = (files: GitFile[]): GitFile[] => files.filter(f => f.kind === 'untracked' || (f.kind === 'changed' && f.work !== '.'));
export const conflictFiles = (files: GitFile[]): GitFile[] => files.filter(f => f.kind === 'conflict');
