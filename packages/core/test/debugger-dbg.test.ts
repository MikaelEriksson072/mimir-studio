/* The debug info a debugger reads (spec 13.2b): the `.dbg` Mimir writes from its render, in Kick Assembler's
 * -debugdump format as Retro Debugger's reader takes it; where prepareDebugger puts it; a running debugger used again;
 * and the breakpoints and watches in the project file. The real debuggers were started on it by hand (DEVELOPMENT.md
 * 39): here a program that stands in for one records its command lines. */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, createProject, debugInfoFile, debugSources, deserializeProject, makeDemo, parsePrg, render, serializeProject, viceLabels } from '../src';
import { launchDebugger, prepareDebugger } from '../src/node';

const d = makeDemo();
const project = () => createProject({ files: [parsePrg(d.name, d.prg)] });
const rendered = () => { const p = project(), A = analyze(p); return { A, R: render(A, p) }; };

describe('the sources with the bytes their lines made', () => {
  const { A, R } = rendered(), [src] = debugSources(R), text = src.text.split('\n');

  it('every instruction line is there once, with its address and its bytes, and the line is that instruction', () => {
    expect(src.name).toBe(`${R.fileNames[0]}.asm`);
    const ins = R.lines.filter(l => l.k === 'ins');
    expect(ins.length).toBeGreaterThan(50);
    for (const l of ins) {
      if (l.k !== 'ins') continue;
      const hit = src.spans.filter(s => s[0] === l.a);
      expect(hit, `$${l.a.toString(16)}`).toHaveLength(1);
      expect(hit[0][1]).toBe(l.a + l.n - 1);
      expect(text[hit[0][2] - 1]).toMatch(new RegExp(`^\\s+${l.mn.toLowerCase()}\\b`, 'i'));
    }
  });

  it('the spans are in the file, do not overlap, and cover the bytes of the program the lines made', () => {
    const f = A.files[0], seen = new Uint8Array(0x10000);
    for (const [a, b, line] of src.spans) {
      expect(a).toBeGreaterThanOrEqual(f.load);
      expect(b).toBeLessThan(f.load + f.bytes.length);
      expect(line).toBeGreaterThan(0);
      expect(line).toBeLessThanOrEqual(text.length);
      for (let x = a; x <= b; x++) { expect(seen[x], `$${x.toString(16)} twice`).toBe(0); seen[x] = 1; }
    }
    // (blocks written as binary files or with a .fill are lines too: most of the program is covered)
    expect(seen.reduce((n, v) => n + v, 0)).toBeGreaterThan(f.bytes.length / 2);
  });
});

describe('the .dbg file', () => {
  const { R } = rendered(), sources = debugSources(R);
  const first = sources[0].spans[0];
  const file = debugInfoFile({ sources, breakpoints: [0x0863, 0x0810, 0x0863], watches: [{ addr: 0xd020 }, { addr: 0x00fb, count: 2, format: 'hex16' }] }, ['C:\\build\\x.debugger.src\\demo.asm'], [{ addr: 0x0810, name: 'start' }, { addr: 0xd020, name: 'VIC.BORDER' }, { addr: 2, name: 'bad name' }]);

  it('is what the debugger reads: sources, a Default segment with its blocks, labels, watches, breakpoints', () => {
    expect(file.startsWith('<C64debugger version="1.0">\n   <Sources values="INDEX,FILE">\n      0,C:\\build\\x.debugger.src\\demo.asm\n   </Sources>')).toBe(true);
    expect(file).toContain('<Segment name="Default" dest="" values="START,END,FILE_IDX,LINE1,COL1,LINE2,COL2">');
    const h = (n: number) => `$${n.toString(16).padStart(4, '0')}`;
    expect(file).toMatch(new RegExp(`<Block name="[^"]+ \\${h(first[0])}">\\n {9}\\${h(first[0])},\\${h(first[1])},0,${first[2]},1,${first[2]},\\d+\\n`));
    // every line of the map: seven fields, the last column not before the first
    const rows = file.split('\n').filter(l => /^ {9}\$/.test(l));
    expect(rows).toHaveLength(sources[0].spans.length);
    for (const r of rows) expect(r).toMatch(/^ {9}\$[0-9a-f]{4},\$[0-9a-f]{4},0,\d+,1,\d+,[1-9]\d*$/);
    expect((file.match(/<Block /g) ?? []).length).toBe((file.match(/<\/Block>/g) ?? []).length);
    expect(file).toContain('   <Labels values="SEGMENT,ADDRESS,NAME">\n      Default,$0810,start\n      Default,$d020,VIC.BORDER\n   </Labels>');
    expect(file).toContain('      Default,$d020\n      Default,$00fb,2,hex16\n   </Watchpoints>');
    // a breakpoint on a PC: the comma after the address, once each, by address
    expect(file).toContain('   <Breakpoints values="SEGMENT,ADDRESS,ARGUMENT">\n      Default,$0810,\n      Default,$0863,\n   </Breakpoints>\n</C64debugger>\n');
  });

  it('refuses a path the debugger would split or the XML would break on', () => {
    expect(() => debugInfoFile({ sources }, ['C:\\a,b\\demo.asm'])).toThrow(/cannot hold a comma/);
    expect(() => debugInfoFile({ sources }, ['C:\\a&b\\demo.asm'])).toThrow(/cannot hold/);
  });

  it('reads the names of a VICE label file', () => {
    expect(viceLabels('al C:0810 .start\r\nal C:d020 .VIC.BORDER\nal fb .zp\n# no\nbreak 1000\n')).toEqual([{ addr: 0x0810, name: 'start' }, { addr: 0xd020, name: 'VIC.BORDER' }, { addr: 0xfb, name: 'zp' }]);
  });
});

