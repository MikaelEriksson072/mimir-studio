/* An animated GIF (GIF89a) of frames of colour numbers, such as a PETSCII animation's frames (spec 14.5b): one palette
 * for all of them, LZW as the GIF specification has it, and a NETSCAPE2.0 block so that it plays over and over. */

/**
 * The GIF of `frames`, each `width` x `height` numbers into `palette` (0xrrggbb, up to 256 colours), shown `delay`
 * hundredths of a second each.
 */
export function gifAnimation(frames: readonly Uint8Array[], width: number, height: number, palette: readonly number[], delay: number): Uint8Array {
  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, palette.length)))), colours = 1 << bits;
  const out: number[] = [];
  const word = (v: number) => out.push(v & 255, (v >> 8) & 255);
  out.push(...[...'GIF89a'].map(c => c.charCodeAt(0)));
  word(width); word(height);
  out.push(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  for (let i = 0; i < colours; i++) { const c = palette[i] ?? 0; out.push((c >> 16) & 255, (c >> 8) & 255, c & 255); }
  // play over and over
  out.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map(c => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  const min = Math.max(2, bits);
  for (const f of frames) {
    out.push(0x21, 0xf9, 4, 0, delay & 255, (delay >> 8) & 255, 0, 0);
    out.push(0x2c); word(0); word(0); word(width); word(height); out.push(0);
    out.push(min);
    const data = lzw(f, min);
    for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); out.push(n); for (let k = 0; k < n; k++) out.push(data[i + k]); }
    out.push(0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}

/** the pixels LZW-coded with codes of `min` + 1 bits and more, up to 12 (then a clear code and the table again) */
function lzw(px: Uint8Array, min: number): number[] {
  const clear = 1 << min, eoi = clear + 1, out: number[] = [];
  let size = min + 1, next = eoi + 1, table = new Map<number, number>(), acc = 0, n = 0;
  const emit = (c: number) => { acc |= c << n; n += size; while (n >= 8) { out.push(acc & 255); acc >>>= 8; n -= 8; } };
  emit(clear);
  if (!px.length) { emit(eoi); if (n > 0) out.push(acc & 255); return out; }
  let cur = px[0];
  for (let i = 1; i < px.length; i++) {
    const k = px[i], key = (cur << 8) | k, got = table.get(key);
    if (got !== undefined) { cur = got; continue; }
    emit(cur);
    if (next < 4096) { table.set(key, next++); if (next - 1 === 1 << size && size < 12) size++; }
    else { emit(clear); table = new Map(); size = min + 1; next = eoi + 1; }
    cur = k;
  }
  emit(cur);
  emit(eoi);
  if (n > 0) out.push(acc & 255);
  return out;
}
