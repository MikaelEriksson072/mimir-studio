/* Sindri: it starts a C64 (or the stand-ins), loads the packed PRG, types RUN, and follows the program as
 * it peels off its layers.
 *
 * A layer begins when the CPU jumps (JMP, JSR, RTS, RTI, BRK or an interrupt) into code that the running layer
 * wrote and has not run yet: a depacker that copied itself to $0100, the program it decrunched, the code a decoder
 * decrypted. Jumping into BASIC's RUN counts too, but not a BASIC program going on with itself (an extension's command
 * ending in NEWSTT, RUN again). Memory is copied at each layer's start, with the bytes that belong to the program it
 * starts; when it ends, the parts of earlier programs that it still ran join them (a trackmo's music and loader).
 * Layers begun inside a subroutine call or an interrupt that then returns to where it was called from were
 * temporary (a depacker called with JSR, generated speedcode, a new IRQ handler): they join the layer that made the
 * call again.
 *
 * The run stops when the newest layer settles (writes no new memory for a while), loads a file, returns to BASIC,
 * crashes or runs out of time. With a disk, a 1541 is on the serial bus and loading goes on: the KERNAL's and fast
 * loaders' alike. With a tape, the datasette plays it from where the file ended: the program's own tape loader reads
 * it, and the KERNAL's LOAD from the tape reads on from there (a T64's files only LOAD reads). Then the newest layer is
 * the unpacked program. An intro that waits before anything was unpacked gets keys pressed (space and fire first). */
import { BASIC, BOOT, C64, KERNAL, LOADED, ZP, type MachineState, type Roms } from './c64.ts';
import { OP_IRQ, OP_NMI } from './cpu.ts';
import { LEN } from './opcodes.ts';
import { initStandIn, KERNAL_VECTORS, standInRoms } from './standin.ts';
import { activity, fingerprintId, identify, strings, type Activity, type Kind, type Range } from './analyze.ts';
import { buildPrg, contentMask, keptParts, loadedParts, saveRange, type KeptPart } from './output.ts';
import { Drive, type DriveState } from './drive.ts';
import { d64ToDisk } from './gcr.ts';
import { g64ToD64, g64ToDisk, isG64 } from './g64.ts';
import { d64NameOf } from './d64.ts';
import { Datasette, isT64, t64Files, tapeFiles, tapeNameMatches, tapPulses, type TapeFile } from './tape.ts';
import { basicLines, evaluate, findSys, listLine, statements, T } from './basic.ts';

export interface UnpackOptions {
  /** the C64 ROMs; without them the stand-ins run (fine for most packers, but not for BASIC programs) */
  roms?: Roms | null;
  /**
   * the disk the file came from (a D64 or G64 image): with the 1541 DOS ROM in `roms` a 1541 with this disk is on
   * the serial bus, so the program can load more files and run its fast loader (a G64 with its copy protection)
   */
  disk?: Uint8Array | null;
  /**
   * the tape the file came from (a TAP image): it is in the datasette with PLAY held down, wound to where the file
   * ended, so the program's own loader reads on from there, and LOAD from the tape loads the next file. A T64 tape
   * archive: LOAD from the tape loads its files (it has no pulses for a loader of the program's own)
   */
  tape?: Uint8Array | null;
  /** where the tape stands when the program starts (a pulse; a T64: a directory slot); by default after the KERNAL
   *  file that holds the file's bytes at its address (its header is in the tape buffer then, as LOAD left it), else at
   *  the start */
  tapeAt?: number;
  /**
   * go on from this machine instead of loading the file and starting it: a VICE snapshot's (vsfMachine), whose RAM the
   * file then holds (from $0200, say). Everything in RAM counts as loaded, and the program goes on where it was; the
   * ROMs are needed
   */
  resume?: MachineState;
  /** start the program here (SYS) instead of RUN */
  entry?: number;
  /**
   * with `entry`: $01 as the program starts there, set right before the jump (a program Sindri saved can start under
   * the BASIC ROM with $01 = $36); by default as at READY, $37
   */
  port?: number;
  /** load the file here instead of at its own load address */
  load?: number;
  /** give up after this many cycles of the program (default 400 million, about 7 minutes of C64 time) */
  maxCycles?: number;
  /** a layer has settled when it writes no new memory for this many cycles (default 1.5 million) */
  settleCycles?: number;
  /** press keys and fire when an intro waits before anything is unpacked (default true) */
  keys?: boolean;
  /** press keys whenever a layer waits, and keep going (past intros after the decrunching) */
  deep?: boolean;
  /** save this layer instead of the newest */
  layer?: number;
  /** clear the bytes in the saved range that are not part of the program (leftovers) */
  clean?: boolean;
  /** a line for every layer and every key press */
  trace?: (line: string) => void;
  /** called before every instruction once the program has started (slow; for looking into a packer) */
  onStep?: (pc: number, c64: C64) => void;
}

export type Via = 'start' | 'jmp' | 'jsr' | 'rts' | 'rti' | 'brk' | 'irq' | 'nmi';

export type StopReason =
  | 'settled' | 'ready' | 'load' | 'save' | 'jam' | 'needs-rom' | 'budget' | 'reset' | 'brk' | 'not-started';

export interface LayerReport {
  index: number;
  /** where it starts */
  entry: number;
  /** how it was entered, and from where */
  via: Via;
  from: number | null;
  /** the C64 time it started, in cycles after the program started */
  cycle: number;
  /** it is a BASIC program started with RUN (entry is then the BASIC routine jumped to) */
  basic: boolean;
  kind: Kind;
  code: Range[];
  instructions: number;
  written: Range[];
  writtenBytes: number;
  read: Range[];
  readBytes: number;
  /** code it wrote and called as a subroutine or interrupt handler */
  calls: { entry: number; via: Via }[];
  /** the fingerprint of its code, and the packer it matches */
  fingerprint: string;
  opcodes: string;
  packer: { name: string; similarity: number } | null;
  /** readable text in and around its code */
  text: string[];
  /** what it printed with CHROUT */
  printed: string;
  /** the keys pressed while it ran */
  presses: string[];
  /** the range that would be saved for it */
  range: Range | null;
  /**
   * parts of earlier layers' programs (layer 0: the loaded file) that it ran while they still held what they held
   * then, such as the music and the loader a trackmo's earlier part loaded: they are saved with it
   */
  kept: (Range & { layer: number })[];
  /**
   * with a disk: parts it loaded after it started and then ran, such as the parts and the music a trackmo's framework
   * loads and calls; they are saved with it as they were when it ended (the run stopped, or the next layer started)
   */
  loaded: Range[];
}

export interface Saved {
  layer: number;
  /** the PRG, load address first */
  prg: Uint8Array;
  start: number;
  end: number;
  /** where to start it: the SYS address (for a BASIC program the first line's SYS, else its start) */
  entry: number;
  /** started with RUN */
  basic: boolean;
  /** $01 as the program found it */
  port: number;
  /** interrupts were on (the I flag clear) */
  interrupts: boolean;
}

export interface UnpackResult {
  /** a layer was peeled off */
  unpacked: boolean;
  stop: { reason: StopReason; pc: number; detail: string; cycle: number };
  /** the layers in order: 0 is the loaded program */
  layers: LayerReport[];
  /** the saved layer (the newest, or options.layer) */
  saved: Saved | null;
  /** build the PRG of another layer */
  save(layer: number, clean?: boolean): Saved | null;
  /** the loaded file's BASIC lines, when it has some */
  basic: string[];
  roms: string;
  /** the 1541 on the serial bus and its disk, or why there was none; null without a disk */
  drive: string | null;
  /** the datasette and its tape: where it stood and how far it played; null without a tape */
  tape: string | null;
  /** emulated cycles from the program's start */
  cycles: number;
  ms: number;
  /** per address, what the run did with the loaded file's byte while it still held what was loaded: `FILE_RAN`,
   *  `FILE_ARG`, `FILE_READ`, and `FILE_WRITTEN` when it was written later (what came after is not of that byte) */
  fileUse: Uint8Array;
}

/** `UnpackResult.fileUse`: executed as an opcode, executed as an operand, read as data, written after the load */
export const FILE_RAN = 1, FILE_ARG = 2, FILE_READ = 4, FILE_WRITTEN = 8;

/** What the run did with each byte as it was loaded: what it did before the byte's first write. */
function fileUse(m: C64): Uint8Array {
  const out = new Uint8Array(0x10000);
  for (let a = 0; a < 0x10000; a++) {
    const w = m.firstWrite[a] || 0xffffffff;
    // (an instruction that writes a byte it ran or read did so first: the same count is before)
    out[a] = (m.firstOp[a] && m.firstOp[a] <= w ? FILE_RAN : 0) | (m.firstArg[a] && m.firstArg[a] <= w ? FILE_ARG : 0)
      | (m.firstRead[a] && m.firstRead[a] <= w ? FILE_READ : 0) | (m.firstWrite[a] ? FILE_WRITTEN : 0);
  }
  return out;
}

interface Snapshot { ram: Uint8Array; port: number; a: number; x: number; y: number; s: number; p: number }
interface Trap { rom: number; run: () => boolean }
/** LOAD typed at the READY prompt, file loaded, RUN typed (the stand-ins start in 'run') */
type Phase = 'load' | 'loaded' | 'run';

class Layer {
  id: number;
  parent: Layer | null;
  entry: number;
  via: Via;
  from: number | null;
  cycle: number;
  icount: number;
  basic = false;
  snapshot: Snapshot;
  /** the bytes that belong to the program it starts (null for the loaded file) */
  mask: Uint8Array | null = null;
  /** the mask with the parts of earlier programs it ran and the parts it loaded and ran (set when it ends), and those
   *  parts */
  live: Uint8Array | null = null;
  kept: KeptPart[] = [];
  loaded: Range[] = [];
  /** memory to save from: the snapshot, with the parts it loaded as they were when it ended (null when it has none) */
  image: Uint8Array | null = null;
  /** the drive's bus changes when it started (Drive.busChanges) */
  driveBus = 0;
  activity: Activity | null = null;
  calls: { entry: number; via: Via }[] = [];
  printed = '';
  presses: string[] = [];
  constructor(id: number, parent: Layer | null, entry: number, via: Via, from: number | null, cycle: number, icount: number, snapshot: Snapshot) {
    this.id = id; this.parent = parent; this.entry = entry; this.via = via; this.from = from;
    this.cycle = cycle; this.icount = icount; this.snapshot = snapshot;
  }
}

