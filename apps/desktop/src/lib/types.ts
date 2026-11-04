import type { Addr, BitfireDisk, D64Image, KickProblem, ListingLine, LogLevel, SpindleDisk, VerifyResult } from '@mimir/core';

/** The mounted .d64: its directory is listed in the Explorer, and a copy goes into VICE's drive 8 on Build & Run;
 *  `spindle`: its jobs, when it is a Spindle 3 disk (the Spindle script tab lists them); `bitfire`: its files, when it
 *  is a Bitfire disk (the Bitfire script tab lists them) */
export interface MountedDisk { name: string; path: string | null; bytes: Uint8Array; img: D64Image; spindle: SpindleDisk | null; bitfire: BitfireDisk | null }

/** Selection in the listing/heatmap; `multi` = an explicit range (shift-click, drag, block header, Go to range).
 * `anchor`..`anchorEnd` is the line or block picked first; extending the selection always keeps it whole.
 * `bytes`: picked byte by byte in the data lines (a click on a byte, a drag over the bytes of one line, Shift+click
 * on a byte, ← and →), so it can start and end inside a line, and the cursor is on a byte. */
export interface Sel { start: Addr; end: Addr; multi: boolean; anchor?: Addr; anchorEnd?: Addr; bytes?: boolean }
/** `y`: keep the line at this height in the listing (px from its top), where it was before its block changed type;
 *  `line`: show this line (a find hit) rather than the address's; `top`: put the line at the top of the listing, with
 *  the line above it (a block header, Ctrl+↓ / Ctrl+↑) */
export interface ScrollReq { addr: Addr; center: boolean; n: number; y?: number; line?: ListingLine; top?: boolean }
/** Where in memory the editor is (spec 14.6b): the address at the top of the listing, of Graphics or of Memory, as it
 *  was scrolled last; the one of these tabs opened next starts there, unless a jump (a ScrollReq) is newer. `end`: the
 *  address at the bottom; `top` and `lines`: the listing's own scroll position and the lines it was in, so the listing
 *  comes back exactly where it was while its lines are the same */
export interface ViewAt { addr: Addr; end: Addr; n: number; top?: number; lines?: readonly ListingLine[] }
/** a block whose type just changed (the listing frames it a moment, with `label` on it); `at`: when */
export interface Changed { start: Addr; end: Addr; label: string; at: number }
/** inline edit popover: a label, a line's trailing comment, or a comment line / block (`block`) above a line */
/** `zp`: the label is a zero-page variable; `line`: open the editor under this listing line (a `.label` line in the
 *  file head, which has no address of the label itself) */
export interface Editing { kind: 'label' | 'comment' | 'note'; addr: Addr; value: string; block?: boolean; zp?: boolean; line?: number }
export interface NavOptions { center?: boolean; listing?: boolean; noHistory?: boolean; keepSel?: boolean; fromSource?: boolean }
export type ToastKind = 'info' | 'ok' | 'warn' | 'err';
export interface Toast { id: string; msg: string; kind: ToastKind }

/** One row in the log / problems lists. */
export interface UiProblem {
  lvl: LogLevel; msg: string; addr: Addr | null | undefined; cat: string;
  /** a button on the row that fixes it (turns a setting on, say) */
  action?: { label: string; run: () => void };
}

export interface Command { id: string; label: string; key?: string; run: () => void }
/** `checked`: a setting the item turns on or off (or one choice of several), shown with a check mark */
export type MenuItem = { sep: true } | { label: string; key?: string; checked?: boolean; run: () => void } | { label: string; children: { label: string; key?: string; run: () => void }[] };
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
