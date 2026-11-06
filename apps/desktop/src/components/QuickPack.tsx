/* Pack from the start screen: PRG files, or a Kick Assembler source, packed with Brokkr or Exomizer as they are, without
 * a project or the analysis. A source is assembled with KickAss.jar where it is (its folder's out\, as its own build
 * would), when it is chosen and again before each pack. The settings are the Pack view's (PackSettings), kept for the
 * next time; the packed file goes next to what was packed unless another folder is chosen. Smart attach opens it over
 * the work with a source already chosen, for Brokkr to pack. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { h4, makePrg, parseBasic, type BasicInfo, type KickProblem, type PackPrefs, type PackRange, type ToolchainSettings } from '@mimir/core';
import type { AsmPickResult } from '../../shared/ipc';
import { Icon } from '../lib/icons';
import { packKeyOf, packWarning } from '../lib/pack';
import { cx, errorText, fmtBytes } from '../lib/util';
import { useUi } from '../store/ui';
import { PackerChoice, PackSettings, RangesField, type PackProgress, type PackResult } from './Pack';

const kr = window.kr;

/** a file to pack: its name (without .prg), where it loads, its bytes and where it is on disk */
interface Packed { name: string; load: number; bytes: Uint8Array; path: string }
/** what is packed: PRG files as they are, or a source and the PRG KickAss.jar made of it (null: not yet, or it failed) */
type Input =
  | { kind: 'prg'; files: Packed[] }
  | { kind: 'asm'; source: AsmPickResult; built: Packed | null; problems: KickProblem[] };

const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '');
const bare = (name: string) => name.replace(/\.prg$/i, '');

/** the BASIC line of a PRG that loads at $0801 (its SYS starts the program), read without the analysis */
function basicOf(f: Pick<Packed, 'load' | 'bytes'> | undefined): BasicInfo | null {
  if (!f || f.load !== 0x0801) return null;
  const mem = new Uint8Array(0x10000), owner = new Int16Array(0x10000).fill(-1);
  const n = Math.min(f.bytes.length, 0x10000 - f.load);
  mem.set(f.bytes.subarray(0, n), f.load);
  owner.fill(0, f.load, f.load + n);
  return parseBasic(mem, owner, f.load);
}

/** settings for new files: the packer and how it packs stay, what belongs to the files before goes; the program starts
 *  with the SYS of its BASIC line, else at its load address; the packed file goes next to them */
function prefsFor(p: PackPrefs, first: Packed | undefined, dir: string): PackPrefs {
  const sys = basicOf(first)?.sys ?? null;
  return { ...p, dir, out: '', ranges: null, start: sys != null ? 'sys' : 'jmp', jmp: sys != null ? null : first?.load ?? null, memLoad: typeof p.memLoad === 'number' ? 'auto' : p.memLoad };
}

interface QuickPackProps {
  onBack: () => void;
  /** a source chosen already (Smart attach): it is assembled at once, and Brokkr is the packer */
  source?: AsmPickResult;
  /** the button that goes back: to the start screen, or to the work Smart attach was chosen in */
  back?: { label: string; title: string };
}

