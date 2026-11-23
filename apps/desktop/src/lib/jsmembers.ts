/* What a JavaScript script's values have (spec 10.3): after a dot, the editor suggests the properties and methods of
 * the value before it. The values are those a script is given (script-js.ts): the disk, a file of its directory, the
 * CPU, what a call gives back, a file of the program, bytes (mem, a scratchpad, a file read from the disk), a list
 * and a text. What a name is, is read from the code: `const r = cpu.call(…)`, `for (const f of disk.files)`,
 * `disk.files.map(f => …)`. */

/** a property or a method of a value: its name, what is put in (a method with its `(`) and what it is */
export interface JsMember { label: string; insert: string; detail: string }

/** the kinds of value a script works with */
export type JsType = 'disk' | 'diskFile' | 'cpu' | 'regs' | 'file' | 'bytes' | 'text' | 'diskFiles' | 'files' | 'list'
  | 'sindri' | 'machine' | 'unpacked' | 'layers' | 'layer' | 'ranges' | 'ran' | 'texts' | 'screen';

const m = (label: string, detail: string, call = false): JsMember => ({ label, insert: call ? `${label}(` : label, detail });

const LIST: JsMember[] = [
  m('length', 'how many there are'),
  m('forEach', 'forEach(x => …): once for each', true), m('map', 'map(x => …): a list of what each gives', true),
  m('filter', 'filter(x => …): those for which it is true', true), m('find', 'find(x => …): the first for which it is true', true),
  m('some', 'some(x => …): whether it is true for any', true), m('every', 'every(x => …): whether it is true for all', true),
  m('findIndex', 'findIndex(x => …): where the first such one is, or -1', true), m('slice', 'slice(from, to): a part of it, as a list of its own', true),
  m('join', 'join(", "): one text of them all', true),
];

