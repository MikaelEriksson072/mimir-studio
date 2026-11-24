/* =====================================================================
 * SID music for a JavaScript script (spec 10.3): the program's music as the analysis found it, .sid files read and
 * made, a player run frame by frame, and a tune played in VICE or DeepSID, as `sid` in a script's code (script-js.ts):
 *
 *   sid.tunes                      the program's music blocks: a list (empty when it has none). Each tune:
 *       name, file                 its label, and the program's file it is in
 *       start, end, size, bytes    the block, as the program has it (end: the address after its last byte)
 *       init, play                 the player's own routines (play 0: a sample player, nothing is called each frame)
 *       song, songs                the song the program starts (0: the first), and how many the .sid says it has
 *       samples                    a sample player's { nmi, hz }, else null
 *       why, score                 what the analysis found it by
 *       plays                      what it plays with in VICE, in DeepSID and as a .sid: { start, end, bytes, init,
 *                                  play, parts, routine, problem, alone }. init may be a routine Mimir puts next to
 *                                  the block (routine says which: one that gives X and Y as the program does, puts
 *                                  back what a snapshot's player reads, writes a song's bytes, starts the samples)
 *       sid({ name, author, released })    its .sid file, as the export writes it (a sample player's an RSID)
 *       player({ song, title })    the PRG that plays it in VICE: { prg, port, driver, screen, warnings }
 *       run({ song, frames })      it run on its own, as sid.run
 *   sid.tune                       the first tune, or null
 *   sid.at(address)                the tune that covers an address, or null
 *   sid.musicPlayer                where music plays (Settings → Toolchain): "VICE" or "DeepSID"
 *   sid.parse(file)                a .sid file read: { name, author, released, start, end, size, init, play, songs,
 *                                  song, rsid, bytes }
 *   sid.make(bytes, { load, init, play, name, author, released, song, songs, rsid })
 *                                  a .sid file of bytes (a PSID v2; rsid: true an RSID): init is load and play is
 *                                  load + 3 when not given
 *   sid.load(file, at)             a .sid file's bytes copied into mem where they load (or at an address): what
 *                                  sid.parse gives
 *   sid.run({ init, play, song, a, x, y, frames, registers })
 *                                  a player run in a copy of mem as it is now: init with the song in A, then play
 *                                  once a frame. { plays, init, played, frames, stop, registers, notes, heard, used,
 *                                  ran, initCycles, maxCycles, dump }: dump is the SID's 25 registers after init and
 *                                  after each play call (left out with registers: false). play 0 or not given: a
 *                                  sample player, run from its timer interrupt ({ samples: true, hz, nmi, handler,
 *                                  calls, … })
 *   sid.player({ bytes, load, init, play, song, title } or a .sid file)
 *                                  the PRG that plays it in VICE: { prg, port, driver, screen, warnings }
 *   sid.play(what, { song, in })   a tune, a .sid file or { bytes, load, init, play } played when the run has ended
 *                                  well: in VICE with Mimir's player or in DeepSID (in: "vice" or "deepsid"; not
 *                                  given: where Settings says)
 *   sid.note(frequency, { ntsc })  a voice's frequency value (registers 0 and 1) as { name, octave, hz, cents },
 *                                  name such as "A-4"; null for 0
 *   sid.voices(registers)          a dump's 25 registers read: [{ frequency, pulse, control, gate, wave, attack,
 *                                  decay, sustain, release, note }] and volume, filter on the list itself
 *   sid.noteTables()               where note frequency tables are in mem: [{ start, end }]
 *   sid.requests                   what the script has asked to be played so far, a text each
 *
 * Nothing is played during the run: the run ends with the requests (ScriptRun.plays) and the app plays them, unless
 * the script is in safe mode, where Last run says what it would play.
 * ===================================================================== */
import { noteTables } from './analyze/music';
import { makePsid, parsePsid } from './c64/psid';
import { musicSidFile, sidPlayer, type MusicPlayData } from './c64/sidplayer';
import { digiPlays, plays, runDigi, runPlayer, USED_RUN } from './c64/sidrun';
import { sidWithTexts } from './library';

