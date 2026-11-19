/* PETSCII animations a player draws frame by frame (c64/petscii-anim.ts, spec 14.5b). The frames are written by the
 * helper's own encoder and played by a player of its own, written to the shape the reader looks for
 * (test/helpers/petscii-anim.ts). The reader was also checked against The Pumpkins' Breadbin of Horror (side 1, Spindle
 * job 13): from the job's code alone it finds the player at $faaf, the pointer $80, the counter $8c and the tables
 * $cd00/$cdfb, and reads 105 frames in four sequences ($8000 x64, $bffb x15, $9dc8 x15, $aa1b x11), the last ending one
 * byte past the job's bytes; at the player's 31st and 71st call the screen and colour RAM in VICE are the reader's
 * frames 30 and 70 (counted from 1). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPetsciiAnims, gifAnimation, PETSCII_SCREEN, petsciiFrameAt, petsciiFramePixels, readSpindleDisk, type PetsciiAnim } from '../src';
import { readGif } from './helpers/gif';
import { animDemo, animMemory, encodeFrames, screenWith, type PlayerOptions, type Screen } from './helpers/petscii-anim';
import { makeSpindleDisk } from './helpers/spindle-disk';

/** a little picture moving right a character a frame, in two colours, from column `from` */
const moving = (n: number, from = 0, base?: Screen) => Array.from({ length: n }, (_, k) => screenWith([
  { at: 400 + from + k, codes: [0x51, 0x57, 0x51], colour: 7 }, { at: 440 + from + k, codes: [0xa0, 0xa0, 0xa0], colour: 2 },
], base));

const find = (o: PlayerOptions, streams: { at: number; bytes: number[] }[], tables: { chars: number[]; colours: number[] }): PetsciiAnim[] => {
  const m = animMemory(o, streams, tables);
  return findPetsciiAnims(m.mem, a => m.loaded[a] === 1);
};
const screenOf = (f: { chars: Uint8Array; colours: Uint8Array }): Screen => ({ chars: [...f.chars], colours: [...f.colours] });

