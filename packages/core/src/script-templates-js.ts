/* =====================================================================
 * Script templates in JavaScript (spec 10.3): ready scripts that show what JavaScript is good at in Mimir, each a
 * thing one wants to do with a program: decrypt a block, find its texts, find a byte pattern, name the routines of a
 * jump table, unpack run-length data, read the disk, call a routine with every value. Each starts with a comment that
 * says what it does, then its settings: lines that give a name one value (`const key = 0x77;`), which the Settings
 * tab shows as fields. An address in a setting is a number, or a name of the program in quotes ("tbl_001").
 * ===================================================================== */
import type { ScriptTemplate } from './script-templates';

const W = 76;
const box = (title: string, text: readonly string[]): string[] => [
  `// ${'='.repeat(W)}`,
  `//  ${title}${' '.repeat(Math.max(1, W - 2 - title.length - 'Mimir template'.length))}Mimir template`,
  `// ${'-'.repeat(W)}`,
  ...text.map(l => (l ? `//  ${l}` : '//')),
  `// ${'='.repeat(W)}`,
];
const part = (title: string) => `// ---- ${title} ${'-'.repeat(Math.max(4, W - 6 - title.length))}`;
const js = (name: string, title: string, about: string, pads: ScriptTemplate['pads'], lines: string[], safe = false): ScriptTemplate =>
  ({ name, title, about, pads, source: `${lines.join('\n')}\n`, code: 'js', ...(safe ? { safe: true } : {}) });

const xor = js('xor_js', 'XOR key byte', 'Every byte EORed with one key byte, into the scratchpad result (or in place). The same run encrypts.', [{ name: 'result', size: 0x400 }], [
  ...box('XOR with a key byte', [
    'Every byte of source is EORed with key and written to dest: the commonest way',
    'C64 games hide code and text, and its own opposite (run it on decrypted bytes',
    'and they are encrypted again). With dest = "result" the program stays as it',
    'is and the scratchpad shows the bytes; with a name of the program (or the',
    'same address as source) they go into the program and its .asm.',
    '',
    'Change the line in the loop for another method: (mem[from + i] + key) & 255',
    'adds, (mem[from + i] - key) & 255 subtracts, and a key that changes is a',
    'variable you update after each byte.',
  ]),
  '',
  part('settings: change these'),
  'const source = 0x0801;     // where the encrypted bytes are: a number, or a name in quotes ("tbl_001")',
  'const length = 0x0100;     // how many bytes',
  'const key = 0x77;          // the key byte',
  'const dest = "result";     // where they go: "result", a name of the program, or the same as source',
  '',
  part('the loop'),
  'const from = addr(source), to = addr(dest);',
  'if (to === addr("result") && length > pad("result").length)',
  '  throw new Error("length is more than the scratchpad result holds: make it bigger under Scratchpads");',
  'for (let i = 0; i < length; i++) mem[to + i] = mem[from + i] ^ key;',
  'print(hex(from) + "-" + hex(from + length - 1) + " EOR " + hex(key, 2) + " -> " + hex(to));',
]);

const findText = js('find_text', 'Find text', 'The texts in the program: every run of letters, digits and punctuation, with its address. It can mark them as text.', [], [
  ...box('Find the texts in the program', [
    'Looks through the program\'s bytes for runs that read as text: letters,',
    'digits, spaces and punctuation, at least minLength long and with at least',
    'four letters. PETSCII is what a program prints with CHROUT ($ffd2); screen',
    'codes are what it writes straight to the screen ($0400). Each is printed',
    'with its address under Last run; markThem also marks it as text, so the',
    'listing shows it as text (Ctrl+Z takes that back).',
  ]),
  '',
  part('settings: change these'),
  'const minLength = 6;        // the shortest run that counts',
  'const screenCodes = false;  // false: PETSCII, true: screen codes',
  'const markThem = false;     // true: each text found is marked as text in the listing',
  '',
  part('what a byte reads as'),
  'const letter = b => (screenCodes ? b >= 1 && b <= 26 : (b >= 0x41 && b <= 0x5a) || (b >= 0xc1 && b <= 0xda));',
  'const other = b => b >= 0x20 && b <= 0x3f;   // space, digits, punctuation: the same in both',
  'const char = b => (letter(b) ? String.fromCharCode(65 + ((b & 0x7f) - 1) % 32) : String.fromCharCode(b));',
  '',
  part('the search'),
  'let found = 0;',
  'for (const f of files) {',
  '  for (let a = f.start; a < f.end; a++) {',
  '    let e = a, letters = 0;',
  '    while (e < f.end && (letter(mem[e]) || other(mem[e]))) { if (letter(mem[e])) letters++; e++; }',
  '    if (e - a >= minLength && letters >= 4) {',
  '      let text = "";',
  '      for (let i = a; i < e; i++) text += char(mem[i]);',
  '      print(hex(a) + "-" + hex(e - 1) + "  " + text);',
  '      if (markThem) mark(a, e, screenCodes ? "textsc" : "text");',
  '      found++;',
  '    }',
  '    if (e > a) a = e;',
  '  }',
  '}',
  'print(found + " text" + (found === 1 ? "" : "s") + " found");',
]);

