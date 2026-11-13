/* The Git tab (spec 13.10b): the project's repository. Its branch and where it pushes, the changes staged and those that
 * are not (a click shows a file's changes, its button or a double-click stages or unstages it), a commit message,
 * Push when there is a remote (and a field for origin's URL when there is none), and the newest commits. git runs in
 * the main process (electron/main/git.ts), always in the project's repository; without a project, or in a folder that
 * is no repository yet, the tab says so and offers what makes one. */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CHANGE_WORD, conflictFiles, remoteUrlProblem, stagedFiles, unstagedFiles } from '../../shared/git';
import type { GitChange, GitDiffResult, GitFile, GitOpResult, GitStatus, ProjectHome } from '../../shared/ipc';
import { Icon } from '../lib/icons';
import { cx, errorText } from '../lib/util';

type ToastKind = 'ok' | 'warn' | 'err' | 'info';

/** commit messages being written, by repository: they stay while another tab is shown */
const drafts = new Map<string, string>();

/** how often the tab looks at the repository again while it is shown (the project file is saved as you work) */
const POLL_MS = 4000;

/** a change as the tab writes it: git's letter, an untracked file U (new) and a conflict ! */
const letter = (c: GitChange, kind: GitFile['kind']): string => (kind === 'conflict' ? '!' : c === '?' ? 'U' : c);
const word = (c: GitChange, kind: GitFile['kind']): string => (kind === 'conflict' ? 'in conflict: both sides changed it' : c === '?' ? 'untracked: new, git does not have it yet' : CHANGE_WORD[c]);

/** when a commit was made, in a few words */
function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString();
}

/** the line of git's output that says what went wrong (error:, fatal:, a rejected ref), for the toast */
function failure(output: string): string {
  const lines = output.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('> '));
  return lines.find(l => /^(fatal|error):|^! \[|rejected/.test(l)) ?? lines[lines.length - 1] ?? 'git failed';
}

/** what a file is shown with: the changes staged, or those that are not */
interface Shown { path: string; from?: string; staged: boolean }

export interface GitViewProps {
  /** the project (null: work without a project) */
  home: ProjectHome | null;
  /** the project file written now, so what is staged and committed is the work as it is */
  saveNow: () => Promise<unknown>;
  /** Save: a project made of the work without one */
  onCreateProject: () => void;
  /** a terminal in the project's folder, for what the tab does not do */
  onTerminal: () => void;
  toast: (msg: string, kind?: ToastKind) => void;
}

