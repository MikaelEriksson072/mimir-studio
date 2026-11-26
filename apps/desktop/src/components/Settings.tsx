/* Settings: pages in a list on the left, grouped by where they are kept: the app's own preferences (General, kept by
 * the window), the project's analysis and assembler output (saved in the project) and the toolchain (stored by the main
 * process), split into Assemblers, VICE & music, Debuggers and Packers & editor. In an Assembler project the Project group
 * is its own page instead (Assembler project: the language, the main file, its own arguments for the assembler and where
 * Debug runs), the analysis and the assembler output being a re-assembled program's. Each setting has a line saying what
 * it does and the rest of its explanation behind More; the search box looks through every page. */
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, PICTURE_FORMATS_HIRES, PICTURE_FORMATS_MC, pictureFormatName, type ScriptLang, type Settings } from '@mimir/core';
import { cx } from '../lib/util';
import type { DiskLook, InspectorMode } from '../store/ui';
import type { AsmMachineKind } from '../store/assembler';
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
  /** a routine that is named is remembered, and its name suggested in other projects */
  learnRoutines: boolean;
}
const DEFAULT_PREFS: AppPrefs = { startScreen: true, inspector: 'open', gfxPictures: true, autoUnpack: false, overview: true, diskLook: 'mimir', autoMerge: true, learnRoutines: true };
type PrefBool = { [K in keyof AppPrefs]: AppPrefs[K] extends boolean ? K : never }[keyof AppPrefs];

/** an Assembler project's own settings (Settings → Assembler project): the language, the main file and the arguments
 *  are kept in its project file, where Debug runs by the app for its folder */
export interface AsmSettings {
  lang: ScriptLang;
  /** null: the one Mimir finds */
  main: string | null;
  /** more arguments for the assembler, as typed */
  args: string;
  machine: AsmMachineKind;
}
/** what the page shows besides: the sources in the folder, the main file Mimir finds */
export interface AsmSettingsInfo { sources: string[]; found: string | null }

type PageId = 'general' | 'analysis' | 'output' | 'asmproject' | 'assemblers' | 'vice' | 'debuggers' | 'tools';
export type SettingsPage = PageId;
type Group = 'App' | 'Project' | 'Toolchain';
const GROUPS: readonly Group[] = ['App', 'Project', 'Toolchain'];

/** the page the dialog opens at: the one it was last on, while the app runs */
let lastPage: PageId = 'general';

/** one setting: its label, a line under it, and the rest of what there is to say behind More */
interface Item {
  /** the setting's key; its control is set-<id>, the line under it set-<id>-help */
  id: string;
  label: string;
  help?: string;
  /** behind More; a new line starts a paragraph */
  more?: string;
  /** more text the search looks through (a select's options) */
  words?: string;
  /** a checkbox, its label beside it */
  check?: boolean;
  control: ReactNode;
  /** under the control (what Choose folder… did not find) */
  after?: ReactNode;
}
interface Section { title?: string; items: Item[]; grid?: boolean; note?: string }
interface Page { id: PageId; label: string; group: Group; where: string; sections: Section[]; foot?: string }

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `editors`: Sublime Text and Visual Studio Code where they are installed (the desktop app finds them); `asm`: an
 *  Assembler project's settings (its page instead of Analysis and Assembler output), with `asmInfo`; `page`: the page
 *  it opens at (else the one it was last on) */
