/* An Assembler project's bookmarks (spec 10.7): on lines of its sources, kept in its project file by their ids. */
import { describe, expect, it } from 'vitest';
import { createProject, deserializeProject, serializeProject } from '../src/project';

describe('the bookmarks in Project.asm', () => {
  it('are kept with the project by their ids: file, line, an area\'s last line, title, note, colour', () => {
    const p = createProject({ name: 'game', files: [], asm: { lang: 'kickass', main: 'main.asm', bookmarks: {
      b1: { file: 'main.asm', line: 7, title: 'loop', text: 'the main loop', color: 'teal' },
      b2: { file: 'gfx/sprites.asm', line: 3, end: 20, title: 'sprites', text: '' },
    } } });
    const s = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(s.asm.bookmarks).toEqual({
      b1: { file: 'main.asm', line: 7, title: 'loop', text: 'the main loop', color: 'teal' },
      b2: { file: 'gfx/sprites.asm', line: 3, end: 20, title: 'sprites', text: '' },
    });
    expect(deserializeProject(s).asm?.bookmarks).toEqual(s.asm.bookmarks);
  });
  it('an end at or before the line is no area, and none at all is not written', () => {
    const p = createProject({ name: 'game', files: [], asm: { lang: '64tass', bookmarks: { x: { file: 'a.asm', line: 4, end: 4, title: 't', text: '' } } } });
    expect(p.asm?.bookmarks).toEqual({ x: { file: 'a.asm', line: 4, title: 't', text: '' } });
    expect(serializeProject(createProject({ name: 'game', files: [], asm: { lang: '64tass', bookmarks: {} } })).asm).toEqual({ lang: '64tass' });
  });
});
