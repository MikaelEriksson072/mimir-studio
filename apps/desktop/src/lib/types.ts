import type { Addr, BitfireDisk, BoozeDisk, CovertDisk, D64Image, IfflDisk, KickProblem, KrillDisk, ListingLine, LogLevel, PirateSlayerDisk, ProblemCode, SparkleDisk, SpindleDisk, TapeImage, VerifyResult } from '@mimir/core';
import type { IconName } from './icon-paths';

/** The mounted .d64 or .g64: its directory is listed in the Explorer, and a copy goes into VICE's drive 8 on Build &
 *  Run (with the files the project opened from it built and written back); `spindle`: its jobs, when it is a Spindle 3
 *  disk (the Spindle script tab lists them); `bitfire`: its files, when it is a Bitfire disk (the Bitfire script tab
 *  lists them); `krill`: its directory's files, when they are packed with the ZX0 of Krill's loader, (version 146)
 *  Doynax LZ or (revision 166) TinyCrunch (the Krill script tab lists them); `covert`: its directory's files, when the Covert Bitops loader's code is
 *  on it or they are packed as that loader reads them (the Covert script tab lists them); `iffl`: its IFFL files, each one file holding a game's parts (the IFFL tab lists them); `pirateslayer`: Electronic Arts' copy protection on it (the Pirate Slayer tab); `sides`: the
 *  release's next disks or sides from its folder (or dropped with it), in order: Sindri turns to them when the program
 *  asks */
export interface MountedDisk { name: string; path: string | null; bytes: Uint8Array; img: D64Image; spindle: SpindleDisk | null; bitfire: BitfireDisk | null; booze: BoozeDisk | null; sparkle: SparkleDisk | null; krill: KrillDisk | null; covert: CovertDisk | null; iffl: IfflDisk | null; pirateslayer: PirateSlayerDisk | null; sides: DiskSide[] }
/** one of a mounted disk's next sides: its file name and bytes */
export interface DiskSide { name: string; bytes: Uint8Array }

/** The tape in the datasette (13.5e): its files are listed in the Explorer (and every block in the Tape tab), a file
 *  opens with the tape in Sindri's datasette, and Build & Run puts a copy in VICE's datasette (or the tape with the
 *  re-assembled boot file on it, when the project is that file) */
export interface MountedTape { name: string; path: string | null; bytes: Uint8Array; img: TapeImage }

/** Selection in the listing/heatmap; `multi` = an explicit range (shift-click, drag, block header, Go to range).
 * `anchor`..`anchorEnd` is the line or block picked first; extending the selection always keeps it whole.
 * `bytes`: picked byte by byte in the data lines (a click on a byte, a drag over the bytes of one line, Shift+click
 * on a byte, ← and →), so it can start and end inside a line, and the cursor is on a byte. */
export interface Sel { start: Addr; end: Addr; multi: boolean; anchor?: Addr; anchorEnd?: Addr; bytes?: boolean }
/** `y`: keep the line at this height in the listing (px from its top), where it was before its block changed type;
 *  `line`: show this line (a find hit) rather than the address's; `top`: put the line at the top of the listing, with
 *  the line above it (a block header, Ctrl+↓ / Ctrl+↑); `end`: the line starts an area that ends there (exclusive, a
 *  bookmark's): as much of it as fits is shown, from its first line */
export interface ScrollReq { addr: Addr; center: boolean; n: number; y?: number; line?: ListingLine; top?: boolean; end?: Addr }
/** Where in memory the editor is (spec 14.6b): the address at the top of the listing, of Graphics or of Memory, as it
 *  was scrolled last; the one of these tabs opened next starts there, unless a jump (a ScrollReq) is newer. `end`: the
 *  address at the bottom; `top` and `lines`: the listing's own scroll position and the lines it was in, so the listing
 *  comes back exactly where it was while its lines are the same */
export interface ViewAt { addr: Addr; end: Addr; n: number; top?: number; lines?: readonly ListingLine[] }
/** a block whose type just changed (the listing frames it a moment, with `label` on it); `at`: when */
export interface Changed { start: Addr; end: Addr; label: string; at: number }
/** inline edit popover: a label, a line's trailing comment, or a comment line / block (`block`) above a line */
/** `zp`: the label is a zero-page variable; `line`: open the editor under this listing line (a `.label` line in the
 *  file head, which has no address of the label itself, or one of the user's empty lines); `blank`: a comment written
 *  on one of the address's empty lines, which one (counted from the top) */
export interface Editing { kind: 'label' | 'comment' | 'note'; addr: Addr; value: string; block?: boolean; zp?: boolean; line?: number; blank?: number }
/** `end`: the address starts an area that ends there (a bookmark's), which the listing shows from its first line */
export interface NavOptions { center?: boolean; listing?: boolean; noHistory?: boolean; keepSel?: boolean; fromSource?: boolean; end?: Addr }
export type ToastKind = 'info' | 'ok' | 'warn' | 'err';
export interface Toast { id: string; msg: string; kind: ToastKind }
/** what a toast said, kept for the run in the Messages tab: when it was said */
export interface Message extends Toast { at: number }

/** One row in the log / problems lists. */
export interface UiProblem {
  lvl: LogLevel; msg: string; addr: Addr | null | undefined; cat: string;
  /** the analysis's kind of problem (8.11g); none for Kick Assembler's, the listing's and the packing check's */
  code?: ProblemCode;
  /** a button on the row that fixes it (turns a setting on, say) */
  action?: { label: string; run: () => void };
}

export interface Command { id: string; label: string; key?: string; run: () => void }
/** A menu's item: a separator, a heading over the items after it, an action, or a submenu (to any depth). `checked`: a
 *  setting the item turns on or off (or one choice of several), shown with a check mark; `icon`: in front of the name,
 *  on the items used most; `key`: the key that does the same outside the menu. Empty submenus, headings with nothing
 *  under them and extra separators are left out when the menu shows. */
export type MenuItem =
  | { sep: true }
  | { header: string }
  | { label: string; key?: string; checked?: boolean; icon?: IconName; run: () => void }
  | { label: string; icon?: IconName; children: MenuItem[] };
/** `owner`: the button that opened it, which closes it again */
export interface ContextMenuState { x: number; y: number; items: MenuItem[]; owner?: string }

export interface KickBuild {
  ok: boolean;
  dir: string;
  problems: KickProblem[];
  /** per source file: bytes compared with the original */
  compared: { entry: string; ok: boolean; same: number; total: number; excluded: number; prgPath: string; vsPath: string | null; prg: Uint8Array | null }[];
  /** the cartridge's source: the image it wrote, compared with the original .crt (spec 13.9) */
  cart: CartCheck | null;
}

/** A cartridge image rebuilt (spec 13.9) and compared with the one the project was opened from */
/** `vs`: the VICE labels its source wrote (every bank in one source, 13.9c) */
export interface CartCheck { ok: boolean; name: string; crt: Uint8Array | null; path?: string; vs?: string; same: number; total: number; diffs: string[] }

export interface BuildState {
  ok: boolean;
  log: string;
  /** fingerprint of the generated files this result belongs to */
  key: string;
  at: number;
  V: VerifyResult;
  kick: KickBuild | null;
  /** the cartridge rebuilt from the chips the built-in assembler built; null without one */
  cart: CartCheck | null;
}
