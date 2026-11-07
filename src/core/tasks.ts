import { fork, shuffle, int, type Rng } from './rng';
import { BARRICADE_SECONDS, FUSE_COUNT } from './config';
import { cellOf, distanceField, UNREACHABLE } from './map';
import type { MapData, Reward, Task, TaskId, Vec2 } from './types';

interface TaskDef {
  id: TaskId;
  label: string;
  hint: string;
  requires: TaskId[];
  seconds?: number;
}

// Required-capable tasks come in groups; a group's internal order is fixed (power before gate).
// The map always comes last: it shows where the way out is.
const MAP: TaskDef = { id: 'map', label: 'Find the map', hint: 'Shows the way out', requires: [] };
export const REQUIRED_GROUPS: TaskDef[][] = [
  [
    { id: 'insulin', label: 'Take the insulin', hint: 'From the pharmacy fridge', requires: [] },
    { id: 'deliver', label: 'Bring it to the girl', hint: 'In the laundromat', requires: ['insulin'] },
  ],
  [{ id: 'fuses', label: 'Fit the fuses', hint: 'Find them first', requires: [] }],
  [{ id: 'flare', label: 'Light the flare', hint: 'It draws them away', requires: [] }],
  [{ id: 'barricade', label: 'Break the barricade', hint: 'Loud', requires: [], seconds: BARRICADE_SECONDS }],
  [
    { id: 'survivor', label: 'Find Nora', hint: 'In the crashed bus', requires: [] },
    { id: 'shelter', label: 'Get Nora to the shelter', hint: 'She follows you', requires: ['survivor'] },
  ],
  [{ id: 'key', label: 'Find the key', hint: 'The safehouse door is locked', requires: [] }],
  [
    { id: 'power', label: 'Restore power', hint: 'Start the generator', requires: [] },
    { id: 'gate', label: 'Open the gate', hint: 'Needs power first', requires: ['power'] },
  ],
  [{ id: 'keycard', label: 'Find the keycard', hint: 'Opens the security door', requires: [] }],
  [{ id: 'radio', label: 'Tune the radio', hint: 'Confirms the safehouse is open', requires: [] }],
];

interface OptionalDef extends TaskDef {
  timeCost: number;
  reward: Reward;
}

const OPTIONAL_POOL: OptionalDef[] = [
  { id: 'fuel', label: 'Find fuel', hint: 'Optional: run faster (-12s)', requires: [], timeCost: 12, reward: 'speed' },
  { id: 'medkit', label: 'Gather medical supplies', hint: 'Optional: zombies slow down (-10s)', requires: [], timeCost: 10, reward: 'calm' },
  { id: 'rescue', label: 'Rescue a survivor', hint: 'Optional: bonus funds (-15s)', requires: [], timeCost: 15, reward: 'funds' },
];

/** Groups per chapter: every chapter of a night gets its own, none repeated. */
export const GROUPS_PER_CHAPTER = 2;

/** The step groups for one chapter of a night: the night's shuffled pool, dealt out in turn. */
export function chapterGroups(night: number, chapter: number): TaskDef[][] {
  const pool = shuffle(fork(night, 'groups'), REQUIRED_GROUPS);
  const out: TaskDef[][] = [];
  for (let k = 0; k < GROUPS_PER_CHAPTER; k++) out.push(pool[(chapter * GROUPS_PER_CHAPTER + k) % pool.length]!);
  return out;
}

export const MIN_TASK_SEPARATION = 45;
export const MIN_SPAWN_DISTANCE = 25;

/**
 * Pick and place the task chain. Required tasks come first, in the order they are revealed (every
 * dependency before its dependant, the map last); optional tasks follow. Every position is
 * reachable from the spawn point.
 */
export function generateChain(rng: Rng, map: MapData, spawn: Vec2, safehouse: Vec2, groups: TaskDef[][]): Task[] {
  const defs: TaskDef[] = [...groups.flat(), MAP];
  const optionalCount = int(rng, 1, 2);
  const optional = shuffle(rng, OPTIONAL_POOL).slice(0, optionalCount);

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

  const tasks: Task[] = defs.map((d) => {
    const t: Task = {
      id: d.id, label: d.label, hint: d.hint, required: true, requires: d.requires.slice(),
      pos: place(), timeCost: 0, reward: null, done: false,
    };
    if (d.seconds) t.seconds = d.seconds;
    if (d.id === 'fuses') {
      // spares left in vans and on the pavement a block or two around the fuse box
      const parts: Vec2[] = [];
      for (const p of shuffle(rng, usable)) {
        if (parts.length >= FUSE_COUNT) break;
        const d0 = Math.hypot(p.x - t.pos.x, p.y - t.pos.y);
        if (d0 < 14 || d0 > 38 || parts.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 10)) continue;
        parts.push({ x: p.x, y: p.y });
      }
      t.parts = parts;
      t.got = parts.map(() => false);
    }
    return t;
  });
  for (const o of optional) {
    tasks.push({
      id: o.id, label: o.label, hint: o.hint, required: false, requires: [],
      pos: place(), timeCost: o.timeCost, reward: o.reward, done: false,
    });
  }
  return tasks;
}
