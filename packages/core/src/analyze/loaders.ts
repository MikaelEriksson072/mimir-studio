/* 5.15 Loaders (spec 8.11c): the fast, IRQ and tape loaders in the program.
 *
 * Spindle, Krill's loader, Bitfire, Sparkle and the Covert Bitops loader are known by their own receive loops, install
 * commands and texts; the byte patterns come from their sources (Spindle 3.1 stage1.s, Krill's loader v194
 * hal-c64-c128.inc and install.s, Bitfire resident.asm, Sparkle sl.asm, Covert Bitops loader v3 loader.s). The Action
 * Replay's loaders (Datel) come from its ROMs (5.1, 7.2 and 7.5 keep the same code in other places; 7.2's turbo tape differs), the backups and loader files
 * they saved in VICE, and the MK4's loader file; Novaload is in the 7.2, whose Nova transfer reads such tapes with
 * Novaload's own code. The Super Snapshot's (LMS) come from the V5's ROM and what it ran and saved in VICE: its turbo
 * reads Warp*25 files with the Action Replay's code, and its split backups start with the Action Replay's loader. Any other
 * loader is known by what every disk loader has (Spindle 2.3 and an older Bitfire were read from their releases' binaries): code for the 1541 (it reads and writes the drive's VIA registers at
 * $1800 and $1c00, and waits for GCR bytes with bvc *), drive commands that upload and start it (M-W, M-E, M-R) and a
 * receive loop that reads the serial bus at $dd00 again and again. A tape turbo loader reads CIA1's FLAG line and times
 * the pulses with a CIA timer; the KERNAL's own LOAD is a call to $ffd5. */
import type { Addr, Block, LoaderFinding, LoaderId, LoaderPart } from '../types';
import type { Ctx } from './context';
import { $4 } from '../util/hex';
import { parseVsf } from '../c64/vsf';

type Pattern = (Set<number> | null)[];
/** hex bytes, `..` for any byte, `a|b` for either */
const pat = (s: string): Pattern => s.trim().split(/\s+/).map(t => (t === '..' ? null : new Set(t.split('|').map(x => parseInt(x, 16)))));

interface Sign {
  pat: Pattern; role: LoaderPart['role']; what: string;
  /** the match starts the resident page: the part is that page */
  page?: boolean;
  /** a resident part at a fixed place: the part is all of it when the match is inside */
  fixed?: [Addr, Addr];
  /** code kept to be copied elsewhere (to the drive, the stack page): the part is these bytes from the match, unless it
   *  is traced code here */
  span?: [number, number];
  /** other loaders have it too: it counts only with the loader's own code */
  weak?: boolean;
}
interface Known {
  id: LoaderId; name: string; how: string; signs: Sign[];
  /** a name it writes somewhere */
  text?: string;
  /** loaders of one make (the Action Replay's): what every disk loader has goes to the main one of them */
  group?: string; main?: boolean;
  /** another make's loader whose code this one has too (the Super Snapshot reads Warp*25 files with the Action
   *  Replay's code): found with this one's own code, its parts are this one's */
  claims?: LoaderId[];
  /** it loads through the KERNAL: drive code and drive commands are not its */
  kernal?: boolean;
}

