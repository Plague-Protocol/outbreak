import { describe, expect, it } from 'vitest';
import { briefFor, doneFor, ending, INTRO, objectiveFor, tierLines } from '../src/core/story';
import { generateLevel } from '../src/core/level';
import type { TaskId } from '../src/core/types';

const ALL: TaskId[] = ['map', 'key', 'power', 'gate', 'keycard', 'radio', 'fuel', 'medkit', 'rescue'];

describe('story', () => {
  it('every task that the generator can pick has an objective and a completion line', () => {
    const seen = new Set<TaskId>();
    for (let seed = 1; seed < 400; seed++) for (const t of generateLevel(seed).tasks) seen.add(t.id);
    expect([...seen].sort()).toEqual([...ALL].sort());
    for (const id of ALL) {
      expect(objectiveFor(id).length).toBeGreaterThan(5);
      expect(doneFor(id).length).toBeGreaterThan(0);
    }
  });

  it('every line has a speaker and text', () => {
    const lines = [...INTRO.lines, ...ALL.flatMap((id) => [...briefFor(id), ...doneFor(id)]), ...tierLines(1), ...tierLines(2)];
    for (const l of lines) {
      expect(l.who.length).toBeGreaterThan(0);
      expect(l.text.length).toBeGreaterThan(0);
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