const findBytes = js('find_bytes', 'Find bytes', 'Every place in the program where a pattern of bytes is, ?? for any byte: a routine\'s opcodes, an address, a value.', [], [
  ...box('Find a pattern of bytes', [
    'Looks through the program for the bytes of pattern, written in hex with',
    'spaces between; ?? stands for any byte. "8d 20 d0" is sta $d020, "20 ?? c0"',
    'every jsr to $c0xx, "4c 00 10" jmp $1000. Each place is printed with its',
    'address under Last run.',
  ]),
  '',
  part('settings: change these'),
  'const pattern = "8d 20 d0";  // the bytes, in hex; ?? is any byte',
  '',
  part('the search'),
  'const want = pattern.trim().split(/\\s+/).map(x => (x === "??" ? -1 : parseInt(x, 16)));',
  'if (!want.length || want.some(x => Number.isNaN(x) || x > 255)) throw new Error("pattern is hex bytes with spaces between: 8d 20 d0");',
  'let found = 0;',
  'for (const f of files) {',
  '  for (let a = f.start; a + want.length <= f.end; a++) {',
  '    if (want.every((b, i) => b < 0 || mem[a + i] === b)) {',
  '      let bytes = "";',
  '      for (let i = 0; i < want.length; i++) bytes += hex(mem[a + i], 2).slice(1) + " ";',
  '      print(hex(a) + "  " + bytes);',
  '      found++;',
  '    }',
  '  }',
  '}',
  'print(found + " place" + (found === 1 ? "" : "s"));',
]);

const jumpTable = js('jump_table', 'Name a jump table', 'The routines a table of addresses points at (low bytes and high bytes apart), printed, and named when asked.', [], [
  ...box('Name the routines of a jump table', [
    'A program that picks a routine by a number often keeps the routines\'',
    'addresses in two tables, the low bytes in one and the high bytes in the',
    'other (lda lo,x / pha, or sta ptr / jmp (ptr)). This prints where each',
    'entry goes and, with nameThem, gives each target a name: routine_00,',
    'routine_01 … A table of addresses pushed for an RTS holds each address',
    'less one: set plusOne then.',
  ]),
  '',
  part('settings: change these'),
  'const lo = 0x0900;          // the table of low bytes: a number, or a name in quotes',
  'const hi = 0x0910;          // the table of high bytes',
  'const count = 8;            // how many entries',
  'const prefix = "routine";   // what the names start with',
  'const plusOne = false;      // true: the table holds each address less one (pushed for an RTS)',
  'const nameThem = false;     // false: only print them; true: name each target',
  '',
  part('the table'),
  'const named = new Set();',
  'for (let i = 0; i < count; i++) {',
  '  const target = ((mem[addr(lo) + i] | (mem[addr(hi) + i] << 8)) + (plusOne ? 1 : 0)) & 0xffff;',
  '  const label = prefix + "_" + i.toString(16).padStart(2, "0");',
  '  print(i.toString().padStart(3) + "  " + hex(target) + (named.has(target) ? "  (as an entry before)" : "  " + label));',
  '  if (nameThem && !named.has(target)) name(target, label);',
  '  named.add(target);',
  '}',
]);

