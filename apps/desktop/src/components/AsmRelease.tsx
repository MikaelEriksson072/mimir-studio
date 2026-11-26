/* Release (the Assembler, spec 10.7): what an Assembler project's build is made into, in out\ beside the main file —
 * a disk image with the program as its first file, a tape image in the KERNAL's format, a Magic Desk cartridge that
 * starts it, or the PRG alone — packed with Brokkr or Exomizer as the Pack view is set, or as built; and started in
 * VICE. Also build.bat and build.sh beside the main file, which build it outside Mimir as Run does. App makes the
 * files (releaseAsm). */
import { useState } from 'react';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import { Modal } from './Modal';

export type ReleaseKind = 'd64' | 'tap' | 'crt' | 'prg';
export interface ReleaseChoice { kind: ReleaseKind; packed: boolean; name: string; disk: string; id: string; run: boolean }

const KINDS: { kind: ReleaseKind; label: string; what: string }[] = [
  { kind: 'd64', label: 'Disk image (.d64)', what: 'The program as the disk\'s first file: LOAD"*",8,1 loads it, VICE autostarts it.' },
  { kind: 'tap', label: 'Tape image (.tap)', what: 'The program in the KERNAL\'s format, as SAVE writes it: LOAD loads it, VICE autostarts it.' },
  { kind: 'crt', label: 'Cartridge (.crt)', what: 'A Magic Desk cartridge: it copies the program to where it loads, turns itself off and starts it (RUN, or a jump to where it loads).' },
  { kind: 'prg', label: 'Program (.prg)', what: 'The PRG alone: as built, or the packed one.' },
];
/** a name as the C64 has it: PETSCII upper case, at most `n` characters */
const petName = (s: string, n: number) => s.toUpperCase().replace(/[^\x20-\x5f]/g, '').slice(0, n);

export function AsmReleaseModal({ main, packer, basic, busy, onRelease, onScripts, onClose }: {
  /** the main file (a path in the project's folder) */
  main: string;
  /** the program starts with a BASIC line (Mimir's check found its SYS): LOAD and RUN start it (null: not known) */
  basic: boolean | null;
  /** what Pack packs with (the Pack view's choice) */
  packer: string;
  busy: string | null;
  onRelease: (c: ReleaseChoice) => void;
  onScripts: () => void;
  onClose: () => void;
}) {
  const stem = main.replace(/^.*\//, '').replace(/\.[^.]*$/, '') || 'program';
  const [kind, setKind] = useState<ReleaseKind>('d64');
  const [packed, setPacked] = useState(false);
  const [name, setName] = useState(petName(stem, 16));
  const [disk, setDisk] = useState(petName(stem, 16));
  const [id, setId] = useState('01');
  const folder = main.includes('/') ? `${main.slice(0, main.lastIndexOf('/'))}/out` : 'out';
  const file = `${folder}/${stem}${kind === 'prg' && packed ? '-packed' : ''}.${kind}`;
  const ok = !!name.trim() && (kind !== 'd64' || !!disk.trim());
  const go = (run: boolean) => { if (ok && !busy) onRelease({ kind, packed, name: name.trim() || petName(stem, 16), disk: disk.trim(), id: id.padEnd(2, ' ').slice(0, 2), run }); };
  return (
    <Modal title="Release" onClose={onClose} className="asm-release">
      <div className="modal-body">
        <p className="small muted">Builds {main} with the project's assembler, then makes it into what is chosen here, in <span className="mono">{folder}</span>.</p>
        <div className="rel-kinds" role="radiogroup" aria-label="Make">
          {KINDS.map(k => (
            <label key={k.kind} className={cx('rel-kind', kind === k.kind && 'on')}>
              <input type="radio" name="rel-kind" checked={kind === k.kind} onChange={() => setKind(k.kind)} />
              <span><b>{k.label}</b><small className="muted">{k.what}</small></span>
            </label>
          ))}
        </div>
        <label className="check"><input type="checkbox" checked={packed} onChange={e => setPacked(e.target.checked)} />
          <span>Packed with {packer} <small className="muted">— as the Pack view is set (a self-extracting file starts as the program does)</small></span></label>
        {kind !== 'prg' && <label className="field"><span>{kind === 'd64' ? 'The file\'s name on the disk' : kind === 'tap' ? 'The file\'s name on the tape' : 'The cartridge\'s name'}</span>
          <input className="mono" aria-label="Name" value={name} maxLength={kind === 'crt' ? 32 : 16} spellCheck={false} onChange={e => setName(petName(e.target.value, kind === 'crt' ? 32 : 16))} /></label>}
        {kind === 'd64' && <div className="rel-disk">
          <label className="field"><span>Disk name</span><input className="mono" aria-label="Disk name" value={disk} maxLength={16} spellCheck={false} onChange={e => setDisk(petName(e.target.value, 16))} /></label>
          <label className="field rel-id"><span>ID</span><input className="mono" aria-label="Disk ID" value={id} maxLength={2} spellCheck={false} onChange={e => setId(petName(e.target.value, 2))} /></label>
        </div>}
        {basic === false && !packed && kind !== 'crt' && <p className="small rel-warn" role="note"><Icon name="warn" size={12} /> The program has no BASIC line that starts it: VICE (and a C64) LOADs and RUNs {kind === 'd64' ? 'a disk' : kind === 'tap' ? 'a tape' : 'a PRG'}, which does not start it. A cartridge starts it, and so does a packed file (its decruncher jumps to where it starts).</p>}
        <p className="small"><span className="muted">Writes</span> <span className="mono">{file}</span> <span className="muted">(over the one there)</span></p>
        {busy && <p className="small" role="status">{busy}…</p>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onScripts} title={`Write build.bat and build.sh beside ${main}: they build it with the project's assembler into out\\ and start it in VICE, outside Mimir (those there already stay as they are)`}><Icon name="doc" size={13} />Build scripts</button>
        <span className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!ok || !!busy} onClick={() => go(false)}>Make</button>
        <button className="btn primary" disabled={!ok || !!busy} onClick={() => go(true)}><Icon name="play" size={13} />Make and run in VICE</button>
      </div>
    </Modal>
  );
}
