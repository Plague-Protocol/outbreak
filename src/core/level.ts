import { chance, fork, next, shuffle } from './rng';
import { cellOf, distanceField, districtAt, generateMap, PITCH, STREET, UNREACHABLE } from './map';
import { generateChain } from './tasks';
import { AMMO_PICKUPS, CRATE_COUNT, PLAYER_SPEED, TASK_HOLD_SECONDS, TIME_PAD, TIME_SLACK, VEHICLE_COUNT, VEHICLES } from './config';
import type { Crate, Loot, MapData, Pickup, PickupKind, Store, Task, Vec2, Vehicle, VehicleKind } from './types';

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
  pickups: Pickup[];
  store: Store;
}

/** A spot on the pavement beside a street point (where crates, pickups and the store counter go). */
function pavement(map: MapData, p: Vec2, side: number): Vec2 | null {
  const onVertical = Math.abs((p.x - STREET / 2) % PITCH) < 1e-6;
  const pos = onVertical ? { x: p.x + side * 3.3, y: p.y } : { x: p.x, y: p.y + side * 3.3 };
  return map.blocked[cellOf(map, pos)] === 1 ? null : pos;
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

  const busy = [spawn, safehouse, ...tasks.map((t) => t.pos)];

  // The gun store: a short trip from the start, in town rather than out on the edges.
  const storeAt = shuffle(rng, map.points).find((p) => {
    const d = dist(p, spawn);
    const district = districtAt(map, p)?.district;
    return d > 35 && d < 110 && (district === 'downtown' || district === 'residential') && busy.every((q) => dist(p, q) > 12);
  }) ?? map.points.find((p) => busy.every((q) => dist(p, q) > 12))!;
  const store: Store = { pos: pavement(map, storeAt, 1) ?? pavement(map, storeAt, -1) ?? { ...storeAt }, name: 'Halden Guns' };
  busy.push(store.pos);

  // Supply crates on the pavement beside the street.
  const crates: Crate[] = [];
  for (const p of shuffle(rng, map.points)) {
    if (crates.length >= CRATE_COUNT) break;
    if (busy.some((q) => dist(p, q) < 8) || crates.some((c) => dist(p, c.pos) < 20)) continue;
    const pos = pavement(map, p, chance(rng, 0.5) ? 1 : -1);
    if (!pos) continue;
    const r = next(rng);
    const loot: Loot = r < 0.35 ? 'medkit' : r < 0.65 ? 'supplies' : r < 0.85 ? 'ammo' : 'empty';
    crates.push({ id: crates.length + 1, pos, loot, opened: false });
  }

  // Guns and ammo lying in the street: a shotgun or two, one rifle further out, ammo boxes.
  const kinds: PickupKind[] = ['shotgun', 'shotgun', 'rifle', ...Array<PickupKind>(AMMO_PICKUPS).fill('ammo')];
  const taken = [...busy, ...crates.map((c) => c.pos)];
  const pickups: Pickup[] = [];
  for (const kind of kinds) {
    const minFromStart = kind === 'rifle' ? 70 : kind === 'shotgun' ? 30 : 12;
    const p = shuffle(rng, map.points).find((q) => dist(q, spawn) > minFromStart && taken.every((t) => dist(q, t) > 14));
    if (!p) continue;
    const pos = pavement(map, p, chance(rng, 0.5) ? 1 : -1) ?? { ...p };
    taken.push(pos);
    pickups.push({ id: pickups.length + 1, kind, pos, taken: false });
  }
  return { seed, map, spawn, safehouse, tasks, timeLimit, routeSeconds, vehicles, crates, pickups, store };
}