const rle = js('rle_unpack', 'Unpack RLE', 'Run-length data unpacked into the scratchpad result: a count and a byte at a time. The loop is the place to write your packer\'s format.', [{ name: 'result', size: 0x1000 }], [
  ...box('Unpack run-length data', [
    'Run-length packing is the simplest there is: a count, and the byte that',
    'many times; a count of 0 ends it. Every program has its own flavour (a',
    'marker byte before a run, the count after the byte, literals between), and',
    'that is what JavaScript is for: change the loop below to what the program\'s',
    'own unpacker does. The unpacked bytes go into the scratchpad result, which',
    'To the project… makes a file of.',
  ]),
  '',
  part('settings: change these'),
  'const source = 0x0801;     // where the packed bytes are: a number, or a name in quotes',
  'const dest = "result";     // where the unpacked bytes go',
  '',
  part('the unpacker: a count, then the byte that many times; a count of 0 ends it'),
  'let s = addr(source), d = addr(dest);',
  'const room = dest === "result" ? addr("result_end") : 0x10000;',
  'for (;;) {',
  '  const count = mem[s++];',
  '  if (count === 0) break;',
  '  const value = mem[s++];',
  '  if (d + count > room) throw new Error("the unpacked bytes do not fit: make the scratchpad result bigger under Scratchpads");',
  '  mem.fill(value, d, d + count);',
  '  d += count;',
  '}',
  'print((s - addr(source)) + " packed bytes -> " + (d - addr(dest)) + " unpacked, at " + hex(addr(dest)));',
]);

const diskFiles = js('disk_files', 'Read the disk', 'The mounted disk\'s directory with where each file loads, or one of its files copied into the scratchpad file.', [{ name: 'file', size: 0x4000 }], [
  ...box('Read the mounted disk', [
    'With fileName empty it prints the directory of the mounted disk: each',
    'file\'s name, type, blocks and, for a program, where it loads and ends. With',
    'a name it copies that file\'s bytes (without the load address) into the',
    'scratchpad file, to look at as hex, code or text, or to work on. disk.sector',
    '(track, sector) gives a sector\'s 256 bytes, for a disk whose loader does not',
    'use the directory.',
  ]),
  '',
  part('settings: change these'),
  'const fileName = "";        // "": list the directory; a name: copy that file into the scratchpad file',
  '',
  part('the disk'),
  'if (!disk) throw new Error("no disk is mounted: File, Mount disk image");',
  'if (!fileName) {',
  '  print(disk.name + "  " + disk.id);',
  '  for (const f of disk.files) {',
  '    let where = "";',
  '    try { const b = disk.read(f); if (f.type === "PRG" && b.length > 2) where = hex(b[0] | (b[1] << 8)) + "-" + hex((b[0] | (b[1] << 8)) + b.length - 3); } catch (e) { where = "(cannot be read)"; }',
  '    print(String(f.blocks).padStart(4) + "  " + f.name.padEnd(16) + "  " + f.type + "  " + where);',
  '  }',
  '} else {',
  '  const bytes = disk.read(fileName), into = pad("file");',
  '  into.fill(0);',
  '  into.set(bytes.subarray(2, 2 + into.length));',
  '  print(fileName + ": " + (bytes.length - 2) + " bytes, loads at " + hex(bytes[0] | (bytes[1] << 8)) + (bytes.length - 2 > into.length ? "; only the first " + into.length + " fit in the scratchpad" : ""));',
  '}',
]);

const callMany = js('call_many', 'Call a routine', 'A routine of the program called with every value of A from first to last: what it gives back each time, printed.', [], [
  ...box('Call a routine with every value', [
    'Calls a routine of the program once for each value of A from first to last',
    'and prints what it leaves in A, X, Y and the carry: a table lookup, a',
    'random-number routine, a routine that sets up a level by its number. The',
    'script is added in safe mode: what the routine writes into the program is',
    'listed (In the program, Would change) and not written. Switch safe mode off',
    'to keep it.',
  ]),
  '',
  part('settings: change these'),
  'const routine = 0x0810;     // the routine: a number, or a name in quotes ("sub_0810")',
  'const first = 0;            // A for the first call',
  'const last = 7;             // A for the last call',
  'const x = 0;                // X for every call',
  'const y = 0;                // Y for every call',
  '',
  part('the calls'),
  'for (let a = first; a <= last; a++) {',
  '  const r = cpu.call(routine, { a, x, y });',
  '  print("A=" + hex(a, 2) + "  ->  A=" + hex(r.a, 2) + " X=" + hex(r.x, 2) + " Y=" + hex(r.y, 2) + (r.c ? "  carry set" : ""));',
  '}',
], true);

/** The JavaScript templates, in the order the Scripts tab lists them. */
export const JS_TEMPLATES: readonly ScriptTemplate[] = [xor, findText, findBytes, jumpTable, rle, diskFiles, callMany];
