/* A script or a patch written in Kick Assembler moved to 64tass (spec 10.2, 10.3, 11.8), for a project whose source is
 * for 64tass now: the code converted (kickToTass), and moved only when it gives the same bytes at the same addresses
 * as the Kick Assembler code, with the same names, scratchpads and range. */
import type { AnalysisResult, Project, RenderResult, Settings, UserScript } from './types';
import { kickToTass } from './code-convert';
import { checkScript, padData, scriptNames, type ScriptEnv } from './script';
import { planPatch, type PatchRequest } from './patch';
import { h4 } from './util/hex';

export type Moved<T> = T | { error: string; line?: number };

/**
 * The script as 64tass: its code and its scratchpads' start content written as code, converted; the same bytes
 * checked (its code where it goes, its scratchpads as a run starts them). Else what stops it.
 */
export function scriptIn64tass(env: ScriptEnv, script: Pick<UserScript, 'source' | 'pads' | 'init'>): Moved<{ source: string; pads: UserScript['pads'] }> {
  const was = checkScript(env, { ...script, lang: 'kickass' });
  if (!was.ok) return { error: 'the script must check out in Kick Assembler first' };
  const r = kickToTass(script.source);
  if ('error' in r) return r;
  const pads: UserScript['pads'] = [];
  for (const p of script.pads) {
    if (p.src?.form !== 'asm' || !p.src.text.trim()) { pads.push(p); continue; }
    const q = kickToTass(p.src.text);
    if ('error' in q) return { error: `the start content of scratchpad ${p.name}, its line ${q.line}: ${q.error}` };
    pads.push({ ...p, src: { ...p.src, text: q.source } });
  }
  const now = checkScript(env, { source: r.source, pads, init: script.init, lang: '64tass' });
  if (!now.ok) { const e = now.problems.find(p => p.level === 'error'); return { error: `as 64tass it does not check out: ${e?.msg}`, ...(e?.line ? { line: e.line } : {}) }; }
  for (let a = 0; a < 0x10000; a++) {
    if (was.written[a] !== now.written[a] || (was.written[a] && was.mem[a] !== now.mem[a])) return { error: `as 64tass it gives other bytes at $${h4(a)}` };
  }
  if (was.entry !== now.entry) return { error: 'as 64tass it starts elsewhere' };
  for (let i = 0; i < pads.length; i++) {
    const p0 = script.pads[i], s = p0.src, t = pads[i].src;
    if (s?.form !== 'asm' || s === t || !t) continue;
    const a = padData(s, p0.start, p0.size, scriptNames(env, script.pads), p0.fill ?? 0, 'kickass');
    const b = padData(t, p0.start, p0.size, scriptNames(env, pads), p0.fill ?? 0, '64tass');
    if (!('bytes' in a) || !('bytes' in b) || a.bytes.length !== b.bytes.length || a.bytes.some((x, k) => x !== b.bytes[k])) return { error: `the start content of scratchpad ${p0.name} gives other bytes as 64tass` };
  }
  return { source: r.source, pads };
}

/** A patch's code as 64tass, when it writes the same bytes over its range as the Kick Assembler code does. */
export function patchIn64tass(A: AnalysisResult, R: Pick<RenderResult, 'labels' | 'zp'>, project: Pick<Project, 'files' | 'patches'> & Partial<Pick<Project, 'cart'>> & { settings: Pick<Settings, 'hexCase'> },
  req: Omit<PatchRequest, 'lang'>): Moved<{ source: string }> {
  const was = planPatch(A, R, project, { ...req, lang: 'kickass' });
  if ('error' in was) return { error: `the code must assemble in Kick Assembler first: ${was.error}` };
  const r = kickToTass(req.source);
  if ('error' in r) return r;
  const now = planPatch(A, R, project, { ...req, source: r.source, lang: '64tass' });
  if ('error' in now) return { error: `as 64tass: ${now.error}`, ...(now.line ? { line: now.line } : {}) };
  if (now.patch.bytes.length !== was.patch.bytes.length || now.patch.bytes.some((b, i) => b !== was.patch.bytes[i])) return { error: 'as 64tass it writes other bytes' };
  return { source: r.source };
}
