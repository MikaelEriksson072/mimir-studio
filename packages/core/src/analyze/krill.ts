/* 5.15c Krill's loader's script (spec 13.5k). Krill's loader has no script file: the program's code calls the loader with
 * X and Y naming a file, by the address of its name (`ldx #<name / ldy #>name / jsr load`), or, in builds of version 146
 * and older made so, by its track and sector (`ldx #track / ldy #sector / jsr load`, as Triad's Continuum has it); a
 * table of tracks and sectors gives a call a file each time it runs (`ldy table+1,x / lda table,x / tax / jsr load`).
 * Version 146 loads to where the program says with the carry set, an address it stores in zero page before the call.
 * Those calls are the script: read here from the code that sets X and Y right before a jsr (or jmp) to a routine of the
 * loader's resident part (within $200 of it), in the code the analysis traced and in the bytes it did not (a demo's own
 * script engine often calls the loads, so they are not reached). Which file each loads is the mounted disk's
 * (c64/krill-disk.ts): the analysis does not know the disk. */
import type { Addr, KrillScript, KrillStep, LoaderFinding } from '../types';
import type { Ctx } from './context';
import { cc1541Script, krillCallRegs, krillFileName, krillTableEntries, type KrillDisk, type KrillFile } from '../c64/krill-disk';

/** a track and sector a 1541 disk can have (40 tracks at most) */
const plausible = (t: number, s: number) => t >= 1 && t <= 42 && s < 21;

export function findKrillScript(ctx: Ctx, loaders: LoaderFinding[]): KrillScript | null {
  const f = loaders.find(l => l.id === 'krill');
  if (!f) return null;
  const { mem, insLen, codeOwner, loaded } = ctx;
  const isCode = (a: Addr) => insLen[a] > 0 || codeOwner[a] >= 0;
  const read = (a: Addr) => (a >= 0 && a < 0x10000 && loaded(a) ? mem[a] : null);
  const resident = f.parts.filter(p => p.role === 'resident' && !p.outside);
  const near = (t: Addr) => resident.some(p => t >= p.start - 0x200 && t < p.end + 0x200);
  const inside = (a: Addr) => resident.some(p => a >= p.start && a < p.end);

  const found: KrillStep[] = [];
  for (let a = 0; a + 2 < 0x10000; a++) {
    if (mem[a] !== 0x20 && mem[a] !== 0x4c) continue;
    const traced = insLen[a] === 3;
    if (!traced && (!loaded(a) || !loaded(a + 2) || isCode(a) || isCode(a + 2))) continue;
    if (inside(a)) continue;
    const r = krillCallRegs(read, a);
    if (!r) continue;
    const to = mem[a + 1] | (mem[a + 2] << 8);
    const step: KrillStep = { at: r.at, jsr: a, to, traced, x: null, y: null, name: null, table: null, carry: r.carry, dest: r.dest };
    if ('imm' in r.x && 'imm' in r.y) {
      step.x = r.x.imm; step.y = r.y.imm;
      const p = (r.y.imm << 8) | r.x.imm, name: number[] = [];
      for (let b = read(p); b != null && b !== 0 && name.length < 17; b = read(p + name.length)) name.push(b);
      if (name.length && name.length <= 16 && read(p + name.length) === 0 && name.every(b => (b >= 0x20 && b < 0x80) || b >= 0xa0)) step.name = name;
      if (!step.name && !plausible(step.x, step.y)) continue;
    } else if ('table' in r.x && 'table' in r.y) {
      const entries: [number, number][] = [];
      for (const ts of krillTableEntries(read, r.x, r.y)) { if (!plausible(ts[0], ts[1])) break; entries.push(ts); }
      if (entries.length < 2) continue;
      step.table = { at: r.x.table, entries };
    } else continue;
    found.push(step);
  }
  // the loader's routines: near its resident part (with none found, any), not the KERNAL's jump table; routines within
  // $20 of each other are one group (version 146's loadraw and loadcompd are 11 bytes apart), which counts when two
  // calls call it at least, or one names a file by its name (a lone ldx #4 / ldy #3 / jsr near the resident is the
  // installer's own code in several builds); with no resident part found, three calls
  const candidates = found.filter(s => (resident.length ? near(s.to) : true) && s.to < 0xff81);
  const group = (t: Addr) => candidates.filter(s => Math.abs(s.to - t) <= 0x20);
  const steps = candidates.filter(s => { const g = group(s.to); return new Set(g.map(x => x.jsr)).size >= (resident.length ? 2 : 3) || g.some(x => x.name); });
  if (!steps.length) return null;
  // by name when half of the calls with values point at a name at least, else by track and sector
  const values = steps.filter(s => !s.table), names = values.filter(s => s.name).length;
  const by: KrillScript['by'] = values.length && 2 * names >= values.length ? 'name' : 'ts';
  return { routines: [...new Set(steps.map(s => s.to))].sort((p, q) => p - q), by, steps };
}

