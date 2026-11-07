import { describe, expect, it } from 'vitest';
import { briefFor, doneFor, ending, intro, objectiveFor, tierLines } from '../src/core/story';
import { generateLevel } from '../src/core/level';
import { chapterSeed, createGame } from '../src/core/state';
import { content } from '../src/core/content';
import { CHAPTERS } from '../src/core/config';
import type { Task } from '../src/core/types';

describe('story', () => {
  it('every step in the content turns up in some night, with an objective and a completion line', () => {
    const all = [...content().groups.flat(), content().map, ...content().optional].map((d) => d.id);
    const seen = new Map<string, Task>();
    for (let night = 1; night < 120; night++) {
      for (let c = 0; c < CHAPTERS; c++) {
        for (const t of createGame(chapterSeed(night, c), undefined, { night, chapter: c }).tasks) seen.set(t.id, t);
      }
    }
    expect([...seen.keys()].sort()).toEqual([...all].sort());
    for (const t of seen.values()) {
      expect(objectiveFor(t).length).toBeGreaterThan(5);
      expect(objectiveFor(t)).not.toMatch(/\{\w+\}/); // every {value} filled in
      expect(doneFor(t).length).toBeGreaterThan(0);
      for (const l of [...briefFor(t), ...doneFor(t), ...briefFor(t, false), ...doneFor(t, false)]) {
        expect(l.who.length).toBeGreaterThan(0);
        expect(l.text.length).toBeGreaterThan(0);
        expect(l.text).not.toContain('|');
        expect(l.text).not.toMatch(/\{\w+\}/);
      }
    }
    void generateLevel;
  });

  it('the intro and radio calls have a speaker and text', () => {
    for (const l of [...intro().lines, ...tierLines(1), ...tierLines(2)]) {
      expect(l.who.length).toBeGreaterThan(0);
      expect(l.text).not.toContain('|');
    }
  });

  it('has an ending for each outcome', () => {
    for (const o of ['won', 'caught', 'time'] as const) {
      expect(ending(o).title.length).toBeGreaterThan(0);
      expect(ending(o).text.length).toBeGreaterThan(20);
    }
  });
});
