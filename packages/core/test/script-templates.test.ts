/* The script templates (spec 10.3): each decrypts what a reference of its method encrypted, into a scratchpad, into a
 * table of the program and in place, and encrypts it back to the same bytes. */
import { describe, expect, it } from 'vitest';
import { checkScript, runScript, SCRIPT_TEMPLATES, type ScriptEnv, type ScriptRun, type UserScript } from '../src';

const tpl = (name: string) => SCRIPT_TEMPLATES.find(t => t.name === name)!;
/** the template's source with some of its .vars set (the rest of the line, its comment, kept) */
const withVars = (source: string, vars: Record<string, string | number | boolean>): string => {
  let s = source;
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`^(\\.var\\s+${k}\\s*=\\s*)(\\S+)`, 'm');
    expect(re.test(s), `.var ${k}`).toBe(true);
    s = s.replace(re, (_, head: string) => `${head}${typeof v === 'number' ? `$${v.toString(16)}` : v}`);
  }
  return s;
};

const N = 300;
const PLAIN = Array.from({ length: N }, (_, i) => (i * 37 + (i >> 3) * 11 + 5) & 0xff);
const AT = 0x2000, TABLE = 0x3000;
/** a program with the encrypted bytes at $2000 and an empty table at $3000 */
const envOf = (enc: number[]): ScriptEnv => {
  const bytes = new Uint8Array(0x2000);
  bytes.set(enc, 0);
  return { files: [{ load: AT, bytes }], names: new Map([['crypted', AT], ['crypted_end', AT + N], ['table', TABLE]]) };
};
const RESULT = 0xc000;
const scriptOf = (name: string, source: string): UserScript => ({
  id: name, name, lang: 'kickass', source, pads: tpl(name).pads.map(p => ({ ...p, start: RESULT })),
});
const run = (enc: number[], name: string, vars: Record<string, string | number | boolean>): ScriptRun => {
  const e = envOf(enc), s = scriptOf(name, withVars(tpl(name).source, vars));
  const c = checkScript(e, s);
  expect(c.problems).toEqual([]);
  const r = runScript(e, s, c);
  expect(r.end).toBe('rts');
  expect(r.overCode).toBeUndefined();
  return r;
};
const padOf = (r: ScriptRun) => [...r.pads[0].bytes.subarray(0, N)];
/** what the run left in the program at `at` (N bytes) */
const progAt = (r: ScriptRun, at: number) => [...r.mem.subarray(at, at + N)];

/** each method as the games do it: encrypt the plain bytes with it */
const xorKey = (p: number[], k: number) => p.map(b => b ^ k);
const xorString = (p: number[], key: number[], start = 0) => p.map((b, i) => b ^ key[(start + i) % key.length]);
const rolling = (p: number[], k: number, add: number, eor: number, back = false) => {
  const out = [...p], idx = [...p.keys()];
  if (back) idx.reverse();
  for (const i of idx) { out[i] = p[i] ^ k; k = ((k + add) & 0xff) ^ eor; }
  return out;
};
/** the chain as the game decrypts it: out = in ^ prev, prev the byte decrypted (or as encrypted) before */
const chainDecrypt = (c: number[], first: number, withDecrypted: boolean, back = false) => {
  const out = [...c], idx = [...c.keys()];
  if (back) idx.reverse();
  let prev = first;
  for (const i of idx) { out[i] = c[i] ^ prev; prev = withDecrypted ? out[i] : c[i]; }
  return out;
};
const chainEncrypt = (p: number[], first: number, withDecrypted: boolean, back = false) => {
  const out = [...p], idx = [...p.keys()];
  if (back) idx.reverse();
  let prev = first;
  for (const i of idx) { out[i] = p[i] ^ prev; prev = withDecrypted ? p[i] : out[i]; }
  return out;
};
/** encrypted for a game that adds the key when it decrypts (or subtracts it) */
const addEncrypt = (p: number[], k: number, subtract: boolean, keyAdd: number) => p.map(b => { const v = subtract ? (b + k) & 0xff : (b - k) & 0xff; k = (k + keyAdd) & 0xff; return v; });
const rot = (b: number, n: number, left: boolean) => { for (let i = 0; i < n; i++) b = left ? ((b << 1) | (b >> 7)) & 0xff : ((b >> 1) | (b << 7)) & 0xff; return b; };
type Step = ['NONE' | 'ADD' | 'SUB' | 'XOR' | 'ROTL' | 'ROTR', number];
/** one byte through the steps as the game decrypts (or, `back`, the last first, each undone) */
const stepsOn = (b: number, steps: Step[], back = false) => {
  const undo = { NONE: 'NONE', ADD: 'SUB', SUB: 'ADD', XOR: 'XOR', ROTL: 'ROTR', ROTR: 'ROTL' } as const;
  for (const [op, k] of back ? [...steps].reverse().map(([o, k]) => [undo[o], k] as Step) : steps) {
    if (op === 'ADD') b = (b + k) & 0xff; else if (op === 'SUB') b = (b - k) & 0xff; else if (op === 'XOR') b ^= k;
    else if (op === 'ROTL') b = rot(b, k, true); else if (op === 'ROTR') b = rot(b, k, false);
  }
  return b;
};

