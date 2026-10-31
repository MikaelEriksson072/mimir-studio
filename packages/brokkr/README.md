# Brokkr

**Brokkr is a cruncher for Commodore 64 programs.** It packs a program into a self-extracting PRG that loads, decrunches
itself and starts, or into crunched data that your own program decrunches, and it packs files straight on a D64 disk
image. By default it writes the stream format of Exomizer 3, so every decruncher written for Exomizer reads its files,
and it crunches them smaller than Exomizer 3.1.1 does, in a fraction of the time. Two formats of its own trade size for
speed: one coded adaptively as LZMA is, for the smallest files, and one of whole bytes, for the fastest decrunching.

Every self-extracting file Brokkr makes is planned (where the decruncher, its tables and the crunched data go, and what
`$01` must be) and then run in an emulated C64 from its SYS line until the program starts; the memory is compared with
the program byte for byte before the file is handed over.

It is named after Brokkr, the dwarf who forged Mjölnir with his brother Sindri. [Sindri](https://github.com/MikaelEriksson072/Sindri)
unpacks; Brokkr packs. Both were made for [Mimir Studio](https://github.com/MikaelEriksson072/mimir-studio), whose
built-in cruncher this is. Brokkr is written in TypeScript and runs on Node 22.18 or newer, which runs the sources as
they are.

## The formats

| `--format` | | Crunched data, against Exomizer 3.1.1 | Decrunching | The decruncher |
|---|---|---|---|---|
| `exomizer` (the default) | Exomizer 3's stream: every Exomizer decruncher reads it | 0.6 % smaller | as Exomizer's decrunchers do | about 200 bytes and a 156-byte table |
| `brokkr` | Brokkr's own, every bit coded adaptively as LZMA does | 6.6 % smaller | about 8 times as long as Exomizer's format | about 425 bytes, 512 bytes of probabilities, 1 KB more where there is room |
| `fast` | Brokkr's fast one, whole bytes | 13.2 % larger | about half the time of Exomizer's format | 215 bytes, no tables |

Measured on 163 unpacked C64 programs (see [Results](#results)). Take Exomizer's format unless you need the last bytes
(`brokkr`, for a larger program that may decrunch for a few seconds) or the shortest wait (`fast`). Where a program
leaves no room for the decruncher of Brokkr's own formats, a self-extracting file is made in Exomizer's format, with a
note.

## Install

Brokkr needs [Node.js](https://nodejs.org) 22.18 or newer, and nothing else to run: Node runs its TypeScript sources
as they are.

```
git clone https://github.com/MikaelEriksson072/Brokkr.git
cd Brokkr
node src/cli.ts --help
```

On Windows `brokkr.cmd` runs it from anywhere: put the folder on your `PATH`, or call it with its path, and type
`brokkr` instead of `node src/cli.ts`. On macOS and Linux an alias does the same:

```
alias brokkr='node /path/to/Brokkr/src/cli.ts'
```

To run the tests or change the code, install the development tools (TypeScript and Vitest) with `pnpm install` (or
`npm install`).

## Quick start

Pack a program that starts with a BASIC line (`10 SYS2064`) into a self-extracting file:

```
brokkr sfx game.prg
```

```
game.prg: $0801–$37ff, 12287 bytes
  Crunched data    $07ff–$0dd5
  Decrunched data  $0801–$37ff
  Decrunch table   $0334–$03cf
  Decruncher       $0100–$01d8  zero page $f7-$ff
  File             $0801–$0f5d
  $01 $37 while decrunching, $37 after; interrupts on after; jmp $0810
  checked in an emulated C64: 537238 cycles (0.55 s)
game-brokkr.prg: 1887 bytes (15.4 % of 12287)
```

`game-brokkr.prg` loads at `$0801` and starts with `RUN`. The lines above it say where everything lies while it
decrunches and how long it took in the emulated C64.

More:

```
brokkr sfx game.prg --format brokkr          the smallest file
brokkr sfx game.prg --format fast            the fastest decrunching
brokkr sfx game.prg --effort max             a thorough search, on every core
brokkr sfx code.prg --start $1000            a program without a SYS line, started with jmp $1000
brokkr sfx intro.prg music.prg@$1000         two files in one: the PRG, and raw bytes at $1000
brokkr mem level1.prg                        crunched data for your own decruncher
brokkr d64 disk.d64                          list a disk
brokkr d64 disk.d64 GAME INTRO               pack two files on it into disk-brokkr.d64
brokkr decruncher -o decrunch.asm            the decruncher for mem files, as Kick Assembler source
```

## User guide

### Input files

A file is a `.prg` (its first two bytes are its load address), `<file>@<address>` for raw bytes at an address, or, as
Exomizer takes it, `<file>,<address>[,<offset>[,<length>]]` for a part of a file. Several files are merged into one
memory image (where they overlap, a later one wins; gaps between them are zero). Addresses are written `$c000`,
`0xc000`, `49152` or `%1100…`.

### `sfx`: a self-extracting program

The file loads at `$0801`, decrunches the program and starts it.

- `--start sys` (the default) starts it with the SYS of the program's first BASIC line, `--start basic` with `RUN` (a
  BASIC program), `--start <address>` with a jump there (a program that loads elsewhere than `$0801` needs this).
- `--ram-exit <$01>` is `$01` after decrunching (default `$37`, BASIC and KERNAL in); `--irq on|off` the interrupt flag
  after decrunching (default on when the KERNAL is in).
- `--no-effect`: no border flashing while it decrunches (the fast format never flashes).
- `--four-tables` (Exomizer's format): a table of its own for the offsets of length 3 (`-P+16`); `auto` tries both.

While it decrunches, Brokkr sets `$01` itself so that everything the decruncher reads and writes is RAM, also under the
ROMs and I/O. It puts the decruncher in the stack page or at `$0334` where it can, so nothing shows on the screen, and
says so when the program leaves no room but the screen. The file must load below `$d000`.

### `mem`: crunched data for your own decruncher

`brokkr mem` writes the crunched data with the address it decrunches to, as `exomizer mem` does: backward by default
(the file ends with the data's end address), forward with `-f` (Exomizer's format only). It loads where it decrunches in
place: Brokkr computes the exact margin the decruncher needs so that it never writes over a byte it has not read, and
sets the file's load address from it. `-l <address>` loads it elsewhere (Brokkr warns when that address would make it
write over what it has not read), and `-l none` writes a plain `.bin` without a load address.

To decrunch it, write the decruncher for the same format and assemble it with your program:

```
brokkr mem level1.prg -o level1-packed.prg
brokkr decruncher -o decrunch.asm
```

(or `--format fast` or `--format brokkr` on both commands).

`decrunch.asm` starts with its constants: the zero page it uses (`--zp`), its table (`--table`) and where it goes
(`--at`); change them to suit your program. Then set `stream` to the address after the crunched data's last byte and
call `decrunch`:

```
#import "decrunch.asm"

        lda #<level1_end                // the address after the crunched data, as loaded
        sta stream
        lda #>level1_end
        sta stream+1
        jsr decrunch                    // the data is now at its own address
```

`brokkr mem` prints where the file lies when it is loaded (`level1-packed.prg: 1489 bytes at $07ff–$0dcd`, so
`level1_end` is `$0dce`), and `--json` gives the same as numbers. The decruncher does not change `$01` or the interrupt
flag: the crunched data, the data and the decruncher must be RAM while it runs. The decruncher for Exomizer's format
also decrunches files made by `exomizer mem`: for streams crunched without `-T4` (Brokkr's default), set `MIRRORS` to 1
in its constants.

### `raw`: a bare stream

`brokkr raw` writes the stream alone, as `exomizer raw` does: `-b` crunches backward, `-r` writes the file reversed.

### `d64`: packing on a disk image

`brokkr d64 disk.d64` lists the disk as the 1541 does. `brokkr d64 disk.d64 GAME INTRO` packs the files named into a
copy of the disk, `disk-brokkr.d64` (or `-o`): a file that loads at `$0801` with a SYS line becomes a self-extracting
file, any other one crunched data at its address. `--mode sfx` or `--mode mem` packs every named file the same way.
The disk image you give is not changed.

### Options for every command

| | |
|---|---|
| `--format exomizer\|brokkr\|fast` | the stream format ([The formats](#the-formats)) |
| `--effort fast\|normal\|max` | how hard it crunches: `fast` takes a quarter of the time for streams about 1.7 % larger, `max` searches further on every core but one |
| `--threads <n>` | the threads for `--effort max` |
| `-o <file>` | the output (default `<first file>-brokkr.prg`, `.bin`, `.d64` or `.asm`) |
| `--json` | print the result, or the error, as one JSON object |
| `-q` | print nothing but errors |
| `-P`, `-T`, `-M`, `-m`, `-e`, `-E` | Exomizer's stream options, for `mem` and `raw` in Exomizer's format |

`brokkr --help` lists them all.

### Errors and JSON

An error says what is wrong and what to do, with a code (`BRK-E110` and so on), and Brokkr exits with 1. With `--json`
it prints `{ "ok": false, "error": { "code", "message", "hint" } }` instead, and on success `{ "ok": true, … }` with the
input, the output, the crunched stream's statistics, the memory layout, `$01`, the cycles the decruncher took in the
emulated C64 and the warnings: for build scripts, editors and IDEs.

### From TypeScript

```ts
import { sfx, mem, raw, Disk } from './src/index.ts';

const r = sfx(program, 0x0801, { format: 'fast' });   // program: the bytes after the load address
// r.prg is the file, r.areas the layout, r.cycles the time it took in the emulated C64
```

`src/node.ts` adds the pool of worker threads that `--effort max` uses.

## Better than Exomizer 3.1.1 at

- **Size.** Exomizer keeps one way to reach each position of the data. The cost of a match depends on what came
  before it, though: after a match and one literal the decruncher reads a bit that may take the match's offset again.
  Brokkr's parse keeps several ways to each position, one per state and offset that can still be taken again, so it
  finds where taking an offset again pays. It also takes the cheapest offset for each length, not only the nearest:
  the bucket tables Exomizer's optimiser makes are often not ever wider, and then a farther offset costs fewer bits.
  The tables are made for the parse and the parse for the tables until the stream stops shrinking.
- **Speed.** On one thread it crunches four to eight times as fast as Exomizer. `--effort max` searches further, on
  every core: from several starting tables, and with each bucket of the best table a bit wider and narrower in turn.
  The `fast` effort takes a quarter of the time of `normal` for streams 1.7 % larger.
- **Self-extracting programs that are planned and checked.** Brokkr works out where the decruncher, its table, its
  zero page bytes and the crunched data can go: the stack page and `$0334-$03ff` first, so nothing shows on the screen,
  then anywhere the program leaves room, under the ROMs included. It places the stream so that the decruncher never
  writes over a byte it has not read yet, and it sets `$01` while decrunching so that everything it reads and writes is
  RAM (`$34` when data lies under I/O). Then it runs the file in an emulated C64 from its SYS line until the program
  starts, and compares the memory with the program, byte for byte, before it hands the file over.
- **The in-place margin.** For crunched data (`mem`) it computes the exact margin a decruncher needs to decrunch in
  place, sets the load address from it, and warns when a load address you give would make the decruncher write over
  what it has not read.
- **Disk images.** `brokkr d64` lists a D64 and packs the files you name on it into a new image: self-extracting where a
  file starts with a SYS line, crunched data where not.
- **Tools that read its output.** `--json` prints the result as one JSON object: sizes, the memory layout, `$01`, the
  cycles the decruncher took, warnings. Errors have codes (`BRK-E110`) and say what to do.
- **Its decruncher as source.** `brokkr decruncher` writes Brokkr's 6502 decruncher as Kick Assembler source, to
  decrunch `mem` files (Brokkr's or Exomizer's) in your own program.

## Its own format

`--format brokkr` packs for size above all. It codes the same kind of LZ tokens as Exomizer, but every bit with a
binary arithmetic coder whose probabilities adapt after each bit, as LZMA's do: literals down an 8-bit tree, lengths in
an interleaved gamma code, offsets as their bit length (in the context of the match's length) and then their bits (the
first four in the context of the bit length, the rest of their place), and "the last offset again" after a literal.
The parse prices tokens by what the coder charges, block by block, and parses again until the stream stops shrinking.

On the 163 programs below the streams are 6.6 % smaller than Exomizer 3.1.1's (2 701 397 bytes against 2 891 460;
smaller on 152 of them), crunched in 84 s on one thread. It costs time and memory when decrunching: every bit takes a
multiply, so it decrunches about 8 times slower than Exomizer's format (median 7.8; 6.4 to 9.4 on half of them; up to 24
on data that hardly packs, which is all literals), and the decruncher needs 512 bytes of probabilities, 1 KB of quarter
squares where there is room (a third faster; without them it shifts and adds) and a resident part of about 425 bytes.
As self-extracting files on 159 of the programs, Brokkr's own format makes them 3.5 % smaller in all, smaller on 98: on
small programs Exomizer's format is smaller, its decruncher being shorter, and where a program leaves no room for the
probabilities the file is in Exomizer's format, with a note (26 of them).

`brokkr decruncher --format brokkr` writes its decruncher for `mem` files (backward only) as Kick Assembler source:
`--zp` (12 bytes), `--table` (a page: 1.5 KB, or 512 bytes with `--small`), `--at`, `--effect`.

## Its fast format

`--format fast` packs for decrunching fast. Every token is whole bytes, so the decruncher reads no bits: a literal run
of up to 32 bytes, a match of 2 or 3 bytes up to 16 back in one byte, one of 2 to 8 bytes up to 4096 back in two, any
match in three, and "the last offset again" in one; a full length field takes a byte more, up to 255. The parse prices
them in bytes. The decruncher keeps the write position in Y and copies each byte with `dey`, `lda`, `sta`, `dex` and
`bne`; it is 215 bytes (229 with RUN) and needs no tables, so it fits in the stack page.

On the 163 programs below the streams are 13.2 % larger than Exomizer 3.1.1's (3 273 438 bytes against 2 891 460),
crunched in 19 s on one thread. As self-extracting files on 159 of them they are 12.5 % larger than in Exomizer's format
and decrunch in 0.56 of its time in all: half of it on the median program, 0.4 at best, 0.8 for one that is nearly all
long runs (a copy costs the same in both). 5 programs that fill memory leave no room for the larger stream, and are in
Exomizer's format. It does not flash the border. Before this format Brokkr tried one of bits in the manner of ZX0:
3 % larger than Exomizer's, but only 1.27 times as fast, as reading bits costs about what Exomizer's tables do.

`brokkr decruncher --format fast` writes its decruncher for `mem` files: `--zp` (10 bytes), `--at`.

## Results

On 163 unpacked C64 programs (demos, games and intros from CSDB, unpacked with Sindri; 7.1 MB), as raw streams:

| | Exomizer 3.1.1 | Brokkr normal | Brokkr fast |
|---|---|---|---|
| crunched | 2 891 460 bytes | 2 873 546 bytes (−0.62 %) | 2 923 385 bytes (+1.10 %) |
| smaller than Exomizer | | on 160, the same on 2, larger on 1 | on 1 |
| time (one thread) | 954 s | 121 s | 31 s |

Exomizer decrunches every Brokkr stream to the same bytes (`exomizer raw -d`), and its `desfx` decrunches Brokkr's
self-extracting files. As self-extracting programs, on 62 of them, Brokkr's files are 0.39 % smaller in all, smaller on
36 and up to 81 bytes larger on 26: its decruncher is a little longer than Exomizer's, and it decrunches about 9 %
slower. Both are the next things to improve.

## How it works

- `src/format.ts`: the Exomizer 3 bit stream for every `-P` protocol and `-T` trait: the costs of the tokens, writing a
  parse as a stream, and a decoder, which checks every stream Brokkr writes and computes the in-place margin.
- `src/match.ts`: for every position the nearest place that repeats each length, from a binary tree of the earlier
  suffixes per two-byte prefix (as LZMA's bt2), plus farther places as long as the longest so far.
- `src/parse.ts`: the optimal parse, position by position, with arrivals per state (after a match, after a match and a
  literal, after two literals) and per offset that can be taken again.
- `src/optimize.ts`: the bucket tables for a parse, by dynamic programming from the deepest bucket up.
- `src/crunch.ts`, `src/search.ts`, `src/node.ts`: the rounds of parse and tables; the thorough search, on a pool of
  worker threads.
- `src/sfx.ts`, `src/decruncher.ts`, `src/asm.ts`, `src/emulate.ts`: the self-extracting file. The decruncher is Kick
  Assembler source that Brokkr assembles with its own small assembler at the addresses each file needs; it has a part
  that runs once from where the file loaded (it copies the rest, moves the stream and reads the tables) and a resident
  part of about 200 bytes. The emulated C64 is a 6510 with the CPU port banking BASIC, KERNAL and I/O, where reading a
  ROM that is switched in or writing to I/O counts as a fault.
- `src/brk.ts`, `src/parse-brk.ts`, `src/crunch-brk.ts`, `src/brk-decruncher.ts`: Brokkr's own format: its coder,
  model and prices, its parse, the rounds of parse and prices, and its 6502 decruncher (the self-extracting one and the
  one for `mem` files).
- `src/fast.ts`, `src/parse-fast.ts`, `src/fast-decruncher.ts`: the fast format, its parse (costs in whole bytes), and
  its 6502 decruncher.
- `src/files.ts`, `src/d64.ts`, `src/cli.ts`: the `raw` and `mem` files, D64 images, and the command line.

## Tests

```
pnpm test
```

They need the development tools (`pnpm install`). Besides Brokkr's own checks they compare with the real tools when
they are installed, at the paths in the environment variables `EXOMIZER`, `KICKASS` (with Java on the `PATH`) and
`C1541`; a test whose tool is missing is skipped. Exomizer 3.1.1 decrunches Brokkr's streams for several protocols and
its `desfx` a Brokkr self-extracting file; Kick Assembler assembles the decruncher sources to the same bytes as
Brokkr's assembler; VICE's `c1541` reads the disks Brokkr writes. The decrunchers for your own code decrunch `mem`
files in the emulated C64, in every format, the fast one's in fewer cycles than Exomizer's format takes.

## Licence

GPL-3.0-only, like Mimir Studio and Sindri. Brokkr contains no code of Exomizer's: it writes the stream format that
Magnus Lind designed for Exomizer 3, which its documentation and its decrunchers describe, and its cruncher, its 6502
decruncher and its self-extracting files are its own. The 6510 core is Sindri's.