/** A load of the script: a call, or one entry of a call's table, and its file on the mounted disk. */
export interface KrillLoad {
  step: KrillStep;
  /** the table's entry (null: the call names one file) */
  entry: number | null;
  /** the track and sector it names (null: by name) */
  ts: [number, number] | null;
  /** its file on the mounted disk; null: no disk, or none starts there (or has the name) */
  file: KrillFile | null;
  /** the line of the script: `load 2/20`, `load "NAME"`, `load 21/8 (table $20ca, entry 0)`, ` to $e000` */
  text: string;
}

const h4 = (v: number) => v.toString(16).padStart(4, '0');
const petscii = (b: number[]) => b.map(c => (c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : c >= 0xc1 && c <= 0xda ? String.fromCharCode(c - 0x80) : '·')).join('');

/** The script's loads with their files on the mounted disk (a disk read as one for Krill's loader): by name when the
 *  disk has the name (or the script loads by name), else by where a file starts. */
export function krillLoads(S: KrillScript, d: KrillDisk | null): KrillLoad[] {
  const at = (t: number, s: number) => d?.files.find(f => f.sectors[0][0] === t && f.sectors[0][1] === s) ?? null;
  const named = (name: number[]) => {
    const e = d?.entries.find(x => { let n = x.raw.length; while (n > 0 && x.raw[n - 1] === 0xa0) n--; return n === name.length && name.every((b, i) => x.raw[i] === b); });
    return e ? e.file ?? (e.same != null ? d!.entries[e.same].file : null) : null;
  };
  const to = (s: KrillStep) => (s.dest != null ? ` to $${h4(s.dest)}` : '');
  return S.steps.flatMap((s): KrillLoad[] => {
    if (s.table) return s.table.entries.map(([t, sec], entry) => ({ step: s, entry, ts: [t, sec], file: at(t, sec), text: `load ${t}/${sec} (table $${h4(s.table!.at)}, entry ${entry})${to(s)}` }));
    const byName = s.name && (d ? named(s.name) : S.by === 'name');
    if (byName) return [{ step: s, entry: null, ts: null, file: d ? named(s.name!) : null, text: `load "${petscii(s.name!)}"${to(s)}` }];
    return [{ step: s, entry: null, ts: [s.x!, s.y!], file: at(s.x!, s.y!), text: `load ${s.x}/${s.y}${to(s)}` }];
  });
}

/** The script as text: a comment that says what it is, then each load with where it is and its file on the mounted disk
 *  (what it unpacks to); then, with a disk, cc1541's command line with the calls in the disk's own files. */
export function krillScriptText(S: KrillScript, d: KrillDisk | null, diskName: string | null): string[] {
  const loads = krillLoads(S, d), routines = S.routines.map(r => `$${h4(r)}`).join(' and ');
  const out = [
    `; Krill's loader script, read back by Mimir Studio from the code that calls the loader at ${routines}: ${loads.length} load${loads.length === 1 ? '' : 's'}.`,
    S.by === 'ts'
      ? `; The code is the script: ldx #track / ldy #sector / jsr ${S.routines.length ? `$${h4(S.routines[0])}` : 'load'} loads a file (this build names a file by where it starts).`
      : `; The code is the script: ldx #<name / ldy #>name / jsr ${S.routines.length ? `$${h4(S.routines[0])}` : 'load'} loads a file by its name.`,
    ...(S.steps.some(s => !s.traced) ? ['; Calls marked "not traced" were read from bytes the analysis did not trace (copied elsewhere, or run by a script of the program\'s own).'] : []),
    '',
  ];
  for (const l of loads) {
    const f = l.file, u = f?.unpacked;
    const what = f ? `, ${krillFileName(f)}${u ? `, unpacks to $${h4(u.start)}-$${h4(u.end - 1)}` : ''}` : d ? ', no file of the mounted disk' : '';
    out.push(`  ${l.text.padEnd(38)} ; $${h4(l.step.at)}${l.step.traced ? '' : ' (not traced)'}${what}`);
  }
  if (d && diskName) out.push('', ...cc1541Script(d, diskName));
  return out;
}
