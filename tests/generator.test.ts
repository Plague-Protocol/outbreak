import { describe, expect, it } from 'vitest';
import { createRng, fork, next, shuffle } from '../src/core/rng';
import { generateLevel } from '../src/core/level';
import { cellOf, distanceField, generateMap, reachable, UNREACHABLE } from '../src/core/map';
import { MIN_SPAWN_DISTANCE } from '../src/core/tasks';

const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 1);

describe('rng', () => {
  it('same seed gives same sequence; different seeds differ', () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    const sa = Array.from({ length: 10 }, () => next(a));
    const sb = Array.from({ length: 10 }, () => next(b));
    const sc = Array.from({ length: 10 }, () => next(c));
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true);
  });
  it('fork streams are independent but deterministic', () => {
    expect(fork(5, 'map').s).toBe(fork(5, 'map').s);
    expect(fork(5, 'map').s).not.toBe(fork(5, 'tasks').s);
  });
  it('shuffle is a permutation and does not mutate input', () => {
    const src = [1, 2, 3, 4, 5, 6];
    const out = shuffle(createRng(1), src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort()).toEqual(src);
  });
});

describe('level generation: determinism', () => {
  it('same seed yields an identical level', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const a = generateLevel(seed), b = generateLevel(seed);
      expect(a.tasks).toEqual(b.tasks);
      expect(a.spawn).toEqual(b.spawn);
      expect(a.safehouse).toEqual(b.safehouse);
      expect(a.timeLimit).toBe(b.timeLimit);
      expect(a.map.buildings).toEqual(b.map.buildings);
    }
  });
  it('different seeds give different layouts', () => {
    const sigs = new Set(SEEDS.slice(0, 50).map((s) => JSON.stringify(generateLevel(s).tasks.map((t) => [t.id, t.pos]))));
    expect(sigs.size).toBeGreaterThan(40);
  });
});

describe('level generation: task chain', () => {
  it('has required tasks (3-5) and some optional ones that cost time', () => {
    for (const seed of SEEDS) {
      const { tasks } = generateLevel(seed);
      const req = tasks.filter((t) => t.required);
      const opt = tasks.filter((t) => !t.required);
      expect(req.length).toBeGreaterThanOrEqual(3);
      expect(req.length).toBeLessThanOrEqual(5); // two kinds of step (one or two parts each), then the map
      expect(opt.length).toBeGreaterThanOrEqual(1);
      expect(opt.every((t) => t.timeCost > 0 && t.reward !== null)).toBe(true);
      expect(req.every((t) => t.timeCost === 0)).toBe(true);
      expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
    }
  });

  it('is ordered: every dependency appears earlier, and required tasks never depend on optional ones', () => {
    for (const seed of SEEDS) {
      const { tasks } = generateLevel(seed);
      tasks.forEach((t, i) => {
        for (const dep of t.requires) {
          const j = tasks.findIndex((x) => x.id === dep);
          expect(j).toBeGreaterThanOrEqual(0);
          expect(j).toBeLessThan(i);
          if (t.required) expect(tasks[j]!.required).toBe(true);
        }
      });
      const firstOptional = tasks.findIndex((t) => !t.required);
      expect(tasks.slice(firstOptional).every((t) => !t.required)).toBe(true);
    }
  });

  it('every task and the safehouse are reachable from spawn, and spawn is not on top of them', () => {
    for (const seed of SEEDS) {
      const lv = generateLevel(seed);
      expect(reachable(lv.map, lv.spawn, lv.safehouse)).toBe(true);
      for (const t of lv.tasks) {
        expect(reachable(lv.map, lv.spawn, t.pos)).toBe(true);
        expect(Math.hypot(t.pos.x - lv.spawn.x, t.pos.y - lv.spawn.y)).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
      }
    }
  });

  it('the time limit allows the required route with margin', () => {
    for (const seed of SEEDS) {
      const lv = generateLevel(seed);
      expect(lv.timeLimit).toBeGreaterThan(lv.routeSeconds * 1.3);
    }
  });
});

describe('map', () => {
  it('has no building overlapping a street point and the street grid is connected', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const map = generateMap(seed);
      const field = distanceField(map, map.points[0]!);
      for (const p of map.points) {
        expect(map.blocked[cellOf(map, p)]).toBe(0);
        expect(field[cellOf(map, p)]).not.toBe(UNREACHABLE);
      }
    }
  });
});
