/* The project's macro file as the editor shows it (spec 10.8): not the code Mimir writes in it (what the assembler reads)
 * but a folded list of its macros, each by its name and its parameters, under the file it is from; pointing at one
 * shows its description. In the source, under the line that imports the file, the list is one line that unfolds
 * (`zone`: Monaco's view zone, a line high each row); the file itself opened is the list as a page (`panel`), a click
 * on a macro unfolding its code. */
import { useState } from 'react';
import type { CodeLibBuilt, CodeLibBuiltMacro } from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';

const WHY: Record<CodeLibBuiltMacro['why'], string> = { added: 'its file is used in the project', called: 'the code calls a macro of its file', used: 'another file in it uses its file' };
/** a macro's hover text: its call, its description, where it is from and why it is there */
const tipOf = (m: CodeLibBuiltMacro) => `${m.sig}${m.description ? `\n${m.description}` : ''}\n(${m.in ? `from ${m.in}, ` : ''}${WHY[m.why]})`;
const groupName = (g: CodeLibBuilt['groups'][number]) => g.in ?? 'macros of their own';

/** how many rows the list in the source is, folded or not (its view zone's height in lines) */
export const macroZoneRows = (b: CodeLibBuilt, open: boolean) => 1 + (open ? b.groups.length + b.macros.length : 0);

/** The list under the line that imports the macro file: one line (the file, how many, the calls) that unfolds on a
 *  click to the macros under their collections; pointing at a macro puts its description on the first line. */
export function AsmMacroZone({ built, file, open, lineHeight, onToggle, onOpenFile }: { built: CodeLibBuilt; file: string; open: boolean; lineHeight: number; onToggle: () => void; onOpenFile: () => void }) {
  const [hover, setHover] = useState<CodeLibBuiltMacro | null>(null);
  const by = new Map(built.macros.map(m => [m.name, m]));
  const row = { height: lineHeight, lineHeight: `${lineHeight}px` };
  const n = built.macros.length;
  return (
    <div className="am-zone" role="region" aria-label={`The macros of ${file}`} onMouseLeave={() => setHover(null)}>
      <div className="am-zone-head" style={row}>
        <button type="button" className="am-fold" aria-expanded={open} aria-label={`${open ? 'Fold' : 'Unfold'} the macros of ${file}`} title={`${file}: built by Mimir from the macro library. A click ${open ? 'folds' : 'unfolds'} its macros`} onClick={onToggle}>
          <Icon name="chevron" size={10} className={cx('cl-chev', open && 'on')} /></button>
        {hover ? <span className="am-desc" title={tipOf(hover)}><b className="mono">{hover.sig}</b> {hover.description ? hover.description.split('\n')[0] : <i>no description</i>}</span>
          : <span className="am-sum" onClick={onToggle}>
            <span className="mono">{file.split('/').pop()}</span> · {n} macro{n === 1 ? '' : 's'}{!open && n > 0 && <span className="mono am-names">: {built.macros.map(m => m.sig).join('  ')}</span>}
          </span>}
        <button type="button" className="am-open" title={`Open ${file}: the list, and the code Mimir writes`} onClick={onOpenFile}><Icon name="doc" size={11} /></button>
      </div>
      {open && built.groups.map(g => (
        <div key={g.in ?? ''} role="group" aria-label={groupName(g)}>
          <div className="am-group" style={row}><Icon name={g.in ? 'library' : 'codelib'} size={10} />{groupName(g)}</div>
          {g.macros.map(name => { const m = by.get(name)!; return (
            <div key={name} className="am-row" style={row} title={tipOf(m)} onMouseEnter={() => setHover(m)}>
              <span className="mono am-sig">{m.sig}</span><span className={cx('am-why', m.why)}>{m.why}</span>
            </div>); })}
        </div>))}
    </div>
  );
}

/** The macro file opened: its macros as a folded list under their collections (a click unfolds a macro's code; a
 *  file's own lines with it), pointing at one shows its description below; what is added, called or used. */
export function AsmMacroPanel({ built, file }: { built: CodeLibBuilt; file: string }) {
  const [hover, setHover] = useState<CodeLibBuiltMacro | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set());
  const by = new Map(built.macros.map(m => [m.name, m]));
  const flip = (set: (f: (s: ReadonlySet<string>) => ReadonlySet<string>) => void, k: string) => set(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const n = built.macros.length;
  return (
    <div className="am-panel" role="region" aria-label={`The macros of ${file}`}>
      <p className="am-note small muted"><Icon name="info" size={12} />{file.split('/').pop()} is built by Mimir from the macro library: {n} macro{n === 1 ? '' : 's'}, {built.macros.filter(m => m.why === 'added').length} added, {built.macros.filter(m => m.why === 'called').length} called by the code, {built.macros.filter(m => m.why === 'used').length} used by them. This is the list of them; the file holds their code.</p>
      <div className="am-list">
        {built.groups.map(g => { const k = g.in ?? ''; const folded = shut.has(k); return (
          <div key={k} role="group" aria-label={groupName(g)} className="am-pgroup">
            <button type="button" className="am-pgroup-head" aria-expanded={!folded} onClick={() => flip(setShut, k)}>
              <Icon name="chevron" size={10} className={cx('cl-chev', !folded && 'on')} /><Icon name={g.in ? 'library' : 'codelib'} size={12} />{groupName(g)}<span className="lib-n">{g.macros.length}</span></button>
            {!folded && g.rest && <pre className="am-rest mono" title={`${groupName(g)}'s own lines, with its macros`}>{g.rest}</pre>}
            {!folded && g.macros.map(name => { const m = by.get(name)!; const on = open.has(name); return (
              <div key={name} className={cx('am-prow', on && 'open')} onMouseEnter={() => setHover(m)}>
                <button type="button" className="am-prow-head" aria-expanded={on} title={tipOf(m)} onClick={() => flip(setOpen, name)}>
                  <Icon name="chevron" size={10} className={cx('cl-chev', on && 'on')} /><span className="mono am-sig">{m.sig}</span><span className={cx('am-why', m.why)}>{m.why}</span></button>
                {on && <pre className="cl-code mono am-code" aria-label={`The code of ${m.name}`}>{m.code}</pre>}
              </div>); })}
          </div>); })}
        {!n && <p className="side-hint">No macros in it yet: call one of the library's in the code, or add one in Macros and code (To {file.split('/').pop()}).</p>}
      </div>
      <div className="am-detail" aria-live="polite">
        {hover ? <><b className="mono">{hover.sig}</b><span className="muted small"> · {hover.in ? `${hover.in} · ` : ''}{WHY[hover.why]}</span>
          <div className="am-detail-text">{hover.description || <i className="muted">No description: Edit in Macros and code gives it one.</i>}</div></>
          : <span className="muted small">Point at a macro to see its description; a click shows its code.</span>}
      </div>
    </div>
  );
}
