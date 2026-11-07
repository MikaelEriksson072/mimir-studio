# Sindri (@mimir/sindri)

**Sindri is a generic unpacker for Commodore 64 programs.** It runs a packed PRG in an emulated C64, follows it
through its layers (coders, movers, decrunchers, intros in front of them) and saves the unpacked program at the moment
it starts.
With the disk the program came from, an emulated 1541 is on the serial bus, so it can go on loading: through the
KERNAL, or with a fast loader of its own. With the tape it came from, an emulated datasette plays it from after the
file, for its own turbo loader.
It needs no knowledge of the packer: it works for old and unknown crunchers as well as for known ones, and it reports
what each layer did so that new packers can be recognised and named.

It is written in TypeScript and runs on Node 22.18 or newer, which runs the sources as they are. It was made for
[Mimir Studio](https://github.com/MikaelEriksson072/mimir-studio), whose built-in unpacker it is: this package is a copy
of the standalone project, [MikaelEriksson072/Sindri](https://github.com/MikaelEriksson072/Sindri), and `src/`, `data/`
and `test/` are kept the same as there. Mimir runs it through
`unpackPrg()` and reports it with `unpackLog()` (`packages/core/src/sindri.ts`), in the app's unpacker worker and in
`mimir unpack`.

## How it works

The C64 is emulated with what unpacking needs: a 6510 with all 256 opcodes (the undocumented ones as VICE runs them)
and exact instruction timing, the memory banked by `$01`, the VIC-II's raster line, raster interrupts and badlines,
both CIAs with timers, interrupts and the keyboard and joysticks, and the SID registers a program can read. With the
C64 ROMs it starts the machine, types `LOAD`, loads the file and types `RUN`, as a real C64 does; so BASIC start lines,
autostarts through the vectors or the stack, and packers that call the KERNAL work as they do on the real machine.

For every byte of RAM it records which layer wrote it last and when, when it was last read as data and when it was
last run. **A new layer begins when the CPU jumps into code that the running layer wrote and has not run yet**: the
depacker a stub copied to `$0100`, the program a decruncher wrote, the code a decoder decrypted. Jumping into BASIC's
`RUN` counts too. Memory is copied at the start of every layer, together with the bytes that belong to the program
that layer starts:

- what the layer before it wrote and did not run itself;
- untouched parts of the loaded file;
- parts of an earlier layer's program (or of the loaded file) that it goes on running, as a trackmo's part plays the
  music an earlier part loaded and calls the loader the boot file left: when it ran at least 16 bytes of code there
  that it did not write itself, the part's bytes that still hold what they held when that program started join it,
  except those run or read since by others (that part's start-up code, data a depacker copied from there). They are
  known when the layer ends, and `LayerReport.kept` lists them;
- with a disk, the parts the layer loaded itself after it started and then ran, as a trackmo's framework loads its
  parts and the music and calls them (subroutine calls into code it loaded, which return to it: no layers of their
  own). Memory at the layer's start cannot hold them, and the saved program could not make them again. When the drive
  changed its DATA or CLK line at least 256 times while the layer ran (it loaded; the end of a transfer begun before
  is a few), stretches of bytes the layer wrote after it started, outside the program it started with and the parts
  it kept (gaps up to 256 bytes), in which it ran at least 16 bytes after writing them, join it as memory held them
  when the layer ended: for the newest layer, when the run stopped. The bytes of the program it started with and of
  the kept parts keep their values from its start. `LayerReport.loaded` lists them. Without a disk nothing changes:
  what a program writes later it makes from what it holds;
- not the packed data the depackers consumed (a copy they moved and read), its unread rest, the stub's leftovers,
  the depackers' own code and variables, or what the C64 wrote itself (the screen editor, the clock, the keyboard).

Layers begun inside a subroutine call or an interrupt that returns to where it was called from were temporary and join
the caller again: a decruncher called with `JSR`, speedcode a program generates, an interrupt handler it writes.

A BASIC program that jumps back into BASIC goes on with itself: the commands of a BASIC extension end in a jump to
NEWSTT, and a program may `RUN` itself again and again. That starts a layer only when BASIC goes on with text written
since BASIC last went on from there: from the first line, a program a depacker it called wrote, or one not run yet
(`POKE 44` and `RUN`); in the middle of the program, what the program rewrote itself. Until November 2026 every such
jump was a layer, so a Loadstar program with an extension made thousands and took minutes; on the 550 files of the
comparison with unp64 (with the ROMs and with the stand-ins) and on a sample of 1978 files of the archive (intros,
demos and games) every layer, name and saved program stayed.

The run stops when the newest layer settles (it stops streaming new data through memory), loads a file (without a
disk), returns to BASIC, crashes or runs out of time. The newest layer is then the unpacked program. When an intro waits before anything
was unpacked, keys are pressed in turn (space and fire first, then return, N, F1, Y, F7, 1).

Compared with unp64, which stops at the first jump back to `$0800` or higher, this finds the end of depackers that never
go below `$0800`, goes through every layer of a program packed several times (unp64 does with `-c`), and needs no
packer-specific scanners. It also saves only the program's own bytes, where unp64 saves to the end of memory or to a
packer's end pointer.

## The disk drive

With a disk (a D64 image, given instead of the file or with `--disk`) a 1541 is on the serial bus:

- its own 6502 with 2 KB of RAM and the DOS ROM, taken from VICE's `DRIVES` folder like the C64's ROMs;
- VIA 1 on the serial bus: ATN, CLK and DATA as open-collector lines either side pulls low, the drive's automatic
  answer to ATN (DATA pulled low while ATN and the acknowledge bit differ), and the ATN interrupt;
- VIA 2 on the head: the stepper moving it half a track at a time, the motor, the density (the bit rate of the speed
  zone), SYNC, and byte ready, which also sets the CPU's overflow flag as the DOS and fast loaders wait for it;
- the D64 as the 1541 formats it, GCR-encoded with its SYNC marks, headers and gaps, turning at 300 rpm. The error
  bytes of a D64 that has them become missing headers or data blocks, missing SYNC, bad checksums and wrong IDs.

The drive runs behind the C64 at its own 1 MHz. Whenever the C64 reads or writes the serial port it first catches up
to that cycle, running every instruction whose bus access comes before the C64's; its reads of the head, the timers
and the overflow flag see them as they are in the cycle of the access. So transfer protocols that count cycles work:
Bitfire, Krill's loader, Sparkle, Spindle, the Booze loader and plain KERNAL loads all get through. The file is put in
memory as `LOAD"*",8,1` would leave it (`$ba` is 8, and the drive has read the disk's ID); the program then loads
the rest itself. A program that waits while the drive's motor runs is loading, not settled, for up to 10 seconds.

Every run starts at the same moment: the C64 at the READY prompt after its start-up, and the drive started up a
while before, with the disk's ID just read and its motor still running, as after the LOAD. The first run in a process
starts both up once, each on its own, and every run, the first too, goes on from what that left; so a disk unpacks the
same way whichever run it is. Before, the first run's drive was on the bus through the C64's start-up and ran out of
step with later runs: Xcusemo got a layer further, Multiverse saved from `$0611` instead of `$06be`, I'm Back stopped
at 4.1 instead of 5.3 s. Now every run gives what later runs gave: on 144 demo disks from CSDB's top lists and 641
intros and demos without their disks, the layers, the stop and the saved program are the same as a later run's before,
and the same in the first run and the next. Against a first run before, 34 demos are saved differently, 28 of them in
1 to 81 bytes the program changes as it runs (sprite pointers, operands, a player's variables); two load on where the
first run stopped (Out of Contex, Continuum), and two stop in their framework where the first run reached the next
part (Abstracto, Xcusemo).

On the first disk of each of the 190 top-rated demos at CSDB, 151 get further than the boot file with the drive: the
loader loads the next part and starts it. Without the drive, 151 waited in the boot, 35 went back to READY when
their drive code got no answer and 4 crashed; with it 186 run until a part settles, 3 end at READY and 1 runs out of
time. A disk takes about 0.3 s.

In such a demo the part that settles keeps what earlier parts left that it runs (see above): Fairlight's 1337 is saved
as `$0200-$ffff`, with the loader at `$0200` and the music at `$1000` that the first part loaded, where it was
`$7400-$ffff` before; Viva Las Vegas as `$0b01-$9473` with its music at `$0c00`. Of 103 demo disks from CSDB's top
lists, 42 are saved differently, all of them demos in several parts whose program runs its loader or music from an
earlier layer; none got smaller.

A framework that loads the parts and the music itself is saved with what it loaded and ran (see above). No Bounds'
framework at `$ff40` loads its music to `$0900` and plays it from the parts it calls; it is saved as `$0200-$fffb`
as before, but `$02ff-$2aff` and `$3fff-$a446` now hold memory as the run left it, where 2180 of the 2304 bytes at
`$0900-$11ff` (where the SID writes come from) were what was there before the music was loaded. Mimir now finds the
music at `$0900-$1fff`. Of 138 demo disks from CSDB's top lists, 18 are saved differently (4 end higher, 6 start
lower, 8 have the same range with other bytes; none got smaller, and no layer, stop or time changed); 741 intros and
demos without their disks are saved as before.

## The datasette

With a tape (a TAP image, given instead of the file or with `--tape`) a datasette is plugged in, PLAY held down
(`src/tape.ts`):

- its pulses reach CIA1's FLAG line (the ICR's bit 4, and an IRQ when the mask has it) while the motor runs, that is
  while the 6510's port drives bit 5 low; bit 4 of the port reads 0 (a button is down);
- the tape stands where the file ended (after the KERNAL file that holds the file's bytes, or at `tapeAt`), so the
  program's own tape loader reads on from there: Novaload, Cyberload, Martin Piper's TapeTool and the rest are not
  known by Sindri, they just run;
- LOAD from the tape (device 1) is done by Sindri, not by the KERNAL's routines, which would take minutes of C64 time:
  the next KERNAL file from where the tape stands whose name starts with the one asked for (any without a name), its
  header into the tape buffer at `$033c`, its data where it goes (a relocatable one with secondary address 0 at the
  start of BASIC), the tape wound to after it. The first file is loaded so as well, its header in the tape buffer,
  where many tape loaders keep their code;
- as the KERNAL does, the IRQ vector is kept at `$029f/$02a0` during the load and put back after it. A boot file that
  loads over `$029f/$02a0` starts through the next interrupt, which comes at once (the KERNAL ends the load in its tape
  IRQ and enables CIA1's timer A there, whose underflow is waiting), before BASIC goes on with vectors the file may
  have loaded over. The motor interlock `$c0` is set as the KERNAL sets it when it starts the motor, or the KERNAL's
  IRQ would turn the motor on as soon as PLAY is down. The pointers a tape LOAD leaves are set too: the start in
  `$c1/$c2`, the end in `$ae/$af` and `$ac/$ad` (Mastertronic's and Codemasters' boot files clear memory from (`$ac`)
  up to `$0800`, and stopped at once without them);
- a program waiting while the tape plays is loading, not settled, until a while (5 s) after the tape's end, and the
  time limit grows to the rest of the tape and half a minute more. The report's `Tape:` line says where the tape stood
  and how far it played; pulses read count as loading for the parts a layer loaded and ran. The saved port is the
  program's: bit 4, which PLAY holds low, is left out.

On the boot files of 98 commercial tapes (the first sides among the first 100 of a tape collection), 93 play the
tape for more than 5 s and get to the game's code (Novaload, Cyberload and other turbo loaders, none known to Sindri;
80 before the LOAD pointers were set, the 13 being budget tapes such as Mastertronic's, Codemasters' and
Zeppelin's), 81 end in a running program, 9 at READY, 5 in a reset and 2 on a JAM after loading, and one is a BASIC
game that reads its data with the KERNAL's own routines; 80 save a later layer than the boot file (67 before). A tape
takes 2.1 s (median, 10.0 s at most) for 163 s of C64 time on average. Without the IRQ vector at `$029f/$02a0` and
the motor interlock, only 14 of the first 25 got further than the boot file.

## Use

```
node src/cli.ts game.prg
```

```
game.prg: $0801-$2122 (6.3 KB), 2003 SYS2059
ROMs: C:\C64\vice\GTK3VICE-3.10-win64\C64
layer 0  $080b  start           mover
         ran $0101-$012c $080b-$081a $20c9-$2101 (61 instructions), read $1ff9-$2122 (239 bytes), wrote ...
         unknown depacker, fingerprint 7984a862
         called code it wrote: $0101 (jsr)
layer 1  $0143  jmp from $2101  decruncher
         ...
layer 4  $1000  jmp from $0040  program
stopped after 5.2 s of C64 time (137 ms): settled, waits at $1149
saved layer 4: $0800-$e1ff (54.5 KB), start with SYS 4096 = $1000
  -> game.1000.prg
```

| option | |
|---|---|
| `-o FILE` | save here (default: `<name>.<start address>.prg` next to the file) |
| `--file NAME` | the file on the D64 or TAP to unpack (default: its first program; `*` and `?` as the DOS takes them) |
| `--disk FILE` | put this D64 in the drive for a PRG given on its own |
| `--tape FILE` | put this TAP in the datasette for a PRG given on its own |
| `-e ADDR` | start with `SYS ADDR` instead of `RUN` |
| `-l ADDR` | load the file at `ADDR` instead of its own load address |
| `--layer N` | save layer N instead of the newest (the report lists them) |
| `--all` | save every layer |
| `-i` | report only |
| `--clean` | clear the bytes in the saved range that are not part of the program |
| `--deep` | also press keys when a later layer waits (an intro after the decrunching) |
| `--no-keys` | never press keys |
| `--cycles N` | give up after N million cycles (default 400, about 7 minutes of C64 time) |
| `--roms DIR`, `--no-roms` | the C64 ROM files to use, or the built-in stand-ins |
| `--json` | the whole result as JSON |
| `--trace` | every layer change and key press as it happens |
| `--learn NAME` | add the depackers' fingerprints to the signature list as `NAME` |

`node src/cli.ts demo.d64` unpacks a disk's first PRG with the disk in the drive. Addresses can be written `$080d`,
`0x080d` or `2061`. In this folder, `pnpm unpack game.prg` does the same, and
`pnpm --filter @mimir/sindri unpack game.prg` anywhere in the repository.

The disk is given on its own, and `--file` names a file on it. A path with spaces goes in quotes, or the shell gives
it in pieces:

```
sindri "C:\C64\Demos\001. The Lab\side1.d64" -o lab.prg
sindri "C:\C64\Demos\001. The Lab\side1.d64" --file "PART*" -o part.prg
```

When the arguments do not name one file, Sindri says what is wrong before anything runs: a path that came in pieces,
the disk given to `--file`, more files than one, or none.

### ROMs

The ROM files are not included. Sindri looks for a VICE installation (in `C:\C64`, Program Files and the usual
Linux and macOS places) and takes `kernal-*.bin`, `basic-*.bin` and `chargen-*.bin` from its `C64` folder, or from the
folder in `$C64_ROMS` or `--roms`, and the 1541's `dos1541-*.bin` from the same folder or VICE's `DRIVES` folder next
to it (without it a disk is not used). Without the C64 ROMs it runs with stand-ins: small replacements for the KERNAL routines packers
call (the interrupt entry, CHROUT, GETIN, clear screen, the jump table) and a BASIC that runs start lines made of `SYS`
and `POKE`. That is enough for nearly all packers, but not for BASIC programs or packers that use ROM code or data.

## Analysis: finding new packers

For every layer the report says what it did:

- **kind**: a *mover* copies (a stub moving packed data, a linker), a *decoder* rewrites data in place (a coder, an
  encryption), a *decruncher* writes more than it reads, a *jump* only passes control on, and the last layer is the
  *program*;
- the code it ran, the data it read and what it wrote;
- the code it wrote and called (subroutines, interrupt handlers);
- the text in and around its code (credits, packer names) and what it printed;
- a **fingerprint**: the opcodes of the instructions it ran, in address order, as they were when it ran them. Operands
  are left out, so the same depacker matches wherever it runs and whatever it unpacks, and one that is written over
  before the next layer starts (a depacker in the zero page that the program's own zero page replaces) keeps its
  fingerprint. `data/signatures.json` holds the known ones with their
  names, and a layer that matches one by 80% or more is named. An unknown depacker is listed with the short id of its
  fingerprint, so files packed with the same unknown packer show the same id; `--learn NAME` adds it to the list.

The list was built from about 6000 intros, demos and games: each file was unpacked, and the depacker layer at the
address unp64 names was given unp64's packer name. That gave 321 fingerprints of 135 packers (Exomizer, ECA
Compactor, PuCrunch, the CruelCrunch and Dali versions, ByteBoozer, 1001 CardCruncher, NSU Packer, ...). On 473 other
files Sindri names 429 packers exactly as unp64 does, 2 by the same family and none wrongly; it names nothing
where unp64 knows no name either.

Until November 2026 a fingerprint was read from memory when the next layer started. The depackers of four packers run
in the zero page and were written over by then (Dali's fast decruncher, 1001 CardCruncher New Packer, NuCrunch and Datel
UltraCompander), so their 35 entries held the C64's zero page rather than their code. They were learned again, as 8
entries, from the 418 files of the archive's intros and demos that unp64 names with Dali, 1001 CardCruncher New
Packer, NuCrunch or UltraCompander. Sindri now gives 403 of them unp64's name, where it did 215 before (it often took
Dali 0.3.1 for 0.3.2 and the reverse); a Dali 0.3.5 file gets the name of 0.3.3, whose decruncher it nearly has. On a
sample of 1978 files of the archive (intros, demos and games) the change kept every layer and every name, and named
35 more layers.

The Action Replay's freezer backups are named *Datel Action Replay backup* (unp64 calls them Action Replay v3.x and
v4.x). *DISK SAVE - TURBO* and *STANDARD* both write one PRG at `$0801` with two layers: the depacker at `$080d` moves
the packed data to the top of memory, restores the VIC, SID and CIAs and turns the cartridge off; the one at `$008e`
unpacks the memory, restores the zero page over itself and starts the frozen program. AR 5.1 and 7.5 write the same
depacker, AR 7.2 a slightly different one, and other versions others again: 17 entries name both layers of 2640 of the
2700 backups in the archive. In 31 of the rest the run ends inside the second layer, and in 23 the BASIC line was
changed so that `RUN` starts nothing (`-e 2061` starts them).

The Freeze Machine's backups (Evesham's freezer cartridge) begin with the same instructions and are named *Evesham
Freeze Machine backup*. The depacker at `$080d` moves the packed data up, puts the zero page, the stack and the colours
back from the file and restores the SID, CIAs and VIC; the one at `$007e` unpacks the memory, puts the zero page back
from the stack page and returns into the frozen program. A *Split Freeze* is two files: the first holds the top of
memory and a loader that loads the second, a whole backup, over itself, so it is unpacked only with its disk. 13
entries were learned from the archive's 133 backups (124 that unp64 calls Freeze Machine, 9 Split Freeze), run with
and without their disk. With the disk both layers of 99 of the 124 are named. In 24 the run ends inside the second
layer, which as the last one (the program) gets no name: 22 of them are BASIC programs, which go on in the BASIC ROM,
so no new layer starts. One has a changed BASIC line, and `-e 2061` names both. Of the Split Freezes, 6 get both names
with the disk (3 of them only with `-e 2061`: their BASIC line was cleared), and in 3 the run ends inside the
second layer. Without the disk 98 of the 124 get both names and no Split Freeze gets one: they stop at the load. No
layer of the 2700 Action Replay backups is named after the Freeze Machine, nor the reverse, and on the sample of 1978
files every layer and name stayed. A backup on a Kick Off disk that unp64 does not name has the same depacker; its
first layer is named (82% alike), its second not (78%). That gives 324 fingerprints of 137 packers.

The Super Snapshot's backups (LMS Technologies' freezer cartridge, SNAPSHOT in its menu) are named *LMS Super Snapshot
backup* (unp64 calls them Super Snapshot). They are one PRG at `$0801` with two layers: the depacker at `$080d` turns
off both CIAs' interrupts, moves the packed data to the top of memory, puts the zero page, the stack page and the
colours back and restores the SID, the VIC and the CIAs; the one at `$008e`, the Action Replay's depacker with another
end, unpacks the memory and starts the frozen program. 3 entries were learned from the 250 backups in the archive (249
that unp64 names and a game saved as "snap") and 3 saved with a Super Snapshot V5 in VICE: the first layer ran the same
in all of them, the second in two ways. Both layers of 252 of the 253 are named, and of the last one with `-e 2061`
(its BASIC line is gone). None of them is named after the Action Replay, nor the reverse.

A backup saved as two files (the Super Snapshot's BREAK INTO 2 FILES, the Action Replay 4's split freeze; unp64 calls
the first file an Action Replay v4.x Split Freeze) starts with a loader that copies the top of memory it holds to
`$d000` and loads its second file over itself: "1" and the name it was itself loaded by, which it takes from where
BASIC's LOAD left it. A file from a disk is now loaded as `LOAD"name",8,1` leaves things: its name, from the disk's
directory, is below `$a000` with `$b7`, `$bb` and `$bc` set to it (the saved program gets back what was there before,
unless the program loaded a file by the name or wrote those bytes itself). With their disks, 104 of the archive's 106
Action Replay split freezes and 29 of its 31 Super Snapshot ones are unpacked with both layers named (5 entries for
the first layer, where the loader and the backup's depacker ran as one). Of the other four, two have a BASIC line that
starts nothing, one's first layer runs on into code of the frozen program, and one goes on in the KERNAL. Before, the
loader got no name (Sindri stopped at the load in the ones tried). On 100 demo disks from CSDB's Top 200 the change
kept every layer and start; 92 saved the same bytes, and in 8 the saved program has the name below `$a000`, where the
program itself moved memory out and back again, as it would on a C64. That gives 332 fingerprints of 138 packers.

## Compared with unp64

On 550 intros and demos from a C64 archive, with VICE's ROMs:

| | files |
|---|---|
| the same start address and the same bytes as unp64 | 488 |
| a different start address: a layer deeper, after a second packer, a mover or a decoder (unp64 with `-c` agrees on 11 of them) | 17 |
| nothing to unpack for either (programs that are not packed) | 42 |
| unpacked by unp64 only (an intro that waits for keys it does not read, a reset) | 2 |
| unpacked by this only | 1 |

The saved range differs in 30 of the 488: usually by a few bytes the depacker wrote just below `$0800`, which unp64
always cuts off; once it is shorter, where unp64 saves leftover packed data up to the packer's end pointer. With the
stand-ins instead of the ROMs, 487 files give the same result. A file takes about 80 ms.

Saving what earlier layers left that the program runs (November 2026) changed 2 of 617 intros and demos run without
their disks, and no layer, stop or time: one intro now has the same bytes as unp64 (`$0801-$3fff`; it was cut at
`$22fe`), and in one, where this goes a layer deeper than unp64 as before, the program's code at `$8000-$eaff` is now
saved with it.

`--json` gives all of it (with the full fingerprints) for scripts.

## API

```ts
import { unpack } from './src/index.ts';
import { findRoms } from './src/node.ts';

const result = unpack(prg, { roms: findRoms() });
unpack(prg, { roms: findRoms(), disk: d64 });  // with the disk it came from in a 1541
if (result.saved) save(result.saved.prg);   // load address first; result.saved.entry is the start
result.layers;                              // the report per layer
result.save(2);                             // another layer's PRG
result.fileUse[a] & FILE_RAN;               // what the run did with the loaded byte at a
```

`fileUse` tells, for every address, what the run did with the loaded file's byte there while it still held what was
loaded: `FILE_RAN` (executed as an opcode), `FILE_ARG` (as an operand), `FILE_READ` (read as data), and `FILE_WRITTEN`
once it was written (nothing after that is of the loaded byte). A disassembler can check itself against it: what ran is
code, what was only read is most likely data. A run covers the paths it took, so an untouched byte proves nothing.

`src/index.ts` has no file-system access; `src/node.ts` finds and reads the ROM files, and `src/d64.ts` lists a D64's
directory and reads its files.

## Tests

```
pnpm test
```

The tests build packed programs with a small 6502 assembler (an RLE cruncher whose decruncher runs at `$0100`, stays in
high memory, is called with `JSR` or ends in BASIC's `RUN`, an XOR coder in front of it, an intro that waits for space,
an autostart over the BASIC vectors, a depacker in the zero page that wipes its own code before it starts the program)
and run them with the stand-ins and, when VICE's ROMs are found, with the real ROMs. With the ROMs, small BASIC
programs with an extension go on with themselves and RUN themselves again without new layers, packed or not, and one
that RUNs another program starts a layer. When Exomizer is installed, an Exomizer 3 self-extracting file is unpacked
too. The signature list is checked as well: no entry may hold the BRKs and
JAMs of code that was written over, no Action Replay, Freeze Machine or Super Snapshot entry may name other code, nor
the reverse, and both layers of each backup get their names, as they ran in backups whose fingerprints are close to an
entry but not the same. The drive tests check the GCR tracks sector by sector, have the DOS read sectors all over a
disk, have a split freeze load its second file by the name it was loaded by, and,
with VICE's ROMs, follow a boot file that loads the next file through the KERNAL and one that sends drive code of its
own with `M-W`, starts it with `M-E` and receives a sector over the serial bus bit by bit; a framework that loads its
music and plays it is saved with the music as the run left it, and a part that only makes code of its own after the
load is saved as it started. A boot file that reads the drive's clock with `M-R` and runs it as code gets the same
layers, stop and saved program in the first run in a process, which starts the C64 and the drive up, and in the next.
The datasette tests build a tape (a KERNAL boot file with a loader in its header, then a program as turbo data) and run
its boot file with the stand-ins and the ROMs, started through `$0302` and through the IRQ vector at `$029f`: its loader
reads the program from the tape and starts it, with the pointers a tape LOAD leaves.

## Limits

- Without a disk, a program that loads more files (a linker with a loader, a multi-part demo) stops at the load; the
  layer it reached is saved. With one it goes on through the parts until a part settles.
- Memory is saved as it was when the newest layer started, but with a disk what the layer loaded and ran after it
  started is saved as the run left it: the saved program holds two moments. A loader's pointer may lead into what
  was there at the start, and a part loaded over the program it started with is not saved (those bytes keep their
  start). What the layer loaded but ran no code in or near (data far from code) is left out.
- A program on several disks waits when it asks for the next one (its drive code reads track 18 again and again to see
  the disk change): only one disk is in the drive.
- Copy protections that check what a D64 cannot hold (custom formats, half tracks, timing on the disk; a G64 image
  would), and programs that depend on exact VIC timing (sprite DMA, the cycle within a raster line), may not get
  through. What the drive writes stays in memory; the D64 is not changed.
- An intro that waits for something other than the keys it tries stays where it is; `-e` can start the program behind
  it.

## License

GPL-3.0-only, as Mimir Studio.
