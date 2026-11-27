/* Export (the Assembler, spec 10.7): the program an Assembler project's sources make (the PRG the build writes), an
 * address range of its memory, or the file chosen in the list (the bytes a source's lines write, or a data file's), as
 * one of the formats of ASM_EXPORT_FORMATS: .bin, .prg, .byte lines, one source with its imports put in, VICE labels,
 * symbols, a C array, BASIC DATA lines, a hex dump or a listing. What Mimir's check made is what is exported; the file
 * is saved where the save dialog says (AssemblerView's onSave). */
import { useMemo, useState } from 'react';
import {
  ASM_EXPORT_FORMATS, ASM_SOURCE, asmDataAt, asmExport, asmExportData, asmExportFile, asmExportKinds, asmExportProgram, asmExportRange, asmOneSource,
  asmOneSourceSame, BASIC_AREA, h4, joinedParts, type AsmCheck, type AsmExportKind, type AsmExportSource, type ScriptLang, type Vfs,
} from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import { Modal } from './Modal';

export type AsmExportWhat = 'program' | 'range' | 'file';

/** a file's name without its folder and extension */
const stemOf = (p: string) => p.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') || 'program';
/** `$0801` or `0801` (hex, as Mimir's addresses are written) as an address (null: none) */
const addrOf = (s: string): number | null => { const t = s.trim(); return /^\$?[0-9a-f]{1,4}$/i.test(t) ? parseInt(t.replace('$', ''), 16) : null; };
const TEXT_KINDS = new Set<AsmExportKind>(['bytes', 'one', 'vs', 'sym', 'c', 'bas', 'hex', 'lst']);