/** BASIC's ways into RUN and READY: a depacker jumping here starts a BASIC program */
const BASIC_ENTRIES = [0xa7ae, 0xa871, 0xa659, 0xa660, 0xa68e, 0xa533, 0xa474, 0xa480, 0xa483, 0xe37b, 0xe386];
/** those that go on with the program in memory (NEWSTT, RUN, CLR, LINKPRG) rather than to the READY prompt */
const RUN_ENTRIES = new Set([0xa7ae, 0xa871, 0xa659, 0xa660, 0xa68e, 0xa533]);
const TRANSFER = new Uint8Array(0x102);
for (const op of [0x4c, 0x6c, 0x20, 0x60, 0x40, 0x00, OP_IRQ, OP_NMI]) TRANSFER[op] = 1;
const VIA: Record<number, Via> = { 0x4c: 'jmp', 0x6c: 'jmp', 0x20: 'jsr', 0x60: 'rts', 0x40: 'rti', 0x00: 'brk', [OP_IRQ]: 'irq', [OP_NMI]: 'nmi' };

/** the keys tried, in turn, on an intro that waits: [matrix column, row] */
const PRESSES: { name: string; keys: [number, number][]; joy: number; petscii: number }[] = [
  { name: 'space + fire', keys: [[7, 4]], joy: 0x10, petscii: 0x20 },
  { name: 'return', keys: [[0, 1]], joy: 0, petscii: 0x0d },
  { name: 'n', keys: [[4, 7]], joy: 0, petscii: 0x4e },
  { name: 'f1', keys: [[0, 4]], joy: 0, petscii: 0x85 },
  { name: 'y', keys: [[3, 1]], joy: 0, petscii: 0x59 },
  { name: 'f7', keys: [[0, 3]], joy: 0, petscii: 0x88 },
  { name: '1', keys: [[7, 0]], joy: 0, petscii: 0x31 },
];
/** keys pressed at most, and one more for every key the program took as an answer (up to MAX_ANSWERS) */
const MAX_PRESSES = 24;
const MAX_ANSWERS = 32;
/** a press the program took as an answer wrote this many fresh bytes at least (a short line of text): a trainer menu
 *  that asks one question after another puts the next one up */
const ANSWER_FRESH = 8;
const HOLD = 100_000;
const CHECK = 4096;
const CALLS = 1024;
/** the stand-in SYS pushes this, so RTS lands on the trap at $e147 */
const SYS_RETURN = 0xe146;
/** where the KERNAL's screen editor waits for a key at the READY prompt (with none in the buffer) */
const READY_WAITS = 0xe5cd;

const hex4 = (v: number) => '$' + v.toString(16).padStart(4, '0');

/**
 * The C64 at the READY prompt after it started up, and the 1541 after it started up (by its ROM: it has long been on
 * when a real C64 loads the file), per set of ROMs. Each is booted once, in a machine of its own, and every run
 * starts from the saved states, the first one in the process too. A run that went on from a boot of its own would
 * keep what a saved state leaves out (the instruction count, which sets when Sindri checks the run; how far the
 * motor turned in the drive's start-up), and its drive would run through the C64's start-up, with the C64's reset
 * holding the serial lines low: the same disk could unpack differently in the first run and in later ones.
 */
const bootCache = new Map<string, MachineState | null>();
const driveCache = new Map<string, DriveState>();
const DRIVE_BOOT = 2_500_000;
/** a C64 that does not get to the READY prompt in this many cycles does not start (20 s) */
const BOOT_CYCLES = 20_000_000;
/** a program waiting while the drive's motor runs is loading, not settled: for this long at most (10 s) */
const DRIVE_PATIENCE = 10_000_000;
/** a layer loaded from the disk when the drive changed its DATA or CLK line this often while it ran (a sector is
 * thousands; the end of a transfer that began before it, a few) */
const LOADS = 256;
/** a program waiting while the tape plays is loading, not settled, until the tape ends; then for this long (5 s) */
const TAPE_END_PATIENCE = 5_000_000;

/** Unpack a PRG (load address first). */
export function unpack(file: Uint8Array, options: UnpackOptions = {}): UnpackResult {
  return new Session(file, options).run();
}

class Session {
  readonly m: C64;
  readonly real: boolean;
  readonly o: UnpackOptions;
  /** the layer that last executed each instruction start */
  readonly eid = new Int32Array(0x10000).fill(-3);
  /** the newest layer whose program held each byte when it started (0: the loaded file), -1 for none */
  private readonly owner = new Int32Array(0x10000).fill(-1);
  /** when BASIC last went on from each byte of program text (NEWSTT at the end of a statement, RUN at the start) */
  private readonly basicRan = new Uint32Array(0x10000);
  private readonly special = new Uint8Array(0x10000);
  private readonly traps = new Map<number, Trap>();
  private readonly loadAt: number;
  private readonly data: Uint8Array;
  private readonly file: Uint8Array;
  private maxCycles: number;
  private readonly settleCycles: number;
  /** the drive's bus changes when the last progress window began */
  private windowBus = 0;

  layers: Layer[] = [];
  private cur: Layer | null = null;
  private curId = BOOT;
  private nextId = 0;
  private started = false;
  /** the open subroutine calls and interrupts: stack pointer, return address, layers when called */
  private readonly callSp = new Int16Array(CALLS);
  private readonly callRet = new Int32Array(CALLS);
  private readonly callLayers = new Int32Array(CALLS);
  private calls = 0;
  /** the stack pointer of the innermost open call (above any value while there is none) */
  private frameSp = 0x1ff;
  private lastRam = false;
  private lastPc = 0;
  private irqRet = 0;
  /** where the last RTS at a call's own stack level was due to return (for data after a JSR) */
  private skipFrom = -1;
  private skipAt = -1;
  private irqOp = -1;
  private irqFrom = 0;
  private nmiWas = false;
  private startCycle = 0;

  private phase: Phase = 'load';
  private phaseAt = 0;
  private triedSys = false;
  private stopped = false;
  private stopInfo: UnpackResult['stop'] = { reason: 'settled', pc: 0, detail: '', cycle: 0 };

  private progressLayer: Layer | null = null;
  private progressAt = 0;
  /** the current window of the progress measure, and the fresh writes of all windows so far */
  private windowEnd = 0;
  private windowIcount = 0;
  private freshSum = 0;
  private holdUntil = 0;
  /** the fresh writes of the last windows, with the cycle each began */
  private windowFresh: { at: number; fresh: number }[] = [];
  /** the keys still to press (indexes into PRESSES) before the program gives up, the keys pressed in all, and the
   *  presses the program took as answers */
  private pressQueue = PRESSES.map((_, i) => i);
  private pressCount = 0;
  private answers = 0;
  /** the last press: the layer then, the fresh writes so far and in the settle time before it, and which key it was */
  private pressMark: { layer: Layer | null; fresh: number; quiet: number; index: number } | null = null;
  /** the rows of text the screen showed at the presses since the program last moved on, and the screen at the ends of
   *  the last two windows */
  private readonly rowsSeen = new Set<string>();
  private shots: string[][] = [];

  /** the stand-in BASIC interpreter: the statements of the program and the next one to run */
  private basicStatements: number[][] = [];
  private basicPos = 0;
  private basicRunning = false;
  /** the disk's sectors as a D64 (a G64's decoded), for its directory */
  private d64: Uint8Array | null = null;
  /** the 1541 (with a disk and its DOS ROM), or why there is none */
  private drive: Drive | null = null;
  private driveNote: string | null = null;
  /** since when the drive's motor runs without the program getting new data */
  private driveBusy = 0;
  /** the file's name as LOAD left it below $a000 (with a disk), what was there before, and whether the program loaded
   *  a file by it */
  private loadName: { at: number; bytes: Uint8Array; before: Uint8Array; icount: number; used: boolean } | null = null;
  /** the datasette, the tape's KERNAL files, the one the file came from, and where the tape stood at the start */
  private tape: Datasette | null = null;
  private tapeKernal: TapeFile[] = [];
  private tapeFile: TapeFile | null = null;
  private tapeStart = 0;
  /** since when the tape has been at its end with the motor on */
  private tapeEnded = 0;

  constructor(file: Uint8Array, o: UnpackOptions) {
    if (file.length < 3) throw new Error('not a PRG: shorter than 3 bytes');
    this.o = o;
    this.file = file;
    this.real = !!o.roms;
    this.m = new C64(o.roms ?? standInRoms());
    this.loadAt = o.load ?? (file[0] | (file[1] << 8));
    this.data = file.subarray(2, 2 + Math.min(file.length - 2, 0x10000 - this.loadAt));
    this.maxCycles = o.maxCycles ?? 400_000_000;
    this.settleCycles = o.settleCycles ?? 1_500_000;
    for (const a of BASIC_ENTRIES) this.special[a] |= 2;
    this.setupTraps();
  }

  // --- starting -----------------------------------------------------------------------------------------------------

  run(): UnpackResult {
    const t0 = performance.now();
    if (this.o.tape) this.attachTape();
    if (this.o.resume) this.resumeFrom(this.o.resume);
    else if (this.real) this.bootReal(); else this.bootStandIn();
    if (this.o.disk && !this.stopped) this.attachDrive();
    if (!this.stopped) this.loop();
    return this.finish(performance.now() - t0);
  }

  /**
   * A snapshot's machine, going on where it was: everything in RAM counts as loaded (the program, a depacker resident
   * in the zero page, the packed data it has yet to unpack), and the first instruction it runs in RAM starts the
   * first layer. A program that goes back to the READY prompt has ended: no SYS to where the file loads.
   */
  private resumeFrom(s: MachineState): void {
    const m = this.m;
    if (!this.real) { this.stop('needs-rom', 'going on from a snapshot needs the ROM files'); return; }
    m.restore(s);
    for (let a = 2; a < 0x10000; a++) { m.wid[a] = LOADED; m.wtime[a] = m.icount; }
    for (const t of [m.firstOp, m.firstArg, m.firstRead, m.firstWrite]) t.fill(0);
    this.triedSys = true;
    this.setPhase('run');
  }

