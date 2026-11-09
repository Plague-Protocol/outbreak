import { fork, int, shuffle, type Rng } from './rng';
import { cellOf, distanceField, UNREACHABLE } from './map';
import { content, type StepDef } from './content';
import type { MapData, Task, Vec2 } from './types';

/** Groups per chapter: every chapter of a night gets its own, none repeated. */
export const GROUPS_PER_CHAPTER = 2;

/** The step groups for one chapter of a night: the night's shuffled pool, dealt out in turn. */
export function chapterGroups(night: number, chapter: number): StepDef[][] {
  const pool = shuffle(fork(night, 'groups'), content().groups);
  const out: StepDef[][] = [];
  for (let k = 0; k < GROUPS_PER_CHAPTER; k++) out.push(pool[(chapter * GROUPS_PER_CHAPTER + k) % pool.length]!);
  return out;
}

export const MIN_TASK_SEPARATION = 45;
export const MIN_SPAWN_DISTANCE = 25;

/** A puzzle's starting position: tiles turned (most of them), or the wires' order on the far side. */
function scramble(rng: Rng, kind: Task['puzzle']): number[] | undefined {
  if (kind === 'tiles') {
    for (;;) {
      const r = Array.from({ length: 9 }, () => int(rng, 0, 3));
      if (r.filter((x) => x !== 0).length >= 5) return r;
    }
  }
  if (kind === 'wires') {
    for (;;) {
      const p = shuffle(rng, [0, 1, 2, 3]);
      if (p.some((x, i) => x !== i)) return p;
    }
  }
  return undefined;
}

/**
 * Pick and place the task chain: the chapter's step groups in order (each step needs the one before
 * it in its group), then the map, which shows the way out; optional detours follow. Every position is
 * reachable from the spawn point.
 */
export function generateChain(rng: Rng, map: MapData, spawn: Vec2, safehouse: Vec2, groups: StepDef[][]): Task[] {
  const c = content();
  const optional = shuffle(rng, c.optional).slice(0, int(rng, 1, 2));

  const field = distanceField(map, spawn);
  const usable = map.points.filter(
    (p) =>
      (field[cellOf(map, p)] as number) !== UNREACHABLE &&
      Math.hypot(p.x - spawn.x, p.y - spawn.y) >= MIN_SPAWN_DISTANCE &&
      Math.hypot(p.x - safehouse.x, p.y - safehouse.y) >= MIN_SPAWN_DISTANCE,
  );

  const placed: Vec2[] = [];
  const place = (): Vec2 => {
    const order = shuffle(rng, usable);
    const spaced = order.find((p) => placed.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= MIN_TASK_SEPARATION));
    const p = spaced ?? (order[0] as Vec2);
    placed.push(p);
    return { x: p.x, y: p.y };
  };

  const make = (d: StepDef, requires: string[], required: boolean, code: string): Task => {
    const t: Task = {
      id: d.id, kind: d.kind, required, requires, pos: place(), timeCost: d.timeCost ?? 0, reward: d.reward ?? null, done: false, code,
    };
    if (d.seconds) t.seconds = d.seconds;
    if (d.effect) t.effect = d.effect;
    if (d.needsEscort) t.needsEscort = true;
    if (d.escort) t.escort = { name: d.escort.name, skin: d.escort.skin, scale: d.escort.scale ?? 1, party: d.escort.party?.map((m) => ({ ...m, scale: m.scale ?? 1 })) };
    if (d.parts) {
      // pieces lie a block or two around it, apart from each other
      const parts: Vec2[] = [];
      for (const p of shuffle(rng, usable)) {
        if (parts.length >= d.parts.count) break;
        const d0 = Math.hypot(p.x - t.pos.x, p.y - t.pos.y);
        if (d0 < 14 || d0 > 38 || parts.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 10)) continue;
        parts.push({ x: p.x, y: p.y });
      }
      t.parts = parts;
      t.got = parts.map(() => false);
    }
    if (d.puzzle) { t.puzzle = d.puzzle; t.scramble = scramble(rng, d.puzzle); }
    if (d.kind === 'clear') t.clear = d.clear;
    return t;
  };

  const tasks: Task[] = [];
  for (const g of [...groups, [c.map]]) {
    const code = String(int(rng, 1000, 9999)); // a door code or a phone number, shared by the group's steps
    g.forEach((d, k) => tasks.push(make(d, k > 0 ? [g[k - 1]!.id] : [], true, code)));
  }
  for (const o of optional) tasks.push(make(o, [], false, ''));
  return tasks;
}
