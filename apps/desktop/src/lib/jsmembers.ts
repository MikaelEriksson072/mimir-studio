/* What a JavaScript script's values have (spec 10.3): after a dot, the editor suggests the properties and methods of
 * the value before it. The values are those a script is given (script-js.ts): the disk, a file of its directory, the
 * CPU, what a call gives back, a file of the program, bytes (mem, a scratchpad, a file read from the disk), a list
 * and a text. What a name is, is read from the code: `const r = cpu.call(…)`, `for (const f of disk.files)`,
 * `disk.files.map(f => …)`. */

/** a property or a method of a value: its name, what is put in (a method with its `(`) and what it is */
export interface JsMember { label: string; insert: string; detail: string }

/** the kinds of value a script works with */
export type JsType = 'disk' | 'diskFile' | 'cpu' | 'regs' | 'file' | 'bytes' | 'text' | 'diskFiles' | 'files' | 'list'
  | 'sindri' | 'machine' | 'unpacked' | 'layers' | 'layer' | 'ranges' | 'ran' | 'texts' | 'screen' | 'brokkr' | 'packed' | 'crunched' | 'memFile' | 'areas' | 'area' | 'loader' | 'loaders' | 'loaderGroup' | 'loaderGroups' | 'loaderFile' | 'loaderFiles' | 'exporter' | 'exportFile' | 'exportFiles' | 'exportChanges' | 'build' | 'lastBuild' | 'builtFile' | 'builtFiles'
  | 'library' | 'libItem' | 'libItems' | 'libFrom' | 'libColors'
  | 'snapshot' | 'snapCpu' | 'snapPort' | 'snapCia' | 'snapSid' | 'snapVic' | 'snapSprite' | 'snapSprites' | 'snapDrive' | 'snapVia' | 'snapModule' | 'snapModules'
  | 'scripts' | 'scriptOne' | 'scriptList' | 'scriptSetting' | 'scriptSettings' | 'scriptPads' | 'scriptTemplate' | 'scriptTemplates'
  | 'tapes' | 'tapeImage' | 'tapeEntry' | 'tapeEntries'
  | 'disks' | 'diskImage' | 'diskEntry' | 'diskEntries'
  | 'blocks' | 'block' | 'blockList' | 'struct' | 'structFields' | 'structField' | 'customType' | 'customTypes'
  | 'sid' | 'tune' | 'tunes' | 'tunePlays' | 'sidFile' | 'sidRun' | 'sidPlayer' | 'dump' | 'voices' | 'voice' | 'sidNote';

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
  diskFiles: LIST, files: LIST, list: LIST, layers: LIST, ranges: LIST, texts: LIST, tunes: LIST, dump: LIST,
  libItems: LIST, blockList: LIST, structFields: LIST, customTypes: LIST, snapSprites: LIST, snapModules: LIST,
  tapeEntries: LIST,
  tapes: [
    m('create', 'create("tap" or "t64", { name }): a new, empty tape (a tape\'s pulses, or a tape archive)', true),
    m('open', 'open(bytes): a tape image\'s bytes to work on (a TAP or a T64)', true),
    m('mounted', 'the tape in the datasette to work on, a copy, or null'), m('kinds', 'the kinds of tape: "tap" and "t64"'),
  ],
  tapeImage: [
    m('kind', '"tap" or "t64"'), m('name', 'a T64\'s name (set: up to 24 characters); a TAP\'s file name'), m('files', 'its files: a list of { number, name, format, type, load, end, size, seconds, errors }'),
    m('find', 'find("name" or a number): a file, or null', true), m('has', 'has("name"): whether a file is on it', true),
    m('read', 'read("name" or a number): a file\'s bytes, without a load address', true), m('prg', 'prg("name" or a number): a file\'s bytes with its load address first', true),
    m('add', 'add("name", bytes, { load, basic, header }): a file after the last one; on a TAP in the KERNAL\'s format, as SAVE writes it', true),
    m('remove', 'remove("name" or a number): a file taken off the tape', true), m('rename', 'rename("name" or a number, "new name")', true),
    m('list', 'list(): the files, a line each', true), m('size', 'how many bytes the image is'), m('bytes', 'the image as it is now, a copy'), m('file', 'file(): the image\'s bytes', true),
    m('save', 'save("name.tap"): the image a file of the run (Last run: Save…)', true), m('insert', 'insert(): the image in the datasette when the run has ended well', true),
    m('toT64', 'toT64("name"): a TAP\'s files (turbo ones too) as a T64', true), m('toTap', 'toTap(): a T64\'s files written as a TAP in the KERNAL\'s format', true),
    m('version', 'a TAP: its version (1)'), m('seconds', 'a TAP: how long it plays'), m('pulses', 'a TAP: its pulses\' lengths in cycles, a copy'),
    m('unknown', 'a TAP: the stretches no format reads: a list of { from, to, pulses, seconds, short, long }'),
    m('pause', 'a TAP: pause(seconds): silence at its end', true), m('addPulses', 'a TAP: addPulses([cycles, …]): pulses of your own at its end', true),
    m('cut', 'a TAP: cut(from, to): the pulses from one up to another taken out; gives how many', true), m('endOfTape', 'a TAP: endOfTape(): the KERNAL\'s end-of-tape marker at its end', true),
  ],
  tapeEntry: [m('number', 'its number on the tape, from 0'), m('name', 'its name'), m('format', 'the loader it is in: "cbm" (the KERNAL\'s), "t64", "turbotape", "freeload", …'), m('type', '"prg", "basic", "seq", "end" or "data"'), m('load', 'where it loads, or null'), m('end', 'the address after its last byte, or null'), m('size', 'how many bytes it is'), m('seconds', 'a TAP: when it starts'), m('errors', 'what went wrong reading it, a text each')],
  diskEntries: LIST,
  disks: [
    m('create', 'create("d64" or "d81", { name, id }): a new, formatted disk (a 1541 disk or a 1581 disk)', true),
    m('open', 'open(bytes): a disk image\'s bytes to work on (a D64, a G64\'s sectors, a D81)', true),
    m('mounted', 'the mounted disk to work on, a copy (a D81 that was mounted is kept for scripts), or null'),
    m('kinds', 'the kinds of disk: "d64" and "d81"'), m('blocksFor', 'blocksFor(bytes or a length): how many blocks they take as a file', true),
  ],
  diskImage: [
    m('kind', '"d64" or "d81"'), m('name', 'the disk\'s name (set: up to 16 characters)'), m('id', 'the disk\'s ID (set: two characters)'), m('dosType', 'its DOS type: "2A", "3D"'),
    m('tracks', 'how many tracks it has'), m('sectors', 'how many sectors it has'), m('size', 'how many bytes the image is'), m('free', 'blocks free, as the drive counts them'),
    m('files', 'its directory: a list of { name, type, blocks, size, track, sector, locked, closed }'),
    m('find', 'find("name"): a file\'s entry, or null', true), m('has', 'has("name"): whether a file is on it', true), m('read', 'read("name"): a file\'s bytes (a PRG\'s with its load address first)', true),
    m('add', 'add("name", bytes, { type, load, replace }): a file added in free sectors; type "prg", "seq", "usr" or "del"; load: a load address put in front', true),
    m('remove', 'remove("name"): a file taken off, its sectors free again', true), m('rename', 'rename("name", "new name")', true),
    m('lock', 'lock("name", on): the file locked (< in a listing) or not', true), m('setType', 'setType("name", "seq"): the file\'s type', true),
    m('sector', 'sector(track, sector): its 256 bytes in the image: what is written there is on the disk', true), m('sectorsOn', 'sectorsOn(track): how many sectors a track has', true),
    m('isFree', 'isFree(track, sector): whether the BAM has it as free', true), m('allocate', 'allocate(track, sector): taken in the BAM', true), m('release', 'release(track, sector): free in the BAM', true),
    m('chain', 'chain("name"): a file\'s sectors in order, a list of { track, sector }', true),
    m('validate', 'validate(): the BAM worked out again from the files, as the drive\'s V command; gives what was wrong, a text each', true),
    m('format', 'format("name", "id"): everything off the disk', true), m('list', 'list(): the directory as LOAD"$" lists it, a line each', true),
    m('bytes', 'the image, as it is now'), m('file', 'file(): the image\'s bytes, a copy', true),
    m('save', 'save("name.d64"): the image a file of the run (Last run: Save…)', true),
    m('mount', 'mount(): the image mounted when the run has ended well (a D81: kept for scripts)', true),
  ],
  diskEntry: [m('name', 'its name'), m('type', '"prg", "seq", "usr", "del", "rel" or "cbm"'), m('blocks', 'its size in blocks'), m('size', 'its size in bytes'), m('track', 'the track of its first sector'), m('sector', 'its first sector'), m('locked', 'true when it is locked'), m('closed', 'false for a file that was never closed')],
  scriptList: LIST, scriptSettings: LIST, scriptPads: LIST, scriptTemplates: LIST,
  scripts: [
    m('all', 'the project\'s scripts: a list of { name, code, source, settings, … }'), m('names', 'their names'), m('self', 'the script that runs'),
    m('find', 'find("name"): a script of the project, or null', true),
    m('library', 'the scripts of the library folder: a list, as all'), m('templates', 'the templates: a list of { name, title, about, code, source, safe, settings }'),
    m('call', 'call("name", { setting: value }): another JavaScript script\'s code run here, in this run (the same mem and print); gives what its code returns', true),
    m('use', 'use("name"): as call: a script that ends with return { … } is a library', true),
    m('add', 'add("name", source, { code, safe, when, key }): a new script in the project, when the run has ended well; code "js" or "asm"', true),
    m('edit', 'edit("name", { source, settings, safe, when, key, name }): a script of the project changed, when the run has ended well', true),
    m('run', 'run("name", { settings }): another script run when this run has ended, as Run runs it', true),
    m('requests', 'what the script has asked for so far, a text each'),
  ],
  scriptOne: [
    m('name', 'its name'), m('code', 'what it is written in: "js" or "asm"'), m('lang', 'the assembler its assembler code is for: "kickass" or "64tass"'), m('source', 'its code'), m('lines', 'how many lines its code is'),
    m('safe', 'true when it runs in safe mode'), m('when', 'when it runs by itself: "build", "load" or null'), m('key', 'the key that runs it, or null'), m('machine', '"c64" when it runs in the whole C64, else null'),
    m('pads', 'its scratchpads: a list of { name, start, end, size }'), m('settings', 'its settings: a list of { name, value, line, comment }'), m('self', 'true for the script that runs'),
    m('setting', 'setting("name"): a setting\'s value as its code writes it, or null', true),
    m('withSettings', 'withSettings({ setting: value }): its code with settings set, a text', true),
    m('call', 'call({ setting: value }): its code run here, in this run; gives what it returns (JavaScript only)', true),
  ],
  scriptSetting: [m('name', 'its name'), m('value', 'its value as the code writes it'), m('line', 'the line it is on'), m('comment', 'what its line says it is')],
  scriptTemplate: [m('name', 'the name a copy gets'), m('title', 'what the list of templates shows'), m('about', 'what it does, in a line'), m('code', '"js" or "asm"'), m('source', 'its code'), m('lines', 'how many lines'), m('safe', 'true when a copy starts in safe mode'), m('settings', 'its settings: a list of { name, value, line, comment }')],
  snapshot: [
    m('name', 'the snapshot\'s file'), m('machine', 'the machine VICE ran: "C64SC" (x64sc) or "C64"'), m('vice', 'the VICE version that wrote it'), m('format', 'the snapshot format, "2.0"'), m('size', 'how many bytes the .vsf is'),
    m('cpu', 'the 6510 as it was: { pc, a, x, y, sp, status, flags }, read and set'), m('port', 'the 6510 port: { data ($01), dir ($00), config }'),
    m('ram', 'all 64 KB of RAM as saved: the zero page, the stack and the RAM under ROM and I/O too'),
    m('cia1', 'CIA 1: { pra, prb, ddra, ddrb, timerA, timerB, latchA, latchB, tod, sdr, mask, cra, crb, flags }'), m('cia2', 'CIA 2 (its port A has the VIC bank): as cia1'),
    m('sid', 'the SID: { regs ($d400-$d418 as last written), volume }'), m('vic', 'the VIC-II: its registers, colour RAM and raster, and what they come to (mode, screenAt, sprites, …)'),
    m('drive', 'drive 8 as it was: { type, model, halfTrack, track, cpu, ram, via1, via2, motor, led }, or null'),
    m('modules', 'the modules the snapshot is made of: a list of { name, version, size, offset }'), m('module', 'module("MAINCPU"): a module\'s bytes, to read and to write', true), m('has', 'has("REU"): whether it has a module', true),
    m('changes', 'what the script has changed so far, a text a module'), m('changed', 'true when it has changed something'),
    m('file', 'file(): the snapshot as the script has it now, the bytes of a .vsf', true), m('reset', 'reset(): the script\'s changes taken back', true),
    m('write', 'write(): the project keeps the snapshot as the script has it now, when the run has ended well; Build & Run restarts that one', true),
  ],
  snapCpu: [m('pc', 'where it was (set: an address or a name)'), m('a', 'the accumulator'), m('x', 'the X register'), m('y', 'the Y register'), m('sp', 'the stack pointer'), m('status', 'the status register'), m('flags', 'the status as a text: "N.-..I.C"')],
  snapPort: [m('data', '$01: the port\'s data'), m('dir', '$00: its direction'), m('config', 'the memory configuration it gives, 0-7 (7: BASIC, KERNAL and I/O)')],
  snapCia: [
    m('pra', 'port A'), m('prb', 'port B'), m('ddra', 'port A\'s direction'), m('ddrb', 'port B\'s direction'), m('timerA', 'timer A as it counts now'), m('timerB', 'timer B as it counts now'),
    m('latchA', 'timer A\'s latch'), m('latchB', 'timer B\'s latch'), m('tod', 'the time of day: tenths, seconds, minutes, hours (4 bytes)'), m('sdr', 'the serial register'),
    m('mask', 'the interrupts that are on'), m('cra', 'control register A'), m('crb', 'control register B'), m('flags', 'the interrupts that are waiting'),
  ],
  snapSid: [m('regs', 'the registers $d400-$d418 as last written: 25 bytes'), m('volume', 'the volume, 0-15')],
  snapVic: [
    m('regs', 'the registers $d000-$d03f as last written: 64 bytes, read and set'), m('colorRam', 'the colour RAM ($d800-$dbff): 1024 bytes, read and set'),
    m('border', 'the border colour, 0-15'), m('background', 'the background colour, 0-15'), m('displayOn', 'true when the screen is on ($d011 bit 4)'),
    m('mode', 'the mode: "text", "mc-text", "ecm-text", "bitmap", "mc-bitmap" or "invalid"'), m('bank', 'the VIC bank, 0-3 (from CIA 2)'),
    m('screenAt', 'where the screen is in memory'), m('charsetAt', 'where the character set is'), m('bitmapAt', 'where the bitmap is'), m('charRom', 'true when the characters come from the ROM'),
    m('rows', '24 or 25'), m('cols', '38 or 40'), m('sprites', 'the 8 sprites: a list of { n, on, x, y, color, mc, wide, tall, behind, pointer, dataAt }'),
    m('line', 'the raster line the VIC was at'), m('cycle', 'the cycle in that line'), m('irqLine', 'the raster interrupt\'s line'), m('irqFlags', 'the interrupts that are waiting ($d019)'), m('model', 'VICE\'s model number (0: 6569 PAL, 3: 6567 NTSC), or null'),
  ],
  snapSprite: [m('n', 'which sprite, 0-7'), m('on', 'true when it is shown'), m('x', 'its x, 0-511'), m('y', 'its y'), m('color', 'its colour, 0-15'), m('mc', 'true when it is multicolour'), m('wide', 'true when it is twice as wide'), m('tall', 'true when it is twice as tall'), m('behind', 'true when it is behind the graphics'), m('pointer', 'its pointer (in the screen\'s last bytes)'), m('dataAt', 'where its 64 bytes are')],
  snapDrive: [
    m('unit', '8'), m('type', 'the drive\'s type as VICE numbers it: 1541, 1542 (a 1541-II), 1571, 1581'), m('model', 'the type\'s name: "1541-II"'),
    m('track', 'the track the head is on, in halves (18.5): read and set'), m('halfTrack', 'the half track the head is on (track 18 is 36)'),
    m('cpu', 'the drive\'s 6502: { pc, a, x, y, sp, status, flags }'), m('ram', 'the drive\'s 2 KB of RAM ($0000-$07ff), read and set; null for a drive it is not read from'),
    m('via1', 'VIA 1 ($1800, the serial bus): { pra, ddra, prb, ddrb, latch1, timer1, timer2, sr, acr, pcr, ifr, ier }'), m('via2', 'VIA 2 ($1c00, the head and the motor): as via1'),
    m('motor', 'true when the motor is on'), m('led', 'true when the LED is on'),
  ],
  snapVia: [m('pra', 'port A'), m('ddra', 'port A\'s direction'), m('prb', 'port B'), m('ddrb', 'port B\'s direction'), m('latch1', 'timer 1\'s latch'), m('timer1', 'timer 1 as it counts now'), m('timer2', 'timer 2 as it counts now'), m('sr', 'the shift register'), m('acr', 'the auxiliary control register'), m('pcr', 'the peripheral control register'), m('ifr', 'the interrupt flags'), m('ier', 'the interrupts that are on')],
  snapModule: [m('name', 'its name: "MAINCPU", "C64MEM", "VIC-II", "DRIVECPU0", …'), m('version', 'its version, "1.4"'), m('size', 'how many bytes it has'), m('offset', 'where its bytes start in the file')],
  blocks: [
    m('all', 'every block of the program, in address order: a list of blocks (as they were when the run started)'), m('count', 'how many blocks there are'),
    m('at', 'at(address): the block that has an address, or null', true), m('in', 'in(start, end): the blocks in a range', true),
    m('of', 'of("type"): the blocks of a type ("code", "bytes", "text", "struct", …) or of a custom type', true), m('find', 'find("label"): the block with a label, or null', true),
    m('mark', 'mark(start, end, type, { fmt, row, mc, colors, init, play, label, comment }): as Mark as; type a type\'s name, a custom type or a struct', true),
    m('struct', 'struct("name", ["x: byte", "hp: byte dec", "handler: addr", "name: text[8]"]): a struct, a series of fields; it reads records and marks them', true),
    m('define', 'define("name", { as: "bytes", row: 40, fmt: "dec" }) or define("name", fields): a custom block type; mark takes its name', true),
    m('split', 'split(address): the block there cut in two at the address', true), m('auto', 'auto(start, end): what was marked there taken away: as the analysis reads it', true),
    m('comment', 'comment(address, "text"): the comment above the block there ("" takes it away)', true),
    m('exclude', 'exclude(address, on): the block there left out of the build (false: in it again)', true), m('binary', 'binary(address, on): the block there saved as a binary file (false: written in the source)', true),
    m('text', 'text(start, end, "textsc"): the bytes of a range as text, in a text type\'s encoding', true), m('encode', 'encode("HELLO", "textsc"): a text\'s bytes in a text type\'s encoding', true),
    m('types', 'the types mark takes: a list of names'), m('defined', 'the custom types the script has defined so far'),
  ],
  block: [
    m('start', 'the address of its first byte'), m('end', 'the address after its last byte'), m('size', 'how many bytes it is'),
    m('type', 'what it is: "code", "data", "text", "words", "table", "lohi", "sprite", "charset", "bitmap", "screen", "music", "fill", "basic", "reloc"'),
    m('as', 'the type mark takes for it: "bytes", "textsc", …, or "struct"'), m('custom', 'the name of its custom type, or null'), m('label', 'the label at its start, or null'),
    m('comment', 'the comment above it, or null'), m('file', 'the program\'s file it is in'), m('user', 'true when it was marked (by you or a script), false as the analysis found it'),
    m('confidence', 'how sure the analysis is, 0 to 1'), m('why', 'what the analysis found it by'), m('entropy', 'bits a byte'),
    m('excluded', 'true when it is left out of the build'), m('binary', 'true when it is saved as a binary file'),
    m('fmt', 'how its numbers are written: "hex", "dec", "bin", or null'), m('row', 'how many go on a line, or null'), m('enc', 'a text\'s encoding, else null'),
    m('mc', 'graphics: true multicolour, false hires, null as the VIC registers say'), m('colors', 'sprites: the colours they are drawn in, or null'),
    m('init', 'music: its init routine, else null'), m('play', 'music: its play routine, else null'),
    m('struct', 'a struct block\'s struct, else null'), m('records', 'a struct block\'s records: a list of { field: value }, else null'),
    m('bytes', 'its bytes, as mem has them now'), m('text', 'a text block\'s text, else null'), m('words', 'its bytes as 16-bit values, low byte first'),
    m('next', 'the block after it, or null'), m('prev', 'the block before it, or null'),
    m('mark', 'mark(type, { fmt, row, … }): the block marked as a type, a custom type or a struct', true),
    m('format', 'format({ fmt, row, mc, colors }): how it is written changed, its type kept', true),
    m('setLabel', 'setLabel("name"): the label at its start', true), m('setComment', 'setComment("text"): the comment above it ("" takes it away)', true),
    m('split', 'split(address): cut in two at an address inside it', true), m('auto', 'auto(): what was marked taken away: as the analysis reads it', true),
    m('exclude', 'exclude(on): left out of the build (false: in it again)', true), m('asBinary', 'asBinary(on): saved as a binary file (false: written in the source)', true),
    m('junk', 'junk(): its bytes are junk, left out of everything', true),
  ],
  struct: [
    m('name', 'its name, or null'), m('size', 'how many bytes a record is'), m('fields', 'its fields: a list of { name, type, count, fmt, enc, offset, size, text }'), m('text', 'its fields in a line: "x: byte, name: text[8]"'),
    m('read', 'read(address): the record there: { field: value }, a text field a text, a field with a count a list', true),
    m('records', 'records(address, count): that many records from there, a list', true),
    m('write', 'write(address, { field: value }): the fields given written into mem; gives the address after the record', true),
    m('offset', 'offset("field"): where a field is in the record', true),
    m('mark', 'mark(start, end, { label, comment }): the range marked as records of the struct, a line a field in the listing', true),
    m('markRecords', 'markRecords(start, count, { label, comment }): that many records marked', true),
  ],
  structField: [m('name', 'its name'), m('type', '"byte", "word", "addr" or "text"'), m('count', 'how many'), m('fmt', 'the number format, when it has one'), m('enc', 'a text\'s encoding'), m('offset', 'where it is in the record'), m('size', 'how many bytes it is'), m('text', 'its type as it is written: "byte[40] dec"')],
  customType: [
    m('name', 'its name'), m('as', 'the type it is: "bytes", "textsc", …'), m('struct', 'its struct, or null'), m('size', 'a struct\'s record size, else null'),
    m('mark', 'mark(start, end, { label, comment }): the range marked as this type', true),
  ],
  library: [
    m('items', 'everything in the library: a list of items'), m('sids', 'its SID music'), m('sprites', 'its sprites'), m('chars', 'its charsets'), m('bitmaps', 'its pictures'),
    m('find', 'find("name", kind): an item by its name or its file\'s name, or null', true), m('search', 'search("text", kind): the items whose name, file or source has the text', true),
    m('same', 'same(kind, bytes): the item that holds these bytes already, or null', true),
    m('add', 'add(kind, bytes, { name, from, mc, colors, load, format, author }): added when the run has ended well; kind "sid", "sprites", "chars" or "bitmaps"', true),
    m('folder', 'the library\'s folder on the PC'), m('requests', 'what the script has asked to be added so far, a text each'),
  ],
  libItem: [
    m('kind', 'its kind: "sid", "sprites", "chars" or "bitmaps"'), m('name', 'its name'), m('file', 'its file\'s name in its kind\'s folder'),
    m('bytes', 'its bytes: a .sid whole, sprites and a charset without a load address, a picture as bitmap, screen, colour RAM and background'), m('size', 'how many bytes'),
    m('load', 'the load address its file has, or null'), m('count', 'how many sprites or characters it has (else 1)'),
    m('mc', 'true when it is multicolour'), m('colors', 'the colours it is drawn in: { bg, fg, mc1, mc2 }, or null'),
    m('from', 'where it was taken from: { text, project, file, disk, start, end }, or null'), m('added', 'when it was added (ms, for new Date)'), m('hash', 'its bytes\' hash'), m('own', 'true for a file put in the folder by hand'),
    m('put', 'put(at): its bytes copied into mem (a SID and a charset with a load address where they load; a picture with put({ bitmap, screen, colorRam })); gives { start, end }', true),
    m('asFile', 'asFile(format): it as a file: the .sid, the sprites, the charset with its load address, the picture in a format', true),
    m('tune', 'a SID: { name, author, released, start, end, size, init, play, songs, song, rsid, bytes }'),
    m('sprite', 'sprites: sprite(i), one sprite\'s 64 bytes', true), m('char', 'a charset: char(i), one character\'s 8 bytes', true),
    m('bitmap', 'a picture: its 8000 bytes of bitmap'), m('screen', 'a picture: its 1000 bytes of screen'), m('colorRam', 'a picture: its 1000 bytes of colour RAM'), m('background', 'a picture: its background colour'),
  ],
  libFrom: [m('text', 'what its name says about where it is from'), m('project', 'the project'), m('file', 'the file the bytes were in'), m('disk', 'the disk or tape the file was on'), m('start', 'where the bytes were in memory'), m('end', 'the address after their last byte')],
  libColors: [m('bg', 'the background, a C64 colour 0-15'), m('fg', 'a set pixel (hires), or the pair 11'), m('mc1', 'the pair 01'), m('mc2', 'the pair 10')],
  sid: [
    m('tunes', 'the program\'s music blocks: a list of tunes (empty when it has none)'), m('tune', 'the first tune, or null'),
    m('at', 'at(address): the tune that covers an address, or null', true),
    m('parse', 'parse(file): a .sid file read: { name, author, released, start, end, size, init, play, songs, song, rsid, bytes }', true),
    m('make', 'make(bytes, { load, init, play, name, author, released, song, songs, rsid }): a .sid file of bytes', true),
    m('load', 'load(file, at): a .sid file\'s bytes copied into mem where they load (or at an address)', true),
    m('run', 'run({ init, play, song, a, x, y, frames }): a player run in a copy of mem: init, then play once a frame; gives what it wrote to the SID', true),
    m('player', 'player(tune, .sid file or { bytes, load, init, play }, { song, title }): the PRG that plays it in VICE', true),
    m('play', 'play(tune, .sid file or { bytes, load, init, play }, { song, in }): played when the run has ended well, in VICE or DeepSID', true),
    m('note', 'note(frequency, { ntsc }): a voice\'s frequency value as { name, octave, hz, cents }, or null for 0', true),
    m('voices', 'voices(registers): a dump\'s 25 registers read: the three voices, with volume, cutoff, resonance and filtered', true),
    m('noteTables', 'noteTables(): where note frequency tables are in mem: a list of { start, end }', true),
    m('musicPlayer', 'where music plays (Settings → Toolchain): "VICE" or "DeepSID"'), m('requests', 'what the script has asked to be played so far, a text each'),
  ],
  tune: [
    m('name', 'the block\'s label'), m('file', 'the program\'s file it is in'), m('start', 'the address of the block\'s first byte'), m('end', 'the address after its last byte'), m('size', 'how many bytes the block is'),
    m('bytes', 'the block\'s bytes'), m('init', 'the player\'s init routine'), m('play', 'the player\'s play routine (0: a sample player, nothing is called each frame)'),
    m('song', 'the song the program starts (0: the first)'), m('songs', 'how many songs its .sid says it has'), m('samples', 'a sample player\'s { nmi, hz }, else null'),
    m('why', 'what the analysis found it by, a text each'), m('score', 'how sure the analysis is'),
    m('plays', 'what it plays with in VICE, in DeepSID and as a .sid: { start, end, bytes, init, play, parts, routine, problem, alone }'),
    m('sid', 'sid({ name, author, released }): its .sid file, as the export writes it', true),
    m('player', 'player({ song, title }): the PRG that plays it in VICE: { prg, port, driver, screen, warnings }', true),
    m('run', 'run({ song, frames }): it run on its own: init, then play once a frame; gives what it wrote to the SID', true),
  ],
  tunePlays: [
    m('start', 'where the bytes that play go'), m('end', 'the address after their last byte'), m('bytes', 'the bytes that play: the block, and a routine of Mimir\'s next to it when it needs one'),
    m('init', 'what is called to start a song: the player\'s init, or Mimir\'s routine that calls it'), m('play', 'what is called each frame (0: nothing)'),
    m('parts', 'a sample player\'s bytes outside the block (its samples and song): a list of { start, end, bytes }'),
    m('routine', 'what Mimir\'s routine next to the block does, a text; null when init is the player\'s own'),
    m('problem', 'why it may not play as the program plays it, or null'), m('alone', 'why it does not play with only these bytes in memory, or null'),
  ],
  sidFile: [
    m('name', 'the tune\'s name'), m('author', 'its author'), m('released', 'the year and who released it'),
    m('start', 'where its bytes load'), m('end', 'the address after their last byte'), m('size', 'how many bytes'),
    m('init', 'its init routine'), m('play', 'its play routine (0: init starts the interrupts that play)'), m('songs', 'how many songs it has'), m('song', 'the song it starts with (0: the first)'),
    m('rsid', 'true for an RSID: it runs as on a real C64'), m('bytes', 'its bytes, without the header and the load address'),
  ],
  sidRun: [
    m('plays', 'true when it ran as music does: init and every play call returned, and the SID was written'), m('samples', 'true for a sample player\'s run (from its timer interrupt)'),
    m('init', 'true when init returned'), m('played', 'the play calls (frames) that returned'), m('frames', 'the frames asked for'), m('stop', 'why the run stopped early, or null'),
    m('registers', 'how many SID registers were written (a sample player: a list of { register, writes, values })'), m('notes', 'the notes started (a voice\'s gate switched on)'), m('heard', 'the notes started that can be heard'),
    m('dump', 'the SID\'s 25 registers after init (dump[0]) and after each play call: a list of bytes'),
    m('used', 'the bytes the player ran or read: a list of { start, end }'), m('ran', 'the bytes it ran as code: a list of { start, end }'),
    m('initCycles', 'the cycles init took'), m('maxCycles', 'the most cycles one play call took'), m('hz', 'a sample player: samples a second'),
  ],
  sidPlayer: [
    m('prg', 'the PRG that plays the tune when it is run: start it with build.start(prg) or save it'), m('port', 'the processor port ($01) while it plays'),
    m('driver', 'where the player\'s own code runs: { start, end }'), m('screen', 'true when its screen shows the addresses and the song'), m('warnings', 'what may not play as on the C64 the program ran on, a text each'),
  ],
  voices: [...LIST, m('volume', 'the volume, 0-15'), m('cutoff', 'the filter\'s cutoff, 0-2047'), m('resonance', 'the filter\'s resonance, 0-15'), m('filtered', 'which voices go through the filter: true or false for each')],
  voice: [
    m('note', 'the note its frequency is, such as "A-4" ("---" for 0)'), m('frequency', 'its frequency value (registers 0 and 1)'), m('pulse', 'its pulse width, 0-4095'),
    m('wave', 'its waveform: "triangle", "sawtooth", "pulse", "noise", or several with +'), m('gate', 'true while its note is held'), m('control', 'its control register'),
    m('attack', 'attack, 0-15'), m('decay', 'decay, 0-15'), m('sustain', 'sustain, 0-15'), m('release', 'release, 0-15'),
  ],
  sidNote: [m('name', 'the note, such as "A-4"'), m('octave', 'its octave'), m('hz', 'the frequency in Hz'), m('cents', 'how far from the note it is, in cents')],
  build: [
    m('last', 'the last build, or null before one: { ok, fresh, by, files, log }'),
    m('verify', 'verify(): the round-trip check when the run has ended well, as F7', true),
    m('run', 'run({ debugger }): Build & Run when the run has ended well, as F5 (debugger: true as Shift+F5)', true),
    m('start', 'start(prg, { name, start, debugger }): a PRG of the script\'s own started in the emulator: RUN, or SYS at start', true),
    m('requests', 'what the script has asked for so far, a text each'),
    m('assembler', 'the assembler the project builds with: "kickass" or "64tass"'), m('emulator', 'the emulator Build & Run starts'), m('debugger', 'the debugger Build & Run in a debugger starts'),
  ],
  lastBuild: [
    m('ok', 'true when every file came out byte for byte'), m('fresh', 'true when it is of the project as it is now'), m('by', 'what built it: "built-in" (Verify) or the assembler'),
    m('files', 'the built files: a list of { name, source, ok, same, total, start, end, bytes, prg, errors }'), m('log', 'the build log, a text'),
  ],
  builtFile: [
    m('name', 'the built file\'s name'), m('source', 'the source it was built from'), m('ok', 'true when it came out byte for byte'),
    m('same', 'how many of its bytes are as in the original'), m('total', 'how many bytes were compared'),
    m('start', 'where it loads (null when it did not assemble)'), m('end', 'the address after its last byte'),
    m('bytes', 'its bytes, without the load address'), m('prg', 'it as a PRG, its load address first'), m('errors', 'what the assembler said, a text each'),
  ],
  builtFiles: LIST,
  exporter: [
    m('files', 'every file the export writes: a list of { name, kind, size, text, bytes }'), m('names', 'the names of the export\'s files'),
    m('sources', 'the names of the sources, in the order they are built'), m('main', 'the name of the first source'),
    m('read', 'read("name"): a file\'s text (a binary\'s bytes)', true), m('has', 'has("name"): whether the export has a file', true),
    m('add', 'add("name", content): a file added, or put in place of one: a text or bytes', true),
    m('edit', 'edit("name", text => …): a text file changed: the function gets the text and gives the new one', true),
    m('replace', 'replace("name", from, to): every place a text (or a regular expression) is found in a text file, replaced; gives how many', true),
    m('remove', 'remove("name"): a file left out of the export', true), m('rename', 'rename("from", "to"): a file under another name', true),
    m('write', 'write({ elsewhere }): the export written when the run has ended well, verified first; elsewhere: true asks for the folder', true),
    m('changes', 'what the script has done to the export so far: { added, changed, removed }'),
    m('name', 'the project\'s name'), m('assembler', 'the assembler the sources are for: "kickass" or "64tass"'),
    m('folder', 'where the export goes (the project\'s source folder, else the last one); null when a folder will be asked for'), m('outDir', 'the folder of the built PRGs in the export'),
  ],
  exportFile: [
    m('name', 'the file\'s name in the export\'s folder (folders with /)'), m('kind', 'what it is: "source", "script", "text" or "binary"'), m('size', 'its size in bytes'),
    m('text', 'its text; null for a binary'), m('bytes', 'its bytes'),
  ],
  exportChanges: [m('added', 'the names of the files the script added'), m('changed', 'the names of the export\'s files it changed'), m('removed', 'the names of the files it left out')],
  exportFiles: LIST,
  loader: [
    m('name', 'which loader: "Spindle", "Sparkle", "Krill\'s loader", "Tape", …'), m('disk', 'the name of the disk image or tape it is on'),
    m('files', 'every file the loader loads, in the order they load: a list of { name, group, index, start, end, size, bytes, prg }'),
    m('groups', 'what one call of the loader loads together (a job, a bundle, a part; else a file each): a list of { name, what, files, start, end, size }'),
    m('find', 'find("name" or number): a file by its name (with or without its extension) or its number; null when there is none', true),
    m('group', 'group("name" or number): a group by its name or its number; null when there is none', true),
    m('load', 'load(file or group, at): its bytes copied into mem where it loads (a file elsewhere with at); gives { start, end }', true),
    m('at', 'at(address): the files that cover an address when they are loaded', true),
    m('script', 'the loader script as the tab writes it, one text'), m('lines', 'the loader script, a line each'),
  ],
  loaderGroup: [
    m('name', 'the group\'s name: "job03", "bundle01", a file\'s name'), m('what', 'what it is, in words'), m('files', 'its files: a list of { name, start, end, size, bytes, prg }'),
    m('start', 'the lowest address its files load at'), m('end', 'the address after the highest byte they load'), m('size', 'its files\' bytes together'),
  ],
  loaderFile: [
    m('name', 'the file\'s name, as the loader tab names it'), m('group', 'the name of the group it is in'), m('index', 'its number in loader.files'),
    m('start', 'where it loads'), m('end', 'the address after its last byte'), m('size', 'how many bytes'),
    m('bytes', 'its bytes, without a load address (unpacked where the tab unpacks it)'), m('prg', 'it as a PRG, its load address first'),
  ],
  loaders: LIST, loaderGroups: LIST, loaderFiles: LIST,
  brokkr: [
    m('pack', 'pack(prg, { format, start, effect, effort, port, irq }): a PRG (the program\'s first file when none is given) as a file that unpacks itself; gives { prg, bytes, load, end, size, from, saved, format, entry, … }', true),
    m('crunch', 'crunch(bytes, { format, backward, effort }): a bare stream of the bytes; gives { bytes, size, from, saved, format }', true),
    m('decrunch', 'decrunch(stream, { format, backward }): the bytes of a bare stream again', true),
    m('mem', 'mem(bytes, start, { format, forward, load, effort }): a stream with the data\'s address, loaded where it decrunches in place; gives { bytes, start, end, inPlace, size, … }', true),
    m('decruncher', 'decruncher({ format, zp, at }): the 6510 source (Kick Assembler) of the routine that decrunches a mem file', true),
    m('formats', 'the formats: "exomizer" (Exomizer 3\'s), "brokkr" (smaller, slower to unpack) and "fast" (a little larger, quick)'),
  ],
  packed: [
    m('prg', 'the packed file as a PRG, its load address first'), m('bytes', 'the packed file\'s bytes, without the load address'),
    m('load', 'where the packed file loads ($0801)'), m('end', 'the address after its last byte'),
    m('size', 'the packed file\'s size in bytes, with its load address'), m('from', 'the size of the file it was made from'), m('saved', 'how much smaller it is, in per cent'),
    m('format', 'the format it is in: "exomizer", "brokkr" or "fast"'), m('entry', 'where the program starts when it is unpacked'), m('basic', 'true when the program starts with RUN'),
    m('port', 'the value of $01 the program starts with'), m('cycles', 'the cycles the C64 takes to unpack it'), m('seconds', 'the seconds a PAL C64 takes to unpack it'),
    m('areas', 'where everything is while it unpacks: a list of { name, start, end }'), m('warnings', 'what Brokkr warns of, a text each'),
  ],
  crunched: [
    m('bytes', 'the stream'), m('size', 'its size in bytes'), m('from', 'the size of the bytes it was made from'), m('saved', 'how much smaller it is, in per cent'), m('format', 'the format it is in'),
  ],
  memFile: [
    m('bytes', 'the file: its load address first, unless load was "none"'), m('start', 'where the file lies when it is loaded (null without a load address)'), m('end', 'the address after its last byte there'),
    m('inPlace', 'where it decrunches in place: { start, end }'), m('size', 'the file\'s size in bytes'), m('from', 'the size of the bytes it was made from'),
    m('saved', 'how much smaller it is, in per cent'), m('format', 'the format it is in'), m('warnings', 'what Brokkr warns of, a text each'),
  ],
  area: [m('name', 'what is there: "Crunched data", "Decruncher", …'), m('start', 'its first address'), m('end', 'the address after its last')],
  areas: LIST,
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
    m('border', 'the border\'s colour: 0-15 or a name, read and set (also mem[0xd020])'), m('background', 'the background\'s colour: 0-15 or a name, read and set (also mem[0xd021])'),
    m('reverse', 'RVS ON: true or false'), m('lower', 'the lower case character set: true or false'),
    m('cols', 'how many columns it has (40; more in extended mode)'), m('rows', 'how many rows it has (25; more in extended mode)'),
    m('col', 'the cursor\'s column, read and set'), m('row', 'the cursor\'s row, read and set'),
    m('codes', 'every cell\'s screen code, a row after another (cols bytes a row); the top left 40×25 are also mem at $0400'), m('colors', 'every cell\'s colour, a row after another; the top left 40×25 are also mem at $d800'),
  ],
  ran: [m('reason', 'why it stopped: "until" (it got to the address), "cycles" or "jam"'), m('pc', 'where it is'), m('cycles', 'the cycles this run took')],
};