  /** The C64 started up a while ago, at the READY prompt: type LOAD. */
  private bootReal(): void {
    const m = this.m, roms = this.o.roms!;
    const key = `${roms.source}:${checksum(m.kernal)}:${checksum(m.basic)}`;
    if (!bootCache.has(key)) bootCache.set(key, bootC64(roms));
    const booted = bootCache.get(key);
    if (!booted) { this.stop('not-started', 'the C64 did not get through boot'); return; }
    m.restore(booted);
    this.typeLine('LOAD');
    this.setPhase('load');
  }

  /** A 1541 with the disk on the serial bus, started up a while ago (it needs the real ROMs and its DOS ROM). */
  private attachDrive(): void {
    const rom = this.o.roms?.drive;
    if (!this.real) { this.driveNote = 'the stand-ins have no serial bus: the disk was not used'; return; }
    if (!rom) { this.driveNote = 'no 1541 DOS ROM: the disk was not used'; return; }
    const disk = isG64(this.o.disk!) ? g64ToDisk(this.o.disk!) : d64ToDisk(this.o.disk!);
    this.d64 = isG64(this.o.disk!) ? g64ToD64(this.o.disk!) : this.o.disk!;
    const key = checksum(rom);
    if (!driveCache.has(key)) driveCache.set(key, bootDrive(rom));
    const d = new Drive(rom);
    d.restore(driveCache.get(key)!);
    d.insert(disk);
    this.drive = d;
    this.m.attachDrive(d);
    this.driveNote = `1541 with "${disk.name}" ${disk.id}`;
  }

  /** The datasette with the tape, PLAY held down, wound to where the file ended (or to tapeAt). A T64 sends no
   *  pulses: it stands before a file of its directory. */
  private attachTape(): void {
    const t64 = isT64(this.o.tape!);
    const pulses = t64 ? new Uint32Array(0) : tapPulses(this.o.tape!);
    this.tapeKernal = t64 ? t64Files(this.o.tape!) : tapeFiles(pulses);
    const d = new Datasette(pulses, t64 ? Math.max(0, ...this.tapeKernal.map(f => f.to)) : null);
    // the KERNAL file that holds the file's bytes at its address (LOAD puts a relocatable one at the start of BASIC)
    const same = (f: TapeFile) => (f.type === 3 || f.type === 1) && (f.start === this.loadAt || (f.type === 1 && this.loadAt === 0x0801))
      && f.data.length >= this.data.length && this.data.every((v, i) => f.data[i] === v);
    this.tapeFile = this.tapeKernal.find(same) ?? null;
    this.tapeStart = this.o.tapeAt ?? this.tapeFile?.to ?? 0;
    d.seek(this.tapeStart);
    // time to play the rest of the tape, and half a minute after it
    if (this.o.maxCycles == null) {
      let left = 0;
      for (let i = this.tapeStart; i < pulses.length; i++) left += pulses[i];
      this.maxCycles = Math.max(this.maxCycles, left + 30 * 985248);
    }
    this.tape = d;
    this.m.tape = d;
    d.motor = (this.m.ddr & 0x20) !== 0 && (this.m.port & 0x20) === 0;
  }

  /** A KERNAL file's header in the tape buffer ($033c-$03fb), as LOAD from the tape leaves it: bytes that were loaded. */
  private tapeBuffer(f: TapeFile | null): void {
    const m = this.m;
    if (!f) return;
    for (let i = 0; i < 192; i++) { m.ram[0x033c + i] = f.header[i]; m.wid[0x033c + i] = LOADED; m.wtime[0x033c + i] = m.icount; }
  }

  /** The KERNAL keeps the IRQ vector at $029f/$02a0 while it reads the tape (its own reading IRQ is in $0314 then).
   *  It also sets the motor interlock $c0 when it starts the motor: while that is set, its IRQ does not turn the motor
   *  on again for PLAY held down (at the READY prompt it would, as on a C64), so the tape stands after the file until
   *  the program runs the motor. */
  private tapeIrqSave(): void {
    const m = this.m;
    m.ram[0x029f] = m.ram[0x0314]; m.ram[0x02a0] = m.ram[0x0315];
    m.ram[0xc0] = (m.port & 0x1f) || 0x07;
  }

  /**
   * At the end it puts that vector back, unless its high byte is 0: a file that loads over $029f/$02a0 has the next
   * interrupt start it (many tape loaders' boot files start so). That interrupt comes at once: the KERNAL ends the
   * load inside its tape IRQ and enables CIA1's timer A there, whose underflow is waiting by then, so the CPU takes it
   * on the RTI, before BASIC goes on with vectors the file may have loaded over.
   */
  private tapeIrqRestore(): void {
    const m = this.m;
    if (!m.ram[0x02a0]) return;
    if (m.ram[0x029f] !== m.ram[0x0314] || m.ram[0x02a0] !== m.ram[0x0315]) {
      this.trace(`the IRQ vector is $${(m.ram[0x029f] | (m.ram[0x02a0] << 8)).toString(16).padStart(4, '0')} after the load (from $029f/$02a0)`);
      m.cia1.icr |= 1;
      m.cia1.mask |= 1;
    }
    m.ram[0x0314] = m.ram[0x029f]; m.ram[0x0315] = m.ram[0x02a0];
  }

  /** The pointers a tape LOAD leaves: the start in $c1/$c2, the end in $ae/$af and in $ac/$ad, which the KERNAL's tape
   *  routines count up as they store (boot files go on from there: Codemasters' and Mastertronic's clear the memory
   *  from the end of the load up to $0800 with it) */
  private tapePointers(start: number, end: number): void {
    const m = this.m;
    m.ram[0xc1] = start & 0xff; m.ram[0xc2] = start >> 8;
    for (const p of [0xac, 0xae]) { m.ram[p] = end & 0xff; m.ram[p + 1] = (end >> 8) & 0xff; }
  }

  /**
   * LOAD from the tape (device 1), as the KERNAL does it: the next file from where the tape stands whose name starts
   * with the name asked for (any file without one), its header into the tape buffer; a program saved as relocatable
   * (type 1) loads where LOAD asks with secondary address 0, else where it was saved. The tape stops after it. A T64
   * is searched on from the start after its last file, as VICE does it (its files are a directory, not a tape).
   */
  private loadFromTape(): boolean {
    const m = this.m, cpu = m.cpu, d = this.tape!;
    const len = m.ram[0xb7], at = m.ram[0xbb] | (m.ram[0xbc] << 8);
    const name = Uint8Array.from({ length: len }, (_, i) => m.peek((at + i) & 0xffff));
    const fits = (x: TapeFile) => (x.type === 1 || x.type === 3) && tapeNameMatches(x.header, name);
    const f = this.tapeKernal.find(x => x.at >= d.pos && fits(x)) ?? (d.t64 != null ? this.tapeKernal.find(fits) : undefined);
    if (!f) {
      // the KERNAL would search the tape to its end: not found
      d.seek(d.length);
      m.ram[0x90] = 0x40;
      cpu.a = 4; cpu.c = 1;
      this.trace(`loads "${this.fileName()}" from the tape: not there`);
      return this.rts(200);
    }
    this.tapeBuffer(f);
    this.tapeIrqSave();
    const to = m.ram[0xb9] === 0 && f.type === 1 ? m.ram[0xc3] | (m.ram[0xc4] << 8) : f.start;
    // (loaded before the program started, by a BASIC loader say: loaded bytes, as the file's are)
    for (let i = 0; i < f.data.length && to + i < 0x10000; i++) { m.write(to + i, f.data[i]); if (!this.started) m.wid[to + i] = LOADED; }
    this.tapeIrqRestore();
    const end = Math.min(0x10000, to + f.data.length) & 0xffff;
    this.tapePointers(to, end);
    m.ram[0x90] = 0;
    cpu.x = end & 0xff; cpu.y = end >> 8; cpu.c = 0;
    d.seek(f.to);
    // what the motor would have read while it loaded counts as loading from the tape (a T64's file: the pulses of a
    // KERNAL tape's, 20 a byte, each block twice)
    d.edges += d.t64 != null ? (192 + f.data.length) * 40 : f.to - f.at;
    this.trace(`loads "${this.fileName()}" from the tape: $${to.toString(16).padStart(4, '0')}-$${((to + f.data.length - 1) & 0xffff).toString(16).padStart(4, '0')}`);
    return this.rts(200);
  }

  private bootStandIn(): void {
    const m = this.m;
    initStandIn(m);
    // from a tape: its header in the tape buffer, and the IRQ vector as LOAD from the tape leaves it
    if (this.tapeFile) { this.tapeBuffer(this.tapeFile); this.tapeIrqSave(); }
    const end = this.loadFile();
    if (this.tapeFile) { this.tapeIrqRestore(); this.tapePointers(this.loadAt, end & 0xffff); }
    const basic = this.hasBasic(0x0801);
    if (basic) for (const p of [0x2d, 0x2f, 0x31]) { m.ram[p] = end & 0xff; m.ram[p + 1] = end >> 8; }
    m.cpu.s = 0xf8;
    m.cpu.p = 0x20;
    this.setPhase('run');
    if (this.o.entry != null) {
      this.sys(this.o.entry);
      if (this.o.port != null) m.write(1, this.o.port & 0xff);
      return;
    }
    const auto = this.autostart();
    if (auto != null) { m.cpu.pc = auto; m.cpu.lastOp = 0x6c; return; }
    if (basic) { this.runBasic(true); return; }
    this.sys(this.loadAt);
  }

