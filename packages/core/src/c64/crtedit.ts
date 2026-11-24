/* A cartridge image (.crt) to make and change (spec 10.3): the header's fields and the CHIP packets as a list, written
 * as an image again. An image read and written without a change is the image it was, byte for byte: the header's
 * reserved bytes, a header longer than 64 bytes, a packet longer than its data and bytes after the last packet are kept.
 * A new one has the standard structure of its hardware type (crt-layouts.ts), as VICE's cartconv writes it.
 *
 * programCartridge makes a cartridge that starts a program: a Magic Desk cartridge whose boot bank copies the program
 * to where it loads, turns the cartridge off and starts it (RUN for a BASIC program, a jump for the others). */
import type { Addr } from '../types';
import type { CartMode } from './memconfig';
import { crtMode, parseCrt } from './crt';
import { crtLayout, type CrtLayout } from './crt-layouts';

const MAGIC = 'C64 CARTRIDGE   ';
const HEADER = 0x40;
const CHIP_HEADER = 0x10;
/** the most bytes a chip has (its size is a 16-bit field), and the most of an image a script makes */
export const CRT_CHIP_MAX = 0xffff;
export const CRT_IMAGE_MAX = 32 * 1024 * 1024;

export interface CrtEditChip {
  /** 0 ROM, 1 RAM, 2 Flash, 3 EEPROM */
  type: number;
  bank: number;
  /** the address the image maps it at */
  load: Addr;
  data: Uint8Array;
  /** what the packet has after its data (a packet longer than its data), and the length it says when that is not
   *  its header and data: both as the image had them */
  extra?: Uint8Array; length?: number;
}

/** "CBM80" as the KERNAL looks for it at $8004: the letters with their top bit set */
export const CBM80 = Uint8Array.of(0xc3, 0xc2, 0xcd, 0x38, 0x30);

export class CrtEdit {
  name = '';
  version: [number, number] = [1, 0];
  hw = 0;
  revision = 0;
  /** the EXROM and GAME lines at reset: 0 pulls the line low (active) */
  exrom = 0;
  game = 1;
  chips: CrtEditChip[] = [];
  /** the header's reserved bytes ($1b-$1f), what a longer header has after the name, the header length the image
   *  says, and what comes after the last packet */
  private reserved: Uint8Array = new Uint8Array(5);
  private headerRest: Uint8Array = new Uint8Array(0);
  private headerLength = HEADER;
  private tail: Uint8Array = new Uint8Array(0);
  /** the name's 32 bytes as the image had them (what follows its first zero is kept until the name is set) */
  private nameBytes: Uint8Array | null = null;

  /** An image opened: refused with the reason when it is not a C64 cartridge's. */
  static open(bytes: Uint8Array, name = 'cartridge'): CrtEdit {
    const c = parseCrt(bytes, name), e = new CrtEdit();
    e.name = c.name; e.version = [c.version[0], c.version[1]]; e.hw = c.hw; e.revision = c.revision; e.exrom = c.exrom; e.game = c.game;
    e.reserved = bytes.slice(0x1b, 0x20); e.nameBytes = bytes.slice(0x20, 0x40);
    e.headerRest = bytes.slice(HEADER, c.headerLength);
    e.headerLength = ((bytes[0x10] << 24) | (bytes[0x11] << 16) | (bytes[0x12] << 8) | bytes[0x13]) >>> 0;
    let end = c.headerLength;
    c.chips.forEach((x, i) => {
      const next = i + 1 < c.chips.length ? c.chips[i + 1].offset : Math.min(bytes.length, x.offset + Math.max(x.length, CHIP_HEADER + x.data.length));
      const extra = bytes.slice(x.dataOffset + x.data.length, next);
      e.chips.push({ type: x.type, bank: x.bank, load: x.load, data: x.data.slice(), ...(extra.length ? { extra } : {}), ...(x.length !== CHIP_HEADER + x.data.length + extra.length ? { length: x.length } : {}) });
      end = next;
    });
    e.tail = bytes.slice(end);
    return e;
  }