/** what one of a list is */
const ELEMENT: Partial<Record<JsType, JsType>> = { diskFiles: 'diskFile', files: 'file', layers: 'layer', ranges: 'file', texts: 'text', areas: 'area', loaders: 'loader', loaderGroups: 'loaderGroup', loaderFiles: 'loaderFile', exportFiles: 'exportFile', builtFiles: 'builtFile', libItems: 'libItem', tapeEntries: 'tapeEntry', diskEntries: 'diskEntry', scriptList: 'scriptOne', scriptSettings: 'scriptSetting', scriptPads: 'file', scriptTemplates: 'scriptTemplate', snapSprites: 'snapSprite', snapModules: 'snapModule', blockList: 'block', structFields: 'structField', customTypes: 'customType', tunes: 'tune', dump: 'bytes', voices: 'voice' };
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
  if (e === 'brokkr') return 'brokkr';
  if (e === 'loader') return 'loader';
  if (e === 'exporter') return 'exporter';
  if (e === 'build') return 'build';
  if (e === 'sid') return 'sid';
  if (e === 'library') return 'library';
  if (e === 'blocks') return 'blocks';
  if (e === 'snapshot') return 'snapshot';
  if (e === 'scripts') return 'scripts';
  if (e === 'disks') return 'disks';
  if (e === 'tapes') return 'tapes';
  if (e === 'loaders') return 'loaders';
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
    if (on === 'exporter') return name === 'write' ? 'texts' : null;
    if (on === 'sid') return name === 'at' ? 'tune' : name === 'parse' || name === 'load' ? 'sidFile' : name === 'make' ? 'bytes' : name === 'run' ? 'sidRun' : name === 'player' ? 'sidPlayer' : name === 'note' ? 'sidNote' : name === 'voices' ? 'voices' : name === 'noteTables' ? 'ranges' : null;
    if (on === 'library') return name === 'find' || name === 'same' ? 'libItem' : name === 'search' ? 'libItems' : null;
    if (on === 'libItem') return name === 'asFile' || name === 'sprite' || name === 'char' ? 'bytes' : name === 'put' ? 'file' : null;
    if (on === 'blocks') return name === 'at' || name === 'find' ? 'block' : name === 'in' || name === 'of' ? 'blockList' : name === 'struct' ? 'struct' : name === 'define' ? 'customType' : name === 'text' ? 'text' : name === 'encode' ? 'bytes' : name === 'mark' ? 'file' : null;
    if (on === 'block') return name === 'mark' || name === 'format' ? 'file' : null;
    if (on === 'snapshot') return name === 'module' || name === 'file' ? 'bytes' : name === 'write' ? 'texts' : null;
    if (on === 'scripts') return name === 'find' ? 'scriptOne' : null;
    if (on === 'disks') return name === 'create' || name === 'open' ? 'diskImage' : null;
    if (on === 'tapes') return name === 'create' || name === 'open' ? 'tapeImage' : null;
    if (on === 'tapeImage') return name === 'read' || name === 'prg' || name === 'file' ? 'bytes' : name === 'find' || name === 'add' ? 'tapeEntry' : name === 'toT64' || name === 'toTap' ? 'tapeImage' : name === 'list' ? 'texts' : name === 'save' ? 'text' : null;
    if (on === 'diskImage') return name === 'read' || name === 'sector' || name === 'file' ? 'bytes' : name === 'find' || name === 'add' ? 'diskEntry' : name === 'list' || name === 'validate' ? 'texts' : name === 'save' ? 'text' : name === 'chain' ? 'list' : null;
    if (on === 'scriptOne') return name === 'withSettings' || name === 'setting' ? 'text' : null;
    if (on === 'struct' || on === 'customType') return name === 'mark' || name === 'markRecords' ? 'file' : null;
    if (on === 'tune') return name === 'sid' ? 'bytes' : name === 'run' ? 'sidRun' : name === 'player' ? 'sidPlayer' : null;
    if (on === 'loader') return name === 'find' ? 'loaderFile' : name === 'group' ? 'loaderGroup' : name === 'load' ? 'file' : name === 'at' ? 'loaderFiles' : null;
    if (on === 'brokkr') return name === 'pack' ? 'packed' : name === 'crunch' ? 'crunched' : name === 'mem' ? 'memFile' : name === 'decrunch' ? 'bytes' : name === 'decruncher' ? 'text' : null;
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
  if (on === 'brokkr') return name === 'formats' ? 'texts' : null;
  if (on === 'build') return name === 'last' ? 'lastBuild' : name === 'requests' ? 'texts' : name === 'assembler' || name === 'emulator' || name === 'debugger' ? 'text' : null;
  if (on === 'library') return name === 'items' || name === 'sids' || name === 'sprites' || name === 'chars' || name === 'bitmaps' ? 'libItems' : name === 'requests' ? 'texts' : name === 'folder' ? 'text' : null;
  if (on === 'libItem') return name === 'bytes' || name === 'bitmap' || name === 'screen' || name === 'colorRam' ? 'bytes' : name === 'tune' ? 'sidFile' : name === 'from' ? 'libFrom' : name === 'colors' ? 'libColors' : name === 'name' || name === 'file' || name === 'kind' || name === 'hash' ? 'text' : null;
  if (on === 'tapes') return name === 'mounted' ? 'tapeImage' : name === 'kinds' ? 'texts' : null;
  if (on === 'tapeImage') return name === 'files' ? 'tapeEntries' : name === 'bytes' ? 'bytes' : name === 'unknown' ? 'list' : name === 'name' || name === 'kind' ? 'text' : null;
  if (on === 'tapeEntry') return name === 'name' || name === 'format' || name === 'type' ? 'text' : name === 'errors' ? 'texts' : null;
  if (on === 'disks') return name === 'mounted' ? 'diskImage' : name === 'kinds' ? 'texts' : null;
  if (on === 'diskImage') return name === 'files' ? 'diskEntries' : name === 'bytes' ? 'bytes' : name === 'name' || name === 'id' || name === 'kind' || name === 'dosType' ? 'text' : null;
  if (on === 'diskEntry') return name === 'name' || name === 'type' ? 'text' : null;
  if (on === 'scripts') return name === 'all' || name === 'library' ? 'scriptList' : name === 'self' ? 'scriptOne' : name === 'templates' ? 'scriptTemplates' : name === 'names' || name === 'requests' ? 'texts' : null;
  if (on === 'scriptOne') return name === 'settings' ? 'scriptSettings' : name === 'pads' ? 'scriptPads' : name === 'name' || name === 'code' || name === 'lang' || name === 'source' || name === 'when' || name === 'key' ? 'text' : null;
  if (on === 'scriptTemplate') return name === 'settings' ? 'scriptSettings' : name === 'safe' || name === 'lines' ? null : 'text';
  if (on === 'scriptSetting') return name === 'line' ? null : 'text';
  if (on === 'snapshot') return name === 'cpu' ? 'snapCpu' : name === 'port' ? 'snapPort' : name === 'ram' ? 'bytes' : name === 'cia1' || name === 'cia2' ? 'snapCia' : name === 'sid' ? 'snapSid' : name === 'vic' ? 'snapVic' : name === 'drive' ? 'snapDrive'
    : name === 'modules' ? 'snapModules' : name === 'changes' ? 'texts' : name === 'name' || name === 'machine' || name === 'vice' || name === 'format' ? 'text' : null;
  if (on === 'snapVic') return name === 'regs' || name === 'colorRam' ? 'bytes' : name === 'sprites' ? 'snapSprites' : name === 'mode' ? 'text' : null;
  if (on === 'snapDrive') return name === 'cpu' ? 'snapCpu' : name === 'ram' ? 'bytes' : name === 'via1' || name === 'via2' ? 'snapVia' : name === 'model' ? 'text' : null;
  if (on === 'snapCia') return name === 'tod' ? 'bytes' : null;
  if (on === 'snapSid') return name === 'regs' ? 'bytes' : null;
  if (on === 'snapCpu') return name === 'flags' ? 'text' : null;
  if (on === 'snapModule') return name === 'name' || name === 'version' ? 'text' : null;
  if (on === 'blocks') return name === 'all' ? 'blockList' : name === 'types' ? 'texts' : name === 'defined' ? 'customTypes' : null;
  if (on === 'block') return name === 'bytes' ? 'bytes' : name === 'struct' ? 'struct' : name === 'next' || name === 'prev' ? 'block' : name === 'records' || name === 'words' ? 'list' : name === 'type' || name === 'as' || name === 'label' || name === 'comment' || name === 'file' || name === 'why' || name === 'custom' || name === 'text' ? 'text' : name === 'colors' ? 'libColors' : null;
  if (on === 'struct') return name === 'fields' ? 'structFields' : name === 'name' || name === 'text' ? 'text' : null;
  if (on === 'structField') return name === 'name' || name === 'type' || name === 'text' ? 'text' : null;
  if (on === 'customType') return name === 'struct' ? 'struct' : name === 'name' || name === 'as' ? 'text' : null;
  if (on === 'libFrom') return name === 'start' || name === 'end' ? null : 'text';
  if (on === 'sid') return name === 'tunes' ? 'tunes' : name === 'tune' ? 'tune' : name === 'requests' ? 'texts' : name === 'musicPlayer' ? 'text' : null;
  if (on === 'tune') return name === 'plays' ? 'tunePlays' : name === 'bytes' ? 'bytes' : name === 'why' ? 'texts' : name === 'name' || name === 'file' ? 'text' : null;
  if (on === 'tunePlays') return name === 'bytes' ? 'bytes' : name === 'routine' || name === 'problem' || name === 'alone' ? 'text' : null;
  if (on === 'sidFile') return name === 'bytes' ? 'bytes' : name === 'name' || name === 'author' || name === 'released' ? 'text' : null;
  if (on === 'sidRun') return name === 'dump' ? 'dump' : name === 'used' || name === 'ran' ? 'ranges' : name === 'stop' ? 'text' : null;
  if (on === 'sidPlayer') return name === 'prg' ? 'bytes' : name === 'warnings' ? 'texts' : name === 'driver' ? 'file' : null;
  if (on === 'voice') return name === 'note' || name === 'wave' ? 'text' : null;
  if (on === 'sidNote') return name === 'name' ? 'text' : null;
  if (on === 'lastBuild') return name === 'files' ? 'builtFiles' : name === 'log' || name === 'by' ? 'text' : null;
  if (on === 'builtFile') return name === 'bytes' || name === 'prg' ? 'bytes' : name === 'errors' ? 'texts' : name === 'name' || name === 'source' ? 'text' : null;
  if (on === 'exporter') return name === 'files' ? 'exportFiles' : name === 'names' || name === 'sources' ? 'texts' : name === 'changes' ? 'exportChanges' : name === 'name' || name === 'assembler' || name === 'main' || name === 'outDir' ? 'text' : null;
  if (on === 'exportFile') return name === 'bytes' ? 'bytes' : name === 'name' || name === 'kind' || name === 'text' ? 'text' : null;
  if (on === 'exportChanges') return 'texts';
  if (on === 'loader') return name === 'files' ? 'loaderFiles' : name === 'groups' ? 'loaderGroups' : name === 'lines' ? 'texts' : name === 'name' || name === 'disk' || name === 'script' ? 'text' : null;
  if (on === 'loaderGroup') return name === 'files' ? 'loaderFiles' : name === 'name' || name === 'what' ? 'text' : null;
  if (on === 'loaderFile') return name === 'bytes' || name === 'prg' ? 'bytes' : name === 'name' || name === 'group' ? 'text' : null;
  if (on === 'packed') return name === 'prg' || name === 'bytes' ? 'bytes' : name === 'areas' ? 'areas' : name === 'warnings' ? 'texts' : name === 'format' ? 'text' : null;
  if (on === 'crunched') return name === 'bytes' ? 'bytes' : name === 'format' ? 'text' : null;
  if (on === 'memFile') return name === 'bytes' ? 'bytes' : name === 'inPlace' ? 'file' : name === 'warnings' ? 'texts' : name === 'format' ? 'text' : null;
  if (on === 'area') return name === 'name' ? 'text' : null;
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