  /**
   * Whether the file is a BASIC program to start with RUN: it loads at the start of BASIC, or loads over it from below
   * with a line there whose SYS goes into the file, and a 0 or a colon before it (RUN goes on from that byte as from
   * the end of a statement; anything else is a ?SYNTAX ERROR). Such a file can begin in the screen, with text or a
   * frame there (Cybernoid II +17HDF loads at $05b8, where its frame's bytes make JSRs into crunched data, and has
   * 239 SYS2061 at $0801): LOAD"...",8,1 and RUN start it, SYS to where it loads does not.
   */
  private hasBasic(basicStart: number): boolean {
    const lo = this.loadAt, hi = lo + this.data.length;
    if (lo === basicStart) return true;
    if (lo > basicStart || basicStart + 6 > hi) return false;
    const peek = (a: number) => a >= lo && a < hi ? this.data[a - lo] : 0;
    if (peek(basicStart - 1) !== 0 && peek(basicStart - 1) !== 0x3a) return false;
    const sys = findSys(peek, basicStart);
    return sys != null && sys >= lo && sys < hi;
  }

  /** With the stand-ins: where a file that loads over the RAM vectors or the stack starts by itself. */
  private autostart(): number | null {
    const m = this.m, lo = this.loadAt, hi = this.loadAt + this.data.length;
    const covers = (a: number) => a >= lo && a + 1 < hi;
    for (const v of [0x0326, 0x0302, 0x0300, 0x0328, 0x032a, 0x0324]) {
      if (!covers(v)) continue;
      const target = m.peekWord(v);
      const def = v >= 0x0314 ? KERNAL_VECTORS[(v - 0x0314) >> 1] : [0xe38b, 0xa483][(v - 0x0300) >> 1];
      if (target !== def) return target;
    }
    // a file from a tape that loaded over $029f/$02a0, which the KERNAL puts in the IRQ vector after the load
    if (this.tapeFile && covers(0x029f) && m.peekWord(0x0314) !== KERNAL_VECTORS[0]) return m.peekWord(0x0314);
    for (let sp = 0xf6; sp <= 0xfd; sp++) {
      const a = 0x0100 + sp + 1;
      if (!covers(a)) continue;
      const target = (m.peekWord(a) + 1) & 0xffff;
      if (target >= lo && target < hi) return target;
    }
    return null;
  }

  private setPhase(p: Phase): void { this.phase = p; this.phaseAt = this.progressAt = this.m.cycles; }

  /** Write the file into RAM, as LOAD does (the processor port at $00/$01 is left alone). */
  /**
   * The file's bytes into memory as the KERNAL's LOAD puts them: a byte at a time through the pointer at $ae/$af, so a
   * file that loads over that pointer goes on where it now points (Ferrari Formula One's boot loads at $00ae and has
   * the rest go to $02b0). Returns where LOAD ends, the address after the last byte, as it leaves it in $ae/$af.
   */
  private loadFile(): number {
    const m = this.m;
    let lo = this.loadAt & 0xff, hi = this.loadAt >> 8;
    for (let i = 0; i < this.data.length; i++) {
      const a = lo | (hi << 8), v = this.data[i];
      if (a >= 2) {
        m.ram[a] = v;
        m.wid[a] = LOADED;
        m.wtime[a] = m.icount;
      }
      if (a === 0xae) lo = v; else if (a === 0xaf) hi = v;
      lo = (lo + 1) & 0xff;
      if (!lo) hi = (hi + 1) & 0xff;
    }
    // from here on: what the run does with the loaded bytes
    for (const t of [m.firstOp, m.firstArg, m.firstRead, m.firstWrite]) t.fill(0);
    m.ram[0xae] = lo; m.ram[0xaf] = hi;
    m.ram[0x90] = 0x40;
    return lo | (hi << 8);
  }

  /** Type a line into the keyboard buffer (10 characters at most, RETURN added). */
  private typeLine(text: string): void {
    const m = this.m, bytes = [...text].map(c => c.charCodeAt(0)).concat(0x0d).slice(0, 10);
    m.ram.set(bytes, 0x0277);
    m.ram[0xc6] = bytes.length;
  }

  /** the program's first instruction in RAM: the first layer begins */
  private start(pc: number): void {
    const m = this.m;
    this.started = true;
    this.phase = 'run';
    const root = new Layer(0, null, pc, 'start', null, m.cycles, m.icount, this.snapshot());
    root.driveBus = this.busChanges();
    this.layers = [root];
    this.owner.fill(0, Math.max(2, this.loadAt), this.loadAt + this.data.length);
    this.cur = root; this.curId = 0;
    m.tag = 0;
    this.startCycle = m.cycles;
    this.progressAt = m.cycles;
    this.trace(`layer 0 starts at ${hex4(pc)}`);
  }

  // --- the run ------------------------------------------------------------------------------------------------------

  private loop(): void {
    const m = this.m, cpu = m.cpu, map = m.map, ram = m.ram, etime = m.etime, eop = m.eop, wid = m.wid, eid = this.eid, special = this.special;
    const firstOp = m.firstOp, firstArg = m.firstArg;
    let next = m.icount + CHECK;
    while (!this.stopped) {
      if (cpu.s > this.frameSp) this.unwind();
      const pc = cpu.pc;
      if (special[pc] && this.specialAt(pc)) {
        this.lastRam = false;
        if (m.icount >= next) { next = m.icount + CHECK; this.check(); }
        continue;
      }
      if (map[pc >> 8] <= ZP && (this.started || wid[pc] !== BOOT)) {
        // (before the program starts, RAM code the C64 set up itself, such as BASIC's CHRGET, is not the program)
        if (!this.started) this.start(pc);
        if (eid[pc] !== this.curId) {
          if (wid[pc] === this.curId && TRANSFER[cpu.lastOp] && this.isTransfer(pc)) this.enter(pc, false);
          eid[pc] = this.curId;
        }
        const ic = m.icount, op = ram[pc];
        etime[pc] = ic; eop[pc] = op;
        if (!firstOp[pc]) firstOp[pc] = ic;
        const len = LEN[op];
        if (len > 1) {
          const p1 = (pc + 1) & 0xffff;
          etime[p1] = ic; if (!firstArg[p1]) firstArg[p1] = ic;
          if (len > 2) { const p2 = (pc + 2) & 0xffff; etime[p2] = ic; if (!firstArg[p2]) firstArg[p2] = ic; }
        }
        this.lastRam = true;
        m.inRom = false;
      } else { this.lastRam = false; m.inRom = true; }
      this.lastPc = pc;
      if (this.o.onStep && this.started) this.o.onStep(pc, m);
      const iWas = cpu.i;
      m.dmaWait();
      const cycles = cpu.step();
      m.icount++;
      if (cpu.jammed) { this.jam(pc); break; }
      m.advance(cycles);
      // (before an interrupt that may follow at once: an RTI from a handler that ran a whole frame is a return)
      if (cpu.s > this.frameSp) this.unwind();
      if (this.started) {
        const op = cpu.lastOp;
        if (op === 0x20) this.call((pc + 3) & 0xffff);
        else if (op === 0x00) this.call((pc + 2) & 0xffff);
      }
      if (m.irqLine && !(cpu.lastOp === 0x40 ? cpu.i : iWas)) { this.interrupted(pc); m.advance(cpu.irq()); this.call(this.irqRet); }
      const nmi = m.nmiLine;
      if (nmi && !this.nmiWas) { this.interrupted(pc); m.advance(cpu.nmi()); this.call(this.irqRet); }
      this.nmiWas = nmi;
      if (m.icount >= next) { next = m.icount + CHECK; this.check(); }
    }
  }

  /** A subroutine call or an interrupt that returns to `ret`: remember it, with the number of layers so far. */
  private call(ret: number): void {
    if (!this.started) return;
    const k = this.calls;
    if (k >= CALLS) return;
    this.callSp[k] = this.m.cpu.s;
    this.callRet[k] = ret;
    this.callLayers[k] = this.layers.length;
    this.calls = k + 1;
    this.frameSp = this.m.cpu.s;
  }

  /**
   * The stack rose above a call: when it returned where it was called from, the layers begun inside it were
   * temporary and join the caller's again; when the stack was just dropped, they stay.
   */
  private unwind(): void {
    const cpu = this.m.cpu;
    while (this.calls && cpu.s > this.callSp[this.calls - 1]) {
      const k = --this.calls;
      const returned = (cpu.lastOp === 0x60 || cpu.lastOp === 0x40) && cpu.pc === this.callRet[k];
      // an RTS at the call's own stack level, a little behind the call: the subroutine skipped data after the JSR
      if (cpu.lastOp === 0x60 && cpu.s === this.callSp[k] + 2) { this.skipFrom = this.callRet[k]; this.skipAt = this.m.icount; }
      if (returned && this.layers.length > this.callLayers[k]) this.merge(this.layers[this.callLayers[k]]);
    }
    this.frameSp = this.calls ? this.callSp[this.calls - 1] : 0x1ff;
  }

  /** An interrupt is taken after the instruction at `pc`: remember where it returns to, and how the CPU got there. */
  private interrupted(pc: number): void {
    const cpu = this.m.cpu;
    this.irqRet = cpu.pc;
    this.irqOp = TRANSFER[cpu.lastOp] ? cpu.lastOp : -1;
    this.irqFrom = pc;
  }

  /**
   * Whether the jump to `pc` (code the running layer wrote) starts a new layer. Not when an RTS returns behind a JSR
   * this layer ran (the subroutine changed the code there), nor when an RTI returns into the middle of the code it
   * interrupted; an RTI to the first instruction after a jump counts as that jump.
   */
  private isTransfer(pc: number): boolean {
    const op = this.m.cpu.lastOp;
    if (op === 0x60) {
      const j = (pc - 3) & 0xffff;
      if (this.m.ram[j] === 0x20 && this.eid[j] === this.curId) return false;
      if (this.skipAt === this.m.icount && pc >= this.skipFrom && pc - this.skipFrom < 0x200 && this.eid[(this.skipFrom - 3) & 0xffff] === this.curId) return false;
    }
    if (op === 0x40 && pc === this.irqRet) return this.irqOp >= 0;
    return true;
  }