  /** A new cartridge with a standard structure: its chips filled with `fill`, then with `data` in the image's order. */
  static of(layout: CrtLayout, o: { name?: string; fill?: number; data?: Uint8Array } = {}): CrtEdit {
    const e = new CrtEdit();
    e.name = o.name ?? ''; e.hw = layout.hw; e.exrom = layout.exrom; e.game = layout.game;
    let at = 0;
    for (const c of layout.chips) {
      const data = new Uint8Array(c.size).fill(o.fill ?? 0xff);
      if (o.data && at < o.data.length) data.set(o.data.subarray(at, at + c.size));
      at += c.size;
      e.chips.push({ type: c.type, bank: c.bank, load: c.load, data });
    }
    return e;
  }

  get mode(): CartMode { return crtMode(this.exrom, this.game); }
  /** the bank the C64 starts in: the lowest */
  get bootBank(): number { return this.chips.length ? Math.min(...this.chips.map(c => c.bank)) : 0; }
  /** the bank numbers, in order */
  get banks(): number[] { return [...new Set(this.chips.map(c => c.bank))].sort((a, b) => a - b); }
  /** the bytes of ROM, RAM and Flash in the chips */
  get total(): number { return this.chips.reduce((n, c) => n + c.data.length, 0); }

  /** Where the CPU sees a chip: where the image maps it, but ROMH of an Ultimax cartridge's boot bank kept at $a000
   *  (an EasyFlash's) at $e000 (crt.ts chipAddress). */
  address(chip: CrtEditChip): Addr {
    return this.mode === 'ultimax' && chip.bank === this.bootBank && chip.load === 0xa000 && chip.data.length <= 0x2000 ? 0xe000 : chip.load;
  }

  /** the chip of `bank` that holds the address `a` (as the image maps it, or as the CPU sees it); -1: none */
  chipAt(bank: number, a: Addr): number {
    const at = (load: Addr, c: CrtEditChip) => a >= load && a < load + c.data.length;
    const i = this.chips.findIndex(c => c.bank === bank && at(c.load, c));
    return i >= 0 ? i : this.chips.findIndex(c => c.bank === bank && at(this.address(c), c));
  }

  setName(name: string): void { this.name = name; this.nameBytes = null; }

  /** How the C64 starts the cartridge, from its boot bank: the CBM80 vectors at $8000 (8K and 16K mode), or the
   *  CPU's own at $fffa (Ultimax mode); null when it has neither. */
  get start(): { kind: 'cbm80'; cold: Addr; warm: Addr } | { kind: 'vectors'; nmi: Addr; reset: Addr; irq: Addr } | null {
    const bank = this.bootBank, w = (c: CrtEditChip, o: number) => c.data[o] | (c.data[o + 1] << 8);
    if (this.mode === 'ultimax') {
      const i = this.chipAt(bank, 0xfffa), c = this.chips[i];
      if (!c) return null;
      const o = 0xfffa - (0xfffa >= c.load && 0xfffa < c.load + c.data.length ? c.load : this.address(c));
      return o + 6 <= c.data.length ? { kind: 'vectors', nmi: w(c, o), reset: w(c, o + 2), irq: w(c, o + 4) } : null;
    }
    const c = this.chips.find(x => x.bank === bank && x.load === 0x8000 && x.data.length >= 9);
    return c && CBM80.every((v, k) => c.data[4 + k] === v) ? { kind: 'cbm80', cold: w(c, 0), warm: w(c, 2) } : null;
  }