/** a music block as the app hands it to a script's run */
export interface ScriptSidTune {
  name: string;
  /** the program's file it is in (null: none) */
  file: string | null;
  /** the block and the player's own routines, as addresses of the 64 KB */
  start: number; end: number; init: number; play: number;
  why: string[]; score: number;
  /** what it plays with (c64/sidplayer.ts musicPlayData) */
  data: MusicPlayData;
}

/** what the app hands a script's run of the program's music */
export interface ScriptSidData {
  /** where music plays (Settings → Toolchain) */
  player: 'vice' | 'deepsid';
  tunes: ScriptSidTune[];
}

/** what a script asked to be played: done by the app when the run has ended well. `sid`: the .sid file (DeepSID plays
 *  it); `prg`: Mimir's player with it (VICE), null when it cannot be made (`problem` says why) */
export interface ScriptSidRequest {
  name: string;
  /** where: as the script said, else where Settings says */
  player: 'vice' | 'deepsid';
  sid: Uint8Array;
  prg: Uint8Array | null;
  problem?: string;
  /** what the tune is, in words: "init $1000 with song $00, then play $1003 each frame" */
  how: string;
  warnings: string[];
}

/** the most a script asks to be played in one run */
export const SID_REQUESTS = 4;
/** the frames one sid.run takes at most (ten minutes of a PAL C64), and when none are said (ten seconds) */
export const SID_RUN_FRAMES = 30_000, SID_RUN_DEFAULT = 500;

const h = (v: number, n = 4) => `$${v.toString(16).padStart(n, '0')}`;
const NOTES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
const WAVES = ['triangle', 'sawtooth', 'pulse', 'noise'];

/** What a request does, in words: for Last run and the messages. */
export function sidRequestText(r: ScriptSidRequest): string {
  return `${r.name} played in ${r.player === 'deepsid' ? 'DeepSID' : 'VICE'}: ${r.how}`;
}

const ranges = (mask: ArrayLike<number>, bit: number): { start: number; end: number }[] => {
  const out: { start: number; end: number }[] = [];
  for (let a = 0; a < 0x10000; a++) {
    if (!(mask[a] & bit)) continue;
    const s = a; while (a < 0x10000 && (mask[a] & bit)) a++;
    out.push({ start: s, end: a });
  }
  return out;
};
const isSidFile = (u: Uint8Array) => u.length >= 0x7e && (u[0] === 0x50 || u[0] === 0x52) && u[1] === 0x53 && u[2] === 0x49 && u[3] === 0x44;

/** what is played: the bytes with init and play, as the player's PRG and the .sid take them */
interface Playable { name: string; d: MusicPlayData; sid?: Uint8Array }