export function GitView({ home, saveNow, onCreateProject, onTerminal, toast }: GitViewProps) {
  // read at each render: the desktop app's API (the renderer alone in a browser has none)
  const kr = window.kr;
  const [st, setSt] = useState<GitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const [out, setOut] = useState<{ ok: boolean; text: string; what: string } | null>(null);
  const repo = st?.repo ?? null;
  const root = repo?.root ?? '';
  const [msg, setMsgState] = useState('');
  const setMsg = (m: string) => { setMsgState(m); if (root) { if (m) drafts.set(root, m); else drafts.delete(root); } };
  useEffect(() => { setMsgState(drafts.get(root) ?? ''); }, [root]);
  const [shown, setShown] = useState<Shown | null>(null);
  const [diff, setDiff] = useState<{ for: Shown; res: GitDiffResult } | { for: Shown; error: string } | null>(null);
  /** origin's URL being written (null: not editing) */
  const [remoteEdit, setRemoteEdit] = useState<string | null>(null);
  /** a look again at the shown file's changes (focus, Refresh, a step done) */
  const [tick, setTick] = useState(0);
  const msgRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    if (!kr || busyRef.current) return;
    try { setSt(await kr.gitStatus()); setError(null); } catch (e) { setError(errorText(e)); }
  }, [kr]);

  useEffect(() => { setSt(null); setShown(null); setOut(null); void refresh(); }, [home?.dir, refresh]);
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') { void refresh(); setTick(n => n + 1); } };
    window.addEventListener('focus', again);
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
    return () => { window.removeEventListener('focus', again); clearInterval(t); };
  }, [refresh]);

  const staged = useMemo(() => stagedFiles(repo?.files ?? []), [repo]);
  const changes = useMemo(() => unstagedFiles(repo?.files ?? []), [repo]);
  const conflicts = useMemo(() => conflictFiles(repo?.files ?? []), [repo]);
  /** the shown file as the status has it now: its changes are looked at again when they are another */
  const shownSig = shown ? JSON.stringify(repo?.files.find(f => f.path === shown.path) ?? null) + (repo?.head ?? '') : '';

  useEffect(() => {
    if (!kr || !shown) { setDiff(null); return; }
    let gone = false;
    kr.gitDiff(shown).then(res => { if (!gone) setDiff({ for: shown, res }); }, (e: unknown) => { if (!gone) setDiff({ for: shown, error: errorText(e) }); });
    return () => { gone = true; };
  }, [kr, shown, shownSig, tick]);

  /** a step: its git commands, then the repository after them; what git wrote is kept below the lists */
  const op = async (what: string, fn: () => Promise<GitOpResult>, done?: (r: GitOpResult) => void) => {
    if (!kr || busyRef.current) return;
    busyRef.current = what; setBusy(what);
    try {
      const r = await fn();
      setSt(r.status); setError(null);
      setOut({ ok: r.ok, text: r.output, what });
      if (r.ok) done?.(r);
      else toast(`${what} failed: ${failure(r.output)}`, 'err');
    } catch (e) {
      setOut({ ok: false, text: errorText(e), what });
      toast(errorText(e), 'err');
    } finally {
      busyRef.current = null; setBusy(null); setTick(n => n + 1);
    }
  };

  const stage = (paths?: string[]) => void op(paths ? `Stage ${paths.length === 1 ? paths[0] : `${paths.length} files`}` : 'Stage all', async () => { await saveNow(); return kr!.gitStage(paths ? { paths } : {}); },
    () => { if (shown && !shown.staged && (!paths || paths.includes(shown.path))) setShown({ ...shown, staged: true }); });
  const unstage = (paths?: string[]) => void op(paths ? `Unstage ${paths.length === 1 ? paths[0] : `${paths.length} files`}` : 'Unstage all', () => kr!.gitUnstage(paths ? { paths } : {}),
    () => { if (shown?.staged && (!paths || paths.includes(shown.path))) setShown({ ...shown, staged: false }); });
  const commit = () => {
    if (!msg.trim()) { msgRef.current?.focus(); toast('Write a commit message first', 'warn'); return; }
    if (!staged.length) { toast('Nothing is staged: stage the changes to commit first', 'warn'); return; }
    void op('Commit', async () => { await saveNow(); return kr!.gitCommit({ message: msg }); }, r => {
      setMsg('');
      const c = r.status.repo?.log[0];
      toast(c ? `Committed ${c.short}: ${c.subject}` : 'Committed', 'ok');
    });
  };
  const push = () => void op('Push', () => kr!.gitPush(), r => {
    const g = r.status.repo;
    toast(`Pushed ${g?.branch ?? 'the branch'}${g?.upstream ? ` to ${g.upstream}` : ''}`, 'ok');
  });
  const setRemote = (url: string) => {
    const problem = remoteUrlProblem(url);
    if (problem) { toast(problem, 'warn'); return; }
    void op(repo?.remotes.some(r => r.name === 'origin') ? 'Change origin' : 'Add origin', () => kr!.gitRemote({ url: url.trim() }), () => setRemoteEdit(null));
  };
  const init = () => void op('Create the repository', () => kr!.gitInit(), () => toast(`Created a git repository in ${home?.dir}`, 'ok'));

  const onMsgKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commit(); }
  };

  if (!kr) return <GitEmpty title="Git runs in the desktop app" text="The git commands run in Mimir's main process, in the project's folder. This page is the renderer alone, without it." />;
  if (!home) return <GitEmpty title="Git works in a project's folder" text="This is work without a project: it is in no folder of yours yet. Save it as a project first (Ctrl+S), and tick Create a git repository there.">
    <button className="btn primary" onClick={onCreateProject}><Icon name="folder" size={14} />Create a project from this work…</button>
  </GitEmpty>;
  if (!st && error) return <GitEmpty title="Git did not answer" text={error}><button className="btn" onClick={() => void refresh()}><Icon name="refresh" size={14} />Try again</button></GitEmpty>;
  if (!st) return <div className="empty">Looking at the repository…</div>;
  if (!st.git) return <GitEmpty title="Git is not installed" text="Mimir found no git.exe on PATH or in Program Files. Install Git for Windows (git-scm.com), then look again.">
    <button className="btn" onClick={() => void refresh()}><Icon name="refresh" size={14} />Look again</button>
  </GitEmpty>;
  if (!repo) return <GitEmpty title={`${home.name} is not a git repository`} text={`Create one in ${home.dir}: git keeps every commit of the project file, the source and the packed file, and pushes them to GitHub or a server of your own.`}
    note={<>With a <span className="mono">.gitignore</span> that leaves out <span className="mono">build</span> (KickAss.jar's output, made again by every build) and a <span className="mono">.gitattributes</span> that keeps C64 files binary, where there are none. Git {st.git.version}.</>}>
    <button className="btn primary" disabled={!!busy} onClick={init}><Icon name="git" size={14} />{busy ? 'Creating…' : 'Create a git repository'}</button>
  </GitEmpty>;

  const origin = repo.remotes.find(r => r.name === 'origin') ?? null;
  const canPush = !!repo.head && !!repo.branch && repo.remotes.length > 0 && (!repo.upstream || repo.ahead > 0);
  const pushTip = !repo.remotes.length ? 'There is no remote to push to: add origin below'
    : !repo.head ? 'There is nothing to push yet: commit first'
    : !repo.branch ? 'HEAD is not on a branch'
    : !repo.upstream ? `Push ${repo.branch} to ${origin?.name ?? repo.remotes[0].name} as a branch of the same name, and push there from then on`
    : repo.ahead ? `Push ${repo.ahead} commit${repo.ahead === 1 ? '' : 's'} to ${repo.upstream}` : `Nothing to push: ${repo.upstream} has every commit`;
  const inside = st.dir && repo.root.toLowerCase() !== st.dir.toLowerCase();

  return (
    <div className="git">
      <div className="git-main">
        <div className="git-head">
          <Icon name="git" size={16} />
          <b className="git-branch" title={repo.branch ? `The branch checked out${repo.head ? `, at ${repo.head.slice(0, 12)}` : ', with no commit yet'}` : 'A detached HEAD: no branch is checked out'}>{repo.branch ?? `detached at ${repo.head?.slice(0, 7)}`}</b>
          {repo.upstream && <span className="muted mono git-up" title="The branch it pushes to">→ {repo.upstream}</span>}
          {repo.ahead > 0 && <span className="pill user" title={`${repo.ahead} commit${repo.ahead === 1 ? '' : 's'} not pushed`}>↑{repo.ahead}</span>}
          {repo.behind > 0 && <span className="pill mid" title={`${repo.behind} commit${repo.behind === 1 ? '' : 's'} on ${repo.upstream} that are not here (as git knew it at the last fetch): pull them in a terminal before pushing`}>↓{repo.behind}</span>}
          <span className="grow" />
          {busy && <span className="git-busy muted"><span className="spinner" />{busy}…</span>}
          {repo.remotes.length > 0 && <button className={cx('btn small', canPush && 'primary')} disabled={!canPush || !!busy} onClick={push} title={pushTip}><Icon name="upload" size={14} />{repo.upstream ? `Push${repo.ahead ? ` ${repo.ahead}` : ''}` : 'Push'}</button>}
          <button className="icon-btn" onClick={() => { void refresh(); setTick(n => n + 1); }} disabled={!!busy} title="Look at the repository again (it is looked at every few seconds, and when Mimir gets the focus)" aria-label="Refresh"><Icon name="refresh" size={15} /></button>
        </div>
        <div className="git-root mono" title={repo.root}>{repo.root}{inside && <span className="muted"> (the project's folder is inside it)</span>}</div>

        <div className="git-commit-box">
          <textarea ref={msgRef} value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={onMsgKey} rows={3} spellCheck={false} aria-label="Commit message"
            placeholder={staged.length ? `Message for ${staged.length} staged file${staged.length === 1 ? '' : 's'} (Ctrl+Enter commits)` : 'Commit message (Ctrl+Enter commits)'} />
          <div className="git-commit-row">
            <button className="btn primary small" disabled={!!busy || !staged.length || !msg.trim()} onClick={commit} title={!staged.length ? 'Stage the changes to commit first' : !msg.trim() ? 'Write a commit message first' : `Commit the ${staged.length} staged file${staged.length === 1 ? '' : 's'} (Ctrl+Enter)`}>
              <Icon name="check" size={14} />Commit{staged.length ? ` ${staged.length}` : ''}
            </button>
            <span className="muted small">{staged.length ? `${staged.length} staged` : changes.length ? 'Stage what goes in the commit' : 'Nothing to commit'}{repo.branch ? ` · on ${repo.branch}` : ''}</span>
          </div>
        </div>

        {conflicts.length > 0 && <GitList title="Conflicts" files={conflicts} staged={false} shown={shown} busy={!!busy} onShow={setShown}
          act={{ icon: 'plus', label: 'Stage: the conflict is resolved', run: f => stage([f.path]) }} note="Resolve them in the files (or a terminal), then stage them." />}
        <GitList title="Staged" files={staged} staged shown={shown} busy={!!busy} onShow={setShown}
          act={{ icon: 'minus', label: 'Unstage', run: f => unstage([f.path]) }} all={{ label: 'Unstage all', run: () => unstage() }} />
        <GitList title="Changes" files={changes} staged={false} shown={shown} busy={!!busy} onShow={setShown}
          act={{ icon: 'plus', label: 'Stage', run: f => stage([f.path]) }} all={{ label: 'Stage all', run: () => stage() }}
          note={!changes.length && !staged.length && !conflicts.length ? (repo.head ? 'The folder is as the last commit left it.' : 'No files yet.') : undefined} />

        <section className="git-sec" aria-label="Remote">
          <h3>Remote</h3>
          {repo.remotes.map(r => <div key={r.name} className="git-remote">
            <span className="git-remote-name">{r.name}</span><span className="mono git-remote-url" title={r.url}>{r.url}</span>
            {r.name === 'origin' && remoteEdit == null && <button className="icon-btn" disabled={!!busy} onClick={() => setRemoteEdit(r.url)} title="Change origin's URL" aria-label="Change origin's URL"><Icon name="pencil" size={13} /></button>}
          </div>)}
          {(!repo.remotes.length || remoteEdit != null) && <form className="git-remote-form" onSubmit={e => { e.preventDefault(); setRemote(remoteEdit ?? ''); }}>
            {!repo.remotes.length && <p className="muted small">Push needs a remote: a repository on GitHub, GitLab, Bitbucket or a server of your own. Create an empty one there (no README) and give its URL. Git for Windows asks you to sign in the first time it pushes.</p>}
            <div className="git-remote-row">
              <input className="mono" value={remoteEdit ?? ''} onChange={e => setRemoteEdit(e.target.value)} onFocus={() => { if (remoteEdit == null) setRemoteEdit(''); }} placeholder="https://github.com/you/repository.git" spellCheck={false} aria-label="origin's URL" />
              <button type="submit" className="btn small" disabled={!!busy || !(remoteEdit ?? '').trim()}>{origin ? 'Change' : 'Add origin'}</button>
              {origin && <button type="button" className="btn small ghost" onClick={() => setRemoteEdit(null)}>Cancel</button>}
            </div>
          </form>}
        </section>

        <section className="git-sec" aria-label="Commits">
          <h3>Commits{repo.log.length ? <span className="muted"> · the newest {repo.log.length}</span> : null}</h3>
          {repo.log.length ? <ul className="git-log">
            {repo.log.map(c => <li key={c.hash} title={`${c.hash}\n${c.author}, ${new Date(c.time).toLocaleString()}`}>
              <span className="mono git-hash">{c.short}</span><span className="git-subject">{c.subject}</span><span className="muted git-when">{ago(c.time)}</span>
            </li>)}
          </ul> : <div className="empty small">No commits yet.</div>}
        </section>

        {out && <details className={cx('git-out', !out.ok && 'bad')} open={!out.ok}>
          <summary>{out.what}: {out.ok ? 'done' : 'failed'}</summary>
          <pre>{out.text}</pre>
        </details>}
        {error && <div className="np-error" role="alert">{error}</div>}
        <div className="git-foot muted small">Pull, branches and the rest: <button className="btn small ghost" onClick={onTerminal}><Icon name="prompt" size={13} />Terminal</button> <span>Git {st.git.version}</span></div>
      </div>

      <div className="git-diff" aria-label="The file's changes">
        {shown ? <>
          <div className="git-diff-head">
            <span className="mono git-diff-path" title={shown.path}>{shown.from ? `${shown.from} → ` : ''}{shown.path}</span>
            <span className="pill">{shown.staged ? 'staged' : 'not staged'}</span>
            <span className="grow" />
            <button className="icon-btn" onClick={() => setShown(null)} aria-label="Close the changes" title="Close"><Icon name="x" size={14} /></button>
          </div>
          <DiffText diff={diff && diff.for.path === shown.path && diff.for.staged === shown.staged ? diff : null} />
        </> : <div className="empty">Click a file to see its changes.</div>}
      </div>
    </div>
  );
}

function GitEmpty({ title, text, note, children }: { title: string; text: string; note?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="empty-project git-empty">
      <Icon name="git" size={30} />
      <h2>{title}</h2>
      <p>{text}</p>
      {children && <div className="empty-actions">{children}</div>}
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}

interface ListProps {
  title: string;
  files: GitFile[];
  /** the list of what is staged: a row shows the staged change */
  staged: boolean;
  shown: Shown | null;
  busy: boolean;
  onShow: (s: Shown) => void;
  /** each row's button (a double-click does the same) */
  act: { icon: 'plus' | 'minus'; label: string; run: (f: GitFile) => void };
  all?: { label: string; run: () => void };
  note?: string;
}

function GitList({ title, files, staged, shown, busy, onShow, act, all, note }: ListProps) {
  if (!files.length && !note) return null;
  return (
    <section className="git-sec" aria-label={title}>
      <h3>{title}{files.length ? <span className="pill">{files.length}</span> : null}<span className="grow" />
        {all && files.length > 0 && <button className="btn tiny" disabled={busy} onClick={all.run}>{all.label}</button>}
      </h3>
      {note && <div className="empty small">{note}</div>}
      <ul className="git-files">
        {files.map(f => {
          const c = staged ? f.index : f.work, at = f.path.lastIndexOf('/');
          const on = shown?.path === f.path && shown.staged === staged;
          const show = () => onShow({ path: f.path, ...(f.from ? { from: f.from } : {}), staged });
          // Enter shows the changes, Space stages or unstages, as a click and a double-click do
          return <li key={f.path} className={cx('git-file', on && 'on')} tabIndex={0} aria-current={on || undefined} onClick={show}
            onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter') { e.preventDefault(); show(); } else if (e.key === ' ') { e.preventDefault(); if (!busy) act.run(f); } }}
            onDoubleClick={() => { if (!busy) act.run(f); }} title={`${f.path}: ${word(c, f.kind)}${f.from ? ` (from ${f.from})` : ''}`}>
            <span className={cx('git-letter', `gl-${letter(c, f.kind) === '!' ? 'x' : letter(c, f.kind)}`)}>{letter(c, f.kind)}</span>
            <span className="git-name">{f.path.slice(at + 1)}</span>
            {at > 0 && <span className="git-dir muted">{f.path.slice(0, at)}</span>}
            <button className="icon-btn" disabled={busy} onClick={e => { e.stopPropagation(); act.run(f); }} title={`${act.label} ${f.path}`} aria-label={`${act.label} ${f.path}`}><Icon name={act.icon} size={14} /></button>
          </li>;
        })}
      </ul>
    </section>
  );
}

function DiffText({ diff }: { diff: { res: GitDiffResult } | { error: string } | null }) {
  if (!diff) return <div className="empty">…</div>;
  if ('error' in diff) return <div className="np-error">{diff.error}</div>;
  const { text, truncated, binary } = diff.res;
  if (!text.trim()) return <div className="empty">No changes of this kind: the file's changes are in the other list.</div>;
  if (binary) return <div className="empty">A binary file: git keeps its bytes, and has no lines to show.</div>;
  const lines = text.split('\n');
  return (
    <pre className="git-diff-text">
      {lines.map((l, i) => <div key={i} className={cx(l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : /^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(l) ? 'meta' : '')}>{l || ' '}</div>)}
      {truncated && <div className="meta">… (only the first 512 KB are shown)</div>}
    </pre>
  );
}
