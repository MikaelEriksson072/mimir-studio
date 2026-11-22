/* =====================================================================
 * Kick Assembler code written as 64tass (spec 10.3, 11.8): the script templates, and a script or a patch the user
 * moves to 64tass. Line by line, for the part of Kick Assembler such code is written in: comments, labels, `!:`
 * labels and `!+`/`!-`, `.var`/`.const`/`.label`, `.if (…) { } else { }` and `.if (…) .error "…"`, `.print`,
 * `.byte`/`.word`/`.fill`, `* =`/`.pc =`, `lda.abs`/`.zp`, the undocumented opcodes (64tass's names and `.cpu
 * "6502i"`) and the expressions both have. Anything else (`.for`, macros, functions, texts, scopes …) is said and not
 * converted: the caller keeps the Kick Assembler code. What it gives is checked by assembling both (script-convert.ts).
 * ===================================================================== */
import { OPC, TASS_NAMES } from './cpu/opcodes';
import { commentAt } from './code-lang';

export type Converted = { source: string } | { error: string; line: number };

/** the mnemonics with no documented opcode (64tass needs `.cpu "6502i"` for them), by their Kick Assembler name */
const UNDOC = (() => {
  const doc = new Set(OPC.filter(o => !o.ill).map(o => o.mn));
  return new Set(OPC.filter(o => o.ill && !doc.has(o.mn)).map(o => o.mn.toLowerCase()));
})();
const MNEMONICS = new Set(OPC.map(o => o.mn.toLowerCase()));

/** a line's indent kept for what follows a label: `name:` + spaces up to where the rest stood */
const after = (head: string, col: number) => head + ' '.repeat(Math.max(1, col - head.length));

/**
 * The Kick Assembler code as 64tass, or what stops it (with its line, from 1).
 */
export function kickToTass(source: string): Converted {
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  const open: ('if' | 'else')[] = [];
  let ill = false;
  // a `!:` label that some `!-` goes back to is a `-` too (64tass has `+` labels for forward, `-` for back)
  const back = lines.some(l => { const k = commentAt(l, 'kickass'); return /![-]/.test(k < 0 ? l : l.slice(0, k)); });
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], fail = (error: string): Converted => ({ error, line: i + 1 });
    if (/\/\*/.test(raw.slice(0, commentAt(raw, 'kickass') < 0 ? undefined : commentAt(raw, 'kickass')))) return fail('a block comment (/* */): write it as // lines');
    const k = commentAt(raw, 'kickass');
    let code = (k < 0 ? raw : raw.slice(0, k)).replace(/\s+$/, '');
    const cmt = k < 0 ? '' : `;${raw.slice(k + 2)}`;
    // the comment where it stood (a line of only a comment keeps its indent)
    const withCmt = (c: string) => (cmt ? (c ? `${c.padEnd(Math.max(c.length + 1, k))}${cmt}` : `${' '.repeat(k)}${cmt}`) : c);
    if (!code.trim()) { out.push(withCmt('')); continue; }
    let m: RegExpExecArray | null;
    // blocks: .if (…) { … } else { … }
    if ((m = /^(\s*)\}\s*else\s+if\s*(\(.*\))\s*\{$/.exec(code))) { if (open[open.length - 1] !== 'if') return fail('} else if without .if'); out.push(withCmt(`${m[1]}.elsif ${m[2]}`)); continue; }
    if ((m = /^(\s*)\}\s*else\s*\{$/.exec(code))) { if (open[open.length - 1] !== 'if') return fail('} else without .if'); open[open.length - 1] = 'else'; out.push(withCmt(`${m[1]}.else`)); continue; }
    if ((m = /^(\s*)\}$/.exec(code))) { if (!open.length) return fail('a } that closes a block other than .if (a scope, .for, .pseudopc …)'); open.pop(); out.push(withCmt(`${m[1]}.endif`)); continue; }
    // .if (condition) {, .if (condition) .error "…", .if (condition) one statement
    if ((m = /^(\s*)\.if\s*\(/.exec(code))) {
      const from = m[0].length - 1, to = closeParen(code, from), ind = m[1];
      if (to < 0) return fail('.if (… without its )');
      const cond = code.slice(from, to), tail = code.slice(to).trim(), bad = exprProblem(cond);
      if (bad) return fail(bad);
      let e: RegExpExecArray | null;
      if (tail === '{') { open.push('if'); out.push(withCmt(`${ind}.if ${conv(cond)}`)); continue; }
      if ((e = /^\.error\s+("(?:[^"\\]|\\.)*")$/.exec(tail))) { out.push(withCmt(`${ind}.cerror ${conv(cond)}, ${e[1]}`)); continue; }
      const one = stmt(tail); if ('error' in one) return fail(one.error); ill ||= one.ill;
      out.push(withCmt(`${ind}.if ${conv(cond)}`), `${ind}        ${one.text}`, `${ind}.endif`); continue;
    }
    // a definition: .var/.const/.label name = value, its = where it stood
    if ((m = /^(\s*)\.(var|const|label)\s+([A-Za-z_]\w*)(\s*)=\s*(.*)$/.exec(code))) {
      const p = exprProblem(m[5]); if (p) return fail(p);
      const col = m[1].length + m[2].length + 2 + m[3].length + m[4].length;
      out.push(withCmt(`${m[3].padEnd(Math.max(m[3].length + 1, col))}= ${conv(m[5])}`)); continue;
    }
    // a label at the start: name: (64tass wants it at the start of the line), !: (+, and - when one goes back)
    let head = '', rest = code;
    if ((m = /^(\s*)([A-Za-z_]\w*):(\s*)(.*)$/.exec(code))) { head = `${m[2]}:`; rest = m[4]; if (!rest) { out.push(withCmt(head)); continue; } head = after(head, m[1].length + m[2].length + 1 + m[3].length); }
    else if ((m = /^(\s*)!:(\s*)(.*)$/.exec(code))) {
      if (back) out.push('-');
      rest = m[3];
      if (!rest) { out.push(withCmt('+')); continue; }
      head = after('+', m[1].length + 2 + m[2].length);
    } else if (/^\s*![A-Za-z_]\w*\s*:/.test(code)) return fail('a named ! label (!loop:): give it a name of its own');
    else head = /^\s*/.exec(code)![0] || '        ';
    const s = stmt(rest.trim());
    if ('error' in s) return fail(s.error);
    ill ||= s.ill;
    out.push(withCmt(head + s.text));
  }
  if (open.length) return { error: `.if without its } (${open.length} open)`, line: lines.length };
  return { source: [...(ill ? ['.cpu "6502i"                    ; 64tass: the undocumented opcodes'] : []), ...out].join('\n') };
}

