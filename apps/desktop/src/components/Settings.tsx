/* Settings: toolchain (stored by the main process), analysis and Kick Assembler output (stored in the project), and
 * the app's own preferences (General, kept by the window). */
import { useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '@mimir/core';
import { cx } from '../lib/util';
import type { DiskLook, InspectorMode } from '../store/ui';
import type { EditorInfo, LocateKey } from '../../shared/ipc';
import { Modal } from './Modal';

type Key = keyof Settings;

const kr = window.kr;

/** the app's own preferences in Settings → General */
export interface AppPrefs {
  /** the start screen is shown when the app starts */
  startScreen: boolean;
  /** the inspector always open, or folded in until it is needed */
  inspector: InspectorMode;
  /** sprites, charsets and bitmaps drawn as they look in the listing, instead of their .byte rows */
  gfxPictures: boolean;
  /** a packed file is unpacked as it is opened */
  autoUnpack: boolean;
  /** the overview of the analysis opens when a file is opened and analysed */
  overview: boolean;
  /** the mounted disk's directory in the Explorer: Mimir's list or the C64's screen */
  diskLook: DiskLook;
  /** marking a range merges it with the blocks of that type next to it */
  autoMerge: boolean;
}
const DEFAULT_PREFS: AppPrefs = { startScreen: true, inspector: 'open', gfxPictures: true, autoUnpack: false, overview: true, diskLook: 'mimir', autoMerge: true };

/** `editors`: Sublime Text and Visual Studio Code where they are installed (the desktop app finds them) */
export function SettingsModal({ settings, prefs: prefs0, desktop, editors, onSave, onClose }: { settings: Settings; prefs: AppPrefs; desktop: boolean; editors: EditorInfo[]; onSave: (s: Settings, prefs: AppPrefs) => void; onClose: () => void }) {
  const [s, setS] = useState<Settings>(settings);
  const [prefs, setPrefs] = useState<AppPrefs>(prefs0);
  const [tab, setTab] = useState<'toolchain' | 'analysis' | 'output' | 'general'>('toolchain');
  const set = <K extends Key>(k: K, v: Settings[K]) => setS(o => ({ ...o, [k]: v }));
  /** Choose folder…: what was not found in the folder picked (the field then keeps its path) */
  const [missing, setMissing] = useState<Partial<Record<LocateKey, string>>>({});
  const locate = async (k: LocateKey) => {
    try {
      const r = await kr!.locateTool({ key: k, current: String(s[k]) });
      if (!r) return;
      if (r.path) set(k, r.path);
      setMissing(m => ({ ...m, [k]: r.found || r.path ? undefined : `${r.looked.join(' or ')} is not in ${r.dir} or the folders in it: the field keeps what it had.` }));
    } catch (err) {
      setMissing(m => ({ ...m, [k]: err instanceof Error ? err.message : String(err) }));
    }
  };
  /** a path to a program or file, with Choose folder… in the desktop app; labelled by id: a label around the row would
   *  take its buttons into the field's name */
  const path = (k: LocateKey, label: string, help?: ReactNode, o: { placeholder?: string; extra?: ReactNode } = {}) => (
    <div className="field"><label htmlFor={`set-${k}`}>{label}</label>
      <div className="field-row"><input id={`set-${k}`} className="mono" value={String(s[k])} placeholder={o.placeholder} onChange={e => { set(k, e.target.value); setMissing(m => ({ ...m, [k]: undefined })); }} spellCheck={false} />
        {o.extra}
        {desktop && kr && <button type="button" className="btn small" aria-label={`Choose folder for ${label}`} title={`Choose the folder it is in: Mimir finds ${label} there`} onClick={() => void locate(k)}>Choose folder…</button>}</div>
      {missing[k] && <small className="warn-text" role="status">{missing[k]}</small>}
      {help && <small className="muted">{help}</small>}</div>
  );
  const txt = (k: Key, label: string, help?: string) => <label className="field"><span>{label}</span><input id={`set-${k}`} className="mono" value={String(s[k])} onChange={e => set(k, e.target.value as never)} spellCheck={false} />{help && <small className="muted">{help}</small>}</label>;
  const chk = (k: Key, label: string, help?: string) => <label className="check"><input id={`set-${k}`} type="checkbox" checked={!!s[k]} onChange={e => set(k, e.target.checked as never)} /><span>{label}{help && <small className="muted"> — {help}</small>}</span></label>;
  const sel = (k: Key, label: string, opts: [string | number, string][], help?: string) => <label className="field"><span>{label}</span><select id={`set-${k}`} value={String(s[k])} onChange={e => set(k, (isNaN(+e.target.value) ? e.target.value : +e.target.value) as never)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>{help && <small className="muted">{help}</small>}</label>;
  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="seg wide" role="tablist">{([['toolchain', 'Toolchain'], ['analysis', 'Analysis'], ['output', 'Kick Assembler output'], ['general', 'General']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={cx(tab === k && 'on')} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div className="modal-body">
        {tab === 'toolchain' && <>
          {path('javaPath', 'Java executable', 'Kick Assembler needs Java 8 or later. Choose folder…: the JDK or JRE folder (java is in its bin folder), or the folder with several in it.')}
          {path('kickJar', 'KickAss.jar', 'Verify and Build & Run assemble with this jar when it exists.')}
          {txt('kickArgs', 'Extra Kick Assembler arguments', '-vicesymbols writes a VICE label file next to the PRG.')}
          {path('vicePath', 'VICE emulator (x64sc)', 'Choose folder…: the VICE folder (x64sc is in it or in its bin folder).')}
          {txt('viceArgs', 'Extra VICE arguments')}
          {sel('debugger', 'Build & Run in a debugger (Shift+F5)', [['retro', 'Retro Debugger'], ['c64d', 'C64 Debugger']],
            'Shift+F5 builds and verifies as F5 does, then starts the program in this debugger instead of VICE, the way VICE starts it: RUN, sys <start> with $01 as it starts, or (a program over BASIC\'s work area or the screen) as from VICE\'s monitor; the drive reads the disk first; with the build\'s labels. The debugger loads a copy of the PRG with a little start code next to the program, which does what VICE types. Retro Debugger 1.0.0 stops its emulation with a disk or a tape on its command line, so they are left out (a program that boots from a disk or a tape needs C64 Debugger or VICE); C64 Debugger does not start a cartridge (Retro Debugger and VICE do). Neither reads VICE 3.x snapshots.')}
          {path('retroDebuggerPath', 'Retro Debugger', 'Choose folder…: the Retro Debugger folder (its program is C64Debugger.exe).')}
          {txt('retroDebuggerArgs', 'Extra Retro Debugger arguments', '-layout <id> starts with that layout, -unpause runs the code even when the debugger pauses it.')}
          <label className="field"><span>Retro Debugger: wait before the start (ms)</span>
            <input id="set-debuggerWait" className="mono" type="number" min={0} max={60000} step={500} value={s.debuggerWait} onChange={e => set('debuggerWait', Math.max(0, Math.min(60000, Math.round(Number(e.target.value) || 0))))} />
            <small className="muted">Retro Debugger loads the program and jumps to its start this long after it starts (-wait), when the C64 should be at READY. Raise it when the program starts before READY (the screen stays blank). C64 Debugger waits for READY by itself.</small></label>
          {path('c64DebuggerPath', 'C64 Debugger', 'Choose folder…: the C64 Debugger folder (C64Debugger.exe is in it).')}
          {txt('c64DebuggerArgs', 'Extra C64 Debugger arguments', '-layout <id> starts with that layout.')}
          {sel('musicPlayer', 'Play music blocks in', [['vice', 'VICE: a PRG with a player that calls init and play'], ['deepsid', 'DeepSID (deepsid.chordian.net): the .sid file, online']],
            'Play music (the block\'s right-click menu, the inspector, the command palette) plays the block here. VICE: keys 1-9 and 0 start songs $00-$09, + and - the next and the one before, the border shows the raster time of play. DeepSID: a window of its own opens with DeepSID, and the .sid the export writes goes to its Load SID, which sends the file to DeepSID\'s server (it keeps it there to play it) and plays it with DeepSID\'s emulator; needs the internet.')}
          {path('viceQuicksave', 'VICE quicksave snapshot', 'Empty: C64SC.vsf (x64sc) or C64.vsf (x64) in VICE\'s settings folder (%APPDATA%\\vice), where Snapshot → Quicksave snapshot (Alt+F11) writes it. F9 opens the newest, and the Explorer can open each new one by itself.')}
          {txt('outDir', 'Output folder')}
          {path('unpackerPath', 'External unpacker (optional)', 'Empty: Sindri, the built-in unpacker, unpacks packed (crunched) PRGs. It runs the program in an emulated C64, with the ROMs of the VICE above (or of another VICE it finds), and reports each layer it peels off. An external unpacker such as unp64 runs instead, on a copy of the PRG in a folder of its own.')}
          {txt('unpackerArgs', 'External unpacker arguments', '{in} is the packed PRG, {out} a name for the result; without {out} the file it writes is picked up. unp64: {in} · exomizer: desfx -o {out} {in}')}
          {path('editorPath', 'External editor', <>The Editor button opens the export's folder in it, with its first .asm file open (and exports the project first when it has not been). Empty: the first found of Sublime Text and Visual Studio Code{desktop ? (editors.length ? `, here ${editors[0].name}` : ', and neither was found') : ''}. Choose folder… finds Sublime Text, Visual Studio Code or Notepad++ in the folder; another editor is picked in the file dialog that then opens.</>,
            { placeholder: editors[0]?.path ?? 'Sublime Text or Visual Studio Code', extra: editors.map(e => <button key={e.path} type="button" className="btn small" title={`Use ${e.path}`} onClick={() => set('editorPath', e.path)}>{e.name}</button>) })}
          {txt('editorArgs', 'External editor arguments', "{dir} is the export's folder, {file} its first .asm file. Sublime Text and Visual Studio Code: {dir} {file} (the folder, with the file open in it) · Notepad++: {file}")}
          {path('exomizerPath', 'Exomizer', 'Packs in the Pack view when Exomizer is chosen there instead of Brokkr, the built-in cruncher. The installed app comes with Exomizer 3.1.1 (resources\\exomizer in its folder) and uses it unless you pick another. Empty: Brokkr only.')}
          {desktop && kr && <p className="muted small">Choose folder… looks for the program in the folder you pick, in its bin (or win32) folder and in the folders in it, so the folder a zip unpacked to will do. When it is not there, a file dialog opens in that folder. Save settings keeps it.</p>}
          <p className="muted small">{desktop ? 'Stored by the app (not in the project). The main process starts Java, VICE, an external unpacker, Exomizer and the editor with argument lists, never through a shell.' : 'Running outside the desktop app: these paths only fill in the exported build scripts.'}</p>
        </>}
        {tab === 'analysis' && <>
          {chk('illegal', 'Trace undocumented opcodes', 'LAX, SAX, DCP, ISC… common in demos')}
          {chk('detectMusic', 'Detect SID music', 'JMP init/play tables, the code they reach (traced or not), SID register writes and note tables')}
          {chk('detectGfx', 'Detect graphics', 'from $d018/$dd00/sprite pointer writes, then sizes and alignment')}
          {chk('detectText', 'Detect text', 'PETSCII printed through KERNAL, screen codes copied to screen RAM')}
          {chk('codeIslands', 'Decode unreached code that reads as a routine', 'data nothing traced reaches becomes code when it is 6+ documented instructions ending in RTS or JMP (no BRK, branches inside it); mark it as data (D) where it is not')}
          {chk('deepAnalysis', 'Deep analysis (slower)', 'on for new projects: the normal analysis shows at once and the deep one takes its place when it is done. It traces guesses (pointer-table targets, interrupt handlers, the load address, code islands further into a data block that call known code, the target a JMP the code changes has as loaded) on trial and keeps them when they run into no problem (an interrupt handler or the load address without the side of a branch that does); does not follow a JSR or JMP into ROM or past a routine that never returns; decides branches by the flags set before them; and analyses again until it decides the same. A large program takes a second or two')}
          {chk('bankTracking', 'Follow the memory configuration ($01) and VIC bank', 'names I/O, KERNAL and BASIC accesses only where they are banked in; $dd00 and the $dd02 trick select the VIC bank')}
          {chk('snapshotZeroPage', 'VICE snapshots: include the zero page and the stack', 'opens the RAM from $0002 instead of $0200, for code that runs there (a PC or IRQ handler there is traced). Zero-page variables are then labels of the loaded bytes. Applies to the next snapshot you open')}
        </>}
        {tab === 'output' && <>
          <div className="grid2">
            {sel('hexCase', 'Hex digits', [['lower', '$d020'], ['upper', '$D020']])}
            {sel('bytesPerRow', 'Bytes per .byte row', [[8, '8'], [16, '16'], [4, '4']])}
            {sel('indent', 'Indent', [[8, '8 spaces'], [4, '4 spaces'], [2, '2 spaces']])}
            {sel('commentCol', 'Comment column', [[40, '40'], [48, '48'], [32, '32']])}
          </div>
          {sel('hwInclude', 'Hardware registers and KERNAL routines', [['import', 'Names from include/c64-hardware.asm (#import)'], ['inline', 'Names defined in the .asm file (.label lines)'], ['none', 'Real addresses ($d020, $ffd2), without include/c64-hardware.asm']])}
          <p className="muted small">With real addresses the listing and the export write <span className="mono">sta $d020</span> instead of <span className="mono">sta VIC_BORDER_COLOR</span>, and the comment below still names the register (hover shows its name). Saved in the project; a PRG you open next keeps it.</p>
          {chk('basicUpstart', 'Use BasicUpstart2() when the BASIC stub matches it')}
          {chk('musicAsSid', 'Export detected music as a .sid file loaded with LoadSid()')}
          {chk('gfxBinary', 'Export charsets and bitmaps as binary files with .import binary')}
          {chk('hwComments', 'Comment hardware register accesses', 'what the register or KERNAL routine does, with names or with real addresses')}
          {chk('addrComments', 'Add the original address to every line')}
          {sel('notesFormat', 'Bookmarks and comments in the export', [['html', 'NOTES.html: a formatted page with the code in colour (open it in a browser)'], ['txt', 'NOTES.txt: plain text'], ['none', 'No document']])}
          <p className="muted small">Written only when the project has bookmarks or comments. Both formats list them by address, each with its place in the .asm file and the code around it.</p>
          <p className="muted small">Mnemonics are always written in lower case: Kick Assembler 5.x rejects upper-case mnemonics.</p>
        </>}
        {tab === 'general' && <>
          <label className="check"><input id="set-startScreen" type="checkbox" checked={prefs.startScreen} onChange={e => setPrefs(p => ({ ...p, startScreen: e.target.checked }))} />
            <span>Show the start screen when Mimir starts<small className="muted"> — continue, a new project, open one, or work without a project. Off: Mimir goes on with what you worked on last (the start screen still comes when that project is gone). The project button in the title bar shows it at any time</small></span></label>
          <label className="check"><input id="set-overview" type="checkbox" checked={prefs.overview} onChange={e => setPrefs(p => ({ ...p, overview: e.target.checked }))} />
            <span>Show an overview of the analysis when a file is opened<small className="muted"> — once the analysis is done, a window in the middle says what it found (the program start, packing, loaders, problems, the blocks by type, code, graphics and music), with links to each part and to the listing, the .asm source, Graphics and Memory. A link, a click outside it or Esc closes it. The command palette shows it at any time</small></span></label>
          <label className="check"><input id="set-autoMerge" type="checkbox" checked={prefs.autoMerge} onChange={e => setPrefs(p => ({ ...p, autoMerge: e.target.checked }))} />
            <span>Auto merge when marking blocks<small className="muted"> — marking a selection or a block as a type (C Code, D Bytes, W Words, T Text and the others in Mark as) merges it with the block right before and the block right after it when they are of that type (text in the same encoding) and in the same file: one block. Code merged so is one block, not a block per routine. Off: the marked range is a block of its own. Ctrl+Z takes a merge back</small></span></label>
          <label className="field"><span>Inspector (the panel on the right)</span>
            <select id="set-inspector" value={prefs.inspector} onChange={e => setPrefs(p => ({ ...p, inspector: e.target.value as InspectorMode }))}>
              <option value="open">Always open</option>
              <option value="auto">Folded in: opens when you need it, folds in when you click outside it</option>
            </select>
            <small className="muted">Folded in, the inspector is a strip at the right edge and the listing gets its room. A click on the strip, or on the start of a block (its header in the listing), opens the inspector over the editor; a click outside it or Esc folds it in again. The button at the top of the inspector switches between the two.</small></label>
          <label className="check"><input id="set-gfxPictures" type="checkbox" checked={prefs.gfxPictures} onChange={e => setPrefs(p => ({ ...p, gfxPictures: e.target.checked }))} />
            <span>Show graphics as pictures in the listing<small className="muted"> — sprites, charsets and bitmaps are drawn as they look (in the colours of the Graphics tab, multicolour as the VIC registers say or as set for the block) instead of as .byte rows. Click a character, a sprite or a bitmap cell to select its bytes. The source and the export still write .byte</small></span></label>
          <label className="field"><span>The disk in the Explorer</span>
            <select id="set-diskLook" value={prefs.diskLook} onChange={e => setPrefs(p => ({ ...p, diskLook: e.target.value as DiskLook }))}>
              <option value="mimir">Mimir's list: blocks, name and type in Mimir's font</option>
              <option value="c64">As on a C64: LOAD"$",8 and LIST, in the C64's font and colours</option>
            </select>
            <small className="muted">As on a C64, the directory is the screen a C64 shows after LOAD"$",8 and LIST: light blue on blue, the names in PETSCII with their graphics, and whatever their control codes do (colours, RETURN, DEL), as the 1541 and BASIC list them. Its letters come from VICE's character ROM (Toolchain → VICE); without it, from Mimir's own C64 letters, with no graphics. A click on a file opens it as in Mimir's list; Aa beside the eject button switches the character set, as Commodore+Shift does. The screen is as wide as the side panel: drag its edge to see it larger. Mimir's list, or Restore defaults, shows the disk as before.</small></label>
          <label className="check"><input id="set-autoUnpack" type="checkbox" checked={prefs.autoUnpack} onChange={e => setPrefs(p => ({ ...p, autoUnpack: e.target.checked }))} />
            <span>Unpack packed files when they are opened<small className="muted"> — when Sindri (or the external unpacker in Toolchain) finds a file you open packed, it is unpacked at once, as Unpack does, without the click (in a project, Ctrl+Z brings the packed file back). A file Sindri cannot unpack stays as it was opened</small></span></label>
          <p className="muted small">{desktop ? 'Kept by the app (not in the project).' : 'Running outside the desktop app: there is no start screen.'}</p>
        </>}
      </div>
      <div className="modal-foot"><button className="btn ghost" onClick={() => { setS({ ...DEFAULT_SETTINGS }); setPrefs(DEFAULT_PREFS); }}>Restore defaults</button><span className="grow" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onSave(s, prefs)}>Save settings</button></div>
    </Modal>
  );
}