export function QuickPack({ onBack, source: given, back = { label: 'Start', title: 'Back to the start screen' } }: QuickPackProps) {
  const prefs = useUi(s => s.quickPack);
  const set = (patch: Partial<PackPrefs>) => useUi.getState().set({ quickPack: { ...useUi.getState().quickPack, ...patch } });
  const [toolchain, setToolchain] = useState<ToolchainSettings | null>(null);
  const [input, setInput] = useState<Input | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [packing, setPacking] = useState<PackProgress | null>(null);
  const [result, setResult] = useState<PackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState('');
  const logRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    kr?.getSettings().then(setToolchain, () => setToolchain(null));
    // the settings' cards start open here (the Pack view's, closed when the app starts)
    const ui = useUi.getState();
    ui.set({ sideOpen: [...new Set([...ui.sideOpen, 'pack-what', 'pack-file', 'pack-sfx', 'pack-mem', 'pack-command'])] });
  }, []);

  const files: Packed[] = !input ? [] : input.kind === 'prg' ? input.files : input.built ? [input.built] : [];
  const key = useMemo(() => files.map(f => `${f.name}:${f.load}:${f.bytes.length}`).join('|'), [files]);
  const first = files[0];
  const basic = useMemo(() => basicOf(first), [first]);
  const warning = packWarning(prefs, { basics: basic ? [{ ...basic, file: 0 }] : [] });
  const ranges = prefs.ranges;
  const addLog = (text: string) => setLog(l => (l ? `${l}\n\n${text}` : text));

  /** KickAss.jar on the source where it is; the PRG it made, or null (the problems say why) */
  const assemble = async (source: AsmPickResult): Promise<Packed | null> => {
    if (!kr) return null;
    const r = await kr.build({ dir: source.dir, entries: [source.entry] });
    addLog(r.stdout.trim() || r.problems.map(p => p.message).join('\n'));
    const o = r.outputs[0];
    const built = o?.ok && o.prg && o.prg.length > 2 ? { name: bare(o.prgPath.split(/[\\/]/).pop() ?? source.entry.replace(/\.asm$/i, '')), load: o.prg[0] | (o.prg[1] << 8), bytes: o.prg.subarray(2), path: o.prgPath } : null;
    setInput({ kind: 'asm', source, built, problems: built ? [] : (o?.problems.length ? o.problems : r.problems) });
    return built;
  };

  const choosePrgs = async () => {
    if (!kr) return;
    setError(null);
    try {
      const opened = await kr.openPrg({ kind: 'prg' });
      if (!opened.length) return;
      const list = opened.map(f => ({ name: bare(f.name), load: f.load, bytes: f.bytes, path: f.path ?? f.name }));
      setInput({ kind: 'prg', files: list });
      setResult(null); setLog('');
      set(prefsFor(prefs, list[0], list[0].path.includes('\\') || list[0].path.includes('/') ? folderOf(list[0].path) : ''));
    } catch (e) { setError(errorText(e)); }
  };
  /** a source, from the dialog or given: assembled now, so its PRG is there to set the start by; `patch`: settings
   *  that go with how it came (Smart attach: Brokkr packs it) */
  const takeAsm = async (source: AsmPickResult, patch: Partial<PackPrefs> = {}) => {
    setResult(null); setLog('');
    setInput({ kind: 'asm', source, built: null, problems: [] });
    setBusy('Assembling');
    try {
      const built = await assemble(source);
      set({ ...prefsFor(useUi.getState().quickPack, built ?? undefined, source.dir), ...patch });
    } finally { setBusy(null); }
  };
  const chooseAsm = async () => {
    if (!kr) return;
    setError(null);
    try {
      const source = await kr.pickAsm();
      if (source) await takeAsm(source);
    } catch (e) { setError(errorText(e)); }
  };
  // a source given is taken once (StrictMode runs the effect twice)
  const took = useRef<AsmPickResult | null>(null);
  useEffect(() => {
    if (!given || took.current === given) return;
    took.current = given;
    takeAsm(given, { packer: 'brokkr' }).catch((e: unknown) => setError(errorText(e)));
  }, [given]); // eslint-disable-line react-hooks/exhaustive-deps

  /** a source is assembled again first (it may have changed); then the files are packed, into the folder chosen */
  const pack = async () => {
    if (!kr || !input || packing) return;
    setError(null);
    const asm = input.kind === 'asm';
    setPacking({ step: asm ? 'verify' : 'pack', since: Date.now(), prefs, before: asm ? { title: 'Assemble the source with KickAss.jar', doing: 'Assembling…' } : null });
    try {
      let todo = files;
      if (asm) {
        const built = await assemble(input.source);
        if (!built) { setError(`KickAss.jar could not assemble ${input.source.entry}: see below.`); return; }
        todo = [built];
      }
      // the folder must be one this session may write to: one kept from before is asked for again
      let dir = prefs.dir;
      if (dir) {
        const r = await kr.packFolder({ dir });
        if (!r) { setError('Nothing packed: the folder for the packed file was not chosen.'); return; }
        dir = r.dir;
      } else dir = folderOf(asm ? input.source.path : todo[0].path);
      const now = { ...prefs, dir };
      setPacking(p => p && { ...p, step: 'pack', prefs: now });
      const r = await kr.pack({ files: todo.map(f => ({ name: `${f.name}.prg`, prg: makePrg(f.load, f.bytes) })), prefs: now });
      setResult({ ...r, key: packKeyOf(prefs, todo.map(f => `${f.name}:${f.load}:${f.bytes.length}`).join('|')) });
      addLog(`> ${r.argv.join(' ')}\n${r.output.trim()}${r.check ? `\n${r.check.text}` : ''}${r.ok ? '' : `\n${r.error}`}`);
      if (!r.ok) setError(r.error ?? 'The packer failed: see below.');
    } catch (e) { setError(errorText(e)); } finally { setPacking(null); }
  };
  const run = async () => {
    if (!kr || !result?.path) return;
    try { await kr.run({ prgPath: result.path }); } catch (e) { setError(errorText(e)); }
  };
  const save = async (f: { name: string; prg: Uint8Array } | null = result?.name && result.prg ? { name: result.name, prg: result.prg } : null) => {
    if (!kr || !f) return;
    try { await kr.saveFile({ name: f.name, bytes: f.prg, title: `Save ${f.name}` }); } catch (e) { setError(errorText(e)); }
  };
  const pickDir = async () => {
    if (!kr) return;
    try { const r = await kr.packFolder({ ...(prefs.dir ? { dir: prefs.dir } : {}), ask: true }); if (r) set({ dir: r.dir }); } catch (e) { setError(errorText(e)); }
  };
  const showLog = () => { if (logRef.current) { logRef.current.open = true; logRef.current.scrollIntoView({ block: 'nearest' }); } };

  const total = files.reduce((n, f) => n + f.bytes.length, 0);
  return (
    <div className="start quick-pack">
      <div className="qp-box">
        <div className="qp-head">
          <button className="btn ghost" onClick={onBack} title={back.title}><Icon name="left" size={14} />{back.label}</button>
          <h1>Pack a file</h1>
          <span className="muted">with Brokkr or Exomizer, as it is: no project, no analysis</span>
        </div>
        <div className="qp-cols">
          <div className="qp-what">
            <section className="qp-card" aria-label="What to pack">
              <h2>What to pack</h2>
              <div className="qp-pick">
                <button className={cx('btn', !input && 'primary')} disabled={!!busy || !!packing} onClick={() => void choosePrgs()}><Icon name="doc" size={14} />PRG files…</button>
                <button className="btn" disabled={!!busy || !!packing} onClick={() => void chooseAsm()}><Icon name="code" size={14} />Kick Assembler source…</button>
              </div>
              {!input && <p className="muted small">One PRG or several, packed together into one file; or a .asm source, which KickAss.jar assembles where it is first ({toolchain?.kickJar ? <span className="mono">{toolchain.kickJar.split(/[\\/]/).pop()}</span> : 'set in Settings → Toolchain'}).</p>}
              {input?.kind === 'asm' && <div className="qp-source">
                <div className="mono small" title={input.source.path}><Icon name="code" size={12} /> {input.source.entry}</div>
                <div className="muted small qp-path">{input.source.dir}</div>
                {busy === 'Assembling' && <p className="muted small">Assembling…</p>}
                {input.problems.length > 0 && <ul className="qp-problems" aria-label="Kick Assembler problems">{input.problems.slice(0, 8).map((p, i) => <li key={i} className="err-text small">{p.file ? `${p.file}:${p.line}: ` : ''}{p.message}</li>)}</ul>}
                {input.built && <p className="muted small">KickAss.jar makes <span className="mono">{input.built.name}.prg</span> in <span className="mono">out</span> there; Pack assembles it again first.</p>}
              </div>}
              {files.length > 0 && <div className="qp-files" role="list" aria-label="Files to pack">
                {files.map(f => <div key={f.path} role="listitem" className="mono small" title={f.path}><Icon name="doc" size={12} /> {f.name}.prg <span className="muted">${h4(f.load)}–${h4(f.load + f.bytes.length - 1)} · {fmtBytes(f.bytes.length)}</span></div>)}
                {files.length > 1 && <p className="muted small">{fmtBytes(total)} in {files.length} files, packed together into one (a later file wins where they overlap).</p>}
                {basic?.sys != null && <p className="muted small">BASIC line: SYS {basic.sys} (${h4(basic.sys)}).</p>}
              </div>}
              {files.length > 0 && <>
                <div className="seg wide pack-seg" role="tablist" aria-label="How much to pack">
                  <button role="tab" aria-selected={!ranges} className={cx(!ranges && 'on')} onClick={() => ranges && set({ ranges: null })}>{files.length > 1 ? 'Whole files' : 'Whole file'}</button>
                  <button role="tab" aria-selected={!!ranges} className={cx(ranges && 'on')} onClick={() => !ranges && set({ ranges: [{ start: first.load, end: first.load + first.bytes.length }] })}>Address ranges</button>
                </div>
                {ranges && <RangesField id="qp-ranges" label="Ranges to pack" value={ranges as PackRange[]} placeholder={`$${h4(first.load)}-$${h4(first.load + first.bytes.length - 1)}`}
                  help="Each range by its first and last address, separated by commas. Only these bytes are packed." onCommit={v => set({ ranges: v })} />}
              </>}
            </section>
            {error && <div className="np-error" role="alert">{error}</div>}
            {log && <details ref={logRef} className="qp-card qp-log"><summary>Output</summary><pre className="mono small">{log}</pre></details>}
          </div>
          <div className="qp-settings pack-view" aria-label="Pack settings">
            <PackerChoice prefs={prefs} set={set} exomizer={toolchain?.exomizerPath ?? ''} desktop={!!kr} />
            <PackSettings prefs={prefs} set={set} files={files} fileNames={files.map(f => f.name)} entry={basic?.sys ?? first?.load ?? null} warning={files.length ? warning : null}
              exomizer={toolchain?.exomizerPath ?? ''} desktop={!!kr} busy={busy} packing={packing} result={result} current={packKeyOf(prefs, key)}
              before={input?.kind === 'asm' ? 'Pack assembles the source again with KickAss.jar first.' : files.length ? '' : 'Choose what to pack first.'}
              packTitle={input?.kind === 'asm' ? 'Assemble the source with KickAss.jar, then pack the PRG it makes' : 'Pack the files as they are'}
              noDir={files.length ? 'Next to the file packed.' : 'Next to the file packed, once one is chosen.'}
              onPack={() => void pack()} onRun={() => void run()} onSave={() => void save()} onSaveFile={f => void save(f)} onLog={showLog} onPickDir={() => void pickDir()} />
          </div>
        </div>
      </div>
    </div>
  );
}