describe('PETSCII animations', () => {
  it('reads the frames of each sequence the code sets, in the order of the state it sets with them', () => {
    // three sequences played A, B, C (states 0, 1, 2), set in the code in the order C, A, B; each draws over the last
    const a = moving(5), b = moving(4, 10, a[4]), c = [screenWith([{ at: 0, codes: [1, 2, 3], colour: 1 }, { at: 999, codes: [0x2a], colour: 5 }], b[3])];
    const all = encodeFrames([...a, ...b, ...c]);
    const sA = 0x8000, sB = sA + all.starts[5], sC = sA + all.starts[9];
    const o: PlayerOptions = { chars: 0x9000, colours: 0x9100, codeOrder: [2, 0, 1], sequences: [{ start: sA, frames: 5, state: 0 }, { start: sB, frames: 4, state: 1 }, { start: sC, frames: 1, state: 2 }] };
    const [anim, ...more] = find(o, [{ at: sA, bytes: all.stream }], all);
    expect(more).toEqual([]);
    expect(anim.problem).toBeNull();
    expect(anim.player).toMatchObject({ ptr: 0x80, counter: 0x8c, chars: 0x9000, colours: 0x9100 });
    expect(anim.player.entry).toBe(anim.player.next - 8);
    expect(anim.sequences.map(q => [q.start, q.count, q.frames])).toEqual([[sA, 5, 5], [sB, 4, 4], [sC, 1, 1]]);
    expect(anim.frames.map(screenOf)).toEqual([...a, ...b, ...c]);
    expect(anim.frames.map(f => [f.n, f.seq, f.k])).toEqual([[0, 0, 0], [1, 0, 1], [2, 0, 2], [3, 0, 3], [4, 0, 4], [5, 1, 0], [6, 1, 1], [7, 1, 2], [8, 1, 3], [9, 2, 0]]);
    expect(anim.frames.map(f => f.start - sA)).toEqual(all.starts);
    expect(anim.start).toBe(sA);
    expect(anim.end).toBe(sA + all.stream.length);
    // the first frame writes its six characters; the next only those that change: all four on the row of different
    // characters (QWQ moved on), the two ends on the row of the same one
    expect(anim.frames[0].writes).toBe(6);
    expect(anim.frames[1].writes).toBe(6);
    expect(anim.frames[1].writes).toBe(4 + 2);
    expect(anim.frames[0].chars.length).toBe(PETSCII_SCREEN);
  });

  it('skips far with bytes after the header, $ff while more follow', () => {
    const s = [screenWith([{ at: 0, codes: [1], colour: 1 }, { at: 14, codes: [2], colour: 2 }, { at: 30, codes: [3], colour: 3 }, { at: 300, codes: [4], colour: 4 }, { at: 999, codes: [5], colour: 5 }])];
    const e = encodeFrames(s);
    // skips of 13, 15 (15 and a 15), 269 ($ff and 14) and 698 ($ff, $ff and 188)
    expect(e.stream).toEqual([0x10, 0, 0x1d, 1, 0x1f, 15, 2, 0x1f, 0xff, 14, 3, 0x1f, 0xff, 0xff, 188, 4, 0]);
    const [anim] = find({ chars: 0x9000, colours: 0x9100, sequences: [{ start: 0x8000, frames: 1 }] }, [{ at: 0x8000, bytes: e.stream }], e);
    expect(anim.frames.map(screenOf)).toEqual(s);
  });

  it('tells the colour table from the screen codes by its values, whichever the player writes first', () => {
    const s = moving(3), e = encodeFrames(s);
    for (const coloursFirst of [false, true]) {
      const [anim] = find({ chars: 0xa000, colours: 0xa400, coloursFirst, sequences: [{ start: 0x6000, frames: 3 }] }, [{ at: 0x6000, bytes: e.stream }], e);
      expect(anim.player.colours).toBe(0xa400);
      expect(anim.frames.map(screenOf)).toEqual(s);
    }
  });

  it('plays a sequence that starts inside another one again, and finds the frame at an address', () => {
    // frames 0-4, then again from frame 3: the same bytes are drawn twice (on the screen frame 4 left)
    const a = moving(5), e = encodeFrames(a);
    const again = 0x8000 + e.starts[3];
    const [anim] = find({ chars: 0x9000, colours: 0x9100, sequences: [{ start: 0x8000, frames: 5, state: 0 }, { start: again, frames: 2, state: 1 }] }, [{ at: 0x8000, bytes: e.stream }], e);
    expect(anim.frames.length).toBe(7);
    expect(anim.frames.slice(5).map(f => f.start)).toEqual(anim.frames.slice(3, 5).map(f => f.start));
    expect(petsciiFrameAt(anim, again)).toBe(3);
    expect(petsciiFrameAt(anim, anim.end - 1)).toBe(4);
    expect(petsciiFrameAt(anim, anim.end)).toBe(-1);
  });

  it('reads a start the code does not count up to the next start, or to a frame that changes nothing', () => {
    const a = moving(3), b = moving(2, 20, a[2]), e = encodeFrames([...a, ...b]);
    const sB = 0x8000 + e.starts[3];
    // zeros follow the stream: an empty frame, not 2000 of them
    const [anim] = find({ chars: 0x9000, colours: 0x9100, counted: false, sequences: [{ start: 0x8000, frames: 3, state: 0 }, { start: sB, frames: 2, state: 1 }] }, [{ at: 0x8000, bytes: [...e.stream, 0, 0, 0, 0] }], e);
    expect(anim.sequences.map(q => [q.count, q.frames])).toEqual([[null, 3], [null, 2]]);
    expect(anim.frames.map(screenOf)).toEqual([...a, ...b]);
    expect(anim.problem).toBeNull();
  });

  it('says why it stops early: bytes that are not loaded, a run past the screen', () => {
    const s = moving(4), e = encodeFrames(s);
    const short = find({ chars: 0x9000, colours: 0x9100, sequences: [{ start: 0x8000, frames: 4 }] }, [{ at: 0x8000, bytes: e.stream.slice(0, e.starts[2] + 2) }], e)[0];
    expect(short.frames.length).toBe(2);
    expect(short.problem).toMatch(/^frame 3 from \$8000: \$[0-9a-f]{4} is not loaded$/);
    // a run of 15 (the header $ff) after a skip to 1020 ($ff four times and a 0)
    const past = find({ chars: 0x9000, colours: 0x9100, sequences: [{ start: 0x8000, frames: 1 }] }, [{ at: 0x8000, bytes: [0xff, 0xff, 0xff, 0xff, 0xff, 0x00, ...Array(15).fill(0), 0] }], e)[0];
    expect(past.frames).toEqual([]);
    expect(past.problem).toMatch(/writes past the screen/);
  });

  it('finds no animation without the player, or without its code loaded, and says when nothing sets the stream', () => {
    const e = encodeFrames(moving(2));
    const m = animMemory({ chars: 0x9000, colours: 0x9100, sequences: [{ start: 0x8000, frames: 2 }] }, [{ at: 0x8000, bytes: e.stream }], e);
    // the stream and the tables alone
    const noCode = new Uint8Array(m.mem); noCode.fill(0, m.code.start, m.code.end);
    expect(findPetsciiAnims(noCode)).toEqual([]);
    // the code there but not loaded
    expect(findPetsciiAnims(m.mem, a => m.loaded[a] === 1 && (a < m.code.start || a >= m.code.end))).toEqual([]);
    // the player without the code that sets the stream pointer
    const noSet = find({ chars: 0x9000, colours: 0x9100, sequences: [] }, [{ at: 0x8000, bytes: e.stream }], e);
    expect(noSet.length).toBe(1);
    expect(noSet[0].frames).toEqual([]);
    expect(noSet[0].problem).toBe('the code never sets where the frames start');
  });

  it('draws a frame as pixels in its colours, and writes frames as an animated GIF', () => {
    const font = new Uint8Array(0x800);
    font.set([0x80, 0, 0, 0, 0, 0, 0, 0x01], 0x41 * 8);
    const f = { chars: new Uint8Array(PETSCII_SCREEN).fill(0x20), colours: new Uint8Array(PETSCII_SCREEN) };
    f.chars[41] = 0x41; f.colours[41] = 7;
    const px = petsciiFramePixels(f, font, 6);
    expect(px.length).toBe(320 * 200);
    // character 41 is row 1, column 1: its top-left and bottom-right pixels in yellow, the rest in the background
    expect(px[8 * 320 + 8]).toBe(7);
    expect(px[15 * 320 + 15]).toBe(7);
    expect(px[8 * 320 + 9]).toBe(6);
    expect(px[0]).toBe(6);
    const g = gifAnimation([px, petsciiFramePixels({ ...f, colours: f.colours.map(() => 2) }, font, 0)], 320, 200, [0x000000, 0xffffff, 0x880000, 0xaaffee, 0xcc44cc, 0x00cc55, 0x0000aa, 0xeeee77], 8);
    const r = readGif(g);
    expect([r.width, r.height, r.loop, r.frames.length, r.frames[0].delay]).toEqual([320, 200, true, 2, 8]);
    expect(r.palette.slice(0, 8)).toEqual([0x000000, 0xffffff, 0x880000, 0xaaffee, 0xcc44cc, 0x00cc55, 0x0000aa, 0xeeee77]);
    expect(r.frames[0].pixels).toEqual(px);
    expect(r.frames[1].pixels[8 * 320 + 8]).toBe(2);
  });

  it('is fixtures/d64/petscii-anim.d64, which the e2e tests mount: a Spindle disk whose job 2 plays the animation', () => {
    const demo = animDemo();
    // job 1: the part before (an rts at $0800); job 2: the stream, the tables and the code
    const disk = makeSpindleDisk([{ chunks: [{ start: 0x0800, bytes: [0x60] }] }, { chunks: demo.chunks }]);
    const path = join(__dirname, '../../../fixtures/d64/petscii-anim.d64');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, disk);
    expect(new Uint8Array(readFileSync(path))).toEqual(disk);
    const s = readSpindleDisk(disk)!;
    expect(s.jobs.map(j => j.chunks.map(c => c.start))).toEqual([[0x0800], [0x8000, 0x9000, 0x9100, 0xc000]]);
    const mem = new Uint8Array(0x10000), on = new Uint8Array(0x10000);
    for (const c of s.jobs[1].chunks) { mem.set(c.bytes, c.start); on.fill(1, c.start, c.end); }
    const [anim] = findPetsciiAnims(mem, a => on[a] === 1);
    expect(anim.frames.map(screenOf)).toEqual(demo.screens);
    expect(anim.sequences.map(q => [q.start, q.frames])).toEqual([[0x8000, 8], [anim.frames[8].start, 4]]);
    expect([anim.start, anim.end]).toEqual([0x8000, 0x8000 + demo.stream.length]);
  });

  it('writes a GIF whose codes reach 12 bits and start again (a clear code), and still reads back', () => {
    // noise in 16 colours: the table fills up more than once
    let seed = 1;
    const noise = Uint8Array.from({ length: 320 * 200 }, () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 16) & 15; });
    const r = readGif(gifAnimation([noise], 320, 200, Array.from({ length: 16 }, (_, i) => i * 0x111111), 4));
    expect(r.frames[0].pixels).toEqual(noise);
  });
});
