/* Undo/redo with Immer patches (spec 3): each step stores its forward and inverse patches instead
 * of a full snapshot. Pure functions, so they are unit-tested without React. */
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';

enablePatches();

export const HISTORY_LIMIT = 100;

/** `replace`: the whole value was replaced (commitReplace), so the steps before it are other work's */
export interface HistoryStep { label: string; patches: Patch[]; inverse: Patch[]; replace?: true }
/** `changed`: the value `past` starts from has changes of its own (from before the history, or in steps dropped off its
 *  start) */
export interface History<T> { present: T; past: HistoryStep[]; future: HistoryStep[]; changed: boolean }

export const initHistory = <T,>(present: T, changed = false): History<T> => ({ present, past: [], future: [], changed });

/** `past` with `step` after it, at most HISTORY_LIMIT steps; `changed` as true of the first step kept */
function push<T>(h: History<T>, present: T, step: HistoryStep): History<T> {
  const drop = h.past.length - (HISTORY_LIMIT - 1);
  return { present, past: [...h.past.slice(Math.max(0, drop)), step], future: [], changed: drop > 0 ? !h.past[drop - 1].replace : h.changed };
}

/** Apply a recipe; no-op recipes leave the history untouched. */
export function commit<T>(h: History<T>, label: string, recipe: (draft: Draft<T>) => void): History<T> {
  const [next, patches, inverse] = produceWithPatches(h.present, recipe);
  if (!patches.length) return h;
  return push(h, next, { label, patches, inverse });
}

/** The whole value replaced as one step (a VICE quicksave opened over the project: Ctrl+Z brings the project back). */
export function commitReplace<T>(h: History<T>, label: string, next: T): History<T> {
  const [present, patches, inverse] = produceWithPatches(h.present, () => next as never);
  if (!patches.length) return h;
  return push(h, present as T, { label, patches, inverse, replace: true });
}

export function undo<T extends object>(h: History<T>): History<T> {
  const step = h.past[h.past.length - 1];
  if (!step) return h;
  return { present: applyPatches(h.present, step.inverse) as T, past: h.past.slice(0, -1), future: [step, ...h.future], changed: h.changed };
}

export function redo<T extends object>(h: History<T>): History<T> {
  const step = h.future[0];
  if (!step) return h;
  return { present: applyPatches(h.present, step.patches) as T, past: [...h.past, step], future: h.future.slice(1), changed: h.changed };
}

/**
 * Whether the present has changes of its own: a step since the value was last replaced whole, or (with none) the
 * changes it started with. `carried` steps are none: what replaces the value takes them along.
 */
export function ownChanges<T>(h: History<T>, carried: (step: HistoryStep) => boolean = () => false): boolean {
  for (let i = h.past.length - 1; i >= 0; i--) {
    const step = h.past[i];
    if (step.replace) return false;
    if (!carried(step)) return true;
  }
  return h.changed;
}
