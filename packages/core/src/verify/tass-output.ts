/* Parses 64tass's console output into problems (checked against 64tass 1.57.2900):
 *   raster-demo.asm:34:13: error: not defined symbol 'undefinedthing'
 *            lda undefinedthing
 *                ^
 *   raster-demo.asm: note: searched in the global scope
 *   include/inc.asm:2:5: warning: …
 *   64tass.exe: fatal error: can't write label file 'out/x.vs': No such file or directory
 * The source line and the caret under it are not problems; a note goes with the problem before it. */
import type { KickProblem } from '../types';

const slash = (p: string) => p.replace(/\\/g, '/');

/** `file` relative to `baseDir` (when inside it) with forward slashes */
function relativeTo(file: string, baseDir?: string): string {
  const f = slash(file.trim());
  if (!baseDir) return f;
  const base = slash(baseDir).replace(/\/+$/, '') + '/';
  return f.toLowerCase().startsWith(base.toLowerCase()) ? f.slice(base.length) : f;
}

export function parseTassOutput(output: string, baseDir?: string): KickProblem[] {
  const problems: KickProblem[] = [];
  const seen = new Set<string>();
  let last: KickProblem | null = null;
  for (const line of output.split(/\r?\n/)) {
    // (a Windows path has a drive letter: C:\work\a.asm:3:1: error: …)
    const m = line.match(/^((?:[A-Za-z]:)?[^:]+):(\d+):(\d+): (error|warning|fatal error): (.*)$/);
    if (m) {
      const p: KickProblem = { severity: m[4] === 'warning' ? 'warning' : 'error', file: relativeTo(m[1], baseDir), line: +m[2], column: +m[3], message: m[5].trim() };
      const key = `${p.severity}|${p.file.toLowerCase()}|${p.line}|${p.column}|${p.message}`;
      if (!seen.has(key)) { seen.add(key); problems.push(p); last = p; } else last = null;
      continue;
    }
    const note = line.match(/^(?:[A-Za-z]:)?[^:]+: note: (.*)$/);
    if (note) { if (last) last.message += ` (${note[1].trim()})`; continue; }
    const fatal = line.match(/^[^:]*?(?:64tass(?:\.exe)?): (?:fatal )?error: (.*)$/i);
    if (fatal) { problems.push({ severity: 'error', file: '', line: 0, column: 0, message: fatal[1].trim() }); last = null; }
  }
  return problems;
}
