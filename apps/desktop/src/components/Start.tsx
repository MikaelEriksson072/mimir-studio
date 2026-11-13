/* The start screen: go on with what was worked on last, start a new project, open one, work without a project as
 * before, start empty (Quick work), or pack a file with Brokkr or Exomizer as it is (QuickPack). A project is a folder of its own: its project file and what Mimir writes for it (the Kick Assembler source,
 * the build, the packed file) go there. The New project form is the one "Create a project from this work" shows too. */
import { useEffect, useState, type FormEvent } from 'react';
import { createProject, demoProject, type Project } from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx, errorText } from '../lib/util';
import { forgetUnsavedWork, unsavedWork, unsavedWorkChanged, useProject, workChanged } from '../store/project';
import { useUi } from '../store/ui';
import { projectFileName, projectNameProblem } from '../../shared/projects';
import type { GitVersion, ProjectCreateResult, ProjectStartInfo, RecentProject } from '../../shared/ipc';
import { Logo } from './Logo';
import { Modal } from './Modal';
import { QuickPack } from './QuickPack';

const kr = window.kr;

/** what Quick work's empty work is called, until a file opened names it */
const QUICK_WORK = 'untitled';

/** when a project was opened, in a few words */
function when(ms: number): string {
  const d = new Date(ms), now = new Date();
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return days <= 0 ? `today ${time}` : days === 1 ? `yesterday ${time}` : days < 7 ? `${days} days ago` : d.toLocaleDateString();
}

/** What the note after a new project says about the git repository asked for with it ('' when none was), and whether
 *  making it went wrong (the project is there all the same). */
export function gitNote(r: ProjectCreateResult): { text: string; bad: boolean } {
  const g = r.git;
  if (!g) return { text: '', bad: false };
  if (!g.ok) return { text: `. The git repository was not made: ${g.message}`, bad: true };
  return { text: `, as a git repository${g.nested ? ` of its own inside the repository ${g.nested}` : ''} (the Git tab stages, commits and pushes)`, bad: false };
}

/** `parent` and `name` joined as Windows (or the folder's own separators) writes them */
const joinPath = (parent: string, name: string) => { const sep = parent.includes('/') && !parent.includes('\\') ? '/' : '\\'; return `${parent.replace(/[\\/]+$/, '')}${sep}${name}`; };

interface NewProjectProps {
  /** the name it starts with */
  name: string;
  /** where its folder goes unless another is chosen */
  parent: string;
  /** what moves into it (creating a project from the work without one) */
  moving?: string[];
  submit: string;
  /** `git`: a git repository is made in the folder too */
  onCreate: (name: string, parent: string, git: boolean) => Promise<void>;
  onCancel: () => void;
}

