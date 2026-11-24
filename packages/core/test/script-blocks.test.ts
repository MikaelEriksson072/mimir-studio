/* The program's blocks for a JavaScript script (spec 10.3): read, marked, structs and custom types, and what a run's
 * requests come to in the project, with the source it gives re-assembling to the same bytes. */
import { describe, expect, it } from 'vitest';
import { analyze, createProject, findBlock, planScriptActions, render, runJs, scriptBlocksData, scriptEnv, structFields, structSize, structText, verify, type Project, type ScriptRun, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const program = fromSource('game.prg', [
  '.pc = $0810',
  'main:   ldx #0',
  'loop:   lda table,x', '        sta $0400,x', '        inx', '        cpx #29', '        bne loop', '        jsr h1', '        jmp h2',
  'h1:     lda #1', '        rts',
  'h2:     lda #2', '        rts',
  '.pc = $0840',
  // three records: x, hp, handler, name (4 characters), flags; then two bytes more
  'table:  .byte $10, 100', '        .word h1', '        .byte $53, $48, $49, $50, %00000101',
  '        .byte $20, 50', '        .word h2', '        .byte $42, $4f, $53, $53, %10000000',
  '        .byte $30, 7', '        .word h1', '        .byte $42, $4f, $4d, $42, 0',
  '        .byte $ee, $ff',
  '.pc = $0880',
  'map:    .fill 80, i & 7',
  'words:  .word 1000, 2000, 3000',
  'title:  .byte $08, $05, $0c, $0c, $0f',
].join('\n'));
const project: Project = { ...createProject({ files: [program] }), labels: { 0x0810: 'main', 0x0823: 'h1', 0x0826: 'h2', 0x0840: 'table', 0x0880: 'map', 0x08d0: 'words', 0x08d6: 'title' } };
const A = analyze(project), R = render(A, project);
const env = scriptEnv(project, R, project.settings, A.blocks);
const js = (lines: string[]): UserScript => ({ id: 's', name: 's', lang: 'kickass', code: 'js', source: lines.join('\n'), pads: [] });
const run = (lines: string[], p: Project = project) => {
  const a = analyze(p), r = render(a, p);
  return runJs(scriptEnv(p, r, p.settings, a.blocks), js(lines), { blocks: scriptBlocksData(a, r, p) });
};
/** the project with what a run asked for done, as the app does it */
const applied = (r: ScriptRun, p: Project = project) => {
  const a = analyze(p), plan = planScriptActions(a, render(a, p), p, r.actions ?? []);
  const blockComments = { ...p.blockComments };
  for (const [at, text] of plan.blockComments) { if (text) blockComments[at] = text; else delete blockComments[at]; }
  let excluded = [...p.excluded], binary = [...p.binary];
  for (const [at, on] of plan.excluded) excluded = on ? [...new Set([...excluded, at])] : excluded.filter(x => x !== at);
  for (const [at, on] of plan.binary) binary = on ? [...new Set([...binary, at])] : binary.filter(x => x !== at);
  const after: Project = { ...p, overrides: [...p.overrides, ...plan.overrides], labels: { ...p.labels, ...Object.fromEntries(plan.labels) }, comments: { ...p.comments, ...Object.fromEntries(plan.comments) }, blockComments, excluded, binary };
  const A2 = analyze(after), R2 = render(A2, after);
  const source = Object.entries(R2.files).filter(([n, v]) => typeof v === 'string' && n.endsWith('.asm')).map(([, v]) => v as string).join('\n');
  return { plan, after, A: A2, R: R2, source, lines: source.split('\n').map(l => l.trim().replace(/\s+/g, ' ')) };
};
const STRUCT = ['const enemy = blocks.struct("enemy", ["x: byte", "hp: byte dec", "handler: addr", "name: text[4]", "flags: byte bin"]);'];

describe('a struct\'s fields', () => {
  it('are read from strings, objects and an object with a field a key', () => {
    const a = structFields(['x: byte', 'hp: byte dec', 'handler: addr', 'name: text[4]', 'row: byte[40]', 'pos: word[2] dec', 'msg: textsc[8]']);
    expect(a).toEqual([{ name: 'x', type: 'byte' }, { name: 'hp', type: 'byte', fmt: 'dec' }, { name: 'handler', type: 'addr' }, { name: 'name', type: 'text', count: 4, enc: 'petscii' },
      { name: 'row', type: 'byte', count: 40 }, { name: 'pos', type: 'word', count: 2, fmt: 'dec' }, { name: 'msg', type: 'text', count: 8, enc: 'screen' }]);
    expect(structSize(a)).toBe(1 + 1 + 2 + 4 + 40 + 4 + 8);
    expect(structText(a)).toBe('x: byte, hp: byte dec, handler: addr, name: text[4], row: byte[40], pos: word[2] dec, msg: textsc[8]');
    expect(structFields({ x: 'byte', name: 'textmix[3]', p: { type: 'word', count: 2, fmt: 'bin' } })).toEqual([{ name: 'x', type: 'byte' }, { name: 'name', type: 'text', count: 3, enc: 'petscii-mixed' }, { name: 'p', type: 'word', count: 2, fmt: 'bin' }]);
    expect(structFields(a)).toEqual(a);
  });

  it('say what is wrong with them', () => {
    const bad = (spec: unknown) => { try { structFields(spec); return 'ok'; } catch (e) { return (e as Error).message; } };
    expect(bad([])).toMatch(/^struct: the fields are wanted/);
    expect(bad(['x byte'])).toBe('struct: "x byte" is no field: write "name: type"');
    expect(bad(['x: float'])).toMatch(/^struct: "float" is no type of a field \(x\): byte, word, addr, text, textsc, textmix, textscmix/);
    expect(bad(['1x: byte'])).toMatch(/^struct: "1x" is no field name/);
    expect(bad(['x: byte', 'x: word'])).toBe('struct: the field x is there twice');
    expect(bad(['x: byte[0]'])).toMatch(/has a count of 0/);
    expect(bad(['x: byte[4000]', 'y: byte[200]'])).toBe('struct: a record of 4200 bytes: 4096 at most');
    expect(bad(['n: text[4] dec'])).toBe('struct: n is a text: it has no number format');
    expect(bad(['x: byte oct'])).toBe('struct: "oct" is no number format (x): hex, dec or bin');
  });
});

describe('blocks in a JavaScript script', () => {
  it('lists the program\'s blocks and finds them', () => {
    const r = run([
      'print(blocks.count === blocks.all.length, blocks.all.every((b, i) => i === 0 || b.start >= blocks.all[i - 1].end));',
      'const c = blocks.at("main");', 'print(c.type, c.as, hex(c.start), c.label, c.file, c.user, c.size === c.end - c.start, c.bytes.length === c.size, c.prev, c.next.start === c.end);',
      'const t = blocks.at(0x0845);', 'print(hex(t.start), t.label, t.struct, t.records, t.text, blocks.find("TABLE") === t, blocks.at(0x0100));',
      'print(blocks.in(0x0810, 0x0829).every(b => b.type === "code"), blocks.of("code").length === blocks.all.filter(b => b.type === "code").length, blocks.of("bytes").length === blocks.of("data").length);',
      'print(blocks.types.includes("textsc"), blocks.types.includes("struct"), String(c));',
      'print(blocks.text(0x0844, 0x0848), blocks.text(addr("title"), addr("title") + 5, "textsc"), blocks.encode("HELLO", "textsc").join(), blocks.encode("SHIP").join());',
      'for (const f of [() => blocks.at(0x10000), () => blocks.in(0x900, 0x900), () => blocks.text(0x840, 0x844, "utf8"), () => blocks.encode("é")]) try { f(); } catch (e) { print(e.message); }',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      'true true',
      'code code $0810 main game.prg false true true null true',
      `$${findBlock(A.blocks, 0x0845)!.start.toString(16).padStart(4, '0')} ${R.labels.get(findBlock(A.blocks, 0x0845)!.start)?.name ?? null} null null null ${findBlock(A.blocks, 0x0845)!.start === 0x0840} null`,
      'true true true',
      'true true code $0810-$0822 main',
      'SHIP HELLO 8,5,12,12,15 83,72,73,80',
      '65536 is not an address ($0000-$ffff)', 'in: the end ($0900) is not after the start ($0900): the end is the address after the last byte',
      'text: "utf8" is no text type: text, textsc, textmix or textscmix', 'encode: there is no byte for "é" in that text type',
    ]);
    expect(r.actions).toBeUndefined();
  });

  it('reads and writes records with a struct', () => {
    const r = run([...STRUCT,
      'print(enemy.size, enemy.name, enemy.text, enemy.fields.map(f => f.name + "@" + f.offset + "+" + f.size).join(" "), enemy.offset("name"), String(enemy));',
      'const e = enemy.read("table");', 'print(e.x, e.hp, hex(e.handler), e.name, e.flags);',
      'print(enemy.records("table", 3).map(x => x.name).join(), enemy.records(0x0840, 0).length);',
      'const end = enemy.write(addr("table") + 9, { x: 0x21, name: "BO", handler: "h1", hp: 255 });', 'const w = enemy.read(addr("table") + 9);',
      'print(hex(end), w.x, w.hp, hex(w.handler), JSON.stringify(w.name), w.flags);',
      'const s = blocks.struct({ pos: "word[2] dec", row: "byte[3]" });', 'print(s.name, s.size, JSON.stringify(s.read("words")));',
      'for (const f of [() => enemy.write(0x840, { z: 1 }), () => enemy.write(0x840, { name: "TOOLONG" }), () => enemy.write(0x840, { x: 300 }), () => enemy.write(0x840, { name: "é" }), () => enemy.read(0xfffc), () => enemy.offset("q"), () => blocks.struct("bytes", ["x: byte"])]) try { f(); } catch (e) { print(e.message); }',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      '9 enemy x: byte, hp: byte dec, handler: addr, name: text[4], flags: byte bin x@0+1 hp@1+1 handler@2+2 name@4+4 flags@8+1 4 struct enemy { x: byte, hp: byte dec, handler: addr, name: text[4], flags: byte bin }',
      `16 100 $${R.labels && [...R.labels].find(([, l]) => l.name === 'h1')![0].toString(16).padStart(4, '0')} SHIP 5`,
      'SHIP,BOSS,BOMB 0',
      `$0852 33 255 $${[...R.labels].find(([, l]) => l.name === 'h1')![0].toString(16).padStart(4, '0')} "BO  " 128`,
      'null 7 {"pos":[1000,2000],"row":[184,11,8]}',
      'write: the struct has no field "z" (it has x, hp, handler, name, flags)', 'write: "TOOLONG" is 7 characters, name has 4', 'write: 300 does not fit x (a byte)',
      'write: name has no byte for "é" in text[4]', 'read: 9 bytes at $fffc run past $ffff', 'offset: the struct has no field "q" (it has x, hp, handler, name, flags)',
      'struct: "bytes" is a type Mimir has: give yours another name',
    ]);
    // what it wrote is the run's change of the program's bytes
    expect(r.changes.length).toBeGreaterThan(0);
  });

  it('marks a struct: a line a field in the source, which re-assembles to the same bytes', () => {
    const r = run([...STRUCT, 'const m = enemy.markRecords("table", 3, { label: "enemies", comment: "The enemies\\nthree of them" });', 'print(hex(m.start), hex(m.end));', 'blocks.mark(0x085b, 0x085d, "bytes");']);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['$0840 $085b']);
    const { plan, A: A2, R: R2, lines, after } = applied(r);
    expect(plan.failed).toEqual([]);
    expect(plan.done[0]).toBe('$0840-$085a marked as the struct enemy (x: byte, hp: byte dec, handler: addr, name: text[4], flags: byte bin): 3 records of 9 bytes');
    expect(plan.done).toContain('$0840 named enemies');
    expect(plan.done).toContain('the block at $0840 commented: The enemies');
    const b = findBlock(A2.blocks, 0x0840)!;
    expect([b.start, b.end, b.type, b.user, b.props.custom, b.props.struct?.length]).toEqual([0x0840, 0x085b, 'data', true, 'enemy', 5]);
    expect(after.blockComments[0x0840]).toBe('The enemies\nthree of them');
    const at = lines.findIndex(l => l.startsWith('enemies:'));
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(at - 3, at)).toEqual(['// ---- Struct enemy (9 bytes a record) · enemies · $0840-$085a (27 bytes)', '// The enemies', '// three of them']);
    expect(lines.slice(at + 1, at + 13)).toEqual([
      '.byte $10 // [0] x', '.byte 100 // hp', '.word h1 // handler', '.encoding "petscii_upper"', '.text "SHIP" // name', '.byte %00000101 // flags',
      '.byte $20 // [1] x', '.byte 50 // hp', '.word h2 // handler', '.text "BOSS" // name', '.byte %10000000 // flags',
      '.byte $30 // [2] x',
    ]);
    const V = verify(A2, R2);
    expect(V.ok, JSON.stringify(V.results.map(x => ({ errors: x.errors.slice(0, 3), diffs: x.diffs.slice(0, 3) })))).toBe(true);
    // the block is a struct for the next run: its records, and what it is
    const again = run(['const t = blocks.at("enemies");', 'print(t.as, t.type, t.custom, t.comment.split("\\n").length, t.struct.size, t.records.length, t.records[1].name, hex(t.records[2].handler) === hex(addr("h1")), String(t), blocks.of("struct").length, blocks.of("enemy").length);',
      't.setComment(""); t.exclude(); t.asBinary(); t.setLabel("foes");'], after);
    expect(again.error).toBeUndefined();
    expect(again.prints).toEqual(['struct data enemy 2 9 3 BOSS true struct enemy $0840-$085a enemies 1 1']);
    const next = applied(again, after);
    expect(next.plan.failed).toEqual([]);
    expect([next.after.blockComments[0x0840], next.after.excluded, next.after.binary, next.after.labels[0x0840]]).toEqual([undefined, [0x0840], [0x0840], 'foes']);
  });

  it('writes a struct in 64tass too, bytes after the last record plain, and a word a label points into as bytes', () => {
    const p: Project = { ...project, settings: { ...project.settings, assembler: '64tass' }, labels: { ...project.labels, 0x0843: 'inside' } };
    const r = run(['blocks.struct(["x: byte", "hp: byte dec", "handler: addr", "name: text[4]", "flags: byte bin"]).mark("table", addr("table") + 29);'], p);
    const { plan, A: A2, R: R2, lines } = applied(r, p);
    expect(plan.failed).toEqual([]);
    expect(plan.done[0]).toMatch(/^\$0840-\$085c marked as the struct \(x: byte, .*\): 3 records of 9 bytes, and 2 bytes after them$/);
    expect(lines.some(l => /^\.byte \$10 ; \[0\] x$/.test(l))).toBe(true);
    expect(lines.some(l => /^\.text "ship" ; name$/.test(l))).toBe(true);
    expect(lines.some(l => /^\.byte \$ee, \$ff ; after the last whole record$/.test(l))).toBe(true);
    // the first record's handler has the label `inside` on its high byte: bytes, with the label between them
    expect(lines.some(l => /^\.word h1 ; handler$/.test(l))).toBe(true);
    expect(lines.filter(l => /; handler$/.test(l)).length).toBe(3);
    expect(lines.some(l => /^inside\b/.test(l))).toBe(true);
    const V = verify(A2, R2);
    expect(V.ok, JSON.stringify(V.results.map(x => ({ errors: x.errors.slice(0, 3), diffs: x.diffs.slice(0, 3) })))).toBe(true);
  });

  it('defines custom types: a type with its settings under a name, or a struct', () => {
    const r = run([
      'const row = blocks.define("level map", { as: "bytes", row: 40, fmt: "dec" });', 'const msg = blocks.define("message", "textsc");',
      'const pair = blocks.define("pair", ["lo: word dec", "hi: word dec"]);',
      'print(String(row), String(msg), String(pair), pair.size, row.size, blocks.defined.map(t => t.name).join());',
      'row.mark("map", addr("map") + 80);', 'blocks.mark("title", addr("title") + 5, "message", { label: "hello" });', 'blocks.mark("words", addr("words") + 4, "PAIR");',
      'for (const f of [() => blocks.define("text", "bytes"), () => blocks.define("x", null), () => blocks.mark(0x880, 0x890, "nothing"), () => blocks.mark(0x880, 0x881, pair), () => blocks.mark(0x880, 0x890, "bytes", { row: 0 }), () => blocks.mark(0x880, 0x890, "bytes", { fmt: "oct" }), () => blocks.mark(0x880, 0x890, "struct")]) try { f(); } catch (e) { print(e.message); }',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints!.slice(0, 1)).toEqual(['level map (Bytes (.byte)) message (Text (screen codes)) pair (struct { lo: word dec, hi: word dec }) 4 null level map,message,pair']);
    expect(r.prints![1]).toBe('define: "text" is a type Mimir has: give yours another name');
    expect(r.prints![2]).toMatch(/^define: what the type is is wanted/);
    expect(r.prints![3]).toMatch(/^mark: "nothing" is no type: code, bytes, .*, or one the script defined \(level map, message, pair\)$/);
    expect(r.prints![4]).toBe('mark: 1 byte is less than a record of the struct (4 bytes)');
    expect(r.prints![5]).toMatch(/^mark: row is how many go on a line, 1 to 64/);
    expect(r.prints![6]).toMatch(/^mark: fmt is "hex", "dec" or "bin"/);
    expect(r.prints![7]).toMatch(/^mark: a struct is marked with its fields/);
    const { plan, A: A2, R: R2, lines } = applied(r);
    expect(plan.failed).toEqual([]);
    expect(plan.done).toEqual(['$0880-$08cf marked as level map (Bytes (.byte))', '$08d6-$08da marked as message (Text (screen codes))', '$08d6 named hello', '$08d0-$08d3 marked as the struct pair (lo: word dec, hi: word dec): 1 record of 4 bytes']);
    const m = findBlock(A2.blocks, 0x0880)!, t = findBlock(A2.blocks, 0x08d6)!;
    expect([m.props.custom, m.props.row, m.props.fmt, t.type, t.props.custom, t.props.enc]).toEqual(['level map', 40, 'dec', 'text', 'message', 'screen']);
    expect(lines.some(l => l.startsWith('// ---- level map (Data) · '))).toBe(true);
    expect(lines.some(l => l.startsWith('// ---- message (Text (screen codes)) · hello · $08d6-$08da'))).toBe(true);
    expect(lines).toContain(`.byte ${Array.from({ length: 40 }, (_, i) => i & 7).join(', ')}`);
    expect(lines).toContain('.word 1000 // lo');
    expect(lines).toContain('.word 2000 // hi');
    expect(verify(A2, R2).ok).toBe(true);
  });

  it('changes blocks: a format, a split, the detection back, and what cannot be done is said', () => {
    const marked = applied(run(['blocks.mark("map", addr("map") + 80, "bytes");', 'blocks.mark("words", addr("words") + 6, "words");'])).after;
    const r = run([
      'const m = blocks.at("map"), w = blocks.at("words");', 'print(m.as, m.user, m.fmt, m.row, w.as, w.words.join());',
      'm.format({ fmt: "bin", row: 4 });', 'w.format({ fmt: "dec", row: 3 });', 'm.split(m.start + 40);', 'blocks.comment("words", "three numbers");',
      'blocks.at("main").exclude();', 'blocks.exclude("main", false);', 'blocks.binary("map");',
      'blocks.split(0x0100);', 'blocks.comment(0x0100, "nothing here");', 'blocks.mark(0x0100, 0x0110, "bytes");',
      'try { blocks.at("main").format({ row: 2 }); } catch (e) { print(e.message); }', 'try { m.split(m.start); } catch (e) { print(e.message); }',
    ], marked);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['bytes true null null words 1000,2000,3000', 'format: a code block keeps how it is written', 'split: $0880 is not inside the block ($0881-$08cf)']);
    const { plan, after, A: A2, R: R2, lines } = applied(r, marked);
    expect(plan.failed.map(f => f.why)).toEqual(['$0100 is not part of any block', '$0100 is in no block of the program', '$0100-$010f is not all the program\'s bytes: only bytes of a file can be marked']);
    expect(plan.done).toContain('the block $0880-$08cf cut in two at $08a8');
    expect(plan.done).toContain('the block at $08d0 commented: three numbers');
    expect([after.excluded, after.binary]).toEqual([[], [0x0880]]);
    expect(lines).toContain('.word 1000, 2000, 3000');
    expect(findBlock(A2.blocks, 0x08d0)!.props).toMatchObject({ fmt: 'dec', row: 3 });
    expect(verify(A2, R2).ok).toBe(true);
    // the detection back
    const auto = applied(run(['blocks.at("words").auto();', 'blocks.auto(0x0880, 0x08d0);'], after), after);
    expect(auto.plan.failed).toEqual([]);
    expect(auto.plan.done[0]).toBe('$08d0-$08d5 is as the analysis reads it again (what was marked there is taken away)');
    expect(findBlock(auto.A.blocks, 0x08d0)!.user).toBe(false);
  });

  it('marks with a run that is given no blocks, and leaves nothing to do after an error', () => {
    const r = runJs(env, js(['print(blocks.all.length, blocks.at(0x0810), blocks.find("main"));', 'blocks.mark(0x0840, 0x0844, "bytes", { fmt: "dec" });', 'blocks.struct(["a: byte", "b: byte"]).mark(0x0844, 0x0848);']));
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['0 null null']);
    expect(r.actions).toEqual([{ kind: 'mark', line: 0, start: 0x0840, end: 0x0844, as: 'bytes', props: { fmt: 'dec' } }, { kind: 'mark', line: 0, start: 0x0844, end: 0x0848, as: 'bytes', props: { struct: [{ name: 'a', type: 'byte' }, { name: 'b', type: 'byte' }] } }]);
    const bad = run(['blocks.mark(0x0840, 0x0844, "bytes");', 'throw new Error("no");']);
    expect(bad.error?.msg).toBe('Error: no');
  });
});