export function AsmExportModal({ check, main, lang, file, fileBytes, vfs, args, start, onSave, onClose }: {
  /** Mimir's check of the program (null: none yet) */
  check: AsmCheck | null;
  main: string;
  lang: ScriptLang;
  /** the file chosen in the list (null: none), and a data file's bytes (undefined: being read; null: not readable) */
  file: string | null;
  fileBytes?: Uint8Array | null;
  /** the files the check takes (the sources, the data they load, what they import from outside the folder) */
  vfs: Vfs;
  args: readonly string[];
  /** what is chosen first */
  start: AsmExportWhat;
  onSave: (name: string, bytes: Uint8Array) => void;
  onClose: () => void;
}) {
  const ok = !!check?.ok;
  const source = !!file && ASM_SOURCE.test(file);
  const prgFile = !!file && /\.prg$/i.test(file);
  const program = useMemo(() => (ok && check ? asmExportProgram(check, stemOf(check.programFile ?? main)) : null), [ok, check, main]);
  const span = program ? joinedParts(program.parts) : null;
  const [what, setWhat] = useState<AsmExportWhat>(start === 'file' && file ? 'file' : program ? start : file ? 'file' : 'program');
  const [from, setFrom] = useState(span ? `$${h4(span.start)}` : '$0801');
  const [to, setTo] = useState(span ? `$${h4(span.start + span.bytes.length - 1)}` : '$0801');
  // a data file: where its bytes are (in the program's memory when the sources load it there once, a .prg's load address)
  const foundAt = useMemo(() => (fileBytes && check && !source ? asmDataAt(check, prgFile ? fileBytes.slice(2) : fileBytes) : null), [fileBytes, check, source, prgFile]);
  const [at, setAt] = useState<string | null>(null);
  const atText = at ?? `$${h4(foundAt ?? (prgFile && fileBytes && fileBytes.length >= 2 ? fileBytes[0] | fileBytes[1] << 8 : 0x1000))}`;
  const fromA = addrOf(from), toA = addrOf(to), atA = addrOf(atText);

  const src: AsmExportSource | null = useMemo(() => {
    if (what === 'program') return program;
    if (what === 'range') return ok && check && fromA != null && toA != null && toA >= fromA ? asmExportRange(check, fromA, toA, `${stemOf(main)}_${h4(fromA)}-${h4(toA)}`) : null;
    if (!file) return null;
    if (source) return ok && check ? asmExportFile(check, file, stemOf(file)) : null;
    if (!fileBytes || atA == null) return null;
    // (a .prg at another address: its bytes there)
    return asmExportData(prgFile ? fileBytes.slice(2) : fileBytes, atA, stemOf(file));
  }, [what, program, ok, check, fromA, toA, file, source, fileBytes, atA, prgFile, main]);
  const kinds = src ? asmExportKinds(src) : [];
  const [kind, setKind] = useState<AsmExportKind>('bin');
  const shown = kinds.includes(kind) ? kind : kinds[0] ?? 'bin';
  const format = ASM_EXPORT_FORMATS.find(f => f.kind === shown)!;

  // one source: the main file with its imports put in, and whether Mimir's check of it alone gives the same program
  const one = useMemo(() => {
    if (shown !== 'one' || !check || what !== 'program') return null;
    const o = asmOneSource(vfs, main, lang);
    return { ...o, ...asmOneSourceSame(vfs, main, lang, o.text, check, args) };
  }, [shown, check, what, vfs, main, lang, args]);
  const bytes = useMemo(() => (src ? asmExport(shown, src, { lang, texts: vfs, one: one?.text }) : null), [src, shown, lang, vfs, one]);
  const preview = bytes && TEXT_KINDS.has(shown) ? new TextDecoder().decode(bytes.subarray(0, 4000)).split('\n').slice(0, 14).join('\n') : null;
  const name = src ? (shown === 'one' ? `${main.includes('/') ? main.slice(0, main.lastIndexOf('/') + 1) : ''}${stemOf(main)}-one-file.asm` : `${src.name}.${format.ext}`) : '';
  const j = src ? joinedParts(src.parts) : null;
  const inBasic = shown === 'bas' && j && j.start < BASIC_AREA.end && j.start + j.bytes.length > BASIC_AREA.start;

  const fileText = !file ? 'No file chosen in the list'
    : source ? (!ok ? 'The check has problems: fix them first' : src && what === 'file' ? `the bytes its lines write: ${joinedParts(src.parts).bytes.length} bytes${src.parts.length > 1 ? ` in ${src.parts.length} stretches` : ''}` : asmExportFile(check!, file, '') ? 'the bytes its lines write' : 'its lines write no bytes (a macro\'s are its call\'s)')
      : fileBytes === undefined ? 'reading it…' : fileBytes === null ? 'it could not be read' : `${fileBytes.length} bytes${prgFile ? ', after its load address' : ''}`;
  const fileOk = !!file && (source ? ok && !!asmExportFile(check!, file, '') : !!fileBytes);
  const go = () => { if (bytes && src) onSave(name, bytes); };

  return (
    <Modal title="Export" onClose={onClose} className="asm-export">
      <div className="modal-body">
        <div className="rel-kinds" role="radiogroup" aria-label="Export what">
          <label className={cx('rel-kind', what === 'program' && 'on', !program && 'off')}>
            <input type="radio" name="exp-what" checked={what === 'program'} disabled={!program} onChange={() => setWhat('program')} />
            <span><b>The program</b><small className="muted">{program && span ? `${check!.programFile ?? `${stemOf(main)}.prg`}: $${h4(span.start)}–$${h4(span.start + span.bytes.length - 1)}, ${span.bytes.length} bytes, as the build writes it` : 'Mimir\'s check has problems: fix them first'}</small></span>
          </label>
          <label className={cx('rel-kind', what === 'range' && 'on', !ok && 'off')}>
            <input type="radio" name="exp-what" checked={what === 'range'} disabled={!ok} onChange={() => setWhat('range')} />
            <span><b>Addresses</b><small className="muted">The program's memory from one address to another (what it does not write is 0)</small>
              {what === 'range' && <span className="exp-range">
                <input className="mono" aria-label="From address" value={from} spellCheck={false} onChange={e => setFrom(e.target.value)} />
                <span>–</span>
                <input className="mono" aria-label="To address" value={to} spellCheck={false} onChange={e => setTo(e.target.value)} />
                {(fromA == null || toA == null || toA < fromA) && <small className="exp-bad">from $0000 to $ffff, the first not after the second</small>}
              </span>}</span>
          </label>
          <label className={cx('rel-kind', what === 'file' && 'on', !fileOk && 'off')}>
            <input type="radio" name="exp-what" checked={what === 'file'} disabled={!fileOk} onChange={() => setWhat('file')} />
            <span><b>{file ? <>The file <span className="mono">{file}</span></> : 'The file chosen in the list'}</b><small className="muted">{fileText}</small>
              {what === 'file' && file && !source && fileBytes && <span className="exp-range">
                <span className="small">at</span>
                <input className="mono" aria-label="Its address" value={atText} spellCheck={false} onChange={e => setAt(e.target.value)} />
                <small className="muted">{foundAt != null ? 'where the program has it' : prgFile ? 'its load address' : 'where it goes (the .prg, the .byte lines, the BASIC lines take it)'}</small>
              </span>}</span>
          </label>
        </div>
        <div className="exp-kinds" role="radiogroup" aria-label="As">
          {ASM_EXPORT_FORMATS.map(f => (
            <label key={f.kind} className={cx('exp-kind', shown === f.kind && 'on', !kinds.includes(f.kind) && 'off')}>
              <input type="radio" name="exp-kind" checked={shown === f.kind} disabled={!kinds.includes(f.kind)} onChange={() => setKind(f.kind)} />
              <span>{f.label}</span>
            </label>
          ))}
        </div>
        <p className="small muted exp-what">{format.what}</p>
        {one && <p className={cx('small', one.same ? 'exp-ok' : 'rel-warn')} role="status">
          <Icon name={one.same ? 'check' : 'warn'} size={12} /> {one.same
            ? `${one.inlined.length ? `${one.inlined.length} source${one.inlined.length === 1 ? '' : 's'} put in (${one.inlined.join(', ')})` : 'It imports no sources'}: Mimir's check of the one file alone gives the same ${span?.bytes.length ?? 0} bytes.`
            : `Mimir's check of the one file alone does not give the same program${one.problems.length ? `: ${one.problems.slice(0, 2).join('; ')}` : ''}${one.problems.length > 2 ? ' …' : ''}. Look it over before you build with it.`}</p>}
        {inBasic && <p className="small rel-warn" role="note"><Icon name="warn" size={12} /> BASIC's own program and variables are at ${h4(BASIC_AREA.start)}–${h4(BASIC_AREA.end - 1)}: POKEs there overwrite the BASIC program that makes them. Export bytes that go elsewhere, or load them another way.</p>}
        {preview != null ? <pre className="exp-preview mono" aria-label="Preview">{preview}</pre>
          : bytes && <p className="small"><span className="muted">{bytes.length} bytes</span></p>}
        {bytes && <p className="small"><span className="muted">Saves</span> <span className="mono">{name}</span> <span className="muted">({bytes.length} bytes) where you choose</span></p>}
      </div>
      <div className="modal-foot">
        <span className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!bytes || !src} onClick={go}><Icon name="download" size={13} />Export…</button>
      </div>
    </Modal>
  );
}
