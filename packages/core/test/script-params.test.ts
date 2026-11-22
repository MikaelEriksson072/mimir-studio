/* A script's settings (spec 10.3): read out of its code, set for a run, a table of values with a row a run, and
 * what a run with a row gives as files. */
import { describe, expect, it } from 'vitest';
import { checkScript, parseParamTable, paramValueOk, runResults, runScript, SCRIPT_TEMPLATES, scriptParams, setScriptParams, startParamTable, templateSource, type ScriptEnv } from '../src';

const xor = SCRIPT_TEMPLATES.find(t => t.name === 'xor_key')!;
const N = 16, PLAIN = Array.from({ length: N }, (_, i) => (i * 11 + 3) & 0xff);
/** two blocks at $2000 and $2100, encrypted with $77 and with $12 */
const env: ScriptEnv = { files: [{ load: 0x2000, bytes: Uint8Array.from([...PLAIN.map(b => b ^ 0x77), ...Array(0x100 - N).fill(0), ...PLAIN.map(b => b ^ 0x12)]) }], names: new Map([['level1', 0x2000], ['level2', 0x2100]]) };

describe('a script\'s settings', () => {
  it('are the lines that give a name one value, with the comment that says what it is', () => {
    const p = scriptParams(xor.source);
    expect(p.map(x => [x.name, x.value])).toEqual([['source', '$0801'], ['dest', 'result'], ['length', '$0100'], ['key', '$77']]);
    expect(p[0].comment).toBe('where the encrypted bytes are: an address, a label');
    expect(p[3]).toMatchObject({ name: 'key', comment: 'the key byte' });
    expect(xor.source.split('\n')[p[3].line - 1]).toContain('.var key');
    // a value that is worked out is no setting, and a name set twice counts once
    expect(scriptParams(['.var a = 1', '.var b = a + 1', '.var a = 2', '        lda #a'].join('\n')).map(x => x.name)).toEqual(['a']);
  });

  it('are found in 64tass and in JavaScript too', () => {
    const tass = templateSource(xor, '64tass');
    expect(scriptParams(tass, { lang: '64tass' }).filter(x => ['source', 'dest', 'length', 'key'].includes(x.name)).map(x => [x.name, x.value]))
      .toEqual([['source', '$0801'], ['dest', 'result'], ['length', '$0100'], ['key', '$77']]);
    const js = ['const key = 0x77;        // the key byte', 'let from = "level1";', 'const n = 16', '  const inner = 1;', 'const sum = key + 1;', 'for (let i = 0; i < n; i++) mem[addr(from) + i] ^= key;'].join('\n');
    expect(scriptParams(js, { code: 'js' })).toEqual([
      { name: 'key', value: '0x77', line: 1, comment: 'the key byte' }, { name: 'from', value: '"level1"', line: 2, comment: '' }, { name: 'n', value: '16', line: 3, comment: '' }]);
  });

  it('are set in the code, the comment staying in its column', () => {
    const r = setScriptParams(xor.source, {}, { key: '$12', source: 'level2', nothing: '1', length: '1 + 1' });
    expect(r.skipped.sort()).toEqual(['length', 'nothing']);
    const lines = r.source.split('\n'), was = xor.source.split('\n');
    const key = lines.find(l => l.startsWith('.var key'))!, keyWas = was.find(l => l.startsWith('.var key'))!;
    expect(key).toBe('.var key     = $12        // the key byte');
    expect(key.indexOf('//')).toBe(keyWas.indexOf('//'));
    expect(lines.find(l => l.startsWith('.var source'))).toMatch(/^\.var source  = level2 {5}\/\/ where the encrypted bytes are/);
    expect(scriptParams(r.source).find(p => p.name === 'length')?.value).toBe('$0100');
    // a value longer than the room keeps a space before the comment; every other line is as it was
    expect(setScriptParams('.var a = 1 // one', {}, { a: 'a_long_name' }).source).toBe('.var a = a_long_name // one');
    expect(lines.filter((l, i) => l !== was[i])).toHaveLength(2);
    // JavaScript: the ; stays after the value
    expect(setScriptParams('const key = 0x77;        // the key byte\nlet n = 16', { code: 'js' }, { key: '0x12', n: '32' }).source).toBe('const key = 0x12;        // the key byte\nlet n = 32');
    expect(paramValueOk('$12')).toBe(true);
    expect(paramValueOk('"a b"')).toBe(true);
    expect(paramValueOk('a + b')).toBe(false);
  });

  it('come as a table of values, a row a run, and what is wrong with it is said by its line', () => {
    const params = scriptParams(xor.source);
    expect(startParamTable(params)).toBe('source, dest, length, key\n$0801, result, $0100, $77\n');
    const t = parseParamTable(['# two levels', 'source, key', 'level1, $77', '', 'level2\t$12'].join('\n'), params);
    expect(t).toEqual({ names: ['source', 'key'], rows: [{ source: 'level1', key: '$77' }, { source: 'level2', key: '$12' }], problems: [] });
    const bad = parseParamTable(['source, speed', 'level1', 'level2, 1 + 1', 'level3, 4'].join('\n'), params);
    expect(bad.problems).toEqual([
      { line: 1, msg: '"speed" is no setting of the script (it has source, dest, length, key)' },
      { line: 2, msg: '1 value, but the first line names 2 settings' },
      { line: 3, msg: '"1 + 1" is not a value: one number, name or string' },
    ]);
    expect(bad.rows).toEqual([{ source: 'level3', speed: '4' }]);
    expect(parseParamTable('', params).problems).toEqual([{ line: 1, msg: 'the first line names the settings, the lines after it are the runs' }]);
  });

  it('give a run a row: the template decrypts each level with its key, and each result is a file', () => {
    const base = setScriptParams(xor.source, {}, { length: `$${N.toString(16).padStart(4, '0')}` }).source;
    const pads = [{ name: 'result', start: 0xc000, size: N }];
    const t = parseParamTable('source, key\nlevel1, $77\nlevel2, $12', scriptParams(base));
    const outs = t.rows.map((row, i) => {
      const s = { source: setScriptParams(base, {}, row).source, lang: 'kickass' as const, pads };
      const c = checkScript(env, s);
      expect(c.problems.filter(p => p.level === 'error')).toEqual([]);
      return runResults(pads, runScript(env, s, c), `decrypt_${String(i + 1).padStart(2, '0')}`);
    });
    expect(outs.map(o => o.map(x => [x.name, x.load, x.pad]))).toEqual([[['decrypt_01.prg', 0xc000, 'result']], [['decrypt_02.prg', 0xc000, 'result']]]);
    expect([...outs[0][0].bytes]).toEqual(PLAIN);
    expect([...outs[1][0].bytes]).toEqual(PLAIN);
  });

  it('give the memory a run wrote when it has no scratchpad', () => {
    const s = { source: ['* = $c000', '        lda #1', '        sta $3000', '        sta $3001', '        rts'].join('\n'), lang: 'kickass' as const, pads: [] };
    expect(runResults([], runScript(env, s), 'out')).toEqual([{ name: 'out.prg', load: 0x3000, bytes: Uint8Array.from([1, 1]), from: 'memory' }]);
    expect(runResults([], runScript(env, { ...s, source: '* = $c000\n        rts' }), 'out')).toEqual([]);
  });
});