const KNOWN: Known[] = [
  {
    id: 'spindle', name: 'Spindle (lft)', how: '2-bit + ATN, synchronous; one resident page that the program calls with jsr, the VIC bank set through $dd02',
    signs: [
      { pat: pat('A9 18 80 01 C9 38 F0 .. 8D 00 DD 2C 00 DD 30 .. 50'), role: 'resident', what: 'resident page (jsr here to load the next part)', page: true },
      { pat: pat('4D 00 DD 8F 00 DD 4A 4A C8 8C'), role: 'resident', what: 'receive loop (eor $dd00 / sax $dd00)' },
      // Spindle 2: two resident pages at $0c00-$0dff, loading with jsr $0c90, bytes decoded through a table
      { pat: pat('AE 00 DD 8C 00 DD 5D'), role: 'resident', what: 'Spindle 2 receive loop (ldx $dd00 / sty $dd00 / eor table,x)', fixed: [0x0c00, 0x0e00] },
    ],
  },
  {
    id: 'krill', name: "Krill's loader (Krill/Plush)", how: '2-bit + ATN, the serial bus driven through $dd02 ($37 and $3f)',
    signs: [
      { pat: pat('1D C9 DC 8E 02 DD 6A 6A A2 3F 87|8F'), role: 'resident', what: 'receive loop (ora $dcc9,x / stx $dd02)' },
      { pat: pat('6D|7D 00|C9 DD|DC 8E 02 DD C8 F0 .. 4A 4A A2 3F'), role: 'resident', what: 'receive loop (adc $dd00 / stx $dd02 / iny)' },
    ],
    text: 'KRILL.',
  },
  {
    id: 'bitfire', name: 'Bitfire (Bitbreaker/Oxyron)', how: '2-bit + ATN, the serial bus driven through $dd02 ($3f)',
    signs: [
      { pat: pat('6D 00 DD 8E 02 DD 4A 4A 88 C0 01 A2 3F'), role: 'resident', what: 'receive loop (adc $dd00 / stx $dd02 / dey)' },
      { pat: pat('0D 00 DD 8E 02 DD 6A 6A A2 3F 8F'), role: 'resident', what: 'receive loop (ora $dd00 / stx $dd02)' },
      // an older Bitfire: lda $dcc9,y / sty $dd02 (Krill's loader indexes with x)
      { pat: pat('A0 37 B9 C9 DC 8C 02 DD 4A 4A'), role: 'resident', what: 'receive loop (lda $dcc9,y / sty $dd02)' },
    ],
  },
  {
    id: 'sparkle', name: 'Sparkle (Sparta/OMG)', how: '2-bit + ATN; the resident part lives at $0160 and $0200',
    signs: [
      // dex or inx, ora #$00 or #$01: the versions differ there
      { pat: pat('AD 00 DD 8C 00 DD 4A 4A CA|E8 EA A0 C0 0D 00 DD 8C 00 DD 4A 4A'), role: 'resident', what: 'receive loop (lda $dd00 / sty $dd00)' },
      { pat: pat('2D 00 DD 8D 00 DD 09 00|01 9D .. .. 50'), role: 'resident', what: 'receive loop (and $dd00 / sta $dd00 / sta buffer,x)' },
    ],
    text: 'SPARKLE',
  },
  {
    id: 'covert', name: 'Covert Bitops loader (Cadaver)', how: '2-bit, the C64 reads $dd00 four times per byte (lsr / lsr / eor $dd00)',
    signs: [
      // waits out badlines, then pulls CLK and reads with the classic loop (which older loaders use too)
      { pat: pat('AD 11 D0 18 ED 12 D0 29 07 F0 .. A9 10 0D 00 DD 8D 00 DD'), role: 'resident', what: 'receive loop (waits for no badline, then lda $dd00 / lsr / lsr / eor $dd00 …)' },
      { pat: pat('.. 04|05|06|07 .. 57 2D 4D'), role: 'command', what: 'drive command M-W, stored backwards (its installer sends it from the end)' },
    ],
  },
  // the Action Replay: its ROM holds the code it copies to the stack page and the drive, and the loader file it saves
  // with a Warp*25 backup has the same code
  {
    id: 'ar-fastload', name: 'Action Replay fastload (Datel)', group: 'actionreplay', main: true,
    how: '2-bit, the classic loop (lda $dd00 / lsr / lsr / eor $dd00 …) on a line with no badline; its drive code runs at $0300 in a 1541 (a 1581 has code of its own), and the cartridge banks itself in and out through $de00',
    signs: [
      { pat: pat('2C 00 DD 50 FB 38 AD 12 D0 E5 AA 90 04 29 07 F0 F5 A5 A8 8D 00 DD'), role: 'resident', what: 'receives a byte: waits for the drive and for a line with no badline, then reads the serial bus four times' },
      { pat: pat('2C 00 DD 50 FB A6 9E AD 12 D0 C9 31 90 06 29 06 C9 02 F0 F3 8E 00 DD'), role: 'resident', what: 'receives the bytes (MK4): waits for the drive and for a line with no badline, then reads the serial bus four times' },
      { pat: pat('AD 00 DD 4A 4A 0D 00 DD 4A 4A EA EA 0D 00 DD 4A 4A 0D 00 DD 99 00 02'), role: 'resident', what: 'receives a block of 256 bytes into $0200 (lda $dd00 / lsr / lsr / ora $dd00 …)' },
      { pat: pat('A9 23 8D 00 DE B9 00 02 91 0F C8 D0 F8'), role: 'resident', what: 'copies each block from $0200 into memory with the cartridge banked out ($de00); it runs in the stack page ($013f)', span: [0, 0x80] },
      { pat: pat('78 20 .. 01 A9 7A 8D 02 18 20 E9 F5 20 62 01 4C 00 03'), role: 'drivecode', what: 'code for the 1541 at $0150: it receives the rest of the drive code fast, then starts it at $0300', span: [0, 0x46] },
      { pat: pat('BA 8E 3D 03 88 8C AF 02 C8 84 11 C8 84 1C'), role: 'drivecode', what: 'code for the 1541 at $0300: it reads the file and sends it a sector at a time', span: [0, 0x2f3] },
      { pat: pat('78 A9 D8 8D 01 40 A5 4C AE 8B 02 85 0B'), role: 'drivecode', what: 'code for the 1581 at $0500 (its serial port is the CIA at $4000)', span: [0, 0x23f] },
      { pat: pat('A9 4D 20 A8 FF A9 2D 20 A8 FF 8A 4C A8 FF'), role: 'install', what: 'sends the drive commands M-W, M-E and M-R (lda #"M" / jsr CIOUT / lda #"-" / jsr CIOUT / txa / jmp CIOUT)' },
    ],
  },
  {
    id: 'ar-warp', name: 'Action Replay Warp*25 (Datel)', group: 'actionreplay',
    how: 'Datel\'s own disk format, about 25 times as fast as the 1541: drive code at $0400 reads it, and the C64 takes three bytes a round onto the stack (lda $dd00 / lsr / lsr / eor $dd00 … pha) and decodes them (eor #$f9); the loader file saved with a backup starts the drive code with B-E from track 18',
    signs: [
      { pat: pat('4A 4A 4D 00 DD 48 AD 00 DD 4A 4A 4D 00 DD'), role: 'resident', what: 'receive loop: three bytes a round, pushed onto the stack (lda $dd00 / lsr / lsr / eor $dd00 … pha)' },
      // MK4 banks the ROMs out with dec $01, the later ones with inc $01
      { pat: pat('C6|E6 01 68 49 F9 88 91 AE D0 F8 E6|C6 01'), role: 'resident', what: 'takes the bytes off the stack, decodes them (pla / eor #$f9) and stores them with the ROMs banked out; it runs at $0200', span: [0, 0x1c] },
      { pat: pat('A2 20 8E 00 DE 18 65 0E 85 10 A9 02 85 0F'), role: 'resident', what: 'moves the loaded sectors on with the cartridge banked out ($de00); it runs in the stack page ($013f)', span: [0, 0x80] },
      { pat: pat('4C 56 04 A9 B0 20 85 03 28 D0 F5 A5 0E 85 18 A5 0F 85 19'), role: 'drivecode', what: 'code for the 1541 at $0400: it reads the Warp*25 sectors', span: [0, 0x300] },
      { pat: pat('42 2D 45 20 32 20 30 20 31 38 20 35|36'), role: 'command', what: 'drive command B-E 2 0 18 x: runs the drive code saved on track 18 (MK4 sector 5, later ones sector 6)', weak: true },
    ],
  },
  {
    id: 'ar-tape', name: 'Action Replay tape backups (Datel)', group: 'actionreplay',
    how: 'turbo and superturbo backups: the loader is in the tape header (at $0351) and the first file starts it through the vectors at $0300; it waits for the sync bytes "RB" and tells short pulses from long by CIA2\'s timer B, whose time it reads from the tape, so both speeds load with it',
    signs: [
      { pat: pat('A9 0B 8D 11 D0 A9 05 85 01 85 C0 88 D0 FD CA D0 FA'), role: 'tape', what: 'the loader that goes into the tape header ($0351-$03fa): it waits for the sync bytes "RB" and reads the bits by CIA2\'s timer B', span: [0, 0xaa] },
      { pat: pat('AD 0D DD 8E 0F DD 4A 4A EE 20 D0 60'), role: 'tape', what: 'reads a bit: a pulse on the FLAG line, then whether CIA2\'s timer B has run out' },
      { pat: pat('C9 52 D0 F4 20 .. .. C9 42 D0 ED'), role: 'tape', what: 'waits for the sync bytes "RB"' },
      { pat: pat('78 20 15 FD 20 53 E4 A9 7F 8D 0D DC 78 4C 51 03'), role: 'tape', what: 'the first file: it loads over the vectors at $0300 and jumps to the loader in the tape header ($0351)' },
      { pat: pat('85 B6 A2 08 46 B6 A9 80 90 01 0A 8D 06 DC 90 02 09 82 8D 07 DC 2C 07 DC 30 FB A9 19'), role: 'tape', what: 'saves a backup: each bit a pulse that CIA1\'s timer B times' },
    ],
  },
  {
    id: 'ar-turbotape', name: 'Action Replay turbo tape (Datel)', group: 'actionreplay',
    how: 'LOAD and SAVE with TAPE TURBO ON; 5.1 and 7.5 time the pulses with CIA1\'s timer B and sync on the bytes $10 … $01, 7.2 writes Turbo Tape 250\'s format (threshold $0107, leader byte $02, sync $09 … $01) and times it with CIA2\'s timer B',
    signs: [
      { pat: pat('2C 0D DC F0 F6 AD 20 D0 49 05 8D 20 D0 AD 07 DC 8E 0F DC 0A 60'), role: 'tape', what: 'reads a bit: a pulse on the FLAG line, then CIA1\'s timer B tells short from long' },
      { pat: pat('A0 10 84 90 20 .. .. C5 90 D0 F0 88 D0 F4'), role: 'tape', what: 'waits for the sync bytes $10 … $01' },
      { pat: pat('8D 06 DC 90 02 09 82 8D 07 DC 2C 07 DC 30 FB EE 20 D0'), role: 'tape', what: 'saves: each bit a pulse that CIA1\'s timer B times' },
      // other turbos read the bit the same way, but do not flash the volume and the border with it
      { pat: pat('A9 10 2C 0D DC F0 FB AD 0D DD 8E 07 DD 48 A9 19 8D 0F DD 68 8D 18 D4 8D 20 D0'), role: 'tape', what: 'reads a bit (7.2): a pulse on the FLAG line, then CIA2\'s timer B; the border and the volume flash with each pulse' },
      { pat: pat('A0 09 20 .. .. C9 02 F0 F9 C4 BD D0 E8'), role: 'tape', what: 'waits for the leader bytes $02, then the sync bytes $09 … $01 (7.2)', weak: true },
    ],
  },
  {
    id: 'novaload', name: 'Novaload (Novagen)',
    how: 'tape: the top bit of CIA1\'s timer A ($81f4) tells short pulses from long; a sync byte $aa, the name, then blocks with a checksum. The Action Replay 7.2\'s Nova transfer reads Novaload tapes with the same code',
    signs: [
      { pat: pat('A9 10 2C 0D DC F0 FB AD 05 DC 8E 0E DC 49 80 0A 68 6A'), role: 'tape', what: 'reads a bit: a pulse on the FLAG line, then the top bit of CIA1\'s timer A' },
      { pat: pat('A9 F4 8D 04 DC A9 81 8D 05 DC'), role: 'tape', what: 'times the pulses with CIA1\'s timer A from $81f4', weak: true },
    ],
  },
  // the Super Snapshot V5 (LMS Technologies): its ROM holds the code it uploads to the drive and copies to $0200; a
  // file whose first byte has bit 7 set it reads as the Action Replay's Warp*25 format, with the Action Replay's code
  {
    id: 'ss-turbo', name: 'Super Snapshot turbo (LMS)', group: 'supersnapshot', main: true, claims: ['ar-warp'],
    how: 'Turbo V5, LOAD and SAVE: code for the 1541 at $0150 receives the rest fast and starts it at $0300 (a 1581 has code of its own at $0500); LOAD takes four bytes a handshake (lda $dd00 / lsr / lsr / ora $dd00 …) and stores them with code at $0200 with the ROMs banked out, SAVE sends each byte as two halves from a table, both on lines with no badline; a file whose first byte has bit 7 set is read as the Action Replay\'s Warp*25 format, with the Action Replay\'s code',
    signs: [
      { pat: pat('2C 00 DD 70 FB A0 03 EA 24 80 AD 00 DD 4A 4A EA EA 0D 00 DD'), role: 'resident', what: 'LOAD receives four bytes a handshake into $aa-$ad (lda $dd00 / lsr / lsr / ora $dd00 …)' },
      { pat: pat('A9 34 85 01 A5 AA 91 93 C8 98 48 A9 37 85 01'), role: 'resident', what: 'stores the bytes LOAD receives with the ROMs banked out ($01 = $34); it runs at $0200', span: [0, 0x33] },
      { pat: pat('85 A6 A2 08 2C 00 DD 50 FB AD 00 DD 29 DF 8D 00 DD'), role: 'resident', what: 'trades a byte with the drive a bit at a time: the file\'s first bytes (its load address, and bit 7 for Warp*25)' },
      { pat: pat('2C 00 DD 10 FB 38 AD 12 D0 E5 26 90 06 29 07 C9 02 90 F2 A5 2A 8D 00 DD'), role: 'resident', what: 'receives a byte (GET, the directory, the file copier): waits for the drive and for a line with no badline, then reads the serial bus four times' },
      { pat: pat('2C 00 DD 10 FB 38 AD 12 D0 E5 26 90 06 29 07 C9 02 90 F2 A9 07 8D 00 DD'), role: 'resident', what: 'sends a byte (SAVE, the file copier): waits for the drive and for a line with no badline, then sends it as two halves from a table' },
      { pat: pat('2C 00 DD 50 FB B1 AC EA 48 4A 4A 4A 4A AA AD 12 D0 C9 31 90 06 29 06 C9 02 F0 F3'), role: 'install', what: 'sends the drive code: each byte as two halves from a table, on a line with no badline' },
      { pat: pat('4D 2D 52 FE FF 01 4D 2D 57 50 01 23 4D 2D 57 73 01 23 4D 2D 45 50 01'), role: 'command', what: 'drive commands M-R $fffe (which drive it is), M-W $0150 and $0173 (35 bytes each) and M-E $0150: they start the code that receives the rest' },
      { pat: pat('78 20 8D 01 20 E9 F5 20 5D 01 4C 00 03'), role: 'drivecode', what: 'code for the 1541 at $0150: it receives the rest of the drive code fast, then starts it at $0300', span: [0, 0x46] },
      { pat: pat('A9 17 8D 07 1C 20 32 03 CE 89 01 20 AF 03'), role: 'drivecode', what: 'code for the 1541 at $0300: it finds the file and starts the code that reads it (at $0400, or the Warp*25 reader)', span: [0, 0x100] },
      { pat: pat('A5 43 85 C1 20 82 05 50 FE B8 AD 01 1C'), role: 'drivecode', what: 'code for the 1541 at $0400: it reads the file a sector at a time and sends it', span: [0, 0x200] },
      { pat: pat('20 83 03 20 C6 06 20 93 05 A9 00 8D 00 18'), role: 'drivecode', what: 'code for the 1541 that reads the Action Replay\'s Warp*25 sectors (the Action Replay\'s code, rearranged)', span: [0, 0x300] },
      { pat: pat('78 A0 02 8C 00 18 20 E9 F5 A9 0A 85 69'), role: 'drivecode', what: 'code for the 1541 at $0500 that SAVE uploads: it takes the bytes and writes the sectors', span: [0, 0xff] },
      { pat: pat('78 A9 D2 8D 01 40 A5 4C AE 8B 02 85 0B'), role: 'drivecode', what: 'code for the 1581 at $0503 (its serial port is the CIA at $4000)', span: [0, 0xa6] },
    ],
  },
  {
    id: 'ss-copier', name: 'Super Snapshot copiers (LMS)', group: 'supersnapshot',
    how: 'the disk copier copies a disk with code in the 1541 at $033f and $057c, and the C64 takes each sector into $0500 (lda $dd00 / lsr / lsr / eor $dd00 … eor #$f9) with code it runs from $0801 to $23ff; the file copier has code of its own for the 1541 at $0400 and talks to it with the turbo\'s routines',
    signs: [
      { pat: pat('AD 00 DD 30 FB 09 17 8D 00 DD AD 00 DD 10 FB 29 07 8D 00 DD'), role: 'resident', what: 'the disk copier receives a sector into $0500, four reads of the serial bus a byte (… eor $dd00 / eor #$f9); it runs at $176a' },
      { pat: pat('A0 00 B9 00 05 48 A2 27 8E 00 DD 2C 00 DD 70 FB'), role: 'resident', what: 'the disk copier sends the sector at $0500 to the drive' },
      { pat: pat('AD 00 1C 09 0C 8D 00 1C A9 EE 8D 0C 1C'), role: 'drivecode', what: 'code for the 1541 at $033f that the disk copier uploads: it reads and writes the sectors of a track', span: [0, 0x220] },
      { pat: pat('78 20 3F 03 20 E1 04 A5 BB 20 7A 03'), role: 'drivecode', what: 'code for the 1541 at $057c that the disk copier uploads: it runs the copy of a track', span: [0, 0x160] },
      { pat: pat('32 41 9C 78 A0 02 8C 00 18 AD 00 1C 09 0C 8D 00 1C 20 E9 F5'), role: 'drivecode', what: 'code for the 1541 at $0400 that the file copier uploads: it reads and writes the files\' sectors', span: [0, 0x300] },
    ],
  },
  // a backup saved as two files: the Super Snapshot V5's (BREAK INTO 2 FILES) and the Action Replay 4's split freezes
  // start with this loader, which unp64 knows as the Action Replay v4.x Split Freeze
  {
    id: 'freezer-split', name: 'Split freeze loader (Action Replay, Super Snapshot)', kernal: true,
    how: 'the first file of a backup saved as two: it copies the top of memory it holds to $d000 with the I/O banked out, puts a "1" in front of the name it was loaded by and loads that file, the rest of the backup, over itself; the KERNAL LOAD returns into the backup\'s start at $080d',
    signs: [
      { pat: pat('78 E6 01 A2 .. A0 00 B9 47 08 99 00 D0 C8 D0 F7 EE 16 08 EE 19 08 CA D0 EE C6 01 20 38 08 C8 84 B9 A9 08 48 A9 0C 48 8A 4C D5 FF'), role: 'resident', what: 'copies its pages to $d000 with the I/O banked out, then loads the second file over itself' },
      { pat: pat('A5 BB D0 02 C6 BC C6 BB E6 B7 A9 31 91 BB 60'), role: 'resident', what: 'puts a "1" in front of the file name: the second file is "1" and the first file\'s name' },
    ],
  },
];
const BY_ID = new Map(KNOWN.map(k => [k.id, k]));
/** the classic 2-bit receive loop: the Covert Bitops loader's, and many older loaders' */
const CLASSIC = pat('AD 00 DD 4A 4A 4D 00 DD 4A 4A 4D 00 DD 4A 4A 4D 00 DD');

