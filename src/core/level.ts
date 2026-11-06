import { fork, shuffle } from './rng';
import { cellOf, distanceField, generateMap, UNREACHABLE } from './map';
import { generateChain } from './tasks';
import { PLAYER_SPEED, TASK_HOLD_SECONDS, TIME_PAD, TIME_SLACK } from './config';
import type { MapData, Task, Vec2 } from './types';

export interface Level {
  seed: number;
  map: MapData;
  spawn: Vec2;
  safehouse: Vec2;
  tasks: Task[];
  timeLimit: number; // seconds
  routeSeconds: number; // minimum travel+hold time for the required chain, in chain order
}

/** Deterministic: the same seed always yields the same Level. */
export function generateLevel(seed: number): Level {
  const map = generateMap(fork(seed, 'map').s);
  const rng = fork(seed, 'level');

  const [spawn0] = shuffle(rng, map.points);
  const spawn = { ...(spawn0 as Vec2) };
  const field = distanceField(map, spawn);
  const reach = map.points
    .filter((p) => (field[cellOf(map, p)] as number) !== UNREACHABLE)
    .sort((a, b) => (field[cellOf(map, b)] as number) - (field[cellOf(map, a)] as number));
  const far = reach.slice(0, Math.max(1, Math.floor(reach.length * 0.3)));
  const [sh0] = shuffle(rng, far);
  const safehouse = { ...(sh0 as Vec2) };

  const tasks = generateChain(rng, map, spawn, safehouse);

  const route = [spawn, ...tasks.filter((t) => t.required).map((t) => t.pos), safehouse];
  let steps = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const f = distanceField(map, route[i] as Vec2);
    steps += f[cellOf(map, route[i + 1] as Vec2)] as number;
  }
  const requiredCount = tasks.filter((t) => t.required).length;
  const routeSeconds = steps / PLAYER_SPEED + requiredCount * TASK_HOLD_SECONDS;
  const timeLimit = Math.ceil(routeSeconds * TIME_SLACK + TIME_PAD);
  return { seed, map, spawn, safehouse, tasks, timeLimit, routeSeconds };
}
