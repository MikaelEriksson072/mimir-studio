/* SID music for a JavaScript script (spec 10.3): the program's tunes, .sid files read and made, a player run frame by
 * frame, and the tunes a run asks to be played. */
import { describe, expect, it } from 'vitest';
import { musicPlayData, parsePsid, runJs, sidRequestText, type ScriptEnv, type ScriptSidData, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const hexes = (v: number[]) => v.map(x => `$${x.toString(16).padStart(2, '0')}`).join(',');
/** C-0 to B-7 for a PAL C64 (985248 Hz) */
const FREQ = Array.from({ length: 96 }, (_, n) => Math.min(0xffff, Math.round(16.3516 * 2 ** (n / 12) * 16777216 / 985248)));
/** a player at $1000: init keeps the song and sets the volume, play starts a note in each voice (C-1, C-2 and C-3, a
 *  semitone higher for each song) */
const program = fromSource('tune.prg', `.pc = $1000
 jmp init
 jmp play
init: sta song
 lda #$0f
 sta $d418
 rts
play: ldx #0
 ldy #0
voice: lda notes,y
 clc
 adc song
 sty keep
 tay
 lda freqlo,y
 sta $d400,x
 lda freqhi,y
 sta $d401,x
 ldy keep
 lda #$41
 sta $d404,x
 lda #$09
 sta $d405,x
 txa
 clc
 adc #7
 tax
 iny
 cpy #3
 bne voice
 rts
song: .byte 0
keep: .byte 0
notes: .byte 12,24,36
freqlo: .byte ${hexes(FREQ.map(f => f & 0xff))}
freqhi: .byte ${hexes(FREQ.map(f => f >> 8))}
`);
const END = program.load + program.bytes.length;
const env: ScriptEnv = { files: [program], names: new Map([['music', 0x1000]]) };
const js = (lines: string[]): UserScript => ({ id: 's', name: 's', lang: 'kickass', code: 'js', source: lines.join('\n'), pads: [] });
const data = (player: ScriptSidData['player'] = 'vice'): ScriptSidData => ({ player, tunes: [
  { name: 'music', file: 'tune.prg', start: 0x1000, end: END, init: 0x1000, play: 0x1003, why: ['a jump table'], score: 9, data: musicPlayData(program.bytes, 0x1000, 0x1000, 0x1003) },
] });
const run = (lines: string[], d: ScriptSidData | null = data()) => runJs(env, js(lines), { sid: d });

describe('sid in a JavaScript script', () => {
  it('lists the program\'s music: the block, its routines and what it plays with', () => {
    const r = run([
      'const t = sid.tune;',
      'print(sid.tunes.length, t === sid.tunes[0], t.name, t.file, hex(t.start), hex(t.end), t.size === t.bytes.length, hex(t.init), hex(t.play), t.song, t.songs, t.samples, t.why.join(), t.score);',
      'print(hex(t.plays.start), hex(t.plays.end), hex(t.plays.init), hex(t.plays.play), t.plays.parts.length, t.plays.routine, t.plays.problem, t.plays.alone);',
      'print(sid.at("music") === t, sid.at(t.end - 1) === t, sid.at(t.end), sid.musicPlayer);',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([`1 true music tune.prg $1000 $${END.toString(16)} true $1000 $1003 0 1 null a jump table 9`, `$1000 $${END.toString(16)} $1000 $1003 0 null null null`, 'true true null VICE']);
    // without the program's music there are no tunes, and the rest is there
    const none = run(['print(sid.tunes.length, sid.tune, sid.at(0x1000), sid.musicPlayer, typeof sid.run);'], null);
    expect(none.prints).toEqual(['0 null null VICE function']);
  });

  it('makes a tune\'s .sid file and reads a .sid file', () => {
    const r = run([
      'const f = sid.tune.sid({ author: "Someone", released: "2026 Mimir" });', 'const p = sid.parse(f);',
      'print(f.length - p.size, p.name, p.author, p.released, hex(p.start), hex(p.end), hex(p.init), hex(p.play), p.songs, p.song, p.rsid, p.bytes.length === sid.tune.size);',
      'const own = sid.make(mem.subarray(0x1000, 0x1010), { load: 0x1000, name: "Mine", song: 2, songs: 5, play: 0x1006 });', 'const q = sid.parse(own);',
      'print(q.name, q.author, hex(q.init), hex(q.play), q.songs, q.song, q.size);',
      'const rs = sid.parse(sid.make([1, 2, 3], { load: "music", rsid: true, init: 0x1001 }));', 'print(rs.rsid, hex(rs.init), rs.play, rs.name);',
      'for (const f of [() => sid.parse([1, 2, 3]), () => sid.make([1], {}), () => sid.make([], { load: 0x1000 }), () => sid.make(new Uint8Array(0x200), { load: 0xff00 }), () => sid.parse("x")]) try { f(); } catch (e) { print(e.message); }',
      'save("music.sid", f);',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints![0]).toBe(`126 music Someone 2026 Mimir $1000 $${END.toString(16)} $1000 $1003 1 0 false true`);
    expect(r.prints![1]).toBe('Mine <?> $1000 $1006 5 2 16');
    expect(r.prints![2]).toBe('true $1001 0 Ripped music');
    expect(r.prints![3]).toMatch(/^sid\.parse: not a \.sid file/);
    expect(r.prints![4]).toMatch(/^sid\.make: load is wanted/);
    expect(r.prints![5]).toBe('sid.make: there are no bytes');
    expect(r.prints![6]).toBe('sid.make: 512 bytes at $ff00 run past $ffff');
    expect(r.prints![7]).toMatch(/^sid\.parse: bytes are wanted/);
    const made = parsePsid(r.made![0].bytes);
    expect(made.data).toEqual(program.bytes);
  });

  it('runs a player frame by frame: what it wrote to the SID, the notes, the bytes it used', () => {
    const r = run([
      'const a = sid.tune.run({ frames: 20 });',
      'print(a.plays, a.samples, a.init, a.played, a.frames, a.stop, a.registers, a.notes, a.heard, a.dump.length, a.dump[0][0x18], a.maxCycles > 0, a.initCycles > 0);',
      'const v = sid.voices(a.dump[1]);',
      'print(v.map(x => [x.note, x.wave, x.gate, x.attack, x.decay, hex(x.frequency)].join(" ")).join(" | "), v.volume, v.filtered.join());',
      'print(a.ran[0].start === 0x1000, a.used.some(u => u.start <= addr("music") + 0x40));',
      // the same in the script's memory, with another song: a semitone up; registers: false leaves the dump out
      'const b = sid.run({ init: "music", play: 0x1003, song: 1, frames: 3 });', 'print(b.plays, b.played, sid.voices(b.dump[3]).map(x => x.note).join(" "));',
      'print(sid.run({ init: 0x1000, play: 0x1003, frames: 2, registers: false }).dump);',
      // a play that never returns stops the run; A given as the program gives it
      'mem[0x1003] = 0x4c; mem[0x1004] = 0x03; mem[0x1005] = 0x10;', 'const c = sid.run({ init: 0x1000, play: 0x1003, a: 2, frames: 5 });', 'print(c.plays, c.init, c.played, c.stop);',
      'for (const f of [() => sid.run({}), () => sid.run({ init: 0x1000, frames: 0 }), () => sid.run({ init: 0x1000, play: 0x1003, song: 300 })]) try { f(); } catch (e) { print(e.message); }',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints![0]).toBe('true false true 20 20 null 13 3 3 21 15 true true');
    expect(r.prints![1]).toBe(`C-1 pulse true 0 9 $${FREQ[12].toString(16).padStart(4, '0')} | C-2 pulse true 0 9 $${FREQ[24].toString(16).padStart(4, '0')} | C-3 pulse true 0 9 $${FREQ[36].toString(16).padStart(4, '0')} 15 false,false,false`);
    expect(r.prints![2]).toBe('true true');
    expect(r.prints![3]).toBe('true 3 C#1 C#2 C#3');
    expect(r.prints![4]).toBe('undefined');
    expect(r.prints![5]).toBe('false true 0 play does not return in 19656 cycles (call 1)');
    expect(r.prints![6]).toMatch(/^sid\.run: init is wanted/);
    expect(r.prints![7]).toMatch(/^sid\.run: frames is 1-30000/);
    expect(r.prints![8]).toMatch(/^sid\.run: the song is 0-255/);
  });

  it('names a frequency\'s note and finds the note tables', () => {
    const r = run([
      `print(JSON.stringify(sid.note(${FREQ[57]})), sid.note(0), sid.note(${FREQ[0]}).name, sid.note(${FREQ[57]}, { ntsc: true }).hz);`,
      'print(sid.noteTables().map(t => hex(t.start)).join());',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints![0]).toBe('{"name":"A-4","octave":4,"hz":440.03,"cents":0} null C-0 456.77');
    expect(r.prints![1]).not.toBe('');
  });

  it('makes the PRG that plays a tune in VICE, and loads a .sid file into mem', () => {
    const r = run([
      'const p = sid.tune.player({ song: 1 });', 'print(hex(p.prg[0] | p.prg[1] << 8), hex(p.port, 2), p.screen, p.driver.end > p.driver.start, p.warnings.length);',
      'const q = sid.player({ bytes: [0x60, 0, 0, 0x60], load: 0x4000 });', 'print(hex(q.prg[0] | q.prg[1] << 8), sid.player(sid.tune.sid()).prg.length === sid.tune.player().prg.length);',
      'const f = sid.make([0x4c, 0x06, 0xc0, 0x4c, 0x07, 0xc0, 0x60, 0x60], { load: 0xc000 });', 'const l = sid.load(f);', 'print(hex(l.start), hex(l.end), hex(mem[0xc000], 2), hex(mem[0xc007], 2));',
      'const m = sid.load(f, 0x2000);', 'print(hex(m.start), hex(m.init), hex(m.play), hex(mem[0x2000], 2));',
      'try { sid.player(12); } catch (e) { print(e.message); }',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['$0801 $37 true true 0', '$0801 true', '$c000 $c008 $4c $60', '$2000 $2000 $2003 $4c', 'sid.player: a tune (one of sid.tunes), a .sid file or { bytes, load, init, play } is wanted']);
    // what was loaded outside the program is memory the run wrote, not a change of the program
    expect(r.changes).toEqual([]);
  });

  it('ends the run with the tunes it asked to be played: the .sid and the player\'s PRG', () => {
    const r = run([
      'sid.play(sid.tune);', 'sid.play(sid.tune.sid(), { song: 3, in: "deepsid" });', 'sid.play({ bytes: mem.subarray(0x1000, 0x1100), load: 0x1000, name: "part" }, { in: "VICE" });',
      'sid.requests.forEach(t => print(t));',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.plays!.map(p => [p.name, p.player, !!p.prg, p.how])).toEqual([
      ['music', 'vice', true, 'init $1000 with song $00, then play $1003 each frame'],
      ['music', 'deepsid', true, 'init $1000 with song $03, then play $1003 each frame'],
      ['part', 'vice', true, 'init $1000 with song $00, then play $1003 each frame'],
    ]);
    expect(parsePsid(r.plays![0].sid).data).toEqual(program.bytes);
    const second = parsePsid(r.plays![1].sid);
    expect([second.startSong, second.songs]).toEqual([4, 4]);
    expect(r.prints).toEqual(['music played in VICE: init $1000 with song $00, then play $1003 each frame', 'music played in DeepSID: init $1000 with song $03, then play $1003 each frame',
      'part played in VICE: init $1000 with song $00, then play $1003 each frame']);
    expect(sidRequestText(r.plays![1])).toMatch(/^music played in DeepSID/);
    // not said: where Settings says
    expect(run(['sid.play(sid.tune);', 'print(sid.musicPlayer);'], data('deepsid')).plays![0].player).toBe('deepsid');
  });

  it('plays nothing when the run stops with an error, four tunes at most, and not where playing is not given', () => {
    expect(run(['sid.play(sid.tune);', 'throw new Error("no");']).plays).toBeUndefined();
    expect(run(['for (let i = 0; i < 5; i++) sid.play(sid.tune);']).error?.msg).toBe('RangeError: sid.play: a run asks for 4 tunes to be played at most');
    expect(run(['sid.play(sid.tune, { in: "winamp" });']).error?.msg).toMatch(/^RangeError: sid\.play: in is "vice" or "deepsid"/);
    expect(run(['sid.play({ bytes: [0x60], load: 0x1000 });'], null).error?.msg).toMatch(/^Error: sid\.play: playing is not given here/);
  });
});