/** the index after the ) that closes the ( at `i`, outside strings; -1: none */
function closeParen(s: string, i: number): number {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === '"') { for (k++; k < s.length && s[k] !== '"'; k++) if (s[k] === '\\') k++; continue; }
    if (c === '(') depth++;
    else if (c === ')' && !--depth) return k + 1;
  }
  return -1;
}

/** an expression of Kick Assembler as 64tass: the anonymous references (!+ → +, !- → -); null when it has what 64tass
 *  reads otherwise (a character in ' ', a function, a string) */
function conv(e: string): string { return e.replace(/!([+-]+)/g, '$1'); }
const exprProblem = (e: string): string | null => {
  if (/'/.test(e)) return 'a character in \' \' (64tass encodes it as text): write its value';
  if (/"/.test(e)) return 'a string (64tass encodes it as text)';
  // (!name+ is a named ! label's reference; !name alone is not, as in .if (!pageKey))
  if (/![A-Za-z_]\w*[+-]/.test(e)) return 'a named ! label: give it a name of its own';
  if (/[A-Za-z_]\w*\s*\(/.test(e)) return 'a function (64tass has its own)';
  return null;
};

/** one statement (no label): an instruction, `.byte`, `.word`, `.fill`, `* =`, `.pc =`, `.print` */
function stmt(s: string): { text: string; ill: boolean } | { error: string } {
  let m: RegExpExecArray | null;
  if ((m = /^\.(byte|by|word|wo)\s+(.*)$/.exec(s))) {
    if (/"/.test(m[2])) return { error: 'a string in .byte (64tass encodes it as text): write its bytes' };
    const p = exprProblem(m[2]); if (p) return { error: p };
    return { text: `.${m[1].startsWith('b') ? 'byte' : 'word'} ${conv(m[2])}`, ill: false };
  }
  if ((m = /^\.fill\s+(.*)$/.exec(s))) {
    if (/\bi\b/.test(m[1])) return { error: '.fill with i (each byte its own value): write the bytes, or a loop of your own' };
    const p = exprProblem(m[1]); if (p) return { error: p };
    return { text: `.fill ${conv(m[1])}`, ill: false };
  }
  if ((m = /^(?:\*|\.pc)\s*=\s*([^"]*?)(?:\s+"[^"]*")?$/.exec(s))) { const p = exprProblem(m[1]); if (p) return { error: p }; return { text: `* = ${conv(m[1].trim())}`, ill: false }; }
  if ((m = /^\.print\s+("[^"\\]*")$/.exec(s))) return { text: `.warn ${m[1]}`, ill: false };
  if ((m = /^\.error\s+(".*")$/.exec(s))) return { text: `.error ${m[1]}`, ill: false };
  // Mimir's own directives (script-actions.ts) are the same in both languages
  if (/^\.(mark|name|note|junk)\b/.test(s)) return { text: s, ill: false };
  if (s.startsWith('.') || s.startsWith('#') || s.startsWith('{')) return { error: `${s.split(/\s/)[0]} is not written for 64tass yet: keep the script in Kick Assembler` };
  // an instruction: its mnemonic as 64tass names it, .abs as @w, .zp as @b
  if ((m = /^([A-Za-z]{3})(?:\.([A-Za-z]+))?(?:\s+(.*))?$/.exec(s))) {
    const mn = m[1].toLowerCase();
    if (!MNEMONICS.has(mn)) return { error: `${m[1]} is not an instruction (a macro or a pseudo command?)` };
    const op = (m[3] ?? '').trim();
    const p = exprProblem(op); if (p) return { error: p };
    const ext = (m[2] ?? '').toLowerCase();
    const force = ext === 'abs' || ext === 'a' ? '@w ' : ext === 'zp' || ext === 'z' ? '@b ' : '';
    if (ext && !force) return { error: `.${m[2]} after ${m[1]}: write the instruction without it` };
    const name = (TASS_NAMES[mn.toUpperCase()] ?? mn).toLowerCase();
    const undoc = UNDOC.has(mn) || (mn === 'nop' && !!op);
    return { text: op ? `${name} ${force}${conv(op)}` : name, ill: undoc };
  }
  return { error: `"${s}" is not written for 64tass yet: keep the script in Kick Assembler` };
}