  /** The image. */
  image(): Uint8Array {
    const size = HEADER + this.headerRest.length + this.chips.reduce((n, c) => n + CHIP_HEADER + c.data.length + (c.extra?.length ?? 0), 0) + this.tail.length;
    const out = new Uint8Array(size);
    const w16 = (at: number, v: number) => { out[at] = (v >> 8) & 0xff; out[at + 1] = v & 0xff; };
    const w32 = (at: number, v: number) => { w16(at, v >>> 16); w16(at + 2, v & 0xffff); };
    for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC.charCodeAt(i);
    w32(0x10, this.headerLength === HEADER + this.headerRest.length || this.headerLength < HEADER ? this.headerLength : HEADER + this.headerRest.length);
    out[0x14] = this.version[0]; out[0x15] = this.version[1]; w16(0x16, this.hw);
    out[0x18] = this.exrom; out[0x19] = this.game; out[0x1a] = this.revision; out.set(this.reserved, 0x1b);
    if (this.nameBytes) out.set(this.nameBytes, 0x20);
    else for (let i = 0; i < Math.min(32, this.name.length); i++) out[0x20 + i] = this.name.charCodeAt(i) & 0xff;
    out.set(this.headerRest, HEADER);
    let p = HEADER + this.headerRest.length;
    for (const c of this.chips) {
      const n = CHIP_HEADER + c.data.length + (c.extra?.length ?? 0);
      out[p] = 0x43; out[p + 1] = 0x48; out[p + 2] = 0x49; out[p + 3] = 0x50;
      w32(p + 4, c.length ?? n); w16(p + 8, c.type); w16(p + 10, c.bank); w16(p + 12, c.load); w16(p + 14, c.data.length);
      out.set(c.data, p + CHIP_HEADER);
      if (c.extra) out.set(c.extra, p + CHIP_HEADER + c.data.length);
      p += n;
    }
    out.set(this.tail, p);
    return out;
  }
}

/* ---- a cartridge that starts a program ---- */

/** the banks a Magic Desk cartridge comes with (crt-layouts.ts 'md') */
const MD_BANKS = [4, 8, 12, 16, 32, 64, 128];

export interface ProgramCartridge { crt: CrtEdit; /** where the boot starts, where the program's bytes start in bank 0, and how the program is started */ cold: Addr; data: Addr; banks: number; basic: boolean; start: Addr }

/**
 * A Magic Desk cartridge that starts a program. Its boot bank has the CBM80 vectors and the boot at $8000: it sets the
 * C64 up as the KERNAL's reset does (with the top of memory at $a000, as without a cartridge) and BASIC as its cold
 * start does, copies a routine of some 70 bytes to $0100 and jumps to it. That one copies the program from the banks,
 * one after the other, to where it loads (with all RAM in while it writes a byte, so a program under the ROMs and the
 * I/O loads as well), turns the cartridge off ($de00 = $80) and starts the program: `basic` (taken when it loads at
 * $0801 and no start is given) sets the end of the program and RUNs it, the others are jumped to at `start` (where it
 * loads, when not given). The program is seen as loaded by LOAD and started by RUN or SYS: $01 is $37.
 */