/** instructions that read or write an absolute address (the drive's VIA registers in drive code) */
const ABS_OPS = new Set([0xad, 0x8d, 0x2c, 0xae, 0x8e, 0xac, 0x8c, 0x0d, 0x2d, 0x4d, 0x6d, 0xcd, 0xec, 0xcc, 0xee, 0xce, 0x0e, 0x2e, 0x4e, 0x6e, 0xed]);
/** instructions that read $dd00 (indexed forms from $dcxx reach it too, as Krill's NTSC loop does) */
const READ_OPS = new Set([0xad, 0x0d, 0x2d, 0x4d, 0x6d, 0x2c, 0xcd, 0xae, 0xac]);
const READ_X_OPS = new Set([0x1d, 0x3d, 0x5d, 0x7d, 0xbd, 0x19, 0x39, 0x59, 0x79, 0xb9]);

const KERNAL_SERIAL: Record<number, string> = { 0xffb1: 'LISTEN', 0xff93: 'SECOND', 0xffa8: 'CIOUT', 0xffae: 'UNLSN', 0xffb4: 'TALK', 0xff96: 'TKSA', 0xffa5: 'ACPTR', 0xffab: 'UNTLK' };

/** the encodings a name can be written in: PETSCII upper case, PETSCII lower case (shifted), screen codes, ASCII */
const encodings = (s: string): Pattern[] => {
  const up = [...s.toUpperCase()].map(c => c.charCodeAt(0));
  const letter = (c: number) => c >= 0x41 && c <= 0x5a;
  return [up, up.map(c => (letter(c) ? c + 0x80 : c)), up.map(c => (letter(c) ? c - 0x40 : c)), up.map(c => (letter(c) ? c + 0x20 : c))].map(b => b.map(x => new Set([x])));
};

