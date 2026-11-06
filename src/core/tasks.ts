import { shuffle, int, type Rng } from './rng';
import { cellOf, distanceField, UNREACHABLE } from './map';
import type { MapData, Reward, Task, TaskId, Vec2 } from './types';

interface TaskDef {
  id: TaskId;
  label: string;
  hint: string;
  requires: TaskId[];
}

// Required-capable tasks come in groups; a group's internal order is fixed (power before gate).
const REQUIRED_GROUPS: TaskDef[][] = [
  [{ id: 'map', label: 'Find the map', hint: 'Shows where the safehouse is', requires: [] }],
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

export const MIN_TASK_SEPARATION = 45;
export const MIN_SPAWN_DISTANCE = 25;

/**
 * Pick and place the task chain. Required tasks come first, in an order where every
 * dependency precedes its dependant; optional tasks follow. Every position is
 * reachable from the spawn point.
 */
export function generateChain(rng: Rng, map: MapData, spawn: Vec2, safehouse: Vec2): Task[] {
  const groups = shuffle(rng, REQUIRED_GROUPS).slice(0, 3);
  const defs: TaskDef[] = groups.flat();
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

  const tasks: Task[] = defs.map((d) => ({
    id: d.id, label: d.label, hint: d.hint, required: true, requires: d.requires.slice(),
    pos: place(), timeCost: 0, reward: null, done: false,
  }));
  for (const o of optional) {
    tasks.push({
      id: o.id, label: o.label, hint: o.hint, required: false, requires: [],
      pos: place(), timeCost: o.timeCost, reward: o.reward, done: false,
    });
  }
  return tasks;
}
