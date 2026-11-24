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
  libItems: LIST,
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
const ELEMENT: Partial<Record<JsType, JsType>> = { diskFiles: 'diskFile', files: 'file', layers: 'layer', ranges: 'file', texts: 'text', areas: 'area', loaders: 'loader', loaderGroups: 'loaderGroup', loaderFiles: 'loaderFile', exportFiles: 'exportFile', builtFiles: 'builtFile', libItems: 'libItem', tunes: 'tune', dump: 'bytes', voices: 'voice' };
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
