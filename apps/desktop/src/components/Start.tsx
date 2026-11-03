/* The start screen: go on with what was worked on last, start a new project, open one, work without a project as
 * before, or pack a file with Brokkr or Exomizer as it is (QuickPack). A project is a folder of its own: its project file and what Mimir writes for it (the Kick Assembler source,
 * the build, the packed file) go there. The New project form is the one "Create a project from this work" shows too. */
import { useEffect, useState, type FormEvent } from 'react';
import { createProject, demoProject } from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx, errorText } from '../lib/util';
import { unsavedWork, unsavedWorkChanged, useProject } from '../store/project';
import { useUi } from '../store/ui';
import { projectFileName, projectNameProblem } from '../../shared/projects';
import type { ProjectStartInfo, RecentProject } from '../../shared/ipc';
import { Logo } from './Logo';
import { Modal } from './Modal';
import { QuickPack } from './QuickPack';

const kr = window.kr;

/** when a project was opened, in a few words */
function when(ms: number): string {
  const d = new Date(ms), now = new Date();
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return days <= 0 ? `today ${time}` : days === 1 ? `yesterday ${time}` : days < 7 ? `${days} days ago` : d.toLocaleDateString();
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
  onCreate: (name: string, parent: string) => Promise<void>;
  onCancel: () => void;
}

/** A project's name and the folder its own folder goes in. */
export function NewProjectForm({ name: name0, parent: parent0, moving, submit, onCreate, onCancel }: NewProjectProps) {
  const [name, setName] = useState(name0);
  const [parent, setParent] = useState(parent0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = projectNameProblem(name);
  const n = name.trim();
  const change = async () => {
    try { const r = await kr?.projectParent(); if (r) setParent(r.dir); } catch (e) { setError(errorText(e)); }
  };
  const create = async (e?: FormEvent) => {
    e?.preventDefault();
    if (problem || busy) return;
    setBusy(true); setError(null);
    try { await onCreate(n, parent); } catch (err) { setError(errorText(err)); setBusy(false); }
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
  const create = async (name: string, parent: string) => {
    if (!kr) return;
    const project = createProject({ name, files: [], settings: settings() });
    const r = await kr.createProject({ name, parent, project });
    enter(project, r.home);
    onStarted(`Created the project ${r.home.name} in ${r.home.dir}: open a PRG, a snapshot or a cartridge to start`);
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
            ? <NewProjectForm name="" parent={info.parent} submit="Create project" onCreate={(n, p) => create(n, p)} onCancel={() => setCreating(false)} />
            : <div className="start-actions">
              <button className={cx('btn', !lastProject && !unsaved && 'primary')} disabled={busy} onClick={() => setCreating(true)}><Icon name="plus" size={14} />New project…</button>
              <button className="btn" disabled={busy} onClick={() => void run(() => openProject())}><Icon name="upload" size={14} />Open project…</button>
              {!unsaved && <button className="btn ghost" disabled={busy} onClick={() => void run(withoutProject)} title="Work as before: open PRG files right away, and create a project from the work when you want to keep it">Without a project</button>}
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
          <p className="start-hint">Without a project you work as before, and Mimir keeps the work for the next start. <b>Save</b> (Ctrl+S) then creates a project and moves the work into its folder.</p>
          <label className="check start-toggle">
            <input type="checkbox" checked={showAtStart} onChange={e => useUi.getState().set({ startScreen: e.target.checked })} />
            <span>Show this window when Mimir starts{!showAtStart && <small className="muted"> — Mimir goes on with what you worked on last; Settings → General turns it on again</small>}</span>
          </label>
        </>}
        {error && <div className="np-error" role="alert">{error}</div>}
      </div>
    </div>
  );
}
