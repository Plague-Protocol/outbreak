import { chance, fork, next, shuffle } from './rng';
import { cellOf, distanceField, generateMap, PITCH, STREET, UNREACHABLE } from './map';
import { generateChain } from './tasks';
import { CRATE_COUNT, PLAYER_SPEED, TASK_HOLD_SECONDS, TIME_PAD, TIME_SLACK, VEHICLE_COUNT, VEHICLES } from './config';
import type { Crate, Loot, MapData, Task, Vec2, Vehicle, VehicleKind } from './types';

export interface Level {
  seed: number;
  map: MapData;
  spawn: Vec2;
  safehouse: Vec2;
  tasks: Task[];
  timeLimit: number; // seconds
  routeSeconds: number; // minimum travel+hold time for the required chain, in chain order
  vehicles: Vehicle[];
  crates: Crate[];
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

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

  // Drivable vehicles at kerbside spots, spread out, with one a short walk from the start.
  const spots = shuffle(rng, map.parking);
  const nearStart = spots
    .filter((p) => dist(p, spawn) > 6)
    .sort((a, b) => dist(a, spawn) - dist(b, spawn))[0];
  const chosen = nearStart ? [nearStart] : [];
  for (const p of spots) {
    if (chosen.length >= VEHICLE_COUNT) break;
    if (chosen.every((q) => dist(p, q) > 14)) chosen.push(p);
  }
  const vehicles: Vehicle[] = chosen.map((p, i) => {
    const r = next(rng);
    const kind: VehicleKind = r < 0.5 ? 'sedan' : r < 0.8 ? 'pickup' : 'van';
    return { id: i + 1, kind, pos: { x: p.x, y: p.y }, heading: p.heading, speed: 0, health: VEHICLES[kind].health, wrecked: false, tone: next(rng) };
  });

  // Supply crates on the pavement beside the street.
  const busy = [spawn, safehouse, ...tasks.map((t) => t.pos)];
  const crates: Crate[] = [];
  for (const p of shuffle(rng, map.points)) {
    if (crates.length >= CRATE_COUNT) break;
    if (busy.some((q) => dist(p, q) < 8) || crates.some((c) => dist(p, c.pos) < 20)) continue;
    const onVertical = Math.abs((p.x - STREET / 2) % PITCH) < 1e-6;
    const off = (chance(rng, 0.5) ? 1 : -1) * 3.3;
    const pos = onVertical ? { x: p.x + off, y: p.y } : { x: p.x, y: p.y + off };
    if (map.blocked[cellOf(map, pos)] === 1) continue;
    const r = next(rng);
    const loot: Loot = r < 0.45 ? 'medkit' : r < 0.8 ? 'supplies' : 'empty';
    crates.push({ id: crates.length + 1, pos, loot, opened: false });
  }
  return { seed, map, spawn, safehouse, tasks, timeLimit, routeSeconds, vehicles, crates };
}
