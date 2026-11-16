import { h4, kindInfo, typeInfo, type Addr, type AnalysisResult, type BlockKind, type RenderResult } from '@mimir/core';
import type { MusicPlayer, TypeGroup } from '@mimir/core';

export const ROW = 20;

export const GROUP_ORDER: TypeGroup[] = ['code', 'basic', 'gfx', 'music', 'table', 'text', 'data', 'fill', 'reloc'];
export const GROUP_LABEL: Record<TypeGroup, string> = { code: 'Code', basic: 'BASIC', gfx: 'Graphics', music: 'Music / SID', table: 'Tables', text: 'Text', data: 'Data', fill: 'Fill / unused', reloc: 'Relocated (runs elsewhere)' };
/** group of a type-map id (A.tm, header lines) */
export const groupOfType = (t: number): TypeGroup => typeInfo(t).group;
/** group of a block kind */
export const groupOfKind = (k: BlockKind): TypeGroup => kindInfo(k).group;

export { C64, hexRgb } from './palette';

/** localStorage for per-user UI preferences; failures (private mode, quota) are ignored. */
export const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) as T; } catch { return d; } },
  set(k: string, v: unknown): void { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

export const uid = (): string => Math.random().toString(36).slice(2, 9);
export const cx = (...a: (string | false | null | undefined)[]): string => a.filter(Boolean).join(' ');
export const cssVar = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
export const fmtBytes = (n: number): string => n >= 1024 ? `${(n / 1024).toFixed(n >= 10240 ? 0 : 1)} KB` : `${n} B`;
/** `$8000`, or with a cartridge's banks `3:$8000` (the bank, then the address in it; 13.9b) */
export const bankAdr = (A: Pick<AnalysisResult, 'spaces'>, a: Addr): string => {
  const s = A.spaces?.find(x => x.space === Math.floor(a / 0x10000));
  return `${s ? `${s.bank}:` : ''}$${h4(a)}`;
};

/** Cheap fingerprint of the generated files: tells whether a verification result is stale. */
export const filesKey = (R: RenderResult): string => Object.entries(R.files).map(([k, v]) => {
  let h = 2166136261; const n = v.length;
  for (let i = 0; i < n; i++) { h ^= typeof v === 'string' ? v.charCodeAt(i) : v[i]; h = Math.imul(h, 16777619); }
  return k + ':' + n + ':' + (h >>> 0);
}).join('|');

/** "Error invoking remote method 'x': Error: msg" -> "msg" */
/** the title of a music block's play button (the Blocks view, the overview): where it plays and how; `digi` a sample
 *  player's interrupt (5.8b), `noPlay` when nothing is called each frame */
export const musicPlayTitle = (name: string, player: MusicPlayer, digi: { nmi: boolean; hz: number } | null | undefined, noPlay: boolean): string => {
  const how = player === 'deepsid' ? (digi ? ': an RSID of the block and its samples, in DeepSID\'s window' : ': the .sid the export writes, in DeepSID\'s window')
    : digi && noPlay ? `: init with song $00 starts its ${digi.nmi ? 'NMI' : 'IRQ'}, ${digi.hz} samples a second` : ': init with song $00, then play each frame';
  return `Play ${name} in ${player === 'deepsid' ? 'DeepSID' : 'VICE'}${how}. Settings → Toolchain picks VICE or DeepSID`;
};
export const errorText = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
