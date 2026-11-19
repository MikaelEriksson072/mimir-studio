/* A GIF reader for the tests: the global palette and every image's pixels (LZW decoded as the GIF specification has it),
 * with each frame's delay, to check the animated GIFs Mimir writes. Frames are whole images at 0,0 (as Mimir writes them). */
export function readGif(b: Uint8Array): { width: number; height: number; palette: number[]; loop: boolean; frames: { delay: number; pixels: Uint8Array }[] } {
  const ascii = String.fromCharCode(...b.subarray(0, 6));
  if (ascii !== 'GIF89a' && ascii !== 'GIF87a') throw new Error('not a GIF');
  const word = (at: number) => b[at] | (b[at + 1] << 8);
  const width = word(6), height = word(8), flags = b[10];
  let p = 13;
  const palette: number[] = [];
  if (flags & 0x80) { const n = 2 << (flags & 7); for (let i = 0; i < n; i++, p += 3) palette.push((b[p] << 16) | (b[p + 1] << 8) | b[p + 2]); }
  const frames: { delay: number; pixels: Uint8Array }[] = [];
  let delay = 0, loop = false;
  for (;;) {
    const t = b[p++];
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = b[p++];
      if (label === 0xf9) delay = word(p + 2);
      if (label === 0xff && String.fromCharCode(...b.subarray(p + 1, p + 12)) === 'NETSCAPE2.0') loop = true;
      while (b[p]) p += b[p] + 1;
      p++;
      continue;
    }
    if (t !== 0x2c) throw new Error(`unexpected block $${t.toString(16)}`);
    const w = word(p + 4), h = word(p + 6), lf = b[p + 8];
    p += 9;
    if (lf & 0x80) p += 3 * (2 << (lf & 7));
    const min = b[p++];
    const data: number[] = [];
    while (b[p]) { for (let i = 1; i <= b[p]; i++) data.push(b[p + i]); p += b[p] + 1; }
    p++;
    frames.push({ delay, pixels: unlzw(data, min, w * h) });
  }
  return { width, height, palette, loop, frames };
}

function unlzw(data: number[], min: number, count: number): Uint8Array {
  const clear = 1 << min, eoi = clear + 1, out = new Uint8Array(count);
  let size = min + 1, table: number[][] = [], prev: number[] | null = null, at = 0, bit = 0;
  const reset = () => { table = Array.from({ length: clear + 2 }, (_, i) => [i]); size = min + 1; prev = null; };
  reset();
  for (;;) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) { reset(); continue; }
    if (code === eoi || bit > data.length * 8) break;
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (prev && code === table.length) entry = [...prev, prev[0]];
    else throw new Error(`bad code ${code}`);
    for (const x of entry) if (at < count) out[at++] = x;
    if (prev) table.push([...prev, entry[0]]);
    prev = entry;
    if (table.length === 1 << size && size < 12) size++;
  }
  return out;
}