export function findLoaders(ctx: Ctx, blocks: Block[]): LoaderFinding[] {
  const { mem, owner, insLen, codeOwner, L } = ctx;
  const inCode = (a: Addr) => insLen[a] > 0 || codeOwner[a] >= 0;
  const find = (p: Pattern, from = 0, to = 0x10000): Addr[] => {
    const out: Addr[] = [], first = p[0];
    for (let a = from; a + p.length <= to; a++) {
      if ((first && !first.has(mem[a])) || owner[a] < 0) continue;
      let i = 1;
      for (; i < p.length; i++) { const s = p[i]; if (s && !s.has(mem[a + i])) break; }
      if (i === p.length && owner[a + p.length - 1] === owner[a]) out.push(a);
    }
    return out;
  };
  const blockAt = (a: Addr) => blocks.find(b => a >= b.start && a < b.end);
  /** a traced routine holds the match: the part is that code block */
  const around = (a: Addr, n: number): [Addr, Addr] => { const b = blockAt(a); return b && b.type === 'code' && b.end - b.start <= 0x400 && inCode(a) ? [b.start, b.end] : [a, a + n]; };
  /** code kept here to run elsewhere: the bytes of its span, as far as the file goes */
  const spanned = (a: Addr, [from, to]: [number, number]): [Addr, Addr] => { let end = Math.min(0x10000, a + to); while (end > a + 1 && owner[end - 1] !== owner[a]) end--; return [a + from, end]; };

  const findings: LoaderFinding[] = [];
  const overlaps = (s: Addr, e: Addr) => findings.some(f => f.parts.some(p => p.start < e && p.end > s));

  // ---- the known loaders ----
  for (const k of KNOWN) {
    const parts: LoaderPart[] = [];
    let own = false;
    for (const s of k.signs) {
      for (const a of find(s.pat)) {
        const [start, end] = s.page ? [a, Math.min(0x10000, a + 0x100)] : s.fixed && a >= s.fixed[0] && a < s.fixed[1] ? s.fixed
          : s.span && (s.role === 'drivecode' || !inCode(a)) ? spanned(a, s.span) : around(a, s.pat.length);
        if (parts.some(p => p.start < end && p.end > start)) continue;
        parts.push({ start, end, role: s.role, what: s.what });
        if (!s.weak) own = true;
      }
    }
    // what other loaders have too counts only with its own code
    if (!own) parts.length = 0;
    if (k.text) for (const e of encodings(k.text)) for (const a of find(e)) if (!inCode(a)) parts.push({ start: a, end: a + e.length, role: 'text', what: `its name, "${k.text.replace(/\.$/, '')}"` });
    // its name alone could be any text: it counts with its code, or (below) next to drive commands
    if (parts.length) findings.push({ id: k.id, name: k.name, sure: 'match', how: k.how, parts: parts.sort((x, y) => x.start - y.start) });
  }
  // another make's code that this one has too is this one's, when its own code is there (its parts move over below,
  // after the parts are merged, so that each keeps what it is)
  const claimed = new Map<LoaderId, LoaderFinding>();
  for (const f of findings) for (const id of BY_ID.get(f.id)?.claims ?? []) if (findings.some(x => x.id === id)) claimed.set(id, f);
  // ---- a snapshot opened from $0200: a known loader's code in the zero page or the stack, which it holds ----
  for (const f of ctx.files) {
    if (!f.vsf) continue;
    let ram: Uint8Array;
    try { ram = parseVsf(f.vsf).ram; } catch { continue; }
    for (const k of KNOWN) for (const s of k.signs) {
      if (s.page || s.fixed || s.weak) continue;
      for (let a = 0; a + s.pat.length <= 0x200; a++) {
        if (!s.pat.every((x, i) => owner[a + i] < 0 && (!x || x.has(ram[a + i])))) continue;
        const part: LoaderPart = { start: a, end: a + s.pat.length, role: s.role, what: `${s.what}, in the ${a < 0x100 ? 'zero page' : 'stack'}, which this snapshot is opened without`, outside: true };
        const known = findings.find(x => x.id === k.id);
        if (known) known.parts.push(part);
        else findings.push({ id: k.id, name: k.name, sure: 'match', how: k.how, parts: [part] });
      }
    }
  }
  const named = (f: LoaderFinding) => f.parts.some(p => p.role !== 'text');

  // ---- what every disk loader has ----
  const generic: LoaderPart[] = [];
  /** drive commands that put code into the drive or start it: M-E, and M-W of more than a few bytes (M-R reads, and
   *  a short M-W sets a value, such as the device number at $0077) */
  const uploads = new Set<LoaderPart>();
  // drive commands: "M-W" lo hi length, "M-E" lo hi, "M-R" lo hi length; some loaders send them backwards ("W-M")
  for (const [c, name] of [[0x57, 'M-W'], [0x45, 'M-E'], [0x52, 'M-R']] as const) {
    const plausible = (lo: number, hi: number) => hi <= 0x07 || hi >= 0xc0;
    for (const a of find([new Set([0x4d]), new Set([0x2d]), new Set([c])])) {
      if (inCode(a) || a + 5 > 0xffff || !plausible(mem[a + 3], mem[a + 4])) continue;
      const at = mem[a + 3] | (mem[a + 4] << 8), n = c === 0x45 ? 5 : 6;
      const p: LoaderPart = { start: a, end: a + n, role: 'command', what: `drive command ${name} $${h(at)}${c === 0x45 ? ': starts the code there in the drive' : c === 0x57 ? `, ${mem[a + 5]} bytes into the drive` : ': reads the drive' + (at >= 0xc000 ? "'s ROM (which drive it is)" : "'s memory")}` };
      generic.push(p);
      if (c === 0x45 || (c === 0x57 && mem[a + 5] > 4)) uploads.add(p);
    }
    for (const a of find([new Set([c]), new Set([0x2d]), new Set([0x4d])])) {
      if (inCode(a) || a < 3 || !plausible(mem[a - 1], mem[a - 2])) continue;
      const at = mem[a - 1] | (mem[a - 2] << 8);
      const p: LoaderPart = { start: a - (c === 0x45 ? 2 : 3), end: a + 3, role: 'command', what: `drive command ${name} $${h(at)}, stored backwards (sent from its end)` };
      generic.push(p);
      if (c !== 0x52) uploads.add(p);
    }
  }
  // 1541 code: the drive's VIA registers ($1800 serial port, $1c00 disk controller) and GCR reads (bvc * / lda $1c01)
  const hits: { a: Addr; w: number }[] = [];
  for (let a = 0; a + 2 < 0x10000; a++) {
    if (owner[a] < 0 || inCode(a)) continue;
    const op = mem[a], lo = mem[a + 1], hi = mem[a + 2];
    if (op === 0x50 && lo === 0xfe) hits.push({ a, w: 2 });
    else if (ABS_OPS.has(op) && (hi === 0x18 || hi === 0x1c) && lo <= 0x0f) hits.push({ a, w: hi === 0x1c && lo === 0x01 ? 2 : 1 });
  }
  for (let i = 0; i < hits.length;) {
    let j = i, w = hits[i].w;
    while (j + 1 < hits.length && hits[j + 1].a - hits[j].a <= 160) w += hits[++j].w;
    const vias = hits.slice(i, j + 1).filter(x => x.w === 1 || mem[x.a] !== 0x50).length;
    if (w >= 5 && vias >= 3) {
      let start = hits[i].a, end = hits[j].a + 3;
      const b = blockAt(start);
      if (b && b.type !== 'code' && start - b.start <= 0x200) start = b.start;
      const e = blockAt(end - 1);
      if (e && e.type !== 'code' && e.end - end <= 0x200) end = e.end;
      generic.push({ start, end, role: 'drivecode', what: 'code for the 1541: it is uploaded to the drive and runs there (VIA registers $1800 and $1c00, GCR bytes from $1c01)' });
    }
    i = j + 1;
  }
  // the receive loop: $dd00 read at least four times within 48 bytes
  const reads: Addr[] = [];
  for (let a = 0; a + 2 < 0x10000; a++) {
    if (owner[a] < 0) continue;
    const op = mem[a], lo = mem[a + 1], hi = mem[a + 2];
    if ((READ_OPS.has(op) && lo === 0x00 && hi === 0xdd) || (READ_X_OPS.has(op) && hi === 0xdc && lo >= 0xc0)) reads.push(a);
  }
  for (let i = 0; i < reads.length;) {
    let j = i;
    while (j + 1 < reads.length && reads[j + 1] - reads[i] <= 48) j++;
    if (j - i >= 3) {
      const [start, end] = around(reads[i], reads[j] + 3 - reads[i]);
      const span = mem.subarray(start, end);
      const atn = find(pat('8C|8D|8E 02 DD'), start, end).length > 0;
      const twoBit = [...span.keys()].some(k => (span[k] === 0x4a && span[k + 1] === 0x4a) || (span[k] === 0x6a && span[k + 1] === 0x6a));
      const classic = find(CLASSIC, start, end).length > 0;
      generic.push({ start, end, role: 'resident', what: classic ? 'receive loop: the classic 2-bit loop (lda $dd00 / lsr / lsr / eor $dd00 …), as in the Covert Bitops loader and many older loaders' : `receive loop: reads the serial bus at $dd00 ${j - i + 1} times (${atn ? '2-bit + ATN through $dd02' : twoBit ? '2-bit' : '1-bit'})` });
      i = j + 1;
    } else i++;
  }
  // a name next to a drive command (Krill's installer sends "M-E" lo hi "KRILL.") is enough
  for (let i = findings.length - 1; i >= 0; i--) {
    const f = findings[i];
    if (named(f)) continue;
    if (f.parts.some(t => generic.some(c => c.role === 'command' && c.end <= t.start + 1 && t.start - c.end <= 8))) continue;
    findings.splice(i, 1);
  }
  const evidence = generic.filter(p => !overlaps(p.start, p.end));
  // the KERNAL's serial bus calls send the drive code and the commands (only counted when there is a loader to send)
  if (evidence.length || findings.length) {
    const calls = new Map<Addr, string[]>();
    for (let a = 0; a + 2 < 0x10000; a++) {
      if (insLen[a] !== 3 || mem[a] !== 0x20) continue;
      const name = KERNAL_SERIAL[mem[a + 1] | (mem[a + 2] << 8)];
      if (!name) continue;
      const [s] = around(a, 3);
      calls.set(s, [...new Set([...(calls.get(s) ?? []), name])]);
    }
    const all = [...new Set([...calls.values()].flat())];
    for (const s of calls.keys()) { const [start, end] = around(s, 3); evidence.push({ start, end, role: 'install', what: `talks to the drive through the KERNAL (${all.join(', ')}): sends the drive code and its commands` }); }
  }
  if (evidence.length) {
    // one known disk loader, or loaders of one make (the Action Replay's): these are its parts; otherwise they are a
    // loader of their own
    const disk = findings.filter(f => { const k = BY_ID.get(f.id); return !k?.kernal && !claimed.has(f.id) && !k?.signs.every(s => s.role === 'tape'); });
    const makes = new Set(disk.map(f => BY_ID.get(f.id)?.group ?? f.id));
    const known = makes.size === 1 ? disk.find(f => BY_ID.get(f.id)?.main) ?? disk[0] : null;
    const keep = evidence.filter(p => !(known && p.role === 'resident' && known.parts.some(q => q.role === 'resident')));
    if (known) known.parts.push(...keep.filter(p => !known.parts.some(q => q.start < p.end && q.end > p.start)));
    else if (keep.some(p => p.role === 'drivecode' || p.role === 'resident' || uploads.has(p))) {
      const how = keep.find(p => p.role === 'resident')?.what.replace(/^receive loop: /, '') ?? 'its own code in the drive';
      findings.push({ id: 'fastloader', name: 'A fast loader (not one of the known ones)', sure: 'likely', how, parts: keep });
    }
  }
  for (const f of findings) f.parts = merged(f.parts);
  for (const [id, f] of claimed) {
    const i = findings.findIndex(x => x.id === id);
    if (i < 0 || !findings.includes(f)) continue;
    const name = BY_ID.get(id)!.name.replace(/ \(.*\)$/, '');
    f.parts.push(...findings[i].parts.map(p => ({ ...p, what: `${p.what} (the ${name}'s code)` })));
    f.parts.sort((x, y) => x.start - y.start);
    findings.splice(i, 1);
  }

  // ---- tape: CIA1's FLAG line (the datasette's read line) and a timer to measure the pulses ----
  const flag = [...find(pat('AD 0D DC 29 10')), ...find(pat('A9 10 2C 0D DC')), ...find(pat('A9 90 8D 0D DC'))].filter(inCode);
  const timers = [...find(pat('AD|AE|AC 04|05|06|07 DC|DD')), ...find(pat('8D|8E|8C 0E|0F DC|DD'))].filter(inCode);
  // a known tape loader is that loader's
  const tape = flag.filter(a => timers.some(t => Math.abs(t - a) <= 256) && !overlaps(a, a + 5));
  if (tape.length) {
    const parts: LoaderPart[] = [];
    for (const a of tape) { const [start, end] = around(a, 5); if (!parts.some(p => p.start === start)) parts.push({ start, end, role: 'tape', what: 'tape turbo: waits for pulses on the FLAG line ($dc0d bit 4) and times them with a CIA timer' }); }
    findings.push({ id: 'tape', name: 'A tape turbo loader', sure: 'likely', how: 'reads the datasette through CIA1’s FLAG line and measures the pulses with a timer', parts });
  }

  // ---- the KERNAL's LOAD ----
  const loads: LoaderPart[] = [];
  for (let a = 0; a + 2 < 0x10000; a++) if (insLen[a] === 3 && mem[a] === 0x20 && mem[a + 1] === 0xd5 && mem[a + 2] === 0xff) loads.push({ start: a, end: a + 3, role: 'kernal', what: 'loads a file with the KERNAL (jsr LOAD, $ffd5)' });
  if (loads.length) findings.push({ id: 'kernal', name: 'KERNAL LOAD', sure: 'match', how: 'the standard load through $ffd5 (slow, or as fast as a cartridge or JiffyDOS makes it)', parts: loads });

  for (const f of findings) {
    const where = f.parts.filter(p => p.role !== 'text').slice(0, 4).map(p => `${p.role === 'drivecode' ? 'drive code' : p.role === 'command' ? 'drive command' : p.role} ${$4(p.start)}${p.outside ? ' (not opened: Settings → Analysis → include the zero page and the stack)' : ''}`).join(', ');
    L(f.id === 'kernal' ? 'info' : 'ok', `Loader: ${f.name}${f.sure === 'likely' ? ' (by its traits)' : ''}: ${f.how}; ${where}${f.parts.length > 4 ? ', …' : ''}`, f.parts[0]?.start ?? null, 'loader');
  }
  return findings;
}

const h = (a: Addr) => a.toString(16).padStart(4, '0');

/** parts in address order; parts of the same kind that overlap (or code a few bytes apart) become one */
function merged(parts: LoaderPart[]): LoaderPart[] {
  const out: LoaderPart[] = [];
  for (const p of [...parts].sort((x, y) => x.start - y.start || y.end - x.end)) {
    const gap = p.role === 'resident' ? 32 : p.role === 'command' || p.role === 'text' || p.role === 'kernal' ? -1 : 0;
    const q = [...out].reverse().find(x => x.role === p.role && !x.outside === !p.outside);
    if (q && p.start <= q.end + gap) { q.end = Math.max(q.end, p.end); continue; }
    out.push({ ...p });
  }
  return out;
}
