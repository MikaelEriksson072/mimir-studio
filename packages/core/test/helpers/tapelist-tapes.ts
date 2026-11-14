/* Tapes in the KERNAL's format whose headers show what LOAD's search prints for odd names: colour codes, RVS, quotes,
 * shifted letters, a name of 16 characters, cursor moves, RETURN, DEL, CLR and a switch to lower case; a data file;
 * data blocks that start as a header does (1, 3 or 4); the end-of-tape marker. VICE's screens of them are in
 * tapelist-vice.ts. Each file is after 3 seconds of silence, as on a tape a C64 saved one file at a time: with the
 * blocks closer together, the KERNAL's pause after a FOUND lets VICE's tape run past a header now and then. */

const S = 0x30, M = 0x42, L = 0x56;
const asc = (s: string) => [...s].map(c => c.charCodeAt(0));

/** a KERNAL file: a program (3), a BASIC program (1), a data file (4, `data` its bytes) or the end-of-tape marker (5) */
export interface KernalFile { type: 1 | 3 | 4 | 5; name: number[]; load?: number; data?: number[] }

/** A TAP (version 1) of these files, each header and data block twice as SAVE writes them. */
export function kernalTape(files: KernalFile[]): Uint8Array {
  const out: number[] = [];
  const pulse = (v: number, n = 1) => { for (let i = 0; i < n; i++) out.push(v); };
  const byte = (v: number) => {
    pulse(L); pulse(M);
    let ones = 0;
    for (let b = 0; b < 8; b++) { const bit = (v >> b) & 1; ones += bit; if (bit) { pulse(M); pulse(S); } else { pulse(S); pulse(M); } }
    if (ones & 1) { pulse(S); pulse(M); } else { pulse(M); pulse(S); }
  };
  const block = (data: number[], leader: number) => {
    for (const copy of [0x80, 0]) {
      pulse(S, copy ? leader : 0x4f);
      for (let i = 9; i >= 1; i--) byte(copy | i);
      let x = 0;
      for (const v of data) { byte(v); x ^= v; }
      byte(x);
      pulse(L); pulse(S);
    }
    pulse(S, 0x4e);
  };
  // silence, as a long pulse: 0 and its cycles
  const silence = (cycles: number) => out.push(-cycles);
  files.forEach((f, i) => {
    if (i > 0) silence(3 * 985248);
    const h = new Array<number>(192).fill(0x20);
    const load = f.load ?? 0xc000, data = f.data ?? [];
    const end = f.type === 4 ? 0x03fc : load + data.length;
    h[0] = f.type; h[1] = f.type === 4 ? 0x3c : load & 255; h[2] = f.type === 4 ? 0x03 : load >> 8; h[3] = end & 255; h[4] = (end >> 8) & 255;
    f.name.slice(0, 16).forEach((v, k) => (h[5 + k] = v));
    block(h, i === 0 ? 0x6a00 : 0x1a00);
    if (f.type === 1 || f.type === 3) block(data, 0x1500);
    if (f.type === 4) for (let k = 0; k < Math.max(1, Math.ceil(data.length / 191)); k++) {
      const b = new Array<number>(192).fill(0);
      b[0] = 2;
      data.slice(k * 191, k * 191 + 191).forEach((v, j) => (b[1 + j] = v));
      block(b, 0x1500);
    }
  });
  let n = 0;
  for (const v of out) n += v < 0 ? 4 : 1;
  const u8 = new Uint8Array(20 + n);
  u8.set(asc('C64-TAPE-RAW'), 0);
  u8[12] = 1;
  u8[16] = n & 255; u8[17] = (n >> 8) & 255; u8[18] = (n >> 16) & 255; u8[19] = n >>> 24;
  let k = 20;
  for (const v of out) {
    if (v >= 0) { u8[k++] = v; continue; }
    u8[k++] = 0; u8[k++] = -v & 255; u8[k++] = (-v >> 8) & 255; u8[k++] = -v >> 16;
  }
  return u8;
}

/** names with colour codes, RVS, a quote, shifted letters, 16 characters; a data file; data blocks that start with
 *  1, 3 and 4 (their bytes 5-20 a name, or too short to reach it); the end-of-tape marker */
export const oddTape = () => kernalTape([
  { type: 3, name: asc('PLAIN'), data: [1, 2, 3] },
  { type: 3, name: [0x05, ...asc('WHITE'), 0x9a, ...asc('BLUE')], data: [0x0b, 8, 0, 0] },
  { type: 3, name: [...asc('A"B'), 0x1c, ...asc('C')], data: [0x0b, 8] },
  { type: 4, name: asc('NOTES'), data: asc('HELLO') },
  { type: 3, name: asc('DATA3'), data: [3, 0, 0xc0, 0x10, 0xc0, ...asc('SNEAKY THREE    '), 1, 2, 3] },
  { type: 3, name: asc('DATA1'), data: [1, 0, 0xc0, 0x10, 0xc0, ...asc('SNEAKY ONE      '), 1, 2, 3] },
  { type: 3, name: asc('DATA4'), data: [4, 0x10, 0x20, 0x30, 0x41] },
  { type: 3, name: [0x12, ...asc('RVS'), 0x92, ...asc('OFF')], data: [0] },
  { type: 1, name: [0xc1, 0xc2, 0x60, 0x7e, 0xa0, 0xa0, ...asc('SHIFT')], load: 0x0801, data: [0] },
  { type: 3, name: asc('WITH NO SPACES!!'), data: [0] },
  { type: 5, name: [] },
]);

/** names that move the cursor and edit the screen: CLR, cursor up, RETURN, DEL, lower case */
export const controlTape = () => kernalTape([
  { type: 3, name: asc('FIRST'), data: [0] },
  { type: 3, name: [0x93, ...asc('CLEARED')], data: [0] },
  { type: 3, name: [...asc('UP'), 0x91, 0x91, ...asc('X')], data: [0] },
  { type: 3, name: [...asc('RET'), 0x0d, ...asc('URN')], data: [0] },
  { type: 3, name: [...asc('DELL'), 0x14, ...asc('X')], data: [0] },
  { type: 3, name: [0x0e, ...asc('L'), 0x4f, 0x57, 0x45, 0x52], data: [0] },
  { type: 5, name: [] },
]);
