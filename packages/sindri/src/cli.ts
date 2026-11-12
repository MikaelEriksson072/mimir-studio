/* sindri <file.prg | disk.d64 | disk.g64 | tape.tap | tape.t64 | snapshot.vsf> [options]: unpack a C64 program and report its layers. Run with `node src/cli.ts` (Node 22.18
 * or newer runs the TypeScript as it is), or `pnpm unpack` in this folder. */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpack, type LayerReport, type Saved, type UnpackOptions } from './session.ts';
import { findRoms, loadRoms } from './node.ts';
import { d64File, d64Pick } from './d64.ts';
import { g64ToD64, isG64 } from './g64.ts';
import { tapeImageFiles } from './tape.ts';
import { isVsf, vsfMachine } from './vsf.ts';
import type { Range } from './analyze.ts';

const HELP = `sindri <file.prg | disk.d64 | disk.g64 | tape.tap | tape.t64 | snapshot.vsf> [options]

Runs the program in an emulated C64, follows it through its layers (coders, movers, decrunchers) and saves
the unpacked program when it starts. With a disk (a D64 or G64, or --disk) a 1541 is on the serial bus, so the
program can go on loading from it, with the KERNAL or a fast loader of its own. With a tape (a TAP, or --tape)
the datasette plays it from after the file, PLAY held down, for the program's own tape loader and LOAD. A T64
holds a tape's files without its pulses: LOAD from the tape reads them. A VICE snapshot (.vsf, x64sc) goes on
from where it was taken, with its RAM, CPU, VIC-II and CIAs: a game stopped in its intro or trainer menu
unpacks on from there (the keys Sindri presses get past the menu). The 1541 is not taken from the snapshot.

  -o FILE        save here (default: <name>.<start address>.prg next to the file)
  --file NAME    the file on the D64, G64, TAP or T64 to unpack (default: its first program; * and ? as the DOS takes them)
  --disk FILE    put this D64 or G64 in the drive for a PRG given on its own
  --tape FILE    put this TAP or T64 in the datasette for a PRG given on its own
  -e ADDR        start with SYS ADDR instead of RUN
  --port VALUE   with -e: $01 as the program starts there (a saved program's start hint, $36 say)
  -l ADDR        load the file at ADDR instead of its own load address
  --layer N      save layer N instead of the newest (see the report)
  --all          save every layer
  -i             report only, save nothing
  --clean        clear the bytes in the saved range that are not part of the program
  --deep         also press keys when a later layer waits (an intro after the decrunching)
  --no-keys      never press keys
  --cycles N     give up after N million cycles (default 400)
  --roms DIR     the folder with the C64 ROM files (default: a VICE installation, or $C64_ROMS); the 1541
                 DOS ROM is taken from there or from VICE's DRIVES folder next to it
  --no-roms      use the built-in stand-ins instead of ROM files
  --json         print the result as JSON
  --trace        print every layer change and key press as it happens
  --learn NAME   add the depackers' fingerprints to the signature list as NAME

Addresses: $080d, 0x080d or 2061. A path with spaces goes in quotes: sindri "C:\\C64\\The Lab\\side1.d64".`;