describe('Build & Run in a debugger with debug info', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mimir-dbg-'));
  const prgPath = join(dir, 'demo.prg'), labels = join(dir, 'demo.vs');
  writeFileSync(prgPath, d.prg);
  writeFileSync(labels, 'al C:0810 .start\n');
  const { R } = rendered(), debug = { sources: debugSources(R), breakpoints: [0x0810], watches: [{ addr: 0xd020 }] };

  it('the .dbg is next to the start PRG, where the debugger finds it, with its sources in a folder beside it', async () => {
    for (const kind of ['retro', 'c64d'] as const) {
      const p = await prepareDebugger({ kind, exe: 'x', prgPath, labelsPath: labels, debug });
      const dbg = join(dir, 'demo.debugger.dbg'), src = join(dir, 'demo.debugger.src', debug.sources[0].name);
      expect(p.debugInfo).toEqual({ path: dbg, sources: join(dir, 'demo.debugger.src'), lines: debug.sources[0].spans.length, breakpoints: 1, watches: 1 });
      expect(readFileSync(src, 'utf8')).toBe(debug.sources[0].text);
      const text = readFileSync(dbg, 'utf8');
      expect(text).toContain(`      0,${src}\n`);
      expect(text).toContain('      Default,$0810,start\n');
      expect(text).toContain('      Default,$0810,\n   </Breakpoints>');
      // it is never on the command line (-debuginfo stops Retro Debugger as -symbols does)
      expect(p.argv).not.toContain('-debuginfo');
      expect(p.argv).not.toContain(dbg);
    }
  });

  it('a run without debug info leaves none of an earlier run for the debugger to find', async () => {
    await prepareDebugger({ kind: 'retro', exe: 'x', prgPath, labelsPath: labels, debug });
    expect(existsSync(join(dir, 'demo.debugger.dbg'))).toBe(true);
    const p = await prepareDebugger({ kind: 'retro', exe: 'x', prgPath, labelsPath: labels });
    expect(p.debugInfo).toBeUndefined();
    expect(existsSync(join(dir, 'demo.debugger.dbg'))).toBe(false);
  });
});