  /** a trap or a BASIC entry at `pc`; true when a trap did the work (the instruction there is not run) */
  private specialAt(pc: number): boolean {
    const m = this.m, page = m.map[pc >> 8], flags = this.special[pc];
    if (flags & 2 && this.started && this.lastRam && TRANSFER[m.cpu.lastOp] && (page === BASIC || page === KERNAL) && this.startsBasic(pc)) this.enter(pc, true);
    if (pc === 0xa7ae && page === BASIC) this.basicGoesOn(m.ram[0x7a] | (m.ram[0x7b] << 8));
    if (flags & 1) {
      const t = this.traps.get(pc);
      if (t && t.rom === page) return t.run();
    }
    return false;
  }

  /**
   * Whether the jump into BASIC at `pc` starts a layer. From machine code it does. A BASIC program going back into
   * BASIC (an extension's command or a SYS routine ending in NEWSTT, RUN again) goes on with the program it was running,
   * unless BASIC goes on with text written since BASIC last went on from there: started from its first line (RUN, or
   * NEWSTT after a CLR), a program a depacker it called wrote, or one not run yet; in the middle of the program, what
   * the layer itself rewrote.
   */
  private startsBasic(pc: number): boolean {
    if (!RUN_ENTRIES.has(pc) || !this.cur!.basic) return true;
    const { ram, wid, wtime } = this.m, ran = this.basicRan;
    const start = ram[0x2b] | (ram[0x2c] << 8), end = ram[0x2d] | (ram[0x2e] << 8), at = ram[0x7a] | (ram[0x7b] << 8);
    if (pc !== 0xa7ae || at === start - 1) {
      // the first line's link (high byte) and line number, which NEWSTT reads, and its first token
      for (let a = start + 1; a <= start + 4; a++) if (wtime[a & 0xffff] > ran[a & 0xffff]) return true;
      return false;
    }
    // (not in the program: BASIC goes on in direct mode)
    if (at < start || at >= end) return true;
    // the end of the statement BASIC goes on from, and the next statement or the next line
    const next = ram[at] ? [at, at + 1] : [at, at + 2, at + 3, at + 4, at + 5];
    return next.some(a => a < end && wid[a] === this.curId && wtime[a] > ran[a]);
  }

  /** BASIC goes on from `at`: the end of a statement or the byte before the first line, and the statement or line after it */
  private basicGoesOn(at: number): void {
    for (let a = at; a < at + 6; a++) this.basicRan[a & 0xffff] = this.m.icount;
  }

  /** A new layer starts at `pc`. */
  private enter(pc: number, basic: boolean): void {
    const m = this.m, cpu = m.cpu, parent = this.cur!;
    parent.activity = activity(m, this.eid, parent.id, parent.icount);
    this.keep(parent);
    // a jump the CPU took just before an interrupt counts as made when the interrupt returns
    const late = cpu.lastOp === 0x40 && pc === this.irqRet && this.irqOp >= 0;
    const op = late ? this.irqOp : cpu.lastOp, from = late ? this.irqFrom : this.lastPc;
    const layer = new Layer(++this.nextId, parent, pc, VIA[op] ?? 'jmp', from, m.cycles, m.icount, this.snapshot());
    layer.basic = basic;
    layer.driveBus = this.busChanges();
    const kinds = new Map(this.layers.filter(l => l.activity).map(l => [l.id, l.activity!.kind]));
    layer.mask = contentMask(m, parent.id, parent.snapshot.ram, kinds);
    for (let a = 0; a < 0x10000; a++) if (layer.mask[a]) this.owner[a] = layer.id;
    this.layers.push(layer);
    this.cur = layer; this.curId = layer.id;
    m.tag = layer.id;
    this.trace(`${layer.via} ${basic ? 'into BASIC ' : ''}from ${hex4(from)} to ${hex4(pc)}: layer ${this.layers.length - 1} (${parent.activity.kind} before it, ${this.calls} open calls, sp $${this.m.cpu.s.toString(16)})`);
  }

  /**
   * Layer P ends (a new layer starts, or the run stops): the parts of earlier programs it ran, which still held then
   * what they held when those programs started, join the bytes saved for it (a trackmo's music and loader). Only
   * bytes it ran without writing them count: code it loaded over such a part is not the part. Bytes run or read
   * since such a program started, but not by P, were spent before it (start-up code, data copied from there).
   *
   * When the drive talked on the serial bus while P ran (at least LOADS changes of its lines: P loaded from the disk),
   * the parts P loaded after it started and then ran join them too, as they are now (a trackmo's framework that loads
   * its parts and the music and calls them): the snapshot at P's start cannot hold them, and the saved program cannot
   * make them again. Bytes of the program P started with, and of the parts of earlier programs it kept, keep the
   * values they had then.
   */
  private keep(P: Layer): void {
    if (!P.mask) return;
    const then = new Map(this.layers.map(l => [l.id, l.snapshot.ram]));
    const began = new Map(this.layers.map(l => [l.id, l.icount]));
    const { etime, wtime, rtime, wid, ram } = this.m, since = P.icount, live = P.mask.slice();
    const spent = (a: number, k: number): boolean => {
      const last = Math.max(etime[a], rtime[a]);
      return last < since && last >= (began.get(k) ?? since);
    };
    P.kept = keptParts(this.owner, P.id, id => then.get(id), P.snapshot.ram, P.mask, a => etime[a] >= since && wtime[a] < since, spent, live);
    P.loaded = [];
    P.image = null;
    if (this.busChanges() - P.driveBus >= LOADS) {
      // (what P wrote inside a kept part is that program's own variables and changed code, not something it loaded)
      const got = new Uint8Array(0x10000), id = P.id, taken = live.slice();
      for (const k of P.kept) taken.fill(1, k.start, k.end + 1);
      P.loaded = loadedParts(taken, a => wid[a] === id && wtime[a] >= since, a => etime[a] > wtime[a], got);
      if (P.loaded.length) {
        const image = P.snapshot.ram.slice();
        for (let a = 0; a < 0x10000; a++) if (got[a]) { image[a] = ram[a]; live[a] = 1; }
        P.image = image;
      }
    }
    P.live = P.kept.length || P.loaded.length ? live : null;
  }

  /** Layer L returned to the layer that called it: it and the layers after it join that one again. */
  private merge(L: Layer): void {
    const m = this.m, P = L.parent!, gone = this.layers.splice(this.layers.indexOf(L));
    const { wid } = m, eid = this.eid, owner = this.owner;
    for (let a = 0; a < 0x10000; a++) {
      if (wid[a] >= L.id) wid[a] = P.id;
      if (eid[a] >= L.id) eid[a] = P.id;
      if (owner[a] >= L.id) owner[a] = -1;
    }
    for (const g of gone) {
      if (P.calls.length < 16) P.calls.push({ entry: g.entry, via: g.via });
      P.printed += g.printed;
      P.presses.push(...g.presses);
    }
    this.cur = P; this.curId = P.id;
    m.tag = P.id;
    P.activity = null;
    this.trace(`returned to ${hex4(m.cpu.pc)}: ${gone.map(g => hex4(g.entry)).join(', ')} ran in a call from layer ${this.layers.length - 1}`);
  }

  private check(): void {
    const m = this.m, now = m.cycles;
    if (!this.started) {
      if (this.phase !== 'run' && now - this.phaseAt > 20_000_000) { this.stop('not-started', `the C64 did not get through ${this.phase}`); return; }
    } else if (now - this.startCycle > this.maxCycles) { this.stop('budget', `still running after ${(this.maxCycles / 985248).toFixed(0)} s of C64 time`); return; }
    if (this.holdUntil && now >= this.holdUntil) { m.input.release(); this.holdUntil = 0; this.progressAt = now; }
    m.syncDrive();
    if (this.phase !== 'run') return;
    if (now >= this.windowEnd) {
      // a window is a third of the settle time; fresh writes in it, or a new layer, are progress
      if (m.fresh >= 128 || this.cur !== this.progressLayer) { this.progressLayer = this.cur; this.progressAt = now; this.driveBusy = 0; }
      // the program talks with the drive (sends it code with M-W, a byte at a time, with its motor off): not settled
      const bus = this.drive?.busChanges ?? 0;
      if (bus - this.windowBus >= LOADS) this.progressAt = now;
      this.windowBus = bus;
      this.freshSum += m.fresh;
      this.windowFresh.push({ at: this.windowEnd - this.settleCycles / 3, fresh: m.fresh });
      if (this.windowFresh.length > 4) this.windowFresh.shift();
      m.fresh = 0;
      this.shots = [this.shots.at(-1) ?? [], this.screenRows()];
      m.freshMark = this.windowIcount;
      this.windowIcount = m.icount;
      this.windowEnd = now + this.settleCycles / 3;
    }
    if (this.drive?.motorOn) {
      if (!this.driveBusy) this.driveBusy = now;
      if (now - this.driveBusy < DRIVE_PATIENCE) this.progressAt = now;
    } else this.driveBusy = 0;
    // the tape plays: the program is loading (leaders and gaps between files take seconds), until a while after its end
    const t = this.tape;
    if (t?.motor && t.t64 == null) {
      if (!t.atEnd) { this.progressAt = now; this.tapeEnded = 0; } else {
        if (!this.tapeEnded) this.tapeEnded = now;
        if (now - this.tapeEnded < TAPE_END_PATIENCE) this.progressAt = now;
      }
    }
    if (!this.holdUntil && now - this.progressAt >= this.settleCycles) this.settled();
  }