export function SettingsModal({ settings, prefs: prefs0, desktop, editors, asm: asm0, asmInfo, page: page0, onSave, onClose }: {
  settings: Settings; prefs: AppPrefs; desktop: boolean; editors: EditorInfo[]; asm?: AsmSettings | null; asmInfo?: AsmSettingsInfo; page?: SettingsPage;
  onSave: (s: Settings, prefs: AppPrefs, asm: AsmSettings | null) => void; onClose: () => void;
}) {
  const [s, setS] = useState<Settings>(settings);
  const [prefs, setPrefs] = useState<AppPrefs>(prefs0);
  const [asm, setAsm] = useState<AsmSettings | null>(asm0 ?? null);
  // (an Assembler project has no Analysis or Assembler output page, a re-assembled program no Assembler project page)
  const shows = (p: PageId) => (asm0 ? p !== 'analysis' && p !== 'output' : p !== 'asmproject');
  const [page, setPageState] = useState<PageId>(() => [page0, lastPage].find((p): p is PageId => !!p && shows(p)) ?? 'general');
  const setPage = (p: PageId) => { lastPage = p; setPageState(p); };
  const [query, setQuery] = useState('');
  /** the settings whose More is turned the other way from how the search left it */
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const mainRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }, [page, query]);
  useEffect(() => { setFlipped(new Set()); }, [query]);

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

  // ---- the controls, each with its label, line and More ----
  const described = (k: string, help?: string, more?: string) => (help || more ? `set-${k}-help` : undefined);
  const chk = (k: Key, label: string, help?: string, more?: string): Item => ({ id: k, label, help, more, check: true,
    control: <input id={`set-${k}`} type="checkbox" checked={!!s[k]} aria-describedby={described(k, help, more)} onChange={e => set(k, e.target.checked as never)} /> });
  const pchk = (k: PrefBool, label: string, help?: string, more?: string): Item => ({ id: k, label, help, more, check: true,
    control: <input id={`set-${k}`} type="checkbox" checked={prefs[k]} aria-describedby={described(k, help, more)} onChange={e => setPrefs(p => ({ ...p, [k]: e.target.checked }))} /> });
  const sel = (k: Key, label: string, opts: [string | number, string][], help?: string, more?: string): Item => ({ id: k, label, help, more, words: opts.map(o => o[1]).join(' '),
    control: <select id={`set-${k}`} value={String(s[k])} aria-describedby={described(k, help, more)} onChange={e => set(k, (isNaN(+e.target.value) ? e.target.value : +e.target.value) as never)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> });
  const psel = <K extends 'inspector' | 'diskLook'>(k: K, label: string, opts: [AppPrefs[K], string][], help?: string, more?: string): Item => ({ id: k, label, help, more, words: opts.map(o => o[1]).join(' '),
    control: <select id={`set-${k}`} value={prefs[k]} aria-describedby={described(k, help, more)} onChange={e => setPrefs(p => ({ ...p, [k]: e.target.value as AppPrefs[K] }))}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> });
  const txt = (k: Key, label: string, help?: string, more?: string): Item => ({ id: k, label, help, more,
    control: <input id={`set-${k}`} className="mono" value={String(s[k])} aria-describedby={described(k, help, more)} onChange={e => set(k, e.target.value as never)} spellCheck={false} /> });
  /** a path to a program or file, with Choose folder… in the desktop app (labelled by id: a label around the row would
   *  take its buttons into the field's name) */
  const path = (k: LocateKey, label: string, help?: string, more?: string, o: { placeholder?: string; extra?: ReactNode } = {}): Item => ({ id: k, label, help, more,
    control: <div className="field-row"><input id={`set-${k}`} className="mono" value={String(s[k])} placeholder={o.placeholder} aria-describedby={described(k, help, more)} onChange={e => { set(k, e.target.value); setMissing(m => ({ ...m, [k]: undefined })); }} spellCheck={false} />
      {o.extra}
      {desktop && kr && <button type="button" className="btn small" aria-label={`Choose folder for ${label}`} title={`Choose the folder it is in: Mimir finds ${label} there`} onClick={() => void locate(k)}>Choose folder…</button>}</div>,
    after: missing[k] && <small className="warn-text" role="status">{missing[k]}</small> });

  const tass = s.assembler === '64tass';
  const kept = desktop ? 'Kept by the app, for every project.' : 'Running outside the desktop app.';
  const inProject = 'Saved in the project; a file you open next keeps them.';
  const tools = desktop ? 'Kept by the app, for every project. Mimir starts each program with a list of arguments, never through a shell.' : 'Running outside the desktop app: these paths only fill in the exported build scripts.';
  const chooseFolder = desktop && kr ? 'Choose folder… looks for the program in the folder you pick, in its bin (or win32) folder and in the folders in it, so the folder a zip unpacked to will do. When it is not there, a file dialog opens in that folder.' : undefined;
  const editorFound = desktop ? (editors.length ? `, here ${editors[0].name}` : ', and neither was found') : '';

  /** Project → Assembler project: what an Assembler project is written for and builds, its own arguments for the
   *  assembler, and where Debug runs */
  const asmPage = (a: AsmSettings): Page => {
    const kick = a.lang !== '64tass', tool = kick ? 'Kick Assembler' : '64tass', toolArgs = (kick ? s.kickArgs : s.tassArgs).trim();
    const put = (p: Partial<AsmSettings>) => setAsm(o => o && { ...o, ...p });
    const sources = asmInfo?.sources ?? [];
    return { id: 'asmproject', label: 'Assembler project', group: 'Project', where: 'Saved in the project file; where Debug runs is kept by the app, for this project\'s folder.', sections: [
      { title: 'Building', items: [
        { id: 'asmLang', label: 'Language', help: 'What the sources are written for: Mimir checks them as that while you type, and Run, Build and Release build them with it.',
          more: 'The pill beside the file name in the Assembler switches it too. Kick Assembler is built with KickAss.jar (it needs Java), 64tass with the 64tass that comes with Mimir or the one in Toolchain → Assemblers. The sources stay as they are: written for the other one, they have to be changed by hand.',
          words: 'Kick Assembler 64tass',
          control: <select id="set-asmLang" value={a.lang} aria-describedby="set-asmLang-help" onChange={e => put({ lang: e.target.value === '64tass' ? '64tass' : 'kickass' })}>
            <option value="kickass">Kick Assembler</option><option value="64tass">64tass</option></select> },
        { id: 'asmMain', label: 'Main file', help: `The source Run, Build, Release and Debug build; the others are what it imports.${asmInfo?.found ? ` Mimir finds ${asmInfo.found}.` : ''}`,
          more: 'Found by Mimir: the source that starts a program and that no other source imports. Right-click a source in the Assembler\'s file list to make it the main file there.',
          words: sources.join(' '),
          control: <select id="set-asmMain" className="mono" value={a.main ?? ''} aria-describedby="set-asmMain-help" onChange={e => put({ main: e.target.value || null })}>
            <option value="">{asmInfo?.found ? `${asmInfo.found} (found)` : 'Found by Mimir'}</option>
            {[...new Set([...sources, ...(a.main ? [a.main] : [])])].map(p => <option key={p} value={p}>{p}{sources.includes(p) ? '' : ' (not in the folder)'}</option>)}</select> },
        { id: 'asmArgs', label: 'More arguments', help: `For ${tool} in this project, after the toolchain's. ${kick ? '`-define DEBUG` defines DEBUG for `#if DEBUG`' : '`-D DEBUG=1` defines DEBUG as 1 for `.if DEBUG`'}; Mimir's own check knows it too.`,
          more: `They come after the ones in Toolchain → Assemblers (${toolArgs ? `\`${toolArgs}\`` : 'none now'}), in Run, Build, Release, Shift+F5 and the build.bat and build.sh Mimir writes. `
            + `Mimir's own check, which runs as you type, takes the defines in both: ${kick ? '`-define NAME` (more than one: `-define DEBUG -define MUSIC`)' : '`-D NAME=value` or `-DNAME=value` (`-D NAME` alone is 0, as 64tass gives it); a source that defines the name again is an error, as in 64tass, unless it does so in `.weak` … `.endweak`, which gives way'}; the other arguments are the build's only. `
            + 'Quotes keep spaces in one argument; Mimir passes them to the assembler without a shell.',
          words: 'define arguments command line',
          control: <input id="set-asmArgs" className="mono" value={a.args} placeholder={kick ? '-define DEBUG' : '-D DEBUG=1'} aria-describedby="set-asmArgs-help" onChange={e => put({ args: e.target.value })} spellCheck={false} /> },
      ] },
      { title: 'Debugging', items: [
        { id: 'asmMachine', label: 'Debug runs in', help: 'Memory only: Mimir\'s 6510 with the program\'s memory. Whole C64: Sindri\'s C64 with VICE\'s ROMs.',
          more: 'Memory only is fast; the KERNAL\'s printing routines are done on the C64 screen beside the code, and there are no ROMs or I/O. The whole C64 has BASIC, the KERNAL, the VIC, the CIAs and their interrupts, the keyboard and the screen as the VIC draws it, live. The Runs in box beside Debug in the Assembler switches it too.',
          words: 'memory only whole c64 sindri',
          control: <select id="set-asmMachine" value={a.machine} aria-describedby="set-asmMachine-help" onChange={e => put({ machine: e.target.value === 'c64' ? 'c64' : 'memory' })}>
            <option value="memory">Memory only</option><option value="c64">Whole C64</option></select> },
      ] },
    ] };
  };

  const allPages: Page[] = [
    { id: 'general', label: 'General', group: 'App', where: desktop ? kept : 'Running outside the desktop app: there is no start screen.', sections: [
      { title: 'Starting and opening files', items: [
        pchk('startScreen', 'Show the start screen when Mimir starts', 'Continue, a new project, open one, or work without a project.',
          'Off: Mimir goes on with what you worked on last (the start screen still comes when that project is gone). The project button in the title bar shows it at any time.'),
        pchk('overview', 'Show an overview of the analysis when a file is opened', 'Once the analysis is done, a window says what it found, with links to each part.',
          'It shows the program start, packing, loaders, problems, the blocks by type, code, graphics and music, with links to each part and to the listing, the .asm source, Graphics and Memory. A link, a click outside it or Esc closes it. The Analysis overview button in the title bar (and the command palette) shows it again at any time, also when this is off.'),
        pchk('autoUnpack', 'Unpack packed files when they are opened', 'As Unpack does, without the click.',
          'When Sindri (or the external unpacker in Toolchain → Packers & editor) finds a file you open packed, it is unpacked at once. In a project, Ctrl+Z brings the packed file back. A file Sindri cannot unpack stays as it was opened.'),
      ] },
      { title: 'Listing', items: [
        pchk('gfxPictures', 'Show graphics as pictures in the listing', 'Sprites, charsets and bitmaps are drawn as they look instead of as .byte rows.',
          'They are drawn in the colours of the Graphics tab, multicolour as the VIC registers say or as set for the block. Click a character, a sprite or a bitmap cell to select its bytes. The source and the export still write .byte.'),
        pchk('autoMerge', 'Auto merge when marking blocks', 'A range marked as a type joins the blocks of that type right before and after it.',
          'Marking a selection or a block as a type (C Code, D Bytes, W Words, T Text and the others in Mark as) merges it with the block right before and the block right after it when they are of that type (text in the same encoding) and in the same file: one block. Code merged so is one block, not a block per routine. Off: the marked range is a block of its own. Ctrl+Z takes a merge back.'),
      ] },
      { title: 'Names', items: [
        pchk('learnRoutines', 'Learn the routines I name', 'A routine you name is remembered by its code, and other projects with the same routine get the name suggested.',
          'When you name a routine (a JSR target, an interrupt handler, an entry point), Mimir keeps a fingerprint of it: its bytes, with the addresses inside the program left out, so the routine is known again wherever it is linked. A project that has it gets the name suggested: in the analysis overview (Known routines, Name them all), in the listing\'s right-click menu on the routine, and in the command palette (Name the routines known from other projects). Nothing is named until you say so, and Ctrl+Z takes it back. '
          + 'A routine of a few instructions is not learned: with its addresses left out it would be every loop of its kind. The right-click menu forgets a name that was suggested wrongly; the command palette learns all the routines already named in the open project.\n'
          + 'Off: nothing new is learned. What is known is still suggested.'),
      ] },
      { title: 'Library', items: [
        { id: 'libraryDir', label: 'Library folder', help: 'Where the SID tunes, sprites, charsets and bitmaps you add to the library are kept. Empty: Mimir\\Library in your documents folder.',
          more: 'The library has a folder for each kind (SIDs, Sprites, Chars, Bitmaps), each a file other tools read too (.sid, .spr, .64c, a paint program\'s picture) named after where it was found, and library.json, which keeps where each was taken from and how it is drawn. Files you put in those folders yourself are in the library too. A folder picked here is used from the next time the library is read; the files in the old one stay there.',
          words: 'sid sprites chars charset bitmaps library folder',
          control: <div className="field-row"><input id="set-libraryDir" className="mono" value={s.libraryDir} placeholder="Mimir\Library in the documents folder" aria-describedby="set-libraryDir-help" onChange={e => set('libraryDir', e.target.value)} spellCheck={false} />
            {desktop && kr && <button type="button" className="btn small" aria-label="Choose the library folder" onClick={() => { kr.libraryPick({ current: s.libraryDir }).then(r => { if (r) set('libraryDir', r.dir); }).catch(() => undefined); }}>Choose…</button>}</div> },
        sel('bitmapFormatMc', 'Multicolour bitmaps are saved as', PICTURE_FORMATS_MC.map(f => [f, pictureFormatName(f)]), 'The picture format a multicolour bitmap added to the library gets, in its Bitmaps folder.',
          'Koala Painter: load address $6000, the bitmap, the screen matrix ($7f40), colour RAM ($8328) and the background ($8710), 10003 bytes. Advanced Art Studio: load address $2000, the bitmap, the screen matrix ($3f40), the border and background ($4328), colour RAM ($4338), 10018 bytes. '
          + 'Add to library can pick the other one for a picture; the Bitmaps folder reads both (.kla, .koa, .ocp, .mpic), also files you put there yourself.'),
        sel('bitmapFormatHires', 'Hires bitmaps are saved as', PICTURE_FORMATS_HIRES.map(f => [f, pictureFormatName(f)]), 'The picture format a hires bitmap added to the library gets.',
          'Art Studio: load address $2000, the bitmap, the screen matrix ($3f40) and the border, 9009 bytes. Doodle!: load address $5c00, the screen matrix, then the bitmap at $6000, 9218 bytes. The Bitmaps folder reads both (.art, .dd, .ddl).'),
      ] },
      { title: 'Panels', items: [
        psel('inspector', 'Inspector (the panel on the right)', [['open', 'Always open'], ['auto', 'Folded in: opens when you need it, folds in when you click outside it']],
          'Folded in, it is a strip at the right edge and the listing gets its room.',
          'A click on the strip, or on the start of a block (its header in the listing), opens the inspector over the editor; a click outside it or Esc folds it in again. The button at the top of the inspector switches between the two.'),
        psel('diskLook', 'The disk and the tape in the Explorer', [['mimir', "Mimir's list: blocks or time, name and type in Mimir's font"], ['c64', 'As on a C64: LOAD"$",8 and LIST, for the tape too, in the C64\'s font and colours']],
          'As on a C64: the screen a C64 shows after LOAD"$",8 and LIST; a tape\'s files as the directory they would make on a disk.',
          'The directory is light blue on blue, the names in PETSCII with their graphics, and whatever their control codes do (colours, RETURN, DEL), as the 1541 and BASIC list them.\n'
          + 'A tape has no directory: its files are listed as they would be on a disk, as VICE lists a tape, the tape\'s name and length on the top line, each file with the blocks it would take on a 1541, every format\'s files, those of a turbo loader with a T before the type (TPRG): the KERNAL cannot load them. FOUND beside Aa shows instead what LOAD prints as it searches the tape to its end, PRESS PLAY ON TAPE, OK, SEARCHING and a FOUND line for each header the KERNAL reads (a data block that starts as a header does gets one too), the turbo loader\'s files listed under it.\n'
          + 'The letters come from VICE\'s character ROM (Toolchain → VICE & music); without it, from Mimir\'s own C64 letters, with no graphics. A click on a file opens it as in Mimir\'s list; Aa beside the eject button switches the character set, as Commodore+Shift does. The screen is as wide as the side panel: drag its edge to see it larger.'),
      ] },
    ] },
    { id: 'analysis', label: 'Analysis', group: 'Project', where: inProject, sections: [
      { title: 'What to look for', items: [
        chk('detectMusic', 'Detect SID music', 'JMP init/play tables, the code they reach (traced or not), SID register writes and note tables.'),
        chk('detectGfx', 'Detect graphics', 'From $d018/$dd00/sprite pointer writes, then sizes and alignment.'),
        chk('detectText', 'Detect text', 'PETSCII printed through KERNAL, screen codes copied to screen RAM.'),
      ] },
      { title: 'Tracing the code', items: [
        chk('illegal', 'Trace undocumented opcodes', 'LAX, SAX, DCP, ISC… common in demos.'),
        chk('codeIslands', 'Decode unreached code that reads as a routine', 'Data nothing traced reaches becomes code when it reads as a routine.',
          'That is 6 or more documented instructions ending in RTS or JMP, with no BRK and its branches inside it. Mark it as data (D) where it is not code.'),
        chk('bankTracking', 'Follow the memory configuration ($01) and VIC bank', 'I/O, KERNAL and BASIC accesses are named only where they are banked in.',
          '$dd00 and the $dd02 trick select the VIC bank. Off: accesses to I/O addresses inside the loaded bytes are written as labels, and Problems says why.'),
        chk('deepAnalysis', 'Deep analysis (slower)', 'Traces guesses on trial and keeps those that run into no problem. A large program takes a second or two.',
          'On for new projects: the normal analysis shows at once and the deep one takes its place when it is done.\n'
          + 'It traces guesses (pointer-table targets, interrupt handlers, the load address, code islands further into a data block that call known code, the target a JMP the code changes has as loaded) on trial and keeps them when they run into no problem (an interrupt handler or the load address without the side of a branch that does); does not follow a JSR or JMP into ROM or past a routine that never returns; decides branches by the flags set before them; and analyses again until it decides the same.'),
      ] },
      { title: 'VICE snapshots', items: [
        chk('snapshotZeroPage', 'Include the zero page and the stack', 'Opens the RAM from $0002 instead of $0200, for code that runs there. Applies to the next snapshot you open.',
          'A PC or IRQ handler there is traced. Zero-page variables are then labels of the loaded bytes.'),
      ] },
    ] },
    { id: 'output', label: 'Assembler output', group: 'Project', where: inProject, sections: [
      { title: 'Assembler', items: [
        sel('assembler', 'Assembler', [['kick', 'Kick Assembler 5.x (KickAss.jar)'], ['64tass', '64tass 1.57 (Turbo Assembler syntax)']],
          'The source the listing shows, the export writes, and Verify and Build & Run assemble.',
          '64tass: comments with ;, * = for an address, .logical for a relocated block, .if for a block left out of the build, the music read from its .sid with binary(), texts with .enc "none" or "screen" (letters as 64tass\'s -a tables have them: lower case for the upper case on the C64\'s screen), the undocumented opcodes by 64tass\'s names with .cpu "6502i"; it is built with -a -C.\n'
          + 'Patches and scripts keep the assembler they were written for; new ones are written for this one.'),
        sel('hwInclude', 'Hardware registers and KERNAL routines', [['import', `Names from include/c64-hardware.asm (${tass ? '.include' : '#import'})`], ['inline', `Names defined in the .asm file (${tass ? 'name = $d020' : '.label'} lines)`], ['none', 'Real addresses ($d020, $ffd2), without include/c64-hardware.asm']],
          'With real addresses the listing and the export write `sta $d020` instead of `sta VIC_BORDER_COLOR`, and the comment still names the register (hover shows its name).'),
      ] },
      { title: 'Layout', grid: true, items: [
        sel('hexCase', 'Hex digits', [['lower', '$d020'], ['upper', '$D020']]),
        sel('bytesPerRow', 'Bytes per .byte row', [[8, '8'], [16, '16'], [4, '4']]),
        sel('indent', 'Indent', [[8, '8 spaces'], [4, '4 spaces'], [2, '2 spaces']]),
        sel('commentCol', 'Comment column', [[40, '40'], [48, '48'], [32, '32']]),
      ], note: tass ? 'Mnemonics are always written in lower case (64tass runs with -C, case-sensitive), the undocumented ones by 64tass\'s names (isb, asr, sbx, ane, sha, shs, lds) with .cpu "6502i" at the top.' : 'Mnemonics are always written in lower case: Kick Assembler 5.x rejects upper-case mnemonics.' },
      { title: 'Comments', items: [
        chk('hwComments', 'Comment hardware register accesses', 'What the register or KERNAL routine does, with names or with real addresses.'),
        chk('addrComments', 'Add the original address to every line'),
        sel('notesFormat', 'Bookmarks and comments in the export', [['html', 'NOTES.html: a formatted page with the code in colour (open it in a browser)'], ['txt', 'NOTES.txt: plain text'], ['none', 'No document']],
          'Written only when the project has bookmarks or comments.', 'Both formats list them by address, each with its place in the .asm file and the code around it.'),
      ] },
      { title: 'Export', items: [
        tass ? chk('basicUpstart', 'Write the BASIC stub as one BASIC line', 'As `.word (+), 10` and `.null $9e, format("%d", start)`, when the stub is that line.')
          : chk('basicUpstart', 'Use BasicUpstart2() when the BASIC stub matches it'),
        tass ? chk('musicAsSid', 'Export detected music as a .sid file read with binary()', 'music.init, music.play and music.data, as with Kick Assembler.')
          : chk('musicAsSid', 'Export detected music as a .sid file loaded with LoadSid()'),
        chk('gfxBinary', 'Export charsets and bitmaps as binary files', tass ? 'Read with `.binary`.' : 'Read with `.import binary`.'),
      ] },
    ] },
    ...(asm ? [asmPage(asm)] : []),
    { id: 'assemblers', label: 'Assemblers', group: 'Toolchain', where: tools, foot: chooseFolder, sections: [
      { title: 'Kick Assembler', items: [
        path('javaPath', 'Java executable', 'Kick Assembler needs Java 8 or later.', 'Choose folder…: the JDK or JRE folder (java is in its bin folder), or the folder with several in it.'),
        path('kickJar', 'KickAss.jar', 'Verify and Build & Run assemble with this jar when it exists.'),
        txt('kickArgs', 'Extra Kick Assembler arguments', '`-vicesymbols` writes a VICE label file next to the PRG.',
          'For every build, a re-assembled program\'s and an Assembler project\'s; an Assembler project can add its own after them (Project → Assembler project). Mimir\'s own check takes the `-define NAME` in them too.'),
      ] },
      { title: '64tass', items: [
        path('tassPath', '64tass', 'Verify and Build & Run assemble a project written for 64tass (Assembler output) with it, and an Assembler project in 64tass is built with it.',
          'The installed app comes with 64tass 1.57.2900 (resources\\64tass in its folder) and uses it unless you pick another.'),
        txt('tassArgs', 'Extra 64tass arguments', '`-Wall` shows more warnings in Problems.', 'Mimir always gives -a -C --cbm-prg, the output and a VICE label file (--vice-labels -l). An Assembler project can add its own after them (Project → Assembler project); Mimir\'s own check takes the `-D NAME=value` in them too.'),
      ] },
      { title: 'Build', items: [
        txt('outDir', 'Output folder', 'The folder in the export\'s folder the build writes the PRG and its VICE labels to.'),
      ] },
    ] },
    { id: 'vice', label: 'VICE & music', group: 'Toolchain', where: tools, foot: chooseFolder, sections: [
      { title: 'VICE', items: [
        path('vicePath', 'VICE emulator (x64sc)', 'Build & Run (F5) starts the program in it. Sindri and the C64 look of the Explorer use its ROMs.', 'Choose folder…: the VICE folder (x64sc is in it or in its bin folder).'),
        txt('viceArgs', 'Extra VICE arguments'),
        path('viceQuicksave', 'VICE quicksave snapshot', 'F9 opens the newest. Empty: the one Alt+F11 writes.',
          'Empty: C64SC.vsf (x64sc) or C64.vsf (x64) in VICE\'s settings folder (%APPDATA%\\vice), where Snapshot → Quicksave snapshot (Alt+F11) writes it. The Explorer can open each new one by itself.'),
      ] },
      { title: 'Music', items: [
        sel('musicPlayer', 'Play music blocks in', [['vice', 'VICE: a PRG with a player that calls init and play'], ['deepsid', 'DeepSID (deepsid.chordian.net): the .sid file, online']],
          'Play music (the block\'s right-click menu, the inspector, the command palette) plays the block here.',
          'VICE: keys 1-9 and 0 start songs $00-$09, + and - the next and the one before, the border shows the raster time of play.\n'
          + 'DeepSID: a window of its own opens with DeepSID, and the .sid the export writes goes to its Load SID, which sends the file to DeepSID\'s server (it keeps it there to play it) and plays it with DeepSID\'s emulator; needs the internet.'),
      ] },
    ] },
    { id: 'debuggers', label: 'Debuggers', group: 'Toolchain', where: tools, foot: chooseFolder, sections: [
      { items: [
        sel('debugger', 'Build & Run in a debugger (Shift+F5)', [['retro', 'Retro Debugger'], ['c64d', 'C64 Debugger']],
          'Shift+F5 builds and verifies as F5 does, then starts the program in this debugger instead of VICE.',
          'It starts the program the way VICE does: RUN, sys <start> with $01 as it starts, or (a program over BASIC\'s work area or the screen) as from VICE\'s monitor; the drive reads the disk first; with the build\'s labels. The debugger loads a copy of the PRG with a little start code next to the program, which does what VICE types.\n'
          + 'Retro Debugger 1.0.0 stops its emulation with a tape on its command line, so a tape is left out (a program that boots from a tape needs C64 Debugger or VICE). A disk it gets in its drive first, and the program after that, as a debugger that was already running gets one; but with its VIC border set to Full or Debug it crashes about every other time it gets a disk, so the disk is then left out and the build log says what to change (in Retro Debugger: Settings → C64 → VIC → VIC Border mode → Normal). C64 Debugger does not start a cartridge (Retro Debugger and VICE do).\n'
          + 'A VICE snapshot is restarted in C64 Debugger: Mimir writes it again as that debugger reads one (VICE 3.1\'s format, as its C64 PAL or C64 NTSC model, which the debugger must be set to), with the disk in it, and passes it to the debugger, a running one too. Retro Debugger does not read VICE\'s snapshots.'),
      ] },
      { title: 'Retro Debugger', items: [
        path('retroDebuggerPath', 'Retro Debugger', 'Its program is C64Debugger.exe. Starts cartridges; leaves out disks and tapes.', 'Choose folder…: the Retro Debugger folder.'),
        txt('retroDebuggerArgs', 'Extra Retro Debugger arguments', '`-layout <id>` starts with that layout, `-unpause` runs the code even when the debugger pauses it.'),
        { id: 'debuggerWait', label: 'Wait before the start (ms)', help: 'Raise it when the screen stays blank: the program started before READY.',
          more: 'Retro Debugger loads the program and jumps to its start this long after it starts (-wait), when the C64 should be at READY. C64 Debugger waits for READY by itself.',
          control: <input id="set-debuggerWait" className="mono" type="number" min={0} max={60000} step={500} value={s.debuggerWait} aria-describedby="set-debuggerWait-help" onChange={e => set('debuggerWait', Math.max(0, Math.min(60000, Math.round(Number(e.target.value) || 0))))} /> },
      ] },
      { title: 'C64 Debugger', items: [
        path('c64DebuggerPath', 'C64 Debugger', 'Its program is C64Debugger.exe. Takes disks and VICE snapshots; no cartridges.', 'Choose folder…: the C64 Debugger folder (C64Debugger.exe is in it).'),
        txt('c64DebuggerArgs', 'Extra C64 Debugger arguments', '`-layout <id>` starts with that layout.'),
      ] },
    ] },
    { id: 'tools', label: 'Packers & editor', group: 'Toolchain', where: tools, foot: chooseFolder, sections: [
      { title: 'Unpacking', items: [
        path('unpackerPath', 'External unpacker (optional)', 'Empty: Sindri, the built-in unpacker, unpacks packed (crunched) PRGs.',
          'Sindri runs the program in an emulated C64, with the ROMs of the VICE in VICE & music (or of another VICE it finds), and reports each layer it peels off. An external unpacker such as unp64 runs instead, on a copy of the PRG in a folder of its own.'),
        txt('unpackerArgs', 'External unpacker arguments', '`{in}` is the packed PRG, `{out}` a name for the result.', 'Without {out} the file it writes is picked up. unp64: {in} · exomizer: desfx -o {out} {in}'),
      ] },
      { title: 'Packing', items: [
        path('exomizerPath', 'Exomizer', 'The Pack view packs with it when Exomizer is chosen there instead of Brokkr, the built-in cruncher. Empty: Brokkr only.',
          'The installed app comes with Exomizer 3.1.1 (resources\\exomizer in its folder) and uses it unless you pick another.'),
      ] },
      { title: 'Editor', items: [
        path('editorPath', 'External editor', 'The Editor button opens the export\'s folder in it, with its first .asm file open.',
          `It exports the project first when it has not been. Empty: the first found of Sublime Text and Visual Studio Code${editorFound}. Choose folder… finds Sublime Text, Visual Studio Code or Notepad++ in the folder; another editor is picked in the file dialog that then opens.`,
          { placeholder: editors[0]?.path ?? 'Sublime Text or Visual Studio Code', extra: editors.map(e => <button key={e.path} type="button" className="btn small" title={`Use ${e.path}`} onClick={() => set('editorPath', e.path)}>{e.name}</button>) }),
        txt('editorArgs', 'External editor arguments', '`{dir}` is the export\'s folder, `{file}` its first .asm file.', 'Sublime Text and Visual Studio Code: {dir} {file} (the folder, with the file open in it) · Notepad++: {file}'),
      ] },
    ] },
  ];
  const pages = allPages.filter(p => shows(p.id));

  // ---- the search: every word typed is somewhere in the setting, its section or its page ----
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const hitRe = searching ? new RegExp(`(${words.map(escapeRe).join('|')})`, 'gi') : null;
  const matches = (p: Page, sec: Section, it: Item) => {
    const all = [p.group, p.label, sec.title, it.label, it.help, it.more, it.words].filter(Boolean).join(' ').toLowerCase();
    return words.every(w => all.includes(w));
  };
  const found = pages.map(p => ({ p, sections: p.sections.map(sec => ({ sec, items: sec.items.filter(it => matches(p, sec, it)) })).filter(x => x.items.length) }));
  const hits = (id: PageId) => found.find(f => f.p.id === id)!.sections.reduce((n, x) => n + x.items.length, 0);

  /** text with `code` in the code font and the words searched for marked */
  const rich = (t: string): ReactNode => t.split(/`([^`]+)`/).map((part, i) => {
    const marked = hitRe ? part.split(hitRe).map((x, j) => (j % 2 ? <mark key={j} className="set-hit">{x}</mark> : x)) : part;
    return i % 2 ? <code key={i} className="set-code">{marked}</code> : <Fragment key={i}>{marked}</Fragment>;
  });

  const row = (it: Item) => {
    const auto = searching && !!it.more && words.some(w => it.more!.toLowerCase().includes(w));
    const open = auto !== flipped.has(it.id);
    const toggle = () => setFlipped(f => { const n = new Set(f); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; });
    const help = (it.help || it.more) && (
      <div className="set-help" id={`set-${it.id}-help`}>
        {it.help && rich(it.help)}
        {it.more && <>{it.help && ' '}<button type="button" className="linkish set-more-btn" aria-expanded={open} onClick={toggle}>{open ? 'Less' : 'More'}<span className="sr-only"> about {it.label}</span></button></>}
      </div>);
    const more = it.more && open && <div className="set-more">{it.more.split('\n').map((para, i) => <p key={i}>{rich(para)}</p>)}</div>;
    return it.check
      ? <div key={it.id} className="set-row check-row"><label className="check">{it.control}<span className="set-label">{rich(it.label)}</span></label>{help}{more}</div>
      : <div key={it.id} className="field set-row"><label className="set-label" htmlFor={`set-${it.id}`}>{rich(it.label)}</label>{it.control}{it.after}{help}{more}</div>;
  };
  const sections = (list: { sec: Section; items: Item[] }[]) => list.map(({ sec, items }, i) => (
    <section key={sec.title ?? i} className="set-sec">
      {sec.title && <h3>{rich(sec.title)}</h3>}
      <div className={cx(sec.grid && 'set-grid')}>{items.map(row)}</div>
      {sec.note && !searching && <p className="set-note">{sec.note}</p>}
    </section>));

  const go = (id: PageId) => { setQuery(''); setPage(id); };
  const order = pages.map(p => p.id);
  const navKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = order.indexOf(page);
    const to = e.key === 'ArrowDown' ? order[(i + 1) % order.length] : e.key === 'ArrowUp' ? order[(i - 1 + order.length) % order.length] : e.key === 'Home' ? order[0] : e.key === 'End' ? order[order.length - 1] : null;
    if (!to) return;
    e.preventDefault();
    go(to);
    document.getElementById(`set-tab-${to}`)?.focus();
  };
  const current = pages.find(p => p.id === page)!;

  return (
    <Modal title="Settings" onClose={onClose} className="settings-modal">
      <div className="set-wrap">
        <nav className="set-nav">
          <input ref={searchRef} type="search" className="set-search" placeholder="Search settings" aria-label="Search settings" value={query} spellCheck={false}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }} />
          <div role="tablist" aria-orientation="vertical" aria-label="Settings pages" onKeyDown={navKey}>
            {GROUPS.map(g => <Fragment key={g}>
              <div className="set-group">{g}</div>
              {pages.filter(p => p.group === g).map(p => {
                const n = searching ? hits(p.id) : 0;
                return <button key={p.id} id={`set-tab-${p.id}`} role="tab" type="button" aria-selected={!searching && page === p.id} aria-controls="set-panel" tabIndex={page === p.id ? 0 : -1}
                  className={cx('set-tab', searching && !n && 'dim')} onClick={() => go(p.id)}>
                  <span>{p.label}</span>{searching && n > 0 && <span className="set-count">{n}</span>}</button>;
              })}
            </Fragment>)}
          </div>
        </nav>
        <div className="set-main" id="set-panel" ref={mainRef} role={searching ? 'region' : 'tabpanel'} aria-label={searching ? 'Settings found' : undefined} aria-labelledby={searching ? undefined : `set-tab-${page}`}>
          {searching
            ? (found.some(f => f.sections.length)
              ? found.filter(f => f.sections.length).map(({ p, sections: list }) => (
                <div key={p.id} className="set-found">
                  <button type="button" className="set-crumb" title={`Open ${p.label}`} onClick={() => go(p.id)}>{p.group} › {p.label}</button>
                  {sections(list)}
                </div>))
              : <p className="set-none">No setting matches “{query.trim()}”.</p>)
            : <>
              <header className="set-head"><h2>{current.label}</h2><p>{current.where}</p></header>
              {sections(current.sections.map(sec => ({ sec, items: sec.items })))}
              {current.foot && <p className="set-note set-foot">{current.foot}</p>}
            </>}
        </div>
      </div>
      <div className="modal-foot"><button className="btn ghost" title={`Every setting on every page back to its default${asm ? ' (the project\'s language and main file stay)' : ''} (Save settings keeps it)`} onClick={() => { setS({ ...DEFAULT_SETTINGS }); setPrefs(DEFAULT_PREFS); setAsm(a => a && { ...a, args: '', machine: 'memory' }); }}>Restore defaults</button><span className="grow" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onSave(s, prefs, asm)}>Save settings</button></div>
    </Modal>
  );
}
