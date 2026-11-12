/* A release's next disks or sides by their file names (nextSides): names as the archive's top demos have them. */
import { describe, expect, it } from 'vitest';
import { nextSides } from '../src';

describe('nextSides', () => {
  it('finds the sides after the disk, in order, whatever the side mark looks like', () => {
    expect(nextSides('Mathematical_SideA.D64', ['Mathematical_SideA.D64', 'Mathematical_SideB.D64', 'reflex_mathematica-A.d64', 'reflex_mathematica-B.d64'])).toEqual(['Mathematical_SideB.D64']);
    expect(nextSides('reflex_mathematica-A.d64', ['Mathematical_SideA.D64', 'Mathematical_SideB.D64', 'reflex_mathematica-A.d64', 'reflex_mathematica-B.d64'])).toEqual(['reflex_mathematica-B.d64']);
    expect(nextSides('Tower Power 100% [Side 1].d64', ['Tower Power 100% [Side 2].d64', 'camelot_tower_power_final-B.d64'])).toEqual(['Tower Power 100% [Side 2].d64']);
    expect(nextSides('EdgeOfDisgrace_0.d64', ['EdgeOfDisgrace_1b.d64', 'EdgeOfDisgrace_1a.d64', 'EdgeOfDisgrace_0.d64'])).toEqual(['EdgeOfDisgrace_1a.d64', 'EdgeOfDisgrace_1b.d64']);
    expect(nextSides('image2.d64', ['image1.d64', 'image2.d64', 'image3.d64', 'image4.d64', 'image10.d64'])).toEqual(['image3.d64', 'image4.d64', 'image10.d64']);
    expect(nextSides('MementoMori-GP-Disk1.d64', ['MementoMori-GP-Disk3.d64', 'MementoMori-GP-Disk2.d64', 'Meme.sid'])).toEqual(['MementoMori-GP-Disk2.d64', 'MementoMori-GP-Disk3.d64']);
    expect(nextSides('Bromance side 1.D64', ['Bromance side 2.D64'])).toEqual(['Bromance side 2.D64']);
    expect(nextSides('the-hat-7a825b1-a.d64', ['the-hat-7a825b1-b.d64'])).toEqual(['the-hat-7a825b1-b.d64']);
    expect(nextSides('We Are New [Fairlight] (Side 1)_RC1.d64', ['We Are New [Fairlight] (Side 2)_RC1.d64'])).toEqual(['We Are New [Fairlight] (Side 2)_RC1.d64']);
    expect(nextSides('Krestology.s1.d64', ['Krestology.s2.d64', 'tools.d64'])).toEqual(['Krestology.s2.d64']);
    // a G64 side of a D64 disk is one too
    expect(nextSides('game-a.d64', ['game-b.g64'])).toEqual(['game-b.g64']);
  });

  it('leaves out the sides before it, other versions, other files and words that only end in a letter', () => {
    expect(nextSides('Mathematical_SideB.D64', ['Mathematical_SideA.D64', 'Mathematical_SideB.D64'])).toEqual([]);
    expect(nextSides('e2ira_A.d64', ['e2ira_101_A.d64', 'e2ira_101_B.d64', 'e2ira_B.d64', 'e2ira_C.d64'])).toEqual(['e2ira_B.d64', 'e2ira_C.d64']);
    expect(nextSides('Void [Side 1].d64', ['Void [Coma + Resource] (side 2).d64', 'Void [Side 2].d64', 'coma_resource_void-B.d64'])).toEqual(['Void [Side 2].d64']);
    expect(nextSides('0-intro.d64', ['1-parti.d64', '2-partii.d64'])).toEqual([]);
    expect(nextSides('demo.d64', ['demo.g64', 'demo.prg', 'demo2.txt'])).toEqual([]);
    expect(nextSides('final.d64', ['finbl.d64'])).toEqual([]);
    expect(nextSides('demo.prg', ['demo2.d64'])).toEqual([]);
  });
});