  /**
   * The program writes no new memory: press a key if it is an intro still in front of the depacker, or stop. The keys
   * go in turn until the program reacts to one: then from the first again when it is a new program, else that key
   * again first. A trainer menu that asks one question after another ("Unlimited lives (Y/N)") reacts to N with little:
   * it puts the next question up, a line of text the screen had not shown at a press, and stands still there. It
   * stops once every key was pressed without a reaction.
   */
  private settled(): void {
    const m = this.m;
    const first = !this.started || this.layers.length === 1;
    const k = this.pressMark, rows = this.screenRows();
    if (k) {
      const fresh = this.freshSum + m.fresh - k.fresh;
      const all = PRESSES.map((_, i) => i), again = [k.index, ...all.filter(i => i !== k.index)];
      // a new program: the keys from the first again
      if (this.cur !== k.layer) { this.pressQueue = all; this.rowsSeen.clear(); }
      // the same program did much (a new page, or a depacker started): that key again first
      else if (fresh >= 128) this.pressQueue = again;
      else if (this.answers < MAX_ANSWERS && fresh >= ANSWER_FRESH + 2 * k.quiet && this.newRow(rows)) {
        // it wrote more than it does when left alone and shows a line it had not shown at a press, which stands still
        // (the next question; not the same complaint about a wrong key again, the same "insert side 2" on the next
        // line, or a scroll text)
        this.pressQueue = again;
        this.answers++;
        this.trace(`answered with ${PRESSES[k.index].name} (${fresh} fresh writes, ${k.quiet} before it)`);
      }
    }
    if ((first || this.o.deep) && this.o.keys !== false && this.pressCount < MAX_PRESSES + this.answers && this.pressQueue.length) {
      const index = this.pressQueue.shift()!, p = PRESSES[index];
      this.pressCount++;
      for (const row of rows) this.rowsSeen.add(row);
      m.input.release();
      for (const [col, row] of p.keys) m.input.keys[col] |= 1 << row;
      m.input.joy1 = m.input.joy2 = p.joy;
      m.input.petscii = p.petscii;
      this.holdUntil = m.cycles + HOLD;
      this.pressMark = { layer: this.cur, fresh: this.freshSum + m.fresh, quiet: this.quietFresh(), index };
      const when = ((m.cycles - this.startCycle) / 985248).toFixed(1);
      this.cur?.presses.push(`${p.name} at ${when} s`);
      this.trace(`waiting at ${hex4(m.cpu.pc)}: pressed ${p.name}`);
      return;
    }
    if (!this.started) {
      // (a snapshot taken while the KERNAL loaded from a disk: the 1541 is not in it as it was)
      const at = this.o.resume ? `: the snapshot was in the ROM at ${hex4(this.o.resume.cpu.pc)} and went on there` : '';
      this.stop('not-started', `no machine code ran${at}`);
      return;
    }
    this.stop('settled', `waits at ${hex4(m.cpu.pc)}`);
  }

  /** the fresh writes of the windows that began after the program last made progress (or a key was let go) */
  private quietFresh(): number {
    return this.windowFresh.reduce((sum, w) => w.at >= this.progressAt ? sum + w.fresh : sum, 0);
  }

  /** the text screen the VIC-II shows (its video matrix in the bank CIA 2 sets), a string a row */
  private screenRows(): string[] {
    const m = this.m, c = m.cia2;
    const at = (3 - ((c.pra | ~c.ddra) & 3)) * 0x4000 + ((m.vic.regs[0x18] >> 4) << 10);
    const rows: string[] = [];
    for (let r = 0; r < 25; r++) rows.push(String.fromCharCode(...m.ram.subarray(at + r * 40, at + r * 40 + 40)));
    return rows;
  }

  /** the screen shows a row not shown at a press, and the same at the end of the window before last (half a second
   *  or more ago, after the press): it stands still */
  private newRow(rows: string[]): boolean {
    const before = this.shots[0];
    return rows.some((row, i) => row === before?.[i] && !this.rowsSeen.has(row));
  }