describe('script templates', () => {
  it('each assembles as it comes, with its scratchpad, and has the settings every template has', () => {
    expect(SCRIPT_TEMPLATES.map(t => t.name)).toEqual(['xor_key', 'xor_key_string', 'xor_rolling_key', 'xor_chain', 'add_key', 'steps']);
    for (const t of SCRIPT_TEMPLATES) {
      const e = envOf(PLAIN), s = scriptOf(t.name, t.source);
      const c = checkScript(e, s);
      expect(c.problems, t.name).toEqual([]);
      expect(t.source.split('\n')[0]).toMatch(/^\/\/ =+$/);
      for (const v of ['source', 'dest', 'length']) expect(t.source).toMatch(new RegExp(`^\\.var ${v}\\s+= `, 'm'));
      expect(t.source).toContain('Seen in');
      // it runs as it comes (the program's first $100 bytes into the scratchpad)
      expect(runScript(e, s, c).end).toBe('rts');
    }
  });

  it('XOR with a key byte: into the scratchpad, into a table of the program, in place, and back', () => {
    const enc = xorKey(PLAIN, 0xa5);
    expect(padOf(run(enc, 'xor_key', { source: 'crypted', length: 'crypted_end - crypted', key: 0xa5 }))).toEqual(PLAIN);
    expect(progAt(run(enc, 'xor_key', { source: 'crypted', dest: 'table', length: N, key: 0xa5 }), TABLE)).toEqual(PLAIN);
    const inPlace = run(enc, 'xor_key', { source: 'crypted', dest: 'source', length: N, key: 0xa5 });
    expect(progAt(inPlace, AT)).toEqual(PLAIN);
    expect(inPlace.changes.map(c => [c.start, c.end])).toEqual([[AT, AT + N]]);
    // the same run encrypts
    expect(padOf(run(PLAIN, 'xor_key', { source: 'crypted', length: N, key: 0xa5 }))).toEqual(enc);
  });

  it('XOR with a key of several bytes: its own key bytes, a table of the program, a start in the key', () => {
    const enc = xorString(PLAIN, [0x12, 0x34, 0x56, 0x78]);
    expect(padOf(run(enc, 'xor_key_string', { source: 'crypted', length: N }))).toEqual(PLAIN);
    // the key in the program: 5 bytes at $2200 (after the data), from its third
    const key = [0x9a, 0x01, 0xfe, 0x33, 0x70], enc2 = xorString(PLAIN, key, 2);
    const e = envOf(enc2);
    (e.files[0].bytes as Uint8Array).set(key, 0x200);
    const s = scriptOf('xor_key_string', withVars(tpl('xor_key_string').source, { source: 'crypted', length: N, keys: 0x2200, keyLength: 5, keyStart: 2 }));
    const r = runScript(e, s, checkScript(e, s));
    expect(padOf(r)).toEqual(PLAIN);
    // a 256-byte key (keyLength 0)
    const long = Array.from({ length: 256 }, (_, i) => (i * 7) & 0xff), enc3 = xorString(PLAIN, long);
    const e3 = envOf(enc3);
    (e3.files[0].bytes as Uint8Array).set(long, 0x1000);
    const s3 = scriptOf('xor_key_string', withVars(tpl('xor_key_string').source, { source: 'crypted', length: N, keys: 0x3000, keyLength: 0 }));
    expect(padOf(runScript(e3, s3, checkScript(e3, s3)))).toEqual(PLAIN);
  });

  it('XOR with a key that changes: the position as the key, a key that steps and EORs, from the end down', () => {
    expect(padOf(run(rolling(PLAIN, 0, 1, 0), 'xor_rolling_key', { source: 'crypted', length: N, key: 0, keyAdd: 1, keyEor: 0 }))).toEqual(PLAIN);
    expect(padOf(run(rolling(PLAIN, 0x5a, 0xfd, 0x21), 'xor_rolling_key', { source: 'crypted', length: N, key: 0x5a, keyAdd: 0xfd, keyEor: 0x21 }))).toEqual(PLAIN);
    expect(padOf(run(rolling(PLAIN, 0x77, 3, 0, true), 'xor_rolling_key', { source: 'crypted', length: N, key: 0x77, keyAdd: 3, backwards: true }))).toEqual(PLAIN);
    // the page of the byte's address EOR $7f (EA's construction sets), in place
    const paged = PLAIN.map((b, i) => b ^ ((AT + i) >> 8) ^ 0x7f);
    expect(progAt(run(paged, 'xor_rolling_key', { source: 'crypted', dest: 'source', length: N, key: 0x7f, pageKey: true }), AT)).toEqual(PLAIN);
  });

  it('XOR with the byte before: either chain, either way round, forwards and backwards', () => {
    for (const withDecrypted of [true, false]) for (const back of [false, true]) {
      const enc = chainEncrypt(PLAIN, 0x3c, withDecrypted, back);
      expect(chainDecrypt(enc, 0x3c, withDecrypted, back)).toEqual(PLAIN);
      const vars = { source: 'crypted', length: N, first: 0x3c, withDecrypted, backwards: back };
      expect(padOf(run(enc, 'xor_chain', vars)), `decrypt ${withDecrypted} ${back}`).toEqual(PLAIN);
      expect(padOf(run(PLAIN, 'xor_chain', { ...vars, encrypt: true })), `encrypt ${withDecrypted} ${back}`).toEqual(enc);
      // in place
      expect(progAt(run(enc, 'xor_chain', { ...vars, dest: 'source' }), AT)).toEqual(PLAIN);
    }
  });

  it('add or subtract a key: adc, sbc, a key that steps, and back', () => {
    for (const subtract of [false, true]) for (const keyAdd of [0, 0xff]) {
      const enc = addEncrypt(PLAIN, 0x20, subtract, keyAdd);
      const vars = { source: 'crypted', length: N, key: 0x20, subtract, keyAdd };
      expect(padOf(run(enc, 'add_key', vars)), `${subtract} ${keyAdd}`).toEqual(PLAIN);
      expect(padOf(run(PLAIN, 'add_key', { ...vars, encrypt: true }))).toEqual(enc);
    }
  });

  it('several steps: the Commodore tapes (SUB, XOR, SUB, XOR), rotations both ways, a step of NONE, and back', () => {
    const cases: Step[][] = [
      [['SUB', 0x1b], ['XOR', 0xaa], ['SUB', 0xfb], ['XOR', 0x55]],
      [['ADD', 0x32], ['XOR', 0x49], ['NONE', 0x99], ['NONE', 0]],
      [['ROTL', 3], ['XOR', 0x81], ['ROTR', 1], ['ADD', 7]],
      [['NONE', 0], ['ROTR', 7], ['ROTL', 0], ['SUB', 0x80]],
    ];
    for (const st of cases) {
      const enc = PLAIN.map(b => stepsOn(b, st, true));
      expect(enc.map(b => stepsOn(b, st))).toEqual(PLAIN);
      const vars: Record<string, string | number> = { source: 'crypted', length: N };
      st.forEach(([op, k], i) => { vars[`step${i + 1}`] = op; vars[`key${i + 1}`] = k; });
      expect(padOf(run(enc, 'steps', vars)), JSON.stringify(st)).toEqual(PLAIN);
      expect(padOf(run(PLAIN, 'steps', { ...vars, encrypt: 'true' })), JSON.stringify(st)).toEqual(enc);
    }
    // as it comes: Spirates' steps
    const spirates: Step[] = [['SUB', 0x1b], ['XOR', 0xaa], ['SUB', 0xfb], ['XOR', 0x55]];
    expect(padOf(run(PLAIN.map(b => stepsOn(b, spirates, true)), 'steps', { source: 'crypted', length: N }))).toEqual(PLAIN);
  });

  it('say when the scratchpad is too small, and a length that cannot be', () => {
    const e = envOf(PLAIN);
    const big = checkScript(e, scriptOf('xor_key', withVars(tpl('xor_key').source, { length: 0x401 })));
    expect(big.problems).toEqual([expect.objectContaining({ level: 'error', msg: expect.stringContaining('more than the scratchpad result holds') })]);
    const none = checkScript(e, scriptOf('xor_key', withVars(tpl('xor_key').source, { length: 0 })));
    expect(none.problems).toEqual([expect.objectContaining({ level: 'error', msg: expect.stringContaining('length must be 1 to $10000') })]);
    // into the program, the scratchpad's size does not matter
    expect(checkScript(e, scriptOf('xor_key', withVars(tpl('xor_key').source, { dest: 'table', length: 0x1000 }))).problems).toEqual([]);
  });

  it('a pointer to where Mimir put the script\'s code reaches the program there: the code sits in the empty table it fills', () => {
    // the program fills memory; its only long run of one value is the empty table at $8000 the decryption fills
    const bytes = new Uint8Array(0x10000 - 0x0200).map((_, i) => (i * 13 + (i >> 8) * 7 + 1) & 0xff);
    bytes.fill(0, 0x8000 - 0x200, 0x9000 - 0x200);
    const enc = xorKey(PLAIN, 0x5a);
    bytes.set(enc, AT - 0x200);
    const e: ScriptEnv = { files: [{ load: 0x0200, bytes }], names: new Map([['crypted', AT], ['buffer', 0x8000]]) };
    const s: UserScript = { id: 'x', name: 'x', lang: 'kickass', source: withVars(tpl('xor_key').source, { source: 'crypted', dest: 'buffer', length: N, key: 0x5a }).replace(/^\.if \(dest >= result.*$/m, ''), pads: [] };
    const c = checkScript(e, s);
    expect(c).toMatchObject({ ok: true, place: 'program' });
    expect(c.code.some(r => r.start < 0x8000 + N && r.end > 0x8000)).toBe(true);
    const r = runScript(e, s, c);
    expect(r.end).toBe('rts');
    expect(r.overCode).toBeUndefined();
    expect([...r.mem.subarray(0x8000, 0x8000 + N)]).toEqual(PLAIN);
  });
});