export const JS_MEMBERS: Readonly<Record<JsType, readonly JsMember[]>> = {
  disk: [
    m('name', 'the disk\'s name, as its directory heads it'), m('id', 'the disk\'s ID (two characters) and DOS type'), m('tracks', 'how many tracks the image holds (35, or 40)'),
    m('files', 'its directory: a list of { name, type, blocks, track, sector }'),
    m('read', 'read(file or "NAME"): the file\'s bytes, its load address first', true), m('sector', 'sector(track, sector): the sector\'s 256 bytes', true),
  ],
  diskFile: [
    m('name', 'the file\'s name in the directory'), m('type', 'its type: "PRG", "SEQ", "USR", "REL" or "DEL"'), m('blocks', 'how many blocks the directory says it has'),
    m('track', 'the track its first sector is on'), m('sector', 'its first sector'),
  ],
  cpu: [
    m('call', 'call("name" or address, { a, x, y, c }): run the program\'s code until it returns; gives { a, x, y, p, c, z, n, brk }', true),
    m('limit', 'the instructions one call may take before it is stopped (50 million): set it lower for code that may not return'),
  ],
  regs: [
    m('a', 'A as the code left it'), m('x', 'X as the code left it'), m('y', 'Y as the code left it'), m('p', 'the status register (N V - B D I Z C)'),
    m('c', 'the carry flag: true or false'), m('z', 'the zero flag: true or false'), m('n', 'the negative flag: true or false'), m('brk', 'true when the code ended at a BRK, not an RTS'),
  ],
  file: [m('start', 'the address of the file\'s first byte'), m('end', 'the address after its last byte')],
  bytes: [
    m('length', 'how many bytes'),
    m('fill', 'fill(value, from, to): the same byte in each', true), m('set', 'set(bytes, at): bytes copied in, from position at', true),
    m('subarray', 'subarray(from, to): a part of it that is still the same memory', true), m('slice', 'slice(from, to): a copy of a part of it', true),
    m('indexOf', 'indexOf(value, from): where the byte first is, or -1', true), m('includes', 'includes(value): whether the byte is there', true),
    m('forEach', 'forEach((b, i) => …): once for each byte', true), m('every', 'every((b, i) => …): whether it is true for all', true), m('some', 'some((b, i) => …): whether it is true for any', true),
    m('reduce', 'reduce((sum, b) => sum + b, 0): one value of them all (a checksum)', true), m('join', 'join(" "): the bytes as one text', true),
  ],
  text: [
    m('length', 'how many characters'),
    m('padEnd', 'padEnd(width): spaces after it, up to a width', true), m('padStart', 'padStart(width, "0"): filled in front, up to a width', true),
    m('trim', 'trim(): without the spaces around it', true), m('startsWith', 'startsWith("…"): whether it begins so', true), m('includes', 'includes("…"): whether it has it', true),
    m('toLowerCase', 'toLowerCase(): in small letters', true), m('toUpperCase', 'toUpperCase(): in capitals', true), m('slice', 'slice(from, to): a part of it', true),
    m('charCodeAt', 'charCodeAt(i): the code of its character i', true), m('split', 'split(" "): a list of its parts', true),
  ],
  diskFiles: LIST, files: LIST, list: LIST, layers: LIST, ranges: LIST, texts: LIST,
  sindri: [
    m('unpack', 'unpack(prg, { disk, entry, port }): Sindri\'s unpacker run on a PRG (the program\'s first file when none is given); gives { unpacked, packer, start, end, entry, bytes, prg, layers, … }', true),
    m('c64', 'c64({ disk, program }): a whole C64 at READY, the program in its RAM and the disk in its 1541 (the ROMs are needed)', true),
    m('disassemble', 'disassemble(at, count, bytes): so many instructions of mem (or of bytes) from an address, a line each', true),
    m('basic', 'basic(at): the BASIC program at an address ($0801 when none is given) as its lines', true),
    m('sys', 'sys(at): the address the BASIC program\'s SYS goes to, or null', true),
    m('prg', 'prg(start, end): the bytes of mem from start up to end as a PRG, its load address first', true),
    m('roms', 'where the C64\'s ROMs are from, or "stand-ins" when there are none'),
  ],
  machine: [
    m('mem', 'the C64\'s RAM (64 KB): its own, not the script\'s mem'),
    m('run', 'run({ until, cycles }): run on from its PC until an address (or one of several), or for so many cycles; gives { reason, pc, cycles }', true),
    m('call', 'call("name" or address, { a, x, y, c }): call a routine with the ROMs, the I/O and the interrupts there; gives { a, x, y, p, c, z, n }', true),
    m('type', 'type("RUN\\r"): keys into the keyboard buffer (at most 10; \\r is RETURN)', true),
    m('screen', 'screen(): the text screen as its 25 lines', true),
    m('load', 'load(bytes, at): bytes into its RAM', true), m('loadPrg', 'loadPrg(prg): a PRG into its RAM; gives its load address', true),
    m('peek', 'peek(address): a byte as the CPU reads it (a ROM where one is mapped in)', true),
    m('pc', 'the program counter, read and set'), m('a', 'A, read and set'), m('x', 'X, read and set'), m('y', 'Y, read and set'),
    m('s', 'the stack pointer, read and set'), m('p', 'the status register (N V - B D I Z C), read and set'), m('cycles', 'the cycles it has run'),
  ],
  unpacked: [
    m('unpacked', 'true when Sindri got to a program under a packer'), m('packer', 'the packers it went through, by name ("" when it knew none)'),
    m('start', 'the address of the unpacked program\'s first byte'), m('end', 'the address after its last byte'),
    m('entry', 'where the unpacked program starts'), m('port', 'the value of $01 it starts with'), m('basic', 'true when it starts with RUN, not at an address'),
    m('bytes', 'the unpacked program\'s bytes, from start'), m('prg', 'the unpacked program as a PRG, its load address first'),
    m('layers', 'what ran, layer by layer: a list of { index, entry, kind, packer, instructions, written, what }'),
    m('listing', 'the BASIC lines the file starts with'), m('stop', 'why Sindri stopped, as a text'), m('drive', 'what the 1541 did, when the disk was used'),
    m('cycles', 'the cycles the run took'), m('ms', 'the milliseconds the run took'),
  ],
  layer: [
    m('index', 'its number, from 0'), m('entry', 'where it started'), m('kind', 'what it is: a packer\'s stage, a loader, the program …'), m('packer', 'the packer\'s name, or null'),
    m('instructions', 'how many instructions it ran'), m('written', 'the memory it wrote: a list of { start, end }'), m('what', 'what it did, as a sentence'),
  ],
  screen: [
    m('print', 'print(...values): a line on the C64 screen, then RETURN (the cursor goes to the next row; the screen scrolls)', true),
    m('write', 'write(...values): text on the C64 screen where the cursor is, without RETURN', true),
    m('chrout', 'chrout(byte or bytes): PETSCII as CHROUT prints it: colour codes, RVS ON $12/OFF $92, CLR $93, HOME $13, cursor moves', true),
    m('at', 'at(col, row): the cursor to a column and a row, from 0', true),
    m('clear', 'clear(): CLR, the screen in the cursor\'s colour, the cursor home', true), m('home', 'home(): the cursor to the top left', true),
    m('poke', 'poke(col, row, code, color): a screen code (and its colour) into a cell, as POKE does', true),
    m('peek', 'peek(col, row): the screen code in a cell', true),
    m('show', 'show(at, colorsAt): 1000 screen codes of the program (an address, a name or bytes) and their colours at the top left; show(c64) the screen of a C64 of sindri.c64()', true),
    m('charset', 'charset(at): the program\'s own character set (2 KB) in place of the ROM\'s; charset(null) for the ROM\'s', true),
    m('color', 'the colour text is printed in: 0-15 or a name ("light blue"), read and set'),
    m('border', 'the border\'s colour: 0-15 or a name, read and set'), m('background', 'the background\'s colour: 0-15 or a name, read and set'),
    m('reverse', 'RVS ON: true or false'), m('lower', 'the lower case character set: true or false'),
    m('cols', 'how many columns it has (40; more in extended mode)'), m('rows', 'how many rows it has (25; more in extended mode)'),
    m('col', 'the cursor\'s column, read and set'), m('row', 'the cursor\'s row, read and set'),
    m('codes', 'every cell\'s screen code, a row after another (cols bytes a row)'), m('colors', 'every cell\'s colour, a row after another'),
  ],
  ran: [m('reason', 'why it stopped: "until" (it got to the address), "cycles" or "jam"'), m('pc', 'where it is'), m('cycles', 'the cycles this run took')],
};