/** `sid` for a script's run; `asked` is called with each request. */
export function sidApi(data: ScriptSidData | null, ctx: { mem: Uint8Array; addr: (where: unknown) => number; files: readonly { start: number; end: number }[] }, asked: (r: ScriptSidRequest) => void): Record<string, unknown> {
  const { mem, addr } = ctx;
  const made: ScriptSidRequest[] = [];
  const bytesOf = (v: unknown, what: string): Uint8Array => {
    if (v instanceof Uint8Array) return v;
    if (Array.isArray(v)) return Uint8Array.from(v as number[]);
    throw new TypeError(`${what}: bytes are wanted (a Uint8Array, such as mem.subarray(…), disk.read(…) or a tune's sid())`);
  };
  const frames = (v: unknown, what: string): number => {
    if (v == null) return SID_RUN_DEFAULT;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > SID_RUN_FRAMES) throw new RangeError(`${what}: frames is 1-${SID_RUN_FRAMES} (50 a second), not ${String(v)}`);
    return n;
  };
  const songOf = (v: unknown, what: string, first = 0): number => {
    if (v == null) return first;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 255) throw new RangeError(`${what}: the song is 0-255 (0: the first), not ${String(v)}`);
    return n;
  };
  const parse = (file: unknown, what: string) => {
    const u = bytesOf(file, what);
    if (!isSidFile(u)) throw new TypeError(`${what}: not a .sid file (a PSID or RSID starts with those letters and has a header of $7c bytes)`);
    const p = parsePsid(u);
    return { name: p.name, author: p.author, released: p.released, start: p.location, end: p.location + p.size, size: p.size, init: p.init, play: p.play, songs: p.songs, song: Math.max(0, p.startSong - 1), rsid: p.rsid, bytes: p.data.slice() };
  };

  /** a player run in `memory`; `own`: what is loaded when it runs on its own (running out of it ends the run) */
  const runIn = (memory: Uint8Array, o: { init: number; play: number; song: number; regs?: { a?: number; x?: number; y?: number }; frames: number; dump: boolean; loaded?: (a: number) => boolean; digi?: MusicPlayData['digi']; port?: number }) => {
    if (!o.play) {
      const r = runDigi(memory, { init: o.init, song: o.song, frames: o.frames, ...(o.port != null ? { port: o.port } : {}), ...(o.loaded ? { loaded: o.loaded } : {}), ...(o.digi?.irq ? { irq: o.digi.irq } : {}) });
      return { samples: true, plays: digiPlays(r), init: r.init, played: r.played, frames: o.frames, stop: r.stop, nmi: r.nmi, hz: r.hz, latch: r.latch, handler: r.handler, vector: r.vector, port: r.port,
        calls: r.calls, sidCalls: r.sidCalls, registers: r.regs.map(x => ({ register: x.reg, writes: x.writes, values: x.values })), used: ranges(r.used, 3), ran: ranges(r.used, USED_RUN), wrote: ranges(r.wrote, 1), maxCycles: r.maxCycles };
    }
    const dump: Uint8Array[] = [];
    const r = runPlayer(memory, { init: o.init, play: o.play, song: o.song, frames: o.frames, ...(o.regs ? { regs: o.regs } : {}), ...(o.loaded ? { loaded: o.loaded } : {}), ...(o.dump ? { frame: (_n: number, s: Uint8Array) => { dump.push(s.slice()); } } : {}) });
    return { samples: false, plays: plays(r), init: r.init, played: r.played, frames: o.frames, stop: r.stop, registers: r.regs, notes: r.notes, heard: r.heard, used: ranges(r.used, 3), ran: ranges(r.used, USED_RUN),
      initCycles: r.initCycles, maxCycles: r.maxPlay, ...(o.dump ? { dump } : {}) };
  };
  /** the bytes of what plays with nothing else in memory, and what is loaded then */
  const alone = (d: MusicPlayData) => {
    const m = new Uint8Array(0x10000), segs = [{ load: d.load, data: d.data }, ...(d.parts ?? [])];
    for (const g of segs) m.set(g.data.subarray(0, 0x10000 - g.load), g.load);
    const covers = (s: number, e: number) => segs.some(g => g.load < e && s < g.load + g.data.length);
    return { m, loaded: (a: number) => segs.some(g => a >= g.load && a < g.load + g.data.length), port: covers(0xe000, 0x10000) || covers(0x0314, 0x031a) ? 0x35 : covers(0xa000, 0xc000) ? 0x36 : 0x37 };
  };
  const howText = (d: MusicPlayData, song: number): string => {
    if (d.digi && d.play === 0) return `init ${h(d.init)} starts its ${d.digi.nmi ? 'NMI' : 'IRQ'}, which plays ${d.digi.hz ? `${d.digi.hz} samples a second` : 'it'}; nothing is called each frame`;
    return `init ${h(d.init)} with song ${h(song, 2)}, then play ${h(d.play)} each frame`;
  };
  const playerOf = (p: Playable, song: number, title?: unknown) => {
    const d = p.d;
    const r = sidPlayer({ data: d.data, load: d.load, init: d.init, play: d.play, song, title: String(title ?? p.name).slice(0, 40), ...(d.parts ? { parts: d.parts } : {}), ...(d.digi ? { digi: d.digi } : {}), ...(d.busy ? { busy: d.busy } : {}),
      ...(d.regs ? { fixed: { x: d.regs.x, y: d.regs.y } } : {}) });
    return { prg: r.prg, port: r.port, driver: r.driver, screen: r.screen, warnings: r.warnings };
  };
  const ask = (p: Playable, o: { song?: unknown; in?: unknown } = {}) => {
    if (!data) throw new Error('sid.play: playing is not given here (the script runs where it is not: Run on files, Run with values, before Build & Run)');
    if (made.length >= SID_REQUESTS) throw new RangeError(`sid.play: a run asks for ${SID_REQUESTS} tunes to be played at most`);
    const where = o?.in == null ? data.player : String(o.in).toLowerCase();
    if (where !== 'vice' && where !== 'deepsid') throw new RangeError(`sid.play: in is "vice" or "deepsid" (not ${JSON.stringify(o.in)})`);
    const song = songOf(o?.song, 'sid.play', p.d.song ?? 0);
    // the .sid: a file given is played as it is (with another song, its start song set); else made of the bytes
    let file = p.sid ?? musicSidFile(p.d, p.name);
    if (o?.song != null) { file = file.slice(); file[0x10] = 0; file[0x11] = Math.min(255, song) + 1; if (((file[0x0e] << 8) | file[0x0f]) < song + 1) { file[0x0e] = (song + 1) >> 8; file[0x0f] = (song + 1) & 0xff; } }
    let prg: Uint8Array | null = null, problem: string | undefined, warnings: string[] = [];
    try { const r = playerOf(p, song); prg = r.prg; warnings = r.warnings; } catch (e) { problem = e instanceof Error ? e.message : String(e); }
    if (!prg && where === 'vice') throw new Error(`sid.play: ${problem}`);
    const r: ScriptSidRequest = { name: p.name, player: where, sid: file, prg, ...(problem ? { problem } : {}), how: howText(p.d, song), warnings };
    made.push(r); asked(r);
  };

  const tunes = (data?.tunes ?? []).map(t => {
    const d = t.data;
    const playable: Playable = { name: t.name, d };
    const routine = d.regs ? `${h(d.regs.at)} gives init ${(['x', 'y'] as const).filter(k => d.regs![k] != null).map(k => `${k.toUpperCase()} = ${h(d.regs![k]!, 2)}`).join(' and ')} as the program does, then jumps to ${h(d.regs.init)}`
      : d.songs ? `${h(d.songs.at)} writes what the program's routine for song A leaves for play (${d.songs.count} song${d.songs.count === 1 ? '' : 's'})`
        : d.wrapped ? `${h(d.wrapped.at)} calls init ${h(d.wrapped.init)} and leaves only the samples' interrupt on`
          : d.resume ? `${h(d.resume.at)} puts back the bytes the player reads outside the block` : null;
    const tune: Record<string, unknown> = {
      name: t.name, file: t.file, start: t.start, end: t.end, size: t.end - t.start, bytes: mem.slice(t.start, t.end), init: t.init, play: t.play,
      song: d.song ?? 0, songs: Math.max(d.songs?.count ?? 0, (d.song ?? 0) + 1), samples: d.digi ? { nmi: d.digi.nmi, hz: d.digi.hz } : null, why: [...t.why], score: t.score,
      plays: { start: d.load, end: d.load + d.data.length, bytes: d.data.slice(), init: d.init, play: d.play, parts: (d.parts ?? []).map(p => ({ start: p.load, end: p.load + p.data.length, bytes: p.data.slice() })),
        routine, problem: d.problem ?? null, alone: d.alone ?? null },
      sid(o: { name?: unknown; author?: unknown; released?: unknown } = {}) {
        const f = musicSidFile(d, String(o?.name ?? t.name));
        return sidWithTexts(f, { ...(o?.author != null ? { author: String(o.author) } : {}), ...(o?.released != null ? { released: String(o.released) } : {}) });
      },
      player(o: { song?: unknown; title?: unknown } = {}) { return playerOf(playable, songOf(o?.song, 'tune.player', d.song ?? 0), o?.title); },
      run(o: { song?: unknown; frames?: unknown; registers?: unknown } = {}) {
        const a = alone(d);
        return runIn(a.m, { init: d.init, play: d.play, song: songOf(o?.song, 'tune.run', d.song ?? 0), frames: frames(o?.frames, 'tune.run'), dump: o?.registers !== false, loaded: a.loaded, digi: d.digi, port: a.port });
      },
    };
    return { tune, t };
  });
  const list = tunes.map(x => x.tune);
  const isTune = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && list.includes(v as Record<string, unknown>);
  /** what sid.player and sid.play take: a tune, a .sid file, or { bytes, load, init, play } */
  const playable = (what: unknown, name: string): Playable => {
    if (isTune(what)) { const x = tunes.find(k => k.tune === what)!; return { name: x.t.name, d: x.t.data }; }
    if (what instanceof Uint8Array || Array.isArray(what)) {
      const u = bytesOf(what, name), p = parse(u, name);
      return { name: p.name.replace(/[^A-Za-z0-9 _.-]+/g, '_').trim() || 'tune', sid: u,
        d: { data: p.bytes, load: p.start, init: p.init, play: p.play, song: p.song, ...(p.play === 0 ? { digi: { nmi: false, hz: 0 } } : {}) } };
    }
    if (what && typeof what === 'object') {
      const o = what as { bytes?: unknown; load?: unknown; init?: unknown; play?: unknown; name?: unknown; song?: unknown };
      const bytes = bytesOf(o.bytes, name);
      if (!bytes.length) throw new RangeError(`${name}: there are no bytes`);
      if (o.load == null) throw new TypeError(`${name}: load is wanted, where the bytes go`);
      const load = addr(o.load), init = o.init == null ? load : addr(o.init), play = o.play == null ? load + 3 : o.play === 0 ? 0 : addr(o.play);
      if (load + bytes.length > 0x10000) throw new RangeError(`${name}: the bytes run past $ffff`);
      return { name: String(o.name ?? `music_${load.toString(16).padStart(4, '0')}`), d: { data: bytes, load, init, play, ...(o.song != null ? { song: songOf(o.song, name) } : {}), ...(play === 0 ? { digi: { nmi: false, hz: 0 } } : {}) } };
    }
    throw new TypeError(`${name}: a tune (one of sid.tunes), a .sid file or { bytes, load, init, play } is wanted`);
  };

  const note = (frequency: unknown, o: { ntsc?: boolean } = {}) => {
    const v = Number(frequency) & 0xffff;
    if (!v) return null;
    const hz = v * (o?.ntsc ? 1022727 : 985248) / 16777216;
    const n = 12 * Math.log2(hz / 440) + 57, k = Math.round(n);
    return { name: k >= 0 && k < 120 ? `${NOTES[k % 12]}${Math.floor(k / 12)}` : '---', octave: Math.floor(k / 12), hz: Math.round(hz * 100) / 100, cents: Math.round((n - k) * 100) };
  };
  const api: Record<string, unknown> = {
    tunes: list, tune: list[0] ?? null,
    at(where: unknown) { const a = addr(where); return list.find(t => a >= (t.start as number) && a < (t.end as number)) ?? null; },
    parse: (file: unknown) => parse(file, 'sid.parse'),
    make(bytes: unknown, o: { load?: unknown; init?: unknown; play?: unknown; name?: unknown; author?: unknown; released?: unknown; song?: unknown; songs?: unknown; rsid?: unknown } = {}) {
      const u = bytesOf(bytes, 'sid.make');
      if (!u.length) throw new RangeError('sid.make: there are no bytes');
      if (o?.load == null) throw new TypeError('sid.make: load is wanted, where the bytes go (sid.make(bytes, { load, init, play }))');
      const load = addr(o.load);
      if (load + u.length > 0x10000) throw new RangeError(`sid.make: ${u.length} bytes at ${h(load)} run past $ffff`);
      const rsid = !!o.rsid, init = o.init == null ? load : addr(o.init), play = rsid || o.play === 0 ? 0 : o.play == null ? load + 3 : addr(o.play);
      const song = songOf(o.song, 'sid.make'), songs = o.songs == null ? 0 : Number(o.songs);
      if (!Number.isInteger(songs) || songs < 0 || songs > 256) throw new RangeError(`sid.make: songs is 1-256, not ${String(o.songs)}`);
      const f = makePsid(u, load, init, play, o.name == null ? undefined : String(o.name), rsid, song, songs);
      return sidWithTexts(f, { ...(o.name != null ? { name: String(o.name) } : {}), ...(o.author != null ? { author: String(o.author) } : {}), ...(o.released != null ? { released: String(o.released) } : {}) });
    },
    load(file: unknown, at?: unknown) {
      const p = parse(file, 'sid.load'), to = at == null ? p.start : addr(at);
      if (to + p.size > 0x10000) throw new RangeError(`sid.load: ${p.size} bytes at ${h(to)} run past $ffff`);
      mem.set(p.bytes, to);
      return to === p.start ? p : { ...p, start: to, end: to + p.size, init: p.init - p.start + to, play: p.play ? p.play - p.start + to : 0 };
    },
    run(o: { init?: unknown; play?: unknown; song?: unknown; a?: unknown; x?: unknown; y?: unknown; frames?: unknown; registers?: unknown } = {}) {
      if (o?.init == null) throw new TypeError('sid.run: init is wanted, the routine that starts the tune (sid.run({ init, play }))');
      const init = addr(o.init), play = o.play == null || o.play === 0 ? 0 : addr(o.play), song = songOf(o.song, 'sid.run');
      const reg = (v: unknown, n: string) => { if (v == null) return undefined; const k = Number(v); if (!Number.isInteger(k) || k < 0 || k > 255) throw new RangeError(`sid.run: ${n} is 0-255, not ${String(v)}`); return k; };
      const a = reg(o.a, 'a'), x = reg(o.x, 'x'), y = reg(o.y, 'y');
      return runIn(mem, { init, play, song, frames: frames(o.frames, 'sid.run'), dump: o.registers !== false, ...(a != null || x != null || y != null ? { regs: { ...(a != null ? { a } : {}), ...(x != null ? { x } : {}), ...(y != null ? { y } : {}) } } : {}) });
    },
    player(what: unknown, o: { song?: unknown; title?: unknown } = {}) { const p = playable(what, 'sid.player'); return playerOf(p, songOf(o?.song, 'sid.player', p.d.song ?? 0), o?.title); },
    play(what: unknown, o: { song?: unknown; in?: unknown } = {}) { ask(playable(what, 'sid.play'), o); },
    note,
    voices(registers: unknown) {
      const r = bytesOf(registers, 'sid.voices');
      if (r.length < 0x19) throw new RangeError('sid.voices: the SID\'s 25 registers are wanted ($d400-$d418, as a dump of sid.run has them)');
      const out = [0, 7, 14].map(k => {
        const frequency = r[k] | (r[k + 1] << 8), control = r[k + 4];
        return { frequency, pulse: (r[k + 2] | (r[k + 3] << 8)) & 0x0fff, control, gate: (control & 1) !== 0, wave: WAVES.filter((_w, i) => control & (0x10 << i)).join('+') || 'none',
          attack: r[k + 5] >> 4, decay: r[k + 5] & 15, sustain: r[k + 6] >> 4, release: r[k + 6] & 15, note: note(frequency)?.name ?? '---' };
      }) as unknown as Record<string, unknown>[] & { volume: number; cutoff: number; resonance: number; filtered: boolean[] };
      out.volume = r[0x18] & 15; out.cutoff = (r[0x15] & 7) | (r[0x16] << 3); out.resonance = r[0x17] >> 4; out.filtered = [0, 1, 2].map(k => (r[0x17] & (1 << k)) !== 0);
      return out;
    },
    noteTables() { return noteTables(mem, a => ctx.files.some(f => a >= f.start && a < f.end)); },
  };
  const get = (name: string, f: () => unknown) => Object.defineProperty(api, name, { enumerable: true, get: f });
  get('musicPlayer', () => (data?.player === 'deepsid' ? 'DeepSID' : 'VICE'));
  get('requests', () => made.map(r => sidRequestText(r)));
  return api;
}
