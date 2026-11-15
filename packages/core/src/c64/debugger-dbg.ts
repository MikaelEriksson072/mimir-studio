/* The debug info Retro Debugger and C64 Debugger read (spec 13.2b): Kick Assembler's `-debugdump` format, a `.dbg`
 * file with the sources' paths, which bytes each source line made, the labels, the watches and the breakpoints. With
 * it the debugger shows the source next to the code it runs (its Source code view). Mimir writes the file itself, from
 * the render that was just verified byte for byte, so it is the same with Kick Assembler, 64tass and the built-in
 * assembler. The format as the debugger's reader takes it (CDebugAsmSource.cpp, tag v1.0.0): a source line is
 * `INDEX,PATH` (split at every comma: no comma in a path), a block line `$START,$END,FILE,LINE1,COL1,LINE2,COL2`, a
 * label `SEGMENT,$ADDR,NAME`, a watch `SEGMENT,$ADDR[,COUNT[,FORMAT]]`, a breakpoint on a PC `SEGMENT,$ADDR,` (the
 * comma after the address is needed). Every segment named must be a `<Segment>` of the file. */
import type { Addr, RenderResult } from '../types';

/** one source of the build: its text and the bytes its lines made, `[first address, last address, line]` (lines from 1) */
export interface DebugSource { name: string; text: string; spans: [Addr, Addr, number][] }

/** how a watch is shown: Retro Debugger's names (hex8 is its default) */
export type DebugWatchFormat = 'hex8' | 'hex16' | 'hex32' | 'signed8' | 'signed16' | 'signed32' | 'unsigned8' | 'unsigned16' | 'unsigned32' | 'text';
export interface DebugWatch { addr: Addr; count?: number; format?: DebugWatchFormat }

export interface DebugInfo {
  sources: DebugSource[];
  /** where the debugger stops: the address of an instruction */
  breakpoints?: Addr[];
  watches?: DebugWatch[];
}

/**
 * The sources of the files `files` (the first file when not given) with the bytes each line made: the instruction and
 * data lines of the render, at the addresses they run at. Lines of a block left out of the build made none.
 */
export function debugSources(R: RenderResult, files: number[] = [0]): DebugSource[] {
  const out: DebugSource[] = [];
  for (const fi of files) {
    const name = `${R.fileNames[fi]}.asm`, text = R.files[name], lines = R.fileLines[name];
    if (typeof text !== 'string' || !lines) continue;
    const off = R.excluded.filter(x => x.file === fi);
    const spans: DebugSource['spans'] = [];
    lines.forEach((l, i) => {
      if (!('n' in l) || !l.n || (l.k !== 'ins' && l.k !== 'dat' && l.k !== 'dir')) return;
      if (off.some(x => l.a >= x.start && l.a < x.end)) return;
      spans.push([l.a, Math.min(0xffff, l.a + l.n - 1), i + 1]);
    });
    out.push({ name, text, spans });
  }
  return out;
}

const h4 = (n: number) => `$${(n & 0xffff).toString(16).padStart(4, '0')}`;
const SEGMENT = 'Default';

/**
 * The `.dbg` file: `paths[i]` is where sources[i] is written (the debugger reads the text from there), `labels` the
 * names by address (the assembler's label file has them all).
 */
export function debugInfoFile(info: DebugInfo, paths: string[], labels: { addr: Addr; name: string }[] = []): string {
  const x: string[] = ['<C64debugger version="1.0">', '   <Sources values="INDEX,FILE">'];
  info.sources.forEach((_, i) => {
    if (/[,\r\n<>&]/.test(paths[i] ?? '')) throw new Error(`a source's path cannot hold a comma, <, > or &: ${paths[i]}`);
    x.push(`      ${i},${paths[i]}`);
  });
  x.push('   </Sources>', '', `   <Segment name="${SEGMENT}" dest="" values="START,END,FILE_IDX,LINE1,COL1,LINE2,COL2">`);
  info.sources.forEach((s, i) => {
    const len = s.text.split('\n').map(l => l.replace(/\r$/, '').length);
    // a block for each run of lines whose bytes follow each other, named by where it starts, as the assembler's
    // memory blocks are
    let open = false, next = -1;
    for (const [a, b, line] of s.spans) {
      if (!open || a !== next) { if (open) x.push('      </Block>'); x.push(`      <Block name="${s.name.replace(/[<>&"]/g, '_')} ${h4(a)}">`); open = true; }
      x.push(`         ${h4(a)},${h4(b)},${i},${line},1,${line},${Math.max(1, len[line - 1] ?? 1)}`);
      next = b + 1;
    }
    if (open) x.push('      </Block>');
  });
  x.push('   </Segment>', '', '   <Labels values="SEGMENT,ADDRESS,NAME">');
  for (const l of labels) if (/^[A-Za-z_.@][\w.@]*$/.test(l.name)) x.push(`      ${SEGMENT},${h4(l.addr)},${l.name}`);
  x.push('   </Labels>', '', '   <Watchpoints values="SEGMENT,ADDRESS,ARGUMENT">');
  for (const w of info.watches ?? []) x.push(`      ${SEGMENT},${h4(w.addr)}${w.count || w.format ? `,${Math.max(1, w.count ?? 1)}` : ''}${w.format ? `,${w.format}` : ''}`);
  x.push('   </Watchpoints>', '', '   <Breakpoints values="SEGMENT,ADDRESS,ARGUMENT">');
  for (const a of [...new Set(info.breakpoints ?? [])].sort((p, q) => p - q)) x.push(`      ${SEGMENT},${h4(a)},`);
  x.push('   </Breakpoints>', '</C64debugger>', '');
  return x.join('\n');
}

/** the names of a VICE label file (`al C:0810 .start`), as Kick Assembler and 64tass write one */
export function viceLabels(text: string): { addr: Addr; name: string }[] {
  const out: { addr: Addr; name: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*al\s+(?:C:)?([0-9a-f]{1,4})\s+\.?(\S+)/i.exec(line);
    if (m) out.push({ addr: parseInt(m[1], 16), name: m[2] });
  }
  return out;
}
