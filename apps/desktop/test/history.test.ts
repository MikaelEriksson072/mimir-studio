import { describe, expect, it } from 'vitest';
import { demoProject } from '@mimir/core';
import { commit, commitReplace, HISTORY_LIMIT, initHistory, ownChanges, redo, undo, type HistoryStep } from '../src/store/history';

describe('patch-based undo/redo', () => {
  it('undoes and redoes project edits with patches, keeping file buffers shared', () => {
    const p0 = demoProject();
    let h = initHistory(p0);
    h = commit(h, 'Rename', d => { d.labels[0x0810] = 'main'; });
    h = commit(h, 'Mark as code', d => { d.overrides.push({ start: 0x0a00, end: 0x0a10, type: 'code' }); });
    expect(h.past.map(s => s.label)).toEqual(['Rename', 'Mark as code']);
    expect(h.present.files).toBe(p0.files); // structural sharing: analysis inputs keep their identity
    h = undo(h);
    expect(h.present.overrides).toEqual([]);
    expect(h.present.labels).toEqual({ 2064: 'main' });
    h = undo(h);
    expect(h.present.labels).toEqual({});
    h = redo(redo(h));
    expect(h.present.overrides).toHaveLength(1);
    expect(h.future).toEqual([]);
  });

  it('ignores no-op edits and drops the redo stack on a new edit', () => {
    let h = initHistory(demoProject());
    const same = commit(h, 'nothing', () => { /* no change */ });
    expect(same).toBe(h);
    h = commit(h, 'a', d => { d.name = 'a'; });
    h = undo(h);
    h = commit(h, 'b', d => { d.name = 'b'; });
    expect(h.future).toEqual([]);
    expect(h.present.name).toBe('b');
  });

  it('replaces the whole project as one undoable step', () => {
    const p0 = demoProject();
    let h = commit(initHistory(p0), 'Rename', d => { d.labels[0x0810] = 'main'; });
    const other = { ...demoProject(), name: 'quicksave' };
    h = commitReplace(h, 'Open the VICE quicksave', other);
    expect(h.present).toBe(other);
    expect(h.past.map(s => s.label)).toEqual(['Rename', 'Open the VICE quicksave']);
    h = undo(h);
    expect(h.present.name).toBe(p0.name);
    expect(h.present.labels).toEqual({ 2064: 'main' });
    expect(h.present.files).toBe(p0.files);
    expect(redo(h).present.name).toBe('quicksave');
  });

  it(`keeps at most ${HISTORY_LIMIT} steps`, () => {
    let h = initHistory(demoProject());
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = commit(h, `step ${i}`, d => { d.name = `n${i}`; });
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0].label).toBe('step 20');
  });
});

describe('changes of the present\'s own (the work without a project asks before it is replaced)', () => {
  it('an edit is a change; a value replaced whole has none until it is edited, and Ctrl+Z brings the changes back', () => {
    let h = initHistory(demoProject());
    expect(ownChanges(h)).toBe(false);
    h = commit(h, 'Rename', d => { d.labels[0x0810] = 'main'; });
    expect(ownChanges(h)).toBe(true);
    h = commitReplace(h, 'Open the VICE quicksave', { ...demoProject(), name: 'quicksave' });
    expect(ownChanges(h)).toBe(false);
    expect(ownChanges(redo(undo(h)))).toBe(false);
    expect(ownChanges(undo(h))).toBe(true);
    expect(ownChanges(undo(undo(h)))).toBe(false);
    h = commit(h, 'Rename', d => { d.labels[0x0810] = 'start'; });
    expect(ownChanges(h)).toBe(true);
  });

  it('a history can start with changes (the work the window kept), and carried steps are none', () => {
    const settings = (s: HistoryStep) => s.patches.every(p => p.path[0] === 'settings');
    let h = initHistory(demoProject(), true);
    expect(ownChanges(h)).toBe(true);
    expect(ownChanges(undo(commit(h, 'Rename', d => { d.name = 'x'; })))).toBe(true);
    h = commitReplace(h, 'Open', { ...demoProject(), name: 'other' });
    h = commit(h, 'Settings', d => { d.settings.addrComments = !d.settings.addrComments; });
    expect(ownChanges(h)).toBe(true);
    expect(ownChanges(h, settings)).toBe(false);
  });

  it('steps dropped off the start leave what they changed', () => {
    let h = initHistory(demoProject());
    h = commit(h, 'Rename', d => { d.name = 'renamed'; });
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = commit(h, `Settings ${i}`, d => { d.settings.addrComments = i % 2 === 0; });
    while (h.past.length) h = undo(h);
    expect(h.present.name).toBe('renamed');
    expect(ownChanges(h)).toBe(true);
    let r = commitReplace(initHistory(demoProject(), true), 'Open', { ...demoProject(), name: 'opened' });
    for (let i = 0; i < HISTORY_LIMIT; i++) r = commitReplace(r, `Open ${i}`, { ...demoProject(), name: `opened ${i}` });
    while (r.past.length) r = undo(r);
    expect(ownChanges(r)).toBe(false);
  });
});
