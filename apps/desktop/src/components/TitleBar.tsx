import type { MouseEvent } from 'react';
import { Icon } from '../lib/icons';
import { Logo } from './Logo';
import { cx } from '../lib/util';

interface TitleBarProps {
  projectName: string; undoLabel: string | null; canRedo: boolean; theme: string;
  /** the project's name (null: work without a project); its button opens what can be done with it */
  home: string | null; onProject: (e: MouseEvent<HTMLElement>) => void;
  verifyState: 'ok' | 'bad' | null; busy: boolean;
  /** the project was opened from a VICE snapshot: Build & Run restarts it as it was */
  snapshot?: boolean;
  /** the project was opened from a cartridge: Build & Run attaches the rebuilt image */
  cartridge?: boolean;
  onOpen: () => void; onSave: () => void; onUndo: () => void; onRedo: () => void; onPalette: () => void;
  onVerify: () => void; onExport: () => void; onBuild: () => void; onTerminal: () => void; onTheme: () => void; onSettings: () => void;
  onToggleSide: () => void; onToggleInspector: () => void;
}

export function TitleBar(p: TitleBarProps) {
  return (
    <header className="titlebar">
      <button className="icon-btn only-narrow" aria-label="Toggle sidebar" onClick={p.onToggleSide}><Icon name="menu" /></button>
      <div className="brand"><Logo className="brand-logo" size={20} /><span className="brand-name">Mimir</span><span className="brand-sub">Studio</span></div>
      <button className={cx('proj-chip', !p.home && 'unsaved')} onMouseDown={e => e.stopPropagation()} onClick={p.onProject} aria-haspopup="menu" aria-label={p.home ? `Project ${p.home}` : 'No project'}
        title={p.home ? `The project ${p.home}: Mimir saves it in its folder as you work` : 'Work without a project: Mimir keeps it for the next start. Save (Ctrl+S) creates a project and moves the work into its folder'}>
        <Icon name={p.home ? 'folder' : 'doc'} size={14} /><span>{p.home ?? 'No project'}</span><Icon name="down" size={12} />
      </button>
      <div className="tb-group hide-narrow">
        <button className="btn ghost" onClick={p.onOpen} title="Open PRG files (Ctrl+O)"><Icon name="upload" />Open</button>
        <button className="btn ghost" onClick={p.onSave} title={p.home ? 'Save the project (Ctrl+S); Mimir also saves it as you work' : 'Create a project from this work: a folder of its own, where the work moves (Ctrl+S)'}><Icon name="download" />Save</button>
        <button className="icon-btn" onClick={p.onUndo} disabled={!p.undoLabel} title={p.undoLabel ? `Undo: ${p.undoLabel} (Ctrl+Z)` : 'Nothing to undo'} aria-label="Undo"><Icon name="undo" /></button>
        <button className="icon-btn" onClick={p.onRedo} disabled={!p.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo"><Icon name="redo" /></button>
      </div>
      <button className="cmd-search hide-narrow" onClick={p.onPalette}><Icon name="search" size={14} /><span>{p.projectName}</span><kbd>Ctrl+Shift+P</kbd></button>
      <span className="grow" />
      <div className="tb-group">
        <button className={cx('btn', p.verifyState === 'ok' ? 'okish' : p.verifyState === 'bad' ? 'badish' : '')} onClick={p.onVerify} disabled={p.busy} title="Re-assemble and compare byte by byte (F7)"><Icon name={p.verifyState === 'ok' ? 'ok' : 'check'} /><span className="hide-narrow">Verify</span></button>
        <button className="btn" onClick={p.onExport} disabled={p.busy} title="Export Kick Assembler project to a folder (Ctrl+E)"><Icon name="folder" /><span className="hide-narrow">Export</span></button>
        <button className="btn" onClick={p.onTerminal} aria-label="Terminal" title="Open a terminal in the project folder: VICE (x64sc) is on PATH and kickass <file.asm> runs Kick Assembler"><Icon name="prompt" /><span className="hide-narrow">Terminal</span></button>
        <button className="btn primary" onClick={p.onBuild} disabled={p.busy} title={p.snapshot ? 'Build with KickAss.jar and restart the snapshot in VICE as it was taken, with the built program in its RAM (F5)' : p.cartridge ? 'Build with KickAss.jar, rebuild the cartridge and start it in VICE (F5)' : 'Build with KickAss.jar and run in VICE (F5)'}><Icon name="play" /><span className="hide-narrow">Build &amp; Run</span></button>
        <button className="icon-btn" onClick={p.onTheme} aria-label="Toggle theme" title="Toggle light/dark theme"><Icon name={p.theme === 'dark' ? 'sun' : 'moon'} /></button>
        <button className="icon-btn" onClick={p.onSettings} aria-label="Settings" title="Settings (Ctrl+,)"><Icon name="sliders" /></button>
        <button className="icon-btn only-narrow" aria-label="Toggle inspector" onClick={p.onToggleInspector}><Icon name="panel" /></button>
      </div>
    </header>
  );
}