/** what one of a list is */
const ELEMENT: Partial<Record<JsType, JsType>> = { diskFiles: 'diskFile', files: 'file', layers: 'layer', ranges: 'file', texts: 'text' };
const LIST_GIVES_ONE = /^(find|at)$/, LIST_GIVES_LIST = /^(filter|slice)$/, CALLBACKS = 'map|forEach|filter|find|some|every|findIndex';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The expression that ends a text: names, dots, and whole (…) and […] groups, read from its end back. */
export function tailExpression(text: string): string {
  let i = text.length;
  for (;;) {
    const ch = text[i - 1];
    if (ch === ')' || ch === ']') {
      const open = ch === ')' ? '(' : '[';
      let depth = 0, k = i - 1;
      for (; k >= 0; k--) { if (text[k] === ch) depth++; else if (text[k] === open && --depth === 0) break; }
      if (k < 0) break;
      i = k;
    } else if (ch != null && /[\w$.]/.test(ch)) i--;
    else break;
  }
  return text.slice(i);
}

/** a text up to the first `stop` character that is not inside brackets or quotes (all of it when there is none) */
function firstPart(text: string, stop: string): string {
  let depth = 0, quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (depth === 0 && ch === stop) return text.slice(0, i);
    if (ch === '(' || ch === '[' || ch === '{') depth++; else if (ch === ')' || ch === ']' || ch === '}') depth--;
  }
  return text;
}

/** the last part of an expression and what is before it: `disk.files[0]` → [`disk.files`, `[0]`] */
function lastPart(expr: string): [string, string] | null {
  const end = expr[expr.length - 1];
  if (end === ')' || end === ']') {
    const open = end === ')' ? '(' : '[';
    let depth = 0, k = expr.length - 1;
    for (; k >= 0; k--) { if (expr[k] === end) depth++; else if (expr[k] === open && --depth === 0) break; }
    return k > 0 ? [expr.slice(0, k), expr.slice(k)] : null;
  }
  const dot = expr.lastIndexOf('.');
  return dot > 0 ? [expr.slice(0, dot), expr.slice(dot)] : null;
}

/**
 * What kind of value an expression is, in the script `source`: one of the things a script is given, what a member or
 * a call of one gives, or a name the code gave such a value (a `const`, the variable of a `for … of`, the parameter
 * of a list's callback). null: not one Mimir knows.
 */