/** A project's name and the folder its own folder goes in. */
export function NewProjectForm({ name: name0, parent: parent0, moving, submit, onCreate, onCancel }: NewProjectProps) {
  const [name, setName] = useState(name0);
  const [parent, setParent] = useState(parent0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** a git repository in the folder too: the box as it was ticked last */
  const git = useUi(s => s.newProjectGit);
  /** the git found (undefined: still looking; null: none, and the box cannot be ticked) */
  const [gitFound, setGitFound] = useState<GitVersion | undefined>(kr ? undefined : null);
  useEffect(() => { let gone = false; kr?.gitVersion().then(v => { if (!gone) setGitFound(v); }, () => { if (!gone) setGitFound(null); }); return () => { gone = true; }; }, []);
  const withGit = git && !!gitFound;
  const problem = projectNameProblem(name);
  const n = name.trim();
  const change = async () => {
    try { const r = await kr?.projectParent(); if (r) setParent(r.dir); } catch (e) { setError(errorText(e)); }
  };
  const create = async (e?: FormEvent) => {
    e?.preventDefault();
    if (problem || busy) return;
    setBusy(true); setError(null);
    try { await onCreate(n, parent, withGit); } catch (err) { setError(errorText(err)); setBusy(false); }
  };
  return (
    <form className="new-project" onSubmit={create} aria-label="New project">
      <label className="field"><span>Name</span>
        <input autoFocus value={name} onChange={e => { setName(e.target.value); setError(null); }} placeholder="my-demo" spellCheck={false} className={cx(!!n && problem && 'bad')} aria-invalid={!!n && !!problem} />
      </label>
      <div className="field"><span>Folder it goes in</span>
        <div className="np-parent"><span className="mono" title={parent}>{parent}</span><button type="button" className="btn small" onClick={() => void change()}><Icon name="folder" size={13} />Change…</button></div>
      </div>
      <div className="np-where">
        {n && !problem
          ? <>Creates <span className="mono">{joinPath(parent, n)}</span> with <span className="mono">{projectFileName(n)}</span> in it. The Kick Assembler source, the build and the packed file go in <span className="mono">source</span>, <span className="mono">build</span> and <span className="mono">packed</span> there, and files you save start there. Mimir saves the project as you work.</>
          : <span className={cx(n && 'bad')}>{problem}</span>}
        {moving && moving.length > 0 && <div className="np-moving">Moves there: {moving.join(', ')}.</div>}
      </div>
      <label className={cx('check np-git', gitFound === null && 'off')} title={gitFound ? `${gitFound.path} (git ${gitFound.version})` : undefined}>
        <input type="checkbox" checked={withGit} disabled={!gitFound} onChange={e => useUi.getState().set({ newProjectGit: e.target.checked })} />
        <span>Create a git repository (.git) in the folder
          <small className="muted">{gitFound === null
            ? ' — git is not installed: Mimir found no git.exe on PATH or in Program Files (Git for Windows, git-scm.com)'
            : <> — with a <span className="mono">.gitignore</span> that leaves out <span className="mono">build</span> and a <span className="mono">.gitattributes</span> that keeps C64 files binary. The Git tab stages, commits and pushes.</>}</small>
        </span>
      </label>
      {error && <div className="np-error" role="alert">{error}</div>}
      <div className="np-foot"><span className="grow" /><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="submit" className="btn primary" disabled={!!problem || busy}>{busy ? 'Creating…' : submit}</button></div>
    </form>
  );
}

/** "Create a project from this work": the New project form in a dialog */
export function CreateProjectModal({ title = 'Create a project from this work', ...p }: Omit<NewProjectProps, 'parent' | 'onCancel'> & { title?: string; onClose: () => void }) {
  const [parent, setParent] = useState<string | null>(null);
  useEffect(() => { kr?.projectStart().then(i => setParent(i.parent), () => setParent('')); }, []);
  return (
    <Modal title={title} onClose={p.onClose}>
      <div className="modal-body">
        {parent == null ? <div className="muted">…</div> : <NewProjectForm {...p} parent={parent} onCancel={p.onClose} />}
      </div>
    </Modal>
  );
}

interface UnsavedWorkProps {
  /** the work without a project */
  name: string;
  /** what takes its place */
  what: string;
  /** the project that is open, which `what` leaves (saved as it is); null: the work open is the work without a project */
  left: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
}

/** "The work is not saved": work without a project, with changes that are in no project, about to be replaced. Save
 *  makes a project of it first */
export function UnsavedWorkModal({ name, what, left, onSave, onDiscard, onClose }: UnsavedWorkProps) {
  return (
    <Modal title={left ? 'The work without a project is not saved' : 'The work is not saved'} onClose={onClose}>
      <div className="modal-body unsaved-work">
        {left
          ? <p>The work without a project Mimir keeps, <b>{name}</b>, has changes that are in no project. Opening {what} leaves {left} (saved as it is) and makes it the work without a project instead: the changes would be gone.</p>
          : <p><b>{name}</b> is work without a project, and its changes are in no project. Opening {what} takes its place: the changes would be gone.</p>}
        <p className="muted">Save as a project puts the work in a folder of its own, and {what} opens after that.</p>
      </div>
      <div className="modal-foot"><span className="grow" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn" onClick={onDiscard}>Do not save</button><button className="btn primary" autoFocus onClick={onSave}>Save as a project…</button></div>
    </Modal>
  );
}

interface CloseUnsavedProps {
  /** the work without a project */
  name: string;
  onSave: () => void;
  onClose: () => void;
  onCancel: () => void;
}

/** Mimir is to close, and the work open is work without a project with changes that are in no project. Save makes a
 *  project of it first; without, Mimir keeps it for the next start as before */
export function CloseUnsavedModal({ name, onSave, onClose, onCancel }: CloseUnsavedProps) {
  return (
    <Modal title="Save the work before Mimir closes?" onClose={onCancel}>
      <div className="modal-body unsaved-work">
        <p><b>{name}</b> is work without a project, and its changes are in no project. Save as a project puts it in a folder of its own before Mimir closes.</p>
        <p className="muted">Close without saving: Mimir still keeps the work for the next start, but not in a folder of yours.</p>
      </div>
      <div className="modal-foot"><span className="grow" /><button className="btn" onClick={onCancel}>Cancel</button><button className="btn" onClick={onClose}>Close without saving</button><button className="btn primary" autoFocus onClick={onSave}>Save as a project…</button></div>
    </Modal>
  );
}

interface CloseNotSavedProps {
  /** the project, and its project file */
  name: string;
  file: string;
  /** why it was not saved */
  error: string;
  onRetry: () => void;
  onClose: () => void;
  onCancel: () => void;
}

/** Mimir is to close, and the project's last change could not be saved to its project file */
export function CloseNotSavedModal({ name, file, error, onRetry, onClose, onCancel }: CloseNotSavedProps) {
  return (
    <Modal title="The project is not saved" onClose={onCancel}>
      <div className="modal-body unsaved-work">
        <p>Mimir could not save <b>{name}</b> to <span className="mono">{file}</span>: {error}</p>
        <p className="muted">Closing now loses the changes made since it was saved last.</p>
      </div>
      <div className="modal-foot"><span className="grow" /><button className="btn" onClick={onCancel}>Cancel</button><button className="btn" onClick={onClose}>Close without saving</button><button className="btn primary" autoFocus onClick={onRetry}>Try again</button></div>
    </Modal>
  );
}

export interface StartScreenProps {
  /** go on with what was chosen earlier in this run (the window was reloaded): true when the window opens */
  resume: boolean;
  /** the store holds the work chosen: the workspace opens, saying `note` */
  onStarted: (note?: string) => void;
}

export function StartScreen({ resume, onStarted }: StartScreenProps) {
  const [info, setInfo] = useState<ProjectStartInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  /** Pack a file: the quick pack in place of the start screen */
  const [packing, setPacking] = useState(false);
  const { enter } = useProject.getState();
  const settings = () => useProject.getState().present.settings;
  const [unsaved] = useState(unsavedWork);
  const showAtStart = useUi(s => s.startScreen);
  /** Quick work waits: the work without a project it takes the place of has changes in no project ("The work is not
   *  saved"), and `saving`: "Save as a project…" was the answer */
  const [quickAsk, setQuickAsk] = useState<{ kept: Project; saving: boolean } | null>(null);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const openProject = async (path?: string) => {
    if (!kr) return;
    const r = await kr.openProject(path ? { path } : {});
    if (!r) return;
    enter(r.project, r.home);
    onStarted(`Opened the project ${r.home.name} (${r.home.dir})`);
  };
  /** the work without a project the window kept (else the showcase demo, as on the first start) */
  const withoutProject = async () => {
    const kept = unsavedWork();
    enter(kept ?? demoProject(settings()), null, !!kept && unsavedWorkChanged());
    await kr?.workUnsaved();
    onStarted();
  };
  /** Quick work: an empty Mimir without a project (no files, no project folder, neither the work the window kept nor
   *  the demo). The window keeps one work without a project, so it is that from now on, as a file opened in its place
   *  would be */
  const quickWork = async (note?: string) => {
    enter(createProject({ name: QUICK_WORK, files: [], settings: settings() }), null);
    await kr?.workUnsaved();
    onStarted(note);
  };
  /** Quick work, asking first when the work without a project it takes the place of has changes that are in no project:
   *  the work open (a reloaded window, or back from it), else the one the window keeps (back from a project) */
  const startQuickWork = () => {
    if (busy) return;
    const s = useProject.getState();
    const kept = s.home ? unsavedWork() : s.present;
    if (kept && (s.home ? unsavedWorkChanged() : workChanged(s))) setQuickAsk({ kept, saving: false });
    else void run(() => quickWork());
  };
  /** "Save as a project…": the work without a project made a project in a folder of its own, then Quick work */
  const saveThenQuickWork = async (name: string, parent: string, git: boolean) => {
    if (!kr || !quickAsk) return;
    const r = await kr.createProject({ name, parent, project: quickAsk.kept, git });
    forgetUnsavedWork();
    setQuickAsk(null);
    await quickWork(`Created the project ${r.home.name} in ${r.home.dir}${gitNote(r).text}: the work without a project is saved there. Quick work: open a PRG, a snapshot or a cartridge to start`);
  };
  const create = async (name: string, parent: string, git: boolean) => {
    if (!kr) return;
    const project = createProject({ name, files: [], settings: settings() });
    const r = await kr.createProject({ name, parent, project, git });
    enter(project, r.home);
    onStarted(`Created the project ${r.home.name} in ${r.home.dir}${gitNote(r).text}: open a PRG, a snapshot or a cartridge to start`);
  };
  const forget = async (r: RecentProject) => {
    if (!kr || !info) return;
    try { const recent = await kr.forgetProject({ file: r.file }); setInfo({ ...info, recent, last: info.last?.kind === 'project' && info.last.home.file === r.file ? null : info.last }); } catch (e) { setError(errorText(e)); }
  };

  useEffect(() => {
    if (!kr) return;
    let gone = false;
    kr.projectStart().then(async i => {
      if (gone) return;
      if (resume && i.resume) {
        // a reloaded window goes on with what it worked on (the work without a project is what the store starts with)
        if (i.resume.kind === 'project') await openProject(i.resume.home.file).catch((e: unknown) => { setInfo(i); setError(errorText(e)); });
        else onStarted();
        return;
      }
      // the start screen turned off: straight on with what was worked on last (a project that is gone, or nothing to
      // go on with, still shows it)
      if (resume && !useUi.getState().startScreen) {
        const last = i.last;
        if (last?.kind === 'project' && last.exists) { await openProject(last.home.file).catch((e: unknown) => { setInfo(i); setError(errorText(e)); }); return; }
        if (last?.kind === 'unsaved') { await withoutProject(); return; }
      }
      setInfo(i);
    }, (e: unknown) => setError(errorText(e)));
    return () => { gone = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the first card has the focus: Enter goes on with it
  const last = info?.last;
  const lastProject = last?.kind === 'project' && last.exists ? last.home : null;
  const unsavedFirst = !lastProject && !!unsaved;
  const recent = (info?.recent ?? []).filter(r => r.file !== lastProject?.file);
  const unsavedText = unsaved ? (unsaved.files.length ? unsaved.files.map(f => f.name).slice(0, 3).join(', ') + (unsaved.files.length > 3 ? ` and ${unsaved.files.length - 3} more` : '') : 'no files') : '';

  // until it is known whether there is a start screen to show
  if (!info && !error) return <div className="boot">Opening…</div>;
  if (packing) return <QuickPack onBack={() => setPacking(false)} />;
  return (
    <div className="start">
      <div className="start-box">
        <div className="start-brand"><Logo size={44} /><div><h1>Mimir <span>Studio</span></h1><p>Re-assemble C64 programs into Kick Assembler projects</p></div></div>
        {info && <>
          {(lastProject || unsaved) && <div className="start-cards">
            {lastProject && <button className="start-card primary" autoFocus disabled={busy} onClick={() => void run(() => openProject(lastProject.file))} aria-label={`Continue with the project ${lastProject.name}`}>
              <Icon name="folder" size={22} />
              <span className="sc-text"><span className="sc-kind">Continue</span><span className="sc-name">{lastProject.name}</span><span className="sc-detail mono" title={lastProject.dir}>{lastProject.dir}</span></span>
              <kbd>Enter</kbd>
            </button>}
            {unsaved && <button className={cx('start-card', unsavedFirst && 'primary')} autoFocus={unsavedFirst} disabled={busy} onClick={() => void run(withoutProject)} aria-label={unsavedFirst ? 'Continue with the work without a project' : 'Go on with the work without a project'}>
              <Icon name="doc" size={22} />
              <span className="sc-text"><span className="sc-kind">{unsavedFirst ? 'Continue · without a project' : 'Without a project'}</span><span className="sc-name">{unsaved.name}</span><span className="sc-detail">{unsavedText} · kept by Mimir, not in a folder of yours</span></span>
              {unsavedFirst && <kbd>Enter</kbd>}
            </button>}
          </div>}
          {last?.kind === 'project' && !last.exists && <div className="start-missing" role="status">The project you worked on last, {last.home.name}, is not in {last.home.dir} any more.</div>}
          {creating
            ? <NewProjectForm name="" parent={info.parent} submit="Create project" onCreate={(n, p, g) => create(n, p, g)} onCancel={() => setCreating(false)} />
            : <div className="start-actions">
              <button className={cx('btn', !lastProject && !unsaved && 'primary')} disabled={busy} onClick={() => setCreating(true)}><Icon name="plus" size={14} />New project…</button>
              <button className="btn" disabled={busy} onClick={() => void run(() => openProject())}><Icon name="upload" size={14} />Open project…</button>
              {!unsaved && <button className="btn ghost" disabled={busy} onClick={() => void run(withoutProject)} title="Work as before: open PRG files right away, and create a project from the work when you want to keep it">Without a project</button>}
              <button className="btn ghost" disabled={busy} onClick={startQuickWork} title="An empty Mimir without a project: no files, no project folder, neither the demo nor the work kept from last time. It is the work without a project Mimir keeps from then on"><Icon name="play" size={14} />Quick work</button>
              <button className="btn ghost" disabled={busy} onClick={() => setPacking(true)} title="Pack PRG files or a Kick Assembler source with Brokkr or Exomizer as they are: no project, no analysis"><Icon name="pack" size={14} />Pack a file…</button>
            </div>}
          {recent.length > 0 && <section className="start-recent" aria-label="Recent projects">
            <h2>Recent projects</h2>
            <ul>
              {recent.map(r => <li key={r.file} className={cx('start-row', !r.exists && 'gone')}>
                <button className="sr-open" disabled={busy || !r.exists} onClick={() => void run(() => openProject(r.file))} title={r.exists ? r.file : `${r.file} is not there any more`}>
                  <Icon name="folder" size={15} /><span className="sr-name">{r.name}</span><span className="sr-dir mono">{r.exists ? r.dir : 'not found'}</span><span className="sr-when">{when(r.opened)}</span>
                </button>
                <button className="icon-btn" aria-label={`Take ${r.name} off the list`} title="Take it off the list (the folder stays as it is)" onClick={() => void forget(r)}><Icon name="x" size={13} /></button>
              </li>)}
            </ul>
          </section>}
          <p className="start-hint">Without a project you work as before (<b>Quick work</b> starts it empty), and Mimir keeps the work for the next start. <b>Save</b> (Ctrl+S) then creates a project and moves the work into its folder.</p>
          <label className="check start-toggle">
            <input type="checkbox" checked={showAtStart} onChange={e => useUi.getState().set({ startScreen: e.target.checked })} />
            <span>Show this window when Mimir starts{!showAtStart && <small className="muted"> — Mimir goes on with what you worked on last; Settings → General turns it on again</small>}</span>
          </label>
        </>}
        {error && <div className="np-error" role="alert">{error}</div>}
      </div>
      {quickAsk && !quickAsk.saving && <UnsavedWorkModal name={quickAsk.kept.name} what="Quick work" left={null}
        onSave={() => setQuickAsk({ ...quickAsk, saving: true })} onDiscard={() => { setQuickAsk(null); void run(() => quickWork()); }} onClose={() => setQuickAsk(null)} />}
      {quickAsk?.saving && <CreateProjectModal title="Create a project from the work without a project" name={quickAsk.kept.name}
        moving={['the work without a project (its files, labels, comments, bookmarks and patches)']} submit="Create project, then open Quick work" onCreate={saveThenQuickWork} onClose={() => setQuickAsk(null)} />}
    </div>
  );
}