const hex4 = (v: number) => '$' + v.toString(16).padStart(4, '0');
const range = (r: Range) => r.start === r.end ? hex4(r.start) : `${hex4(r.start)}-${hex4(r.end)}`;
const ranges = (rs: Range[], max = 3) => rs.length ? rs.slice(0, max).map(range).join(' ') + (rs.length > max ? ` +${rs.length - max}` : '') : '-';
const kb = (n: number) => n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} bytes`;

function parseAddr(s: string | undefined, what: string): number {
  if (s == null) throw new Error(`${what} needs an address`);
  const v = /^\$/.test(s) ? parseInt(s.slice(1), 16) : /^0x/i.test(s) ? parseInt(s.slice(2), 16) : Number(s);
  if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new Error(`${what}: "${s}" is not an address`);
  return v;
}

function describe(l: LayerReport): string {
  const head = `layer ${l.index}  ${hex4(l.entry)}  ${(l.via === 'start' ? 'start' : `${l.via} from ${hex4(l.from!)}`).padEnd(15)} ${l.basic ? 'BASIC RUN' : l.kind}`;
  const lines = [head];
  if (l.kind !== 'program' || l.index === 0) {
    lines.push(`         ran ${ranges(l.code)} (${l.instructions} instructions), read ${ranges(l.read)} (${kb(l.readBytes)}), wrote ${ranges(l.written)} (${kb(l.writtenBytes)})`);
    if (l.kind !== 'jump') lines.push(`         ${l.packer ? `packer: ${l.packer.name} (${Math.round(l.packer.similarity * 100)}% alike)` : `unknown depacker, fingerprint ${l.fingerprint}`}`);
  }
  if (l.calls.length) lines.push(`         called code it wrote: ${l.calls.map(c => `${hex4(c.entry)} (${c.via})`).join(', ')}`);
  if (l.kind === 'program' && l.kept.length) lines.push(`         keeps what earlier layers left that it ran: ${l.kept.map(k => `${range(k)} (layer ${k.layer})`).join(', ')}`);
  if (l.kind === 'program' && l.loaded.length) lines.push(`         keeps what it loaded after it started and ran, as it was at the end: ${ranges(l.loaded, 4)}`);
  if (l.text.length) lines.push(`         text: ${l.text.slice(0, 4).map(t => JSON.stringify(t)).join(', ')}`);
  const printed = l.printed.replace(/\s+/g, ' ').trim();
  if (printed) lines.push(`         printed: ${JSON.stringify(printed.slice(0, 80))}`);
  if (l.presses.length) lines.push(`         pressed: ${l.presses.join(', ')}`);
  return lines.join('\n');
}

function startHint(s: Saved): string {
  const port = s.port !== 0x37 ? `, $01=$${s.port.toString(16).padStart(2, '0')}` : '';
  return s.basic ? `RUN (SYS ${s.entry} = ${hex4(s.entry)}${port})` : `SYS ${s.entry} = ${hex4(s.entry)}${port}${s.interrupts ? '' : ', interrupts off'}`;
}

/**
 * Say what is wrong when the arguments do not name one file: a path with spaces and no quotes around it, which the
 * shell gives in pieces; the disk given to --file, which names a file on it; more files than one; or none.
 */
function badFiles(argv: string[], inputs: string[], fileName: string | null, isFile: (p: string) => boolean, path: string): never {
  const quote = (p: string) => (/\s/.test(p) ? `"${p}"` : p);
  let whole: { path: string; from: number; to: number } | null = null;
  for (let i = 0; i < argv.length && !whole; i++) for (let j = argv.length; j > i + 1 && !whole; j--) {
    const p = argv.slice(i, j).join(' ');
    if (isFile(p)) whole = { path: p, from: i, to: j };
  }
  const at = fileName === null ? -1 : argv.lastIndexOf('--file') + 1;
  const disk = whole && whole.from <= at && at < whole.to ? whole.path : !inputs.length && fileName !== null && (isFile(fileName) || /\.[dg]64$/i.test(fileName)) ? fileName : null;
  if (disk) throw new Error(`--file takes the name of a file on the disk, not the disk: give the disk on its own${disk === whole?.path ? ', in quotes as its path has spaces' : ''}, as in sindri ${quote(disk)} (its first PRG, or --file NAME after it for another)`);
  if (whole) throw new Error(`a path with spaces goes in quotes: sindri ${quote(whole.path)}`);
  if (inputs.length > 1) throw new Error(`one file at a time, not ${inputs.length}: ${inputs.map(f => `"${f}"`).join(', ')} (a path with spaces goes in quotes)`);
  if (!inputs.length) throw new Error(fileName !== null ? `no file given: --file NAME picks a file on the disk given with it, as in sindri disk.d64 --file ${quote(fileName)}` : 'no file given');
  throw new Error(`no file ${path}`);
}

function main(argv: string[]): number {
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) { console.log(HELP); return argv.length ? 0 : 2; }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const o: UnpackOptions = {};
  const inputs: string[] = [];
  let out: string | null = null, info = false, all = false, json = false, learn: string | null = null;
  let roms: string | null | false = null, fileName: string | null = null, diskPath: string | null = null, tapePath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-o': out = argv[++i]; break;
      case '--file': fileName = argv[++i]; break;
      case '--disk': diskPath = argv[++i]; break;
      case '--tape': tapePath = argv[++i]; break;
      case '-e': o.entry = parseAddr(argv[++i], '-e'); break;
      case '--port': { const v = parseAddr(argv[++i], '--port'); if (v > 0xff) throw new Error('--port: a byte, $00-$ff'); o.port = v; break; }
      case '-l': o.load = parseAddr(argv[++i], '-l'); break;
      case '--layer': o.layer = Number(argv[++i]); break;
      case '--all': all = true; break;
      case '-i': info = true; break;
      case '--clean': o.clean = true; break;
      case '--deep': o.deep = true; break;
      case '--no-keys': o.keys = false; break;
      case '--cycles': o.maxCycles = Number(argv[++i]) * 1e6; break;
      case '--roms': roms = argv[++i]; break;
      case '--no-roms': roms = false; break;
      case '--json': json = true; break;
      case '--trace': o.trace = line => console.log(`  ${line}`); break;
      case '--learn': learn = argv[++i]; break;
      default:
        if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
        inputs.push(a);
    }
  }
  const isFile = (p: string) => statSync(resolve(cwd, p), { throwIfNoEntry: false })?.isFile() ?? false;
  if (inputs.length !== 1 || !isFile(inputs[0])) badFiles(argv, inputs, fileName, isFile, resolve(cwd, inputs[0] ?? '.'));
  const path = resolve(cwd, inputs[0]);
  let file = new Uint8Array(readFileSync(path));
  let base = join(dirname(path), basename(path, extname(path))), shown = basename(path);
  if (isVsf(file)) {
    // a VICE snapshot (by its header, whatever its name): the run goes on from its machine; its RAM from $0200 is the
    // file, as Mimir Studio opens a snapshot
    o.resume = vsfMachine(file);
    file = Uint8Array.from([0x00, 0x02, ...o.resume.ram.subarray(0x0200)]);
    shown = `${basename(path)}: a snapshot, the CPU at ${hex4(o.resume.cpu.pc)}`;
  } else if (/\.[dg]64$/i.test(path)) {
    const disk = file, sectors = isG64(disk) ? g64ToD64(disk) : disk, entry = d64Pick(sectors, fileName ?? undefined);
    if (!entry) throw new Error(fileName ? `no PRG named "${fileName}" on the disk` : 'no PRG on the disk');
    file = new Uint8Array(d64File(sectors, entry));
    o.disk = disk;
    shown = `${basename(path)}: "${entry.name}"`;
    base += `.${entry.name.replace(/[^A-Za-z0-9 _-]/g, '_').trim() || 'file'}`;
  } else if (/\.t(ap|64)$/i.test(path)) {
    // the tape's KERNAL programs (a relocatable one loads at the start of BASIC, as LOAD puts it); * ends the name, ?
    // is any character, as the DOS takes them
    const tape = file, want = fileName?.toUpperCase();
    const re = want ? new RegExp(`^${[...want].map(c => (c === '?' ? '.' : c === '*' ? '.*' : c.replace(/[.+^${}()|[\]\\]/g, m => `\\${m}`))).join('').replace(/\.\*.*$/, '.*')}${want.includes('*') ? '' : '$'}`) : null;
    const name = (h: Uint8Array) => String.fromCharCode(...h.subarray(5, 21)).replace(/[\s\xa0]+$/, '');
    const f = tapeImageFiles(tape).find(x => (x.type === 1 || x.type === 3) && x.data.length && (!re || re.test(name(x.header))));
    if (!f) throw new Error(fileName ? `no program named "${fileName}" on the tape` : 'no program on the tape');
    const at = f.type === 1 ? 0x0801 : f.start;
    file = new Uint8Array(2 + f.data.length);
    file[0] = at & 0xff; file[1] = at >> 8; file.set(f.data, 2);
    o.tape = tape;
    shown = `${basename(path)}: "${name(f.header)}"`;
    base += `.${name(f.header).replace(/[^A-Za-z0-9 _-]/g, '_').trim() || 'file'}`;
  } else if (fileName) throw new Error('--file picks a file on a D64, G64, TAP or T64');
  if (diskPath) o.disk = new Uint8Array(readFileSync(resolve(cwd, diskPath)));
  if (tapePath) o.tape = new Uint8Array(readFileSync(resolve(cwd, tapePath)));
  o.roms = roms === false ? null : roms ? loadRoms(resolve(cwd, roms)) : findRoms();
  if (roms && !o.roms) throw new Error(`no kernal, basic and chargen ROM files in ${roms}`);

  const r = unpack(file, o);
  const written: string[] = [];
  const write = (s: Saved, name: string) => { writeFileSync(name, s.prg); written.push(name); };
  if (!info && r.saved) {
    if (all) for (let k = 1; k < r.layers.length; k++) { const s = r.save(k); if (s) write(s, `${base}.layer${k}.${s.entry.toString(16).padStart(4, '0')}.prg`); }
    else write(r.saved, out ? resolve(cwd, out) : `${base}.${r.saved.entry.toString(16).padStart(4, '0')}.prg`);
  }
  if (learn) learnSignatures(r.layers, learn);

  if (json) {
    const { save: _save, saved, ...rest } = r;
    console.log(JSON.stringify({ file: path, ...rest, saved: saved && { ...saved, prg: undefined, bytes: saved.prg.length }, written }, null, 2));
    return r.unpacked ? 0 : 1;
  }
  const loadAt = o.load ?? (file[0] | (file[1] << 8));
  console.log(`${shown}: ${range({ start: loadAt, end: loadAt + file.length - 3 })} (${kb(file.length - 2)})${r.basic.length ? `, ${r.basic.slice(0, 2).join(' / ')}` : ''}`);
  console.log(`ROMs: ${r.roms}`);
  if (r.drive) console.log(`Drive: ${r.drive}`);
  if (r.tape) console.log(`Tape: ${r.tape}`);
  for (const l of r.layers) console.log(describe(l));
  const secs = (r.cycles / 985248).toFixed(1);
  console.log(`stopped after ${secs} s of C64 time (${Math.round(r.ms)} ms): ${r.stop.reason}${r.stop.detail ? `, ${r.stop.detail}` : ''}`);
  if (!r.unpacked) console.log('nothing was unpacked');
  else if (r.saved) {
    const s = r.saved;
    console.log(`${info ? 'would save' : 'saved'} layer ${s.layer}: ${range(s)} (${kb(s.prg.length - 2)}), start with ${startHint(s)}`);
    for (const w of written) console.log(`  -> ${w}`);
  }
  return r.unpacked ? 0 : 1;
}

/** Add the depacker layers' fingerprints to data/signatures.json (a layer that changes nothing is left out). */
function learnSignatures(layers: LayerReport[], name: string): void {
  const file = fileURLToPath(new URL('../data/signatures.json', import.meta.url));
  const db = JSON.parse(readFileSync(file, 'utf8')) as { packers: { name: string; kind?: string; opcodes: string }[] };
  const stages = layers.filter(l => l.kind !== 'program' && l.kind !== 'jump' && l.opcodes.length >= 16);
  stages.forEach((l, k) => {
    if (db.packers.some(p => p.opcodes === l.opcodes)) return;
    db.packers.push({ name: stages.length > 1 ? `${name} (${k === stages.length - 1 ? 'depacker' : `stage ${k + 1}`})` : name, kind: l.kind, opcodes: l.opcodes });
    console.log(`learned ${l.kind} at ${hex4(l.entry)} as ${name}`);
  });
  writeFileSync(file, JSON.stringify(db, null, 2) + '\n');
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.error(`sindri: ${(e as Error).message}`);
  process.exitCode = 2;
}