  private stop(reason: StopReason, detail = ''): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stopInfo = { reason, pc: this.m.cpu.pc, detail, cycle: this.started ? this.m.cycles - this.startCycle : 0 };
    this.trace(`stopped: ${reason}${detail ? ` (${detail})` : ''}`);
  }

  private jam(pc: number): void {
    const page = this.m.map[pc >> 8];
    if (!this.real && (page === BASIC || page === KERNAL)) this.stop('needs-rom', `calls the ROM at ${hex4(pc)}, which the stand-ins do not have`);
    else this.stop('jam', `the CPU stopped on the JAM opcode at ${hex4(pc)}`);
  }

  private snapshot(): Snapshot {
    const m = this.m, c = m.cpu;
    // (PLAY held down on the datasette reads as a 0 on bit 4, an input: the program's port is without it)
    return { ram: m.ram.slice(), port: this.tape && !(m.ddr & 0x10) ? m.cpuPort | 0x10 : m.cpuPort, a: c.a, x: c.x, y: c.y, s: c.s, p: c.p };
  }

  /** how often the drive has changed its DATA or CLK line, and how many pulses the tape has played, up to now (0 with
   *  neither): the program loads while this grows */
  private busChanges(): number {
    const tape = this.tape?.edges ?? 0;
    if (!this.drive) return tape;
    this.m.syncDrive();
    return this.drive.busChanges + tape;
  }

  private trace(line: string): void { this.o.trace?.(line); }

  // --- traps --------------------------------------------------------------------------------------------------------

  private trap(addr: number, rom: number, run: () => boolean): void {
    this.traps.set(addr, { rom, run });
    this.special[addr] |= 1;
  }

  /** return from a routine the trap did the work of */
  private rts(cycles = 12): true {
    const m = this.m, c = m.cpu;
    c.s = (c.s + 1) & 0xff; const lo = m.read(0x100 | c.s);
    c.s = (c.s + 1) & 0xff; const hi = m.read(0x100 | c.s);
    c.pc = ((lo | (hi << 8)) + 1) & 0xffff;
    c.lastOp = 0x60;
    m.advance(cycles);
    m.icount++;
    return true;
  }

  private print(ch: number): void {
    if (!this.cur) return;
    const c = ch === 0x0d ? '\n' : ch >= 0x20 && ch < 0x5b ? String.fromCharCode(ch) : ch >= 0xc1 && ch <= 0xda ? String.fromCharCode(ch - 0x80) : '';
    if (this.cur.printed.length < 2000) this.cur.printed += c;
  }

  private fileName(): string {
    const m = this.m, len = m.ram[0xb7], at = m.ram[0xbb] | (m.ram[0xbc] << 8);
    let s = '';
    for (let i = 0; i < len && i < 32; i++) { const b = m.peek((at + i) & 0xffff); s += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '?'; }
    return s;
  }

  private setupTraps(): void {
    const m = this.m, cpu = m.cpu;
    // both: LOAD and SAVE through their vectors, the KERNAL's own BRK handling, reset
    this.trap(0xf4a5, KERNAL, () => {
      if (this.phase === 'load') {
        // from a disk the file came from device 8 by its name (LOAD"name",8,1): loaders take the drive's number from
        // here, and a split freeze's first file loads "1" and the name it was loaded by. BASIC keeps the name of a
        // LOAD typed at the prompt at the top of its string space, below $a000 (the file can load over it)
        if (this.drive) {
          m.ram[0xba] = 8; m.ram[0xb9] = 1;
          const name = d64NameOf(this.d64!, this.file);
          if (name?.length) {
            const at = 0xa000 - name.length;
            this.loadName = { at, bytes: name, before: m.ram.slice(at, 0xa000), icount: m.icount, used: false };
            m.ram.set(name, at); m.ram[0xb7] = name.length; m.ram[0xbb] = at & 0xff; m.ram[0xbc] = at >> 8;
          }
        }
        // from a tape: device 1, and the file's header in the tape buffer
        const fromTape = !!this.tape && (!!this.tapeFile || !this.drive);
        if (fromTape) { m.ram[0xba] = 1; m.ram[0xb9] = 0; this.tapeBuffer(this.tapeFile); this.tapeIrqSave(); }
        const end = this.loadFile();
        if (fromTape) { this.tapeIrqRestore(); this.tapePointers(this.loadAt, end & 0xffff); }
        cpu.x = end & 0xff; cpu.y = (end >> 8) & 0xff; cpu.c = 0;
        this.setPhase('loaded');
        return this.rts(200);
      }
      // with a disk the KERNAL loads it from the drive (by the name LOAD left, perhaps: then it is the program's)
      if (this.drive && m.ram[0xba] === 8) {
        const n = this.loadName, at = m.ram[0xbb] | (m.ram[0xbc] << 8);
        if (n && at < 0xa000 && at + m.ram[0xb7] > n.at) n.used = true;
        this.trace(`loads "${this.fileName()}"`);
        return false;
      }
      // with a tape: the next KERNAL file from where it stands
      if (this.tape && m.ram[0xba] === 1) return this.loadFromTape();
      this.stop('load', `loads "${this.fileName()}" from device ${m.ram[0xba]}`);
      return true;
    });
    this.trap(0xf5ed, KERNAL, () => {
      if (this.drive && m.ram[0xba] === 8) { this.trace(`saves "${this.fileName()}"`); return false; }
      this.stop('save', `saves "${this.fileName()}"`);
      return true;
    });
    this.trap(0xfce2, KERNAL, () => { if (!this.started) return false; this.stop('reset', 'resets the C64'); return true; });
    this.trap(0xf1ca, KERNAL, () => { this.print(cpu.a); return this.real ? false : (cpu.c = 0, this.rts()); });

    if (this.real) {
      // the READY prompt waiting for a key (LOAD was typed at the start): type RUN; after that the program has
      // returned to BASIC
      this.trap(READY_WAITS, KERNAL, () => {
        if (m.ram[0xc6]) return false;
        if (this.phase === 'loaded') {
          if (this.started) { this.stop('ready', 'returned to the READY prompt'); return true; }
          const basicStart = m.ram[0x2b] | (m.ram[0x2c] << 8);
          this.typeLine(this.o.entry != null ? `SYS${this.o.entry}` : this.hasBasic(basicStart) ? 'RUN' : `SYS${this.loadAt}`);
          this.setPhase('run');
        } else if (this.phase === 'run') {
          if (!this.started && !this.triedSys && this.loadAt !== (m.ram[0x2b] | (m.ram[0x2c] << 8))) {
            this.triedSys = true;
            this.typeLine(`SYS${this.loadAt}`);
          } else this.stop('ready', this.started ? 'returned to the READY prompt' : 'the BASIC program ran no machine code');
          return this.stopped;
        }
        return false;
      });
      this.trap(0xfe66, KERNAL, () => {
        if (this.started) this.cur!.printed += `{brk at ${hex4((m.peekWord(0x100 + ((cpu.s + 5) & 0xff)) - 2) & 0xffff)}}`;
        return false;
      });
      // LOAD at the prompt relinks BASIC's lines from its start (LINKPRG, JSR $a533 after the load). Started at an
      // address instead (SYS), a file that loads over that start is in memory as it has it, as VICE's -autoload and
      // Build & Run put it: a program Sindri saved can have code at $0801, and relinking wrote link pointers into it
      // (Cybernoid II's game, $0208-$ffff started at $1400, ran into a JAM at $08e3). Over anything else (an empty
      // program) relinking changes nothing, and is left as it was
      this.trap(0xa533, BASIC, () => {
        if (this.phase !== 'loaded' || this.started || this.o.entry == null) return false;
        const link = (m.ram[0x2b] | (m.ram[0x2c] << 8)) + 1;
        return link >= this.loadAt && link < this.loadAt + this.data.length ? this.rts() : false;
      });
      // SYS jumps to the program with JMP ($0014): a start with its own $01 gets it right before (as Build & Run's
      // stub sets it), so a program under the BASIC ROM is what runs, not the ROM
      const port = this.o.port, entry = this.o.entry;
      if (port != null && entry != null) this.trap(0xe144, KERNAL, () => {
        if (!this.started && (m.ram[0x14] | (m.ram[0x15] << 8)) === entry) m.write(1, port & 0xff);
        return false;
      });
      return;
    }

    // the stand-ins: SYS returning, BASIC's RUN and READY, the KERNAL routines packers call
    this.trap(SYS_RETURN + 1, KERNAL, () => {
      m.ram[0x030c] = cpu.a; m.ram[0x030d] = cpu.x; m.ram[0x030e] = cpu.y; m.ram[0x030f] = cpu.p;
      if (this.basicRunning) this.runBasic(false);
      else this.stop('ready', 'returned to BASIC');
      return true;
    });
    for (const a of [0xa7ae, 0xa871]) this.trap(a, BASIC, () => { this.runBasic(true); return true; });
    for (const a of [0xa659, 0xa660, 0xa68e]) this.trap(a, BASIC, () => {
      const start = (m.ram[0x2b] | (m.ram[0x2c] << 8)) - 1;
      m.write(0x7a, start & 0xff); m.write(0x7b, start >> 8);
      return this.returnsOrRuns();
    });
    this.trap(0xa533, BASIC, () => { this.relink(); return this.returnsOrRuns(); });
    for (const a of [0xa474, 0xa480, 0xa483]) this.trap(a, BASIC, () => { this.stop('ready', 'returned to the READY prompt'); return true; });
    for (const a of [0xe37b, 0xe386]) this.trap(a, KERNAL, () => { this.stop('ready', 'BASIC warm start'); return true; });
    this.trap(0xab1e, BASIC, () => {
      for (let p = cpu.a | (cpu.y << 8), n = 0; n < 256; n++, p = (p + 1) & 0xffff) { const b = m.peek(p); if (!b) break; this.print(b); }
      return this.rts();
    });
    this.trap(0xbdcd, BASIC, () => { for (const ch of String(cpu.x | (cpu.a << 8))) this.print(ch.charCodeAt(0)); return this.rts(); });

    this.trap(0xfe66, KERNAL, () => { this.stop('brk', `BRK at ${hex4((m.peekWord(0x100 + ((cpu.s + 5) & 0xff)) - 2) & 0xffff)}`); return true; });
    this.trap(0xea31, KERNAL, () => {
      // the KERNAL's interrupt work: the jiffy clock
      this.jiffy();
      return false;
    });
    const clearScreen = () => {
      const screen = m.ram[0x0288] << 8;
      for (let i = 0; i < 1000; i++) { m.write((screen + i) & 0xffff, 0x20); m.color[i] = m.ram[0x0286] & 0x0f; }
      return this.rts(20000);
    };
    for (const a of [0xe544, 0xff81, 0xff5b, 0xe518]) this.trap(a, KERNAL, clearScreen);
    for (const a of [0xe566, 0xff84, 0xfda3, 0xff87, 0xfd50, 0xff9f, 0xffa2, 0xff90, 0xe3bf, 0xe453, 0xe422, 0xff93, 0xff96, 0xffa8, 0xffab, 0xffae, 0xffb1, 0xffb4]) {
      this.trap(a, KERNAL, () => { if (a >= 0xff93 && a !== 0xff9f && a !== 0xffa2) m.ram[0x90] |= 0x80; return this.rts(); });
    }
    const restor = () => { KERNAL_VECTORS.forEach((v, i) => { m.write(0x0314 + 2 * i, v & 0xff); m.write(0x0315 + 2 * i, v >> 8); }); return this.rts(200); };
    this.trap(0xff8a, KERNAL, restor);
    this.trap(0xfd15, KERNAL, restor);
    this.trap(0xff8d, KERNAL, () => {
      const at = cpu.x | (cpu.y << 8);
      for (let i = 0; i < 32; i++) {
        if (cpu.c) m.write((at + i) & 0xffff, m.read(0x0314 + i)); else m.write(0x0314 + i, m.read((at + i) & 0xffff));
      }
      return this.rts(300);
    });
    this.trap(0xff99, KERNAL, () => { if (cpu.c) { cpu.x = m.ram[0x0283]; cpu.y = m.ram[0x0284]; } else { m.write(0x0283, cpu.x); m.write(0x0284, cpu.y); } return this.rts(); });
    this.trap(0xff9c, KERNAL, () => { if (cpu.c) { cpu.x = m.ram[0x0281]; cpu.y = m.ram[0x0282]; } else { m.write(0x0281, cpu.x); m.write(0x0282, cpu.y); } return this.rts(); });
    this.trap(0xffa5, KERNAL, () => { cpu.a = 0; m.ram[0x90] |= 0x02; return this.rts(); });
    this.trap(0xffb7, KERNAL, () => { cpu.a = m.ram[0x90]; cpu.n = cpu.a & 0x80; cpu.z = cpu.a ? 0 : 1; return this.rts(); });
    this.trap(0xffba, KERNAL, () => { m.write(0xb8, cpu.a); m.write(0xba, cpu.x); m.write(0xb9, cpu.y); return this.rts(); });
    this.trap(0xffbd, KERNAL, () => { m.write(0xb7, cpu.a); m.write(0xbb, cpu.x); m.write(0xbc, cpu.y); return this.rts(); });
    this.trap(0xffdb, KERNAL, () => { m.write(0xa2, cpu.a); m.write(0xa1, cpu.x); m.write(0xa0, cpu.y); return this.rts(); });
    this.trap(0xffde, KERNAL, () => { cpu.a = m.ram[0xa2]; cpu.x = m.ram[0xa1]; cpu.y = m.ram[0xa0]; return this.rts(); });
    this.trap(0xffea, KERNAL, () => { this.jiffy(); return this.rts(); });
    this.trap(0xffed, KERNAL, () => { cpu.x = 40; cpu.y = 25; return this.rts(); });
    this.trap(0xfff0, KERNAL, () => { if (cpu.c) { cpu.x = m.ram[0xd6]; cpu.y = m.ram[0xd3]; } else { m.write(0xd6, cpu.x); m.write(0xd3, cpu.y); } return this.rts(); });
    this.trap(0xfff3, KERNAL, () => { cpu.x = 0x00; cpu.y = 0xdc; return this.rts(); });
    this.trap(0xe716, KERNAL, () => { this.print(cpu.a); return this.rts(); });
    // the routines behind the RAM vectors
    this.trap(0xf13e, KERNAL, () => {
      let key = 0;
      if (m.ram[0xc6]) { key = m.ram[0x0277]; m.ram.copyWithin(0x0277, 0x0278, 0x0281); m.ram[0xc6]--; }
      else if (m.input.petscii) { key = m.input.petscii; m.input.petscii = 0; }
      cpu.a = key; cpu.n = key & 0x80; cpu.z = key ? 0 : 1; cpu.c = 0;
      return this.rts();
    });
    this.trap(0xf157, KERNAL, () => { cpu.a = 0x0d; cpu.c = 0; return this.rts(); });
    this.trap(0xf6ed, KERNAL, () => { cpu.z = 0; return this.rts(); });
    this.trap(0xf34a, KERNAL, () => { cpu.a = 5; cpu.c = 1; return this.rts(); });
    for (const a of [0xf291, 0xf333, 0xf32f, 0xf20e, 0xf250]) this.trap(a, KERNAL, () => { cpu.c = 0; return this.rts(); });
  }

  private jiffy(): void {
    const ram = this.m.ram;
    // (++ on a typed array element gives 256, not the 0 it stores)
    ram[0xa2]++;
    if (ram[0xa2] === 0) { ram[0xa1]++; if (ram[0xa1] === 0) ram[0xa0]++; }
  }

  /** after a stand-in BASIC routine: return when it was called (JSR), go on with RUN when it was jumped to */
  private returnsOrRuns(): boolean {
    if (this.m.cpu.lastOp === 0x20) return this.rts();
    this.runBasic(true);
    return true;
  }

  /** BASIC's LINKPRG: set every line's link to the line after it */
  private relink(): void {
    const m = this.m;
    let a = m.ram[0x2b] | (m.ram[0x2c] << 8);
    for (let n = 0; n < 2000; n++) {
      if (!m.ram[(a + 1) & 0xffff]) break;
      let p = (a + 4) & 0xffff;
      while (m.ram[p] && p < 0xffff) p++;
      const next = p + 1;
      m.write(a, next & 0xff); m.write((a + 1) & 0xffff, next >> 8);
      a = next;
    }
  }

  /** The stand-in SYS: registers from $030c-$030f, and a return address that lands on a trap. */
  private sys(addr: number): void {
    const m = this.m, c = m.cpu;
    c.a = m.ram[0x030c]; c.x = m.ram[0x030d]; c.y = m.ram[0x030e]; c.p = m.ram[0x030f];
    m.write(0x100 | c.s, SYS_RETURN >> 8); c.s = (c.s - 1) & 0xff;
    m.write(0x100 | c.s, SYS_RETURN & 0xff); c.s = (c.s - 1) & 0xff;
    c.pc = addr;
    c.lastOp = 0x20;
  }

  /**
   * The stand-in BASIC: runs the statements a packer's start line has (SYS, POKE, PRINT, REM, CLR, END). Anything
   * else needs the real BASIC.
   */
  private runBasic(fromStart: boolean): void {
    const m = this.m;
    const peek = (a: number) => m.peek(a);
    if (fromStart) {
      const start = m.ram[0x2b] | (m.ram[0x2c] << 8);
      this.basicStatements = basicLines(peek, start, 256).flatMap(l => statements(l.bytes));
      this.basicPos = 0;
      this.basicGoesOn(start - 1);
    }
    this.basicRunning = true;
    while (this.basicPos < this.basicStatements.length) {
      const st = this.basicStatements[this.basicPos++];
      const k = st.findIndex(b => b !== 0x20);
      if (k < 0) continue;
      const op = st[k], rest = st.slice(k + 1);
      if (op === T.REM || op === T.PRINT || op === T.CLR) continue;
      if (op === T.END || op === T.STOP) break;
      if (op === T.SYS) {
        const r = evaluate(rest, peek);
        if (!r) { this.stop('needs-rom', 'the SYS needs the real BASIC to work out'); return; }
        this.m.cpu.s = 0xf8;
        this.sys(Math.trunc(r.value) & 0xffff);
        return;
      }
      if (op === T.POKE) {
        const a = evaluate(rest, peek);
        const v = a && a.rest[0] === 0x2c ? evaluate(a.rest.slice(1), peek) : null;
        if (!a || !v) { this.stop('needs-rom', 'the POKE needs the real BASIC to work out'); return; }
        m.write(Math.trunc(a.value) & 0xffff, Math.trunc(v.value) & 0xff);
        continue;
      }
      this.stop('needs-rom', 'the BASIC program needs the ROM files to run');
      return;
    }
    this.basicRunning = false;
    // a file that loads below BASIC's start and ran no machine code with RUN: SYS to where it loads, as with the ROMs
    if (!this.started && !this.triedSys && this.loadAt !== 0x0801) {
      this.triedSys = true;
      this.m.cpu.s = 0xf8;
      this.sys(this.loadAt);
      return;
    }
    this.stop('ready', 'the BASIC program ended');
  }

  // --- the result ---------------------------------------------------------------------------------------------------

  private finish(ms: number): UnpackResult {
    const m = this.m;
    const last = this.layers[this.layers.length - 1];
    if (last) {
      last.activity = activity(m, this.eid, last.id, last.icount);
      last.activity.kind = 'program';
      this.keep(last);
    }
    const peekFile = (a: number) => a >= this.loadAt && a < this.loadAt + this.data.length ? this.data[a - this.loadAt] : 0;
    const basic = this.hasBasic(0x0801) ? basicLines(peekFile, 0x0801, 8).map(listLine) : [];
    const reports = this.layers.map((l, i) => this.report(l, i));
    const save = (index: number, clean = this.o.clean ?? false): Saved | null => this.saveLayer(index, clean);
    // a last layer that soon resets or crashes is not a program (an intro's exit, a protection's trap)
    let best = this.layers.length - 1;
    const r = this.stopInfo.reason;
    if (best > 0 && (r === 'reset' || r === 'jam' || r === 'brk') && last.activity!.instructions < 2000) best--;
    const want = this.o.layer ?? (best > 0 ? best : -1);
    return {
      unpacked: best > 0,
      stop: this.stopInfo,
      layers: reports,
      saved: want >= 0 ? save(want) : null,
      save,
      basic,
      roms: this.real ? this.o.roms!.source : 'stand-ins (no ROM files)',
      drive: this.drive ? `${this.driveNote}, ${this.drive.bytesRead} bytes read${this.drive.bytesWritten ? `, ${this.drive.bytesWritten} written` : ''}` : this.driveNote,
      tape: this.tape ? this.tapeNote() : null,
      cycles: this.started ? m.cycles - this.startCycle : 0,
      ms,
      fileUse: fileUse(m),
    };
  }

  /** the datasette: where the tape stood, how far it played, as seconds of tape */
  private tapeNote(): string {
    const t = this.tape!, p = t.pulses;
    if (t.t64 != null) {
      // a T64: which file it stood before, and before which it stands now
      const at = (slot: number) => { const f = this.tapeKernal.find(x => x.at >= slot); return f ? `before file ${f.at + 1}` : 'at its end'; };
      const from = this.tapeFile ? 'after the file' : this.o.tapeAt != null ? 'where asked' : 'at the start';
      return `datasette: a T64 of ${this.tapeKernal.length} file${this.tapeKernal.length === 1 ? '' : 's'}, the tape stood ${from} (${at(this.tapeStart)}), now ${at(t.pos)}`;
    }
    let before = 0, played = 0;
    for (let i = 0; i < this.tapeStart && i < p.length; i++) before += p[i];
    for (let i = this.tapeStart; i < t.pos && i < p.length; i++) played += p[i];
    const s = (c: number) => `${(c / 985248).toFixed(1)} s`;
    const from = this.tapeFile ? 'after the file' : this.o.tapeAt != null ? 'where asked' : 'at the start';
    return `datasette: the tape stood ${from} (${s(before)}), played ${s(played)}${t.atEnd ? ' to its end' : ''}, ${t.pos - this.tapeStart} pulses`;
  }

  private report(l: Layer, index: number): LayerReport {
    const a = l.activity ?? activity(this.m, this.eid, l.id, l.icount);
    const ram = l.snapshot.ram;
    const around = a.code.map(r => ({ start: Math.max(0, r.start - 256), end: Math.min(0xffff, r.end + 256) }));
    const packer = a.kind === 'program' ? null : identify(a.opcodes);
    const range = index > 0 && l.mask ? this.rangeOf(l) : null;
    return {
      index, entry: l.entry, via: l.via, from: l.from, cycle: l.cycle - this.startCycle, basic: l.basic,
      kind: a.kind, code: a.code, instructions: a.instructions,
      written: a.written, writtenBytes: a.writtenBytes, read: a.read, readBytes: a.readBytes,
      calls: l.calls, fingerprint: fingerprintId(a.opcodes), opcodes: a.opcodes, packer,
      text: strings(p => ram[p], around).slice(0, 12),
      printed: l.printed, presses: l.presses,
      range,
      // (a small part far from the rest is left out of the range, as the program's own small parts are)
      kept: l.kept.filter(k => range && k.start <= range.end && k.end >= range.start)
        .map(k => ({ layer: this.layers.findIndex(o => o.id === k.owner), start: k.start, end: k.end })),
      loaded: l.loaded.filter(k => range && k.start <= range.end && k.end >= range.start),
    };
  }

  private rangeOf(l: Layer): Range | null {
    const ram = l.snapshot.ram, mask = l.live ?? l.mask!;
    if (!l.basic) return saveRange(mask, [l.entry]);
    const start = ram[0x2b] | (ram[0x2c] << 8), end = (ram[0x2d] | (ram[0x2e] << 8)) - 1;
    const r = saveRange(mask, [start]);
    return { start: Math.min(r?.start ?? start, start), end: Math.max(r?.end ?? end, end) };
  }

  private saveLayer(index: number, clean: boolean): Saved | null {
    const l = this.layers[index];
    if (!l) return null;
    const s = l.snapshot;
    if (index === 0) {
      return { layer: 0, prg: this.file.slice(), start: this.loadAt, end: this.loadAt + this.data.length - 1, entry: l.entry, basic: false, port: s.port, interrupts: !(s.p & 4) };
    }
    const range = this.rangeOf(l);
    if (!range) return null;
    const prg = buildPrg(l.image ?? s.ram, range, clean ? l.live ?? l.mask! : undefined);
    // the name LOAD left below $a000 is the run's, not the program's, unless the program loaded a file by it (a split
    // freeze does): what was there before, where nothing wrote it since and the file did not load over it
    const n = this.loadName;
    if (n && !n.used) for (let i = 0; i < n.bytes.length; i++) {
      const a = n.at + i, k = 2 + a - range.start;
      if (k < 2 || k >= prg.length || (a >= this.loadAt && a < this.loadAt + this.data.length)) continue;
      if (prg[k] === n.bytes[i] && this.m.wtime[a] <= n.icount) prg[k] = n.before[i];
    }
    const basicStart = s.ram[0x2b] | (s.ram[0x2c] << 8);
    const entry = l.basic ? findSys(a => s.ram[a], basicStart) ?? basicStart : l.entry;
    return { layer: index, prg, start: range.start, end: range.end, entry, basic: l.basic, port: s.port, interrupts: !(s.p & 4) };
  }
}

