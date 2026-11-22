/* What a script says about the program beyond its bytes (spec 10.3): .mark, .name, .note and .junk in its code, read
 * with the names the code has, and what they come to in the project. */
import { describe, expect, it } from 'vitest';
import { analyze, checkScript, createProject, findBlock, planScriptActions, render, runScript, scriptDirectives, scriptEnv, scriptIn64tass, type Project, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const TEXT = 'HELLO FROM THE DECRYPTED BLOCK!!';
const program = fromSource('crypt.prg', [
  '.pc = $0810',
  'main:   ldx #0',
  'loop:   lda data,x', '        eor #$5a', '        sta data,x', '        inx', '        cpx #32', '        bne loop', '        rts',
  '.pc = $0840',
  `data:   .byte ${[...TEXT].map(c => c.charCodeAt(0) ^ 0x5a).join(', ')}`,
  'tail:   .byte 1, 2, 3, 4, 5, 6, 7, 8',
].join('\n'));
const project: Project = createProject({ files: [program] });
const A = analyze(project), R = render(A, project);
const env = scriptEnv(project, R, project.settings, A.blocks);
const dataName = R.labels.get(0x0840)!.name;
const script = (lines: string[], lang: UserScript['lang'] = 'kickass', pads: UserScript['pads'] = []): UserScript => ({ id: 's', name: 's', lang, source: lines.join('\n'), pads });

describe('Mimir\'s directives in a script', () => {
  it('are taken out of the code the assembler gets, line for line, a label before one kept', () => {
    const src = ['        lda #1', '        .mark $0840, $0860, "text" // the block', 'here:   .name $0810, "decrypt"', '        rts'].join('\n');
    const d = scriptDirectives(src);
    expect(d.source.split('\n')).toEqual(['        lda #1', '', 'here:', '        rts']);
    expect(d.directives).toEqual([{ line: 2, name: 'mark', args: '$0840, $0860, "text"' }, { line: 3, name: 'name', args: '$0810, "decrypt"' }]);
    // code without any is as it was
    expect(scriptDirectives('        lda #1\n        rts').directives).toEqual([]);
    // 64tass: its comment is ;
    expect(scriptDirectives('        .junk $0860, $0868 ; the rest', '64tass').directives).toEqual([{ line: 1, name: 'junk', args: '$0860, $0868' }]);
  });

  it('are read with the program\'s names, the scratchpads and the script\'s own .vars and labels', () => {
    const s = script([
      `.var dest = ${dataName}`, '.var length = 32',
      'start:  rts',
      '        .mark dest, dest + length, "text"',
      `        .name ${dataName} + 32, "the_rest"`,
      '        .note start - 0 + $0810 - start, "decrypts the text"',
      '        .junk pad1_end - 8 - pad1 + $0860 - 8, $0868',
      '        .mark $0860, $0868, "DATA"',
    ], 'kickass', [{ name: 'pad1', start: 0xc800, size: 16 }]);
    const c = checkScript(env, s);
    expect(c.problems).toEqual([]);
    expect(c.actions).toEqual([
      { kind: 'mark', line: 4, start: 0x0840, end: 0x0860, as: 'text' },
      { kind: 'name', line: 5, at: 0x0860, name: 'the_rest' },
      { kind: 'note', line: 6, at: 0x0810, text: 'decrypts the text' },
      { kind: 'junk', line: 7, start: 0x0860, end: 0x0868 },
      { kind: 'mark', line: 8, start: 0x0860, end: 0x0868, as: 'bytes' },
    ]);
    // the code is the RTS alone, and runs
    expect(c.bytes).toBe(1);
    expect(runScript(env, s, c).end).toBe('rts');
  });

  it('say on their line what is wrong, and the script does not run', () => {
    const bad = (line: string) => { const c = checkScript(env, script(['        rts', line])); expect(c.ok).toBe(false); expect(c.problems[0].line).toBe(2); return c.problems[0].msg; };
    expect(bad('        .mark $0840, $0860')).toBe('.mark: write .mark start, end, "type"');
    expect(bad('        .mark $0840, $0860, "poem"')).toMatch(/^\.mark: "poem" is no type: code, bytes, words, text, /);
    expect(bad('        .mark $0860, $0840, "text"')).toMatch(/^\.mark: the end \(\$0840\) is not after the start \(\$0860\)/);
    expect(bad('        .mark nowhere, $0860, "text"')).toBe('.mark: "nowhere" is not a name of the program or the script');
    expect(bad('        .name $0840, "9lives"')).toMatch(/^\.name: "9lives" is no label/);
    expect(bad('        .name $0840')).toBe('.name: write .name address, "name"');
    expect(bad('        .note $0840, ""')).toBe('.note: the text goes in quotes');
    expect(bad('        .junk $fff0, $10010')).toMatch(/^\.junk: \$10010 is \$10010, outside/);
    expect(bad('        .mark $0840 * 2, $0860, "text"')).toMatch(/is not an address/);
  });

  it('come to changes of the project: the block marked, the label, the comment, the junk', () => {
    const c = checkScript(env, script(['        rts', '        .mark $0840, $0860, "text"', '        .name $0860, "the_rest"', '        .note $0810, "decrypts the text"', '        .junk $0864, $0868']));
    const plan = planScriptActions(A, R, project, c.actions);
    expect(plan.failed).toEqual([]);
    expect(plan.done).toEqual(['$0840-$085f marked as Text (PETSCII)', '$0860 named the_rest', '$0810 commented: decrypts the text', '$0864-$0867 is junk (4 bytes)']);
    expect(plan.labels).toEqual([[0x0860, 'the_rest']]);
    expect(plan.comments).toEqual([[0x0810, 'decrypts the text']]);
    expect(plan.junk).toEqual([{ start: 0x0864, end: 0x0868 }]);
    // applied, the analysis has a text block there, the name and the comment, and the junk is gone
    const after: Project = { ...project, overrides: [...project.overrides, ...plan.overrides], labels: { ...project.labels, ...Object.fromEntries(plan.labels) }, comments: { ...project.comments, ...Object.fromEntries(plan.comments) }, junk: plan.junk };
    const A2 = analyze(after), R2 = render(A2, after);
    expect(findBlock(A2.blocks, 0x0840)).toMatchObject({ start: 0x0840, end: 0x0860, type: 'text' });
    expect(R2.labels.get(0x0860)?.name).toBe('the_rest');
    expect(A2.owner[0x0865]).toBe(-1);
    expect(A2.owner[0x0863]).toBeGreaterThanOrEqual(0);
  });

  it('say what cannot be done: bytes no file has, a name another address has', () => {
    const c = checkScript(env, script(['        rts', '        .mark $c000, $c010, "text"', `        .name $0812, "${dataName}"`, '        .note $c000, "nothing here"']));
    const plan = planScriptActions(A, R, project, c.actions);
    expect(plan.done).toEqual([]);
    expect(plan.failed).toEqual([
      { line: 2, why: '$c000-$c00f is not all the program\'s bytes: only bytes of a file can be marked' },
      { line: 3, why: `the name ${dataName} is already at $0840` },
      { line: 4, why: '$c000 is not a byte of the program: a comment goes on a line of it' },
    ]);
  });

  it('are the same in 64tass, and move there with the script', () => {
    const kick = script([`.var dest = ${dataName}`, '        lda #1', `        .mark ${dataName}, ${dataName} + 32, "text" // the block`, '        .name dest + 32, "the_rest"', '        rts']);
    const moved = scriptIn64tass(env, kick);
    if ('error' in moved) throw new Error(moved.error);
    expect(moved.source).toContain(`.mark ${dataName}, ${dataName} + 32, "text"`);
    const c = checkScript(env, script(moved.source.split('\n'), '64tass'));
    expect(c.problems).toEqual([]);
    expect(c.actions).toEqual([{ kind: 'mark', line: 3, start: 0x0840, end: 0x0860, as: 'text' }, { kind: 'name', line: 4, at: 0x0860, name: 'the_rest' }]);
  });
});