export function programCartridge(load: Addr, program: Uint8Array, o: { name?: string; start?: Addr; basic?: boolean } = {}): ProgramCartridge {
  const end = load + program.length;
  if (!program.length) throw new RangeError('the program has no bytes');
  if (load < 0x0200) throw new RangeError(`the program loads at $${load.toString(16).padStart(4, '0')}: the cartridge's boot has its copying routine in the stack page, so from $0200`);
  if (end > 0x10000) throw new RangeError('the program ends past $ffff');
  const basic = o.basic ?? (o.start == null && load === 0x0801), start = o.start ?? load;
  const lo = (v: number) => v & 0xff, hi = (v: number) => (v >> 8) & 0xff;
  // the routine at $0100: copy until the destination is the end, a bank after the other
  const mover: number[] = [
    0xa0, 0x00,             // 0100 ldy #$00
    0xb1, 0xfb,             // 0102 lda ($fb),y          a byte of the cartridge
    0xa2, 0x34, 0x86, 0x01, // 0104 ldx #$34 / stx $01   all RAM in
    0x91, 0xfd,             // 0108 sta ($fd),y
    0xa2, 0x37, 0x86, 0x01, // 010a ldx #$37 / stx $01
    0xe6, 0xfd, 0xd0, 0x02, 0xe6, 0xfe,             // 010e inc $fd / bne $0114 / inc $fe
    0xe6, 0xfb, 0xd0, 0x14,                         // 0114 inc $fb / bne $012c
    0xe6, 0xfc, 0xa5, 0xfc, 0xc9, 0xa0, 0xd0, 0x0c, // 0118 inc $fc / lda $fc / cmp #$a0 / bne $012c
    0xa9, 0x80, 0x85, 0xfc,                         // 0120 lda #$80 / sta $fc    the next bank, from $8000:
    0xee, 0x28, 0x01, 0xa9, 0x00, 0x8d, 0x00, 0xde, // 0124 inc $0128 / lda #bank / sta $de00   (counted here: $de00 is not read back)
    0xa5, 0xfd, 0xc9, lo(end), 0xd0, 0xd0,          // 012c lda $fd / cmp #<end / bne $0102
    0xa5, 0xfe, 0xc9, hi(end), 0xd0, 0xca,          // 0132 lda $fe / cmp #>end / bne $0102
    0xa9, 0x80, 0x8d, 0x00, 0xde,                   // 0138 lda #$80 / sta $de00   the cartridge off
  ];
  if (basic) mover.push(0xa9, lo(end), 0x85, 0x2d, 0xa9, hi(end), 0x85, 0x2e, 0x58, 0x20, 0x59, 0xa6, 0x4c, 0xae, 0xa7); // end of the program / cli / jsr $a659 (CLR) / jmp $a7ae (RUN)
  else mover.push(0x58, 0x4c, lo(start), hi(start));                                                                  // cli / jmp start
  const cold = 0x8009;
  const boot: number[] = [
    0x78,                         // sei
    0x8e, 0x16, 0xd0,             // stx $d016
    0x20, 0xa3, 0xfd,             // jsr $fda3   the I/O
    0x20, 0x50, 0xfd,             // jsr $fd50   RAM (the top of memory is the cartridge's start now)
    0xa2, 0x00, 0xa0, 0xa0, 0x18, 0x20, 0x99, 0xff, // ldx #$00 / ldy #$a0 / clc / jsr $ff99   … so $a000 again
    0x20, 0x15, 0xfd,             // jsr $fd15   the KERNAL's vectors
    0x20, 0x5b, 0xff,             // jsr $ff5b   the screen
    0x20, 0x53, 0xe4,             // jsr $e453   BASIC's vectors
    0x20, 0xbf, 0xe3,             // jsr $e3bf   BASIC's RAM
    0x20, 0x22, 0xe4,             // jsr $e422   its start-up message, NEW
    0xa2, 0xfb, 0x9a,             // ldx #$fb / txs
    0x78,                         // sei
  ];
  const at = (n: number) => cold + n;
  // copy the routine, set the pointers, go
  const tail = (moverAt: Addr, dataAt: Addr): number[] => [
    0xa2, mover.length - 1,                 // ldx #len-1
    0xbd, lo(moverAt), hi(moverAt),         // lda mover,x
    0x9d, 0x00, 0x01,                       // sta $0100,x
    0xca, 0x10, 0xf7,                       // dex / bpl
    0xa9, lo(dataAt), 0x85, 0xfb, 0xa9, hi(dataAt), 0x85, 0xfc,
    0xa9, lo(load), 0x85, 0xfd, 0xa9, hi(load), 0x85, 0xfe,
    0x4c, 0x00, 0x01,                       // jmp $0100
  ];
  const tailLen = tail(0, 0).length, moverAt = at(boot.length + tailLen), dataAt = moverAt + mover.length;
  const code = [...boot, ...tail(moverAt, dataAt), ...mover];
  // $fe5e as the warm start: the KERNAL's NMI goes on as it does without a cartridge
  const head = [lo(cold), hi(cold), 0x5e, 0xfe, ...CBM80, ...code];
  const all = new Uint8Array(head.length + program.length);
  all.set(head); all.set(program, head.length);
  const need = Math.ceil(all.length / 0x2000), banks = MD_BANKS.find(n => n >= need)!;
  const crt = CrtEdit.of(crtLayout('md', banks * 0x2000)!, { name: o.name ?? '', data: all });
  return { crt, cold, data: dataAt, banks, basic, start: basic ? 0xa7ae : start };
}