export function jsTypeOf(expr: string, source: string, depth = 0): JsType | null {
  const e = expr.trim();
  if (!e || depth > 6) return null;
  if (e === 'disk') return 'disk';
  if (e === 'cpu') return 'cpu';
  if (e === 'mem') return 'bytes';
  if (e === 'files') return 'files';
  if (e === 'sindri') return 'sindri';
  if (e === 'screen' && !/\b(?:const|let|var)\s+screen\b/.test(source)) return 'screen';
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const n = esc(e);
    // const r = cpu.call(…)
    const decl = new RegExp(`\\b(?:const|let|var)\\s+(?:[^;\\n]*?,\\s*)?${n}\\s*=\\s*([^;\\n]+)`).exec(source);
    if (decl) { const t = jsTypeOf(firstPart(decl[1], ',').trim(), source, depth + 1); if (t) return t; }
    // for (const f of disk.files)
    const loop = new RegExp(`\\bfor\\s*\\(\\s*(?:const|let|var)\\s+${n}\\s+of\\s+([^\\n]+)`).exec(source);
    if (loop) { const t = jsTypeOf(firstPart(loop[1], ')').trim(), source, depth + 1); if (t && ELEMENT[t]) return ELEMENT[t]!; }
    // disk.files.map(f => …), disk.files.forEach((f, i) => …)
    const cb = new RegExp(`([\\w$.()\\[\\]"']+)\\.(?:${CALLBACKS})\\(\\s*\\(?\\s*${n}\\b\\s*[,)=]`).exec(source);
    if (cb) { const t = jsTypeOf(tailExpression(cb[1]), source, depth + 1); if (t && ELEMENT[t]) return ELEMENT[t]!; }
    return null;
  }
  const parts = lastPart(e);
  if (!parts) return /^pad\(/.test(e) ? 'bytes' : /^hex\(/.test(e) ? 'text' : null;
  const [head, tail] = parts;
  if (tail[0] === '(') {
    // a call: pad("x"), cpu.call(…), disk.read(…), list.find(…)
    if (head === 'pad') return 'bytes';
    if (head === 'hex') return 'text';
    const callee = lastPart(head);
    if (!callee || callee[1][0] !== '.') return null;
    const on = jsTypeOf(callee[0], source, depth + 1), name = callee[1].slice(1);
    if (on === 'cpu' && name === 'call') return 'regs';
    if (on === 'sindri') return name === 'unpack' ? 'unpacked' : name === 'c64' ? 'machine' : name === 'prg' ? 'bytes' : name === 'disassemble' || name === 'basic' ? 'texts' : null;
    if (on === 'machine') return name === 'call' ? 'regs' : name === 'run' ? 'ran' : name === 'screen' ? 'texts' : null;
    if (on === 'disk' && (name === 'read' || name === 'sector')) return 'bytes';
    if (on === 'bytes' && (name === 'subarray' || name === 'slice')) return 'bytes';
    if (on === 'bytes' && name === 'join') return 'text';
    if (on && ELEMENT[on] && LIST_GIVES_ONE.test(name)) return ELEMENT[on]!;
    if (on && (ELEMENT[on] || on === 'list') && LIST_GIVES_LIST.test(name)) return on;
    if (on && (ELEMENT[on] || on === 'list') && name === 'map') return 'list';
    if (on && (ELEMENT[on] || on === 'list') && name === 'join') return 'text';
    if (on === 'text' && /^(padEnd|padStart|trim|toLowerCase|toUpperCase|slice)$/.test(name)) return 'text';
    if (on === 'text' && name === 'split') return 'list';
    return null;
  }
  const on = jsTypeOf(head, source, depth + 1);
  // one of a list: disk.files[0]
  if (tail[0] === '[') return on && ELEMENT[on] ? ELEMENT[on]! : null;
  const name = tail.slice(1);
  if (on === 'disk') return name === 'files' ? 'diskFiles' : name === 'name' || name === 'id' ? 'text' : null;
  if (on === 'diskFile') return name === 'name' || name === 'type' ? 'text' : null;
  if (on === 'sindri') return name === 'roms' ? 'text' : null;
  if (on === 'machine') return name === 'mem' ? 'bytes' : null;
  if (on === 'screen') return name === 'codes' || name === 'colors' ? 'bytes' : null;
  if (on === 'unpacked') return name === 'bytes' || name === 'prg' ? 'bytes' : name === 'layers' ? 'layers' : name === 'listing' ? 'texts' : name === 'packer' || name === 'stop' ? 'text' : null;
  if (on === 'layer') return name === 'written' ? 'ranges' : name === 'what' || name === 'kind' || name === 'packer' ? 'text' : null;
  return null;
}

/** What a value has, by the text before the dot the cursor is after: the members of its kind that start with what is
 *  typed after the dot (all of them with nothing typed). null: the value before the dot is not one Mimir knows. */
export function jsMembers(beforeDot: string, typed: string, source: string): JsMember[] | null {
  const t = jsTypeOf(tailExpression(beforeDot), source);
  if (!t) return null;
  const want = typed.toLowerCase();
  return JS_MEMBERS[t].filter(x => x.label.toLowerCase().startsWith(want) && x.label.length > typed.length);
}