describe('a debugger that is already running is used again', () => {
  // the stand-in: node running a script that writes its arguments to a log; like the debugger, it ends at once
  // when it is given -pass and stays (here 30 s) when it is the debugger
  const dir = mkdtempSync(join(tmpdir(), 'mimir-pass-'));
  const script = join(dir, 'debugger.js'), log = join(dir, 'log.txt');
  writeFileSync(script, `const a = process.argv.slice(2); require('fs').appendFileSync(${JSON.stringify(log)}, a.join(' ') + '\\n'); if (!a.includes('-pass')) setTimeout(() => {}, 30000);`);
  const prgPath = join(dir, 'demo.prg');
  writeFileSync(prgPath, d.prg);
  const lines = () => readFileSync(log, 'utf8').trim().split('\n');
  const logged = async (n: number) => { for (let i = 0; i < 100 && (!existsSync(log) || lines().length < n); i++) await new Promise(done => setTimeout(done, 50)); return lines(); };

  it('Retro Debugger: the second run goes to the first one\'s window, after a reset that also takes it out of a breakpoint', async () => {
    const o = { kind: 'retro' as const, exe: process.execPath, args: [script], wait: 3000, prgPath };
    const a = await launchDebugger(o);
    expect(a.reused).toBeUndefined();
    expect(await logged(1)).toEqual([expect.stringMatching(/^-wait 3000 -prg \S+demo\.debugger\.prg -jmp x[0-9a-f]{4}$/)]);
    const b = await launchDebugger(o);
    expect(b).toMatchObject({ reused: true, pid: a.pid });
    const l = await logged(3);
    expect(l[1]).toBe('-pass -reset -unpause');
    expect(l[2]).toMatch(/^-pass -wait 3000 -prg \S+demo\.debugger\.prg -jmp x[0-9a-f]{4}$/);
    try { process.kill(a.pid); } catch { /* it ended by itself */ }
  }, 30_000);

  it('Retro Debugger with a disk: started with the disk alone, then given the program as a running one is; a running one gets the disk passed', async () => {
    writeFileSync(log, '');
    const disk = join(dir, 'd.d64');
    const o = { kind: 'retro' as const, exe: process.execPath, args: [script], wait: 0, prgPath, disk, retroSettings: null };
    const a = await launchDebugger(o);
    expect(a.reused).toBeUndefined();
    const prg = /-wait 0 -prg \S+demo\.debugger\.prg -jmp x[0-9a-f]{4}$/;
    let l = await logged(3);
    expect(l[0]).toBe(`-d64 ${disk}`);
    expect(l[1]).toBe('-pass -reset -unpause');
    expect(l[2]).toMatch(new RegExp(`^-pass ${prg.source}`));
    expect(l.join('\n')).not.toMatch(/-d64 \S+ .*-prg/);
    const b = await launchDebugger(o);
    expect(b).toMatchObject({ reused: true, pid: a.pid });
    l = await logged(6);
    expect(l.slice(3)).toEqual([`-pass -d64 ${disk}`, '-pass -reset -unpause', expect.stringMatching(new RegExp(`^-pass ${prg.source}`))]);
    try { process.kill(a.pid); } catch { /* it ended by itself */ }
  }, 40_000);

  it('C64 Debugger is started anew each time', async () => {
    writeFileSync(log, '');
    const o = { kind: 'c64d' as const, exe: process.execPath, args: [script], prgPath };
    const a = await launchDebugger(o), b = await launchDebugger(o);
    expect(b.reused).toBeUndefined();
    expect(b.pid).not.toBe(a.pid);
    for (let i = 0; i < 100 && readFileSync(log, 'utf8').trim().split('\n').length < 2; i++) await new Promise(done => setTimeout(done, 50));
    expect(readFileSync(log, 'utf8')).not.toMatch(/(^| )-pass( |$)/m);
    for (const pid of [a.pid, b.pid]) try { process.kill(pid); } catch { /* it ended by itself */ }
  }, 30_000);
});

describe('breakpoints and watches in the project', () => {
  it('are saved with the project and read back, and a project without any has neither field', () => {
    const p = project();
    expect(serializeProject(p)).not.toHaveProperty('breakpoints');
    expect(serializeProject(p)).not.toHaveProperty('watches');
    p.breakpoints = [0x0810, 0x0863]; p.watches = [0xd020];
    const back = deserializeProject(JSON.parse(JSON.stringify(serializeProject(p))));
    expect(back.breakpoints).toEqual([0x0810, 0x0863]);
    expect(back.watches).toEqual([0xd020]);
    expect(deserializeProject(JSON.parse(JSON.stringify(serializeProject(project())))).breakpoints).toBeUndefined();
  });
});