/** Power a C64 on and run it to the READY prompt waiting for a key: its state then, or null when it does not get there. */
function bootC64(roms: Roms): MachineState | null {
  const m = new C64(roms), cpu = m.cpu;
  // power on: the port is all inputs (every ROM visible), SP = $fd after the reset sequence
  m.ddr = 0; m.port = 0; m.updateMap();
  cpu.s = 0xfd; cpu.p = 0x24;
  cpu.pc = m.peekWord(0xfffc);
  let nmiWas = false;
  while (m.cycles < BOOT_CYCLES) {
    if (cpu.pc === READY_WAITS && m.map[READY_WAITS >> 8] === KERNAL && !m.ram[0xc6]) return m.save();
    const iWas = cpu.i;
    m.dmaWait();
    const cycles = cpu.step();
    m.icount++;
    if (cpu.jammed) return null;
    m.advance(cycles);
    if (m.irqLine && !(cpu.lastOp === 0x40 ? cpu.i : iWas)) m.advance(cpu.irq());
    const nmi = m.nmiLine;
    if (nmi && !nmiWas) m.advance(cpu.nmi());
    nmiWas = nmi;
  }
  return null;
}

/** Power a 1541 on, without a disk, and let it start up: its state then. */
function bootDrive(rom: Uint8Array): DriveState {
  const d = new Drive(rom);
  while (d.cycles < DRIVE_BOOT) d.step();
  return d.save();
}

function checksum(bytes: Uint8Array): string {
  let h = 0;
  for (let i = 0; i < bytes.length; i++) h = (Math.imul(h, 31) + bytes[i]) >>> 0;
  return h.toString(16);
}
