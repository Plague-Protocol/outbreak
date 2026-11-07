import { chance, fork, next, pick, range, shuffle } from './rng';
import { cellOf, distanceField, generateMap, PITCH, STREET, UNREACHABLE } from './map';
import { generateChain } from './tasks';
import {
  AMBUSH_CHANCE, AMMO_PICKUPS, BOTTLE_PICKUPS, CRATE_COUNT, GEAR_PICKUPS, HOUSE_COUNT, JERRYCAN_PICKUPS, PLAYER_SPEED, STORE_NAMES,
  SURVIVOR_COUNT, SURVIVOR_NAMES, TASK_HOLD_SECONDS, TIME_PAD, TIME_SLACK, VEHICLE_COUNT, VEHICLES,
} from './config';
import type {
  Crate, House, Loot, MapData, Pickup, PickupKind, Store, Survivor, SurvivorRequest, SurvivorReward, Task, Vec2, Vehicle,
  VehicleKind,
} from './types';

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
  stores: Store[];
  houses: House[];
  survivors: Survivor[];
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
    .filter((p) => dist(p, spawn) > 4)
    .sort((a, b) => dist(a, spawn) - dist(b, spawn))[0];
  const chosen = nearStart ? [nearStart] : [];
  for (const p of spots) {
    if (chosen.length >= VEHICLE_COUNT) break;
    if (chosen.every((q) => dist(p, q) > 14)) chosen.push(p);
  }
  const vehicles: Vehicle[] = chosen.map((p, i) => {
    const r = next(rng);
    const kind: VehicleKind = r < 0.5 ? 'sedan' : r < 0.8 ? 'pickup' : 'van';
    return { id: i + 1, kind, pos: { x: p.x, y: p.y }, heading: p.heading, speed: 0, health: VEHICLES[kind].health, wrecked: false, tone: next(rng), fuel: 0 };
  });

  const busy = [spawn, safehouse, ...tasks.map((t) => t.pos)];

  // Weapon stores: buildings placed with the city, each entered from its door on the street.
  const stores: Store[] = map.storefronts.map((f, k) => ({ id: k + 1, name: STORE_NAMES[k % STORE_NAMES.length]!, pos: { ...f.door }, front: f }));
  busy.push(...stores.map((st) => st.pos));

  // Supply crates on the pavement beside the street.
  const crates: Crate[] = [];
  for (const p of shuffle(rng, map.points)) {
    if (crates.length >= CRATE_COUNT) break;
    if (busy.some((q) => dist(p, q) < 8) || crates.some((c) => dist(p, c.pos) < 20)) continue;
    const pos = pavement(map, p, chance(rng, 0.5) ? 1 : -1);
    if (!pos) continue;
    const r = next(rng);
    const loot: Loot = r < 0.3 ? 'medkit' : r < 0.55 ? 'supplies' : r < 0.75 ? 'ammo' : r < 0.88 ? 'bottles' : 'empty';
    crates.push({ id: crates.length + 1, pos, loot, opened: false });
  }

  // Weapons and ammo lying in the street: bats and a machete, a shotgun or two, one rifle
  // further out, ammo boxes.
  const kinds: PickupKind[] = [
    'bat', 'bat', 'machete', 'shotgun', 'shotgun', 'rifle', ...Array<PickupKind>(AMMO_PICKUPS).fill('ammo'),
    ...Array<PickupKind>(BOTTLE_PICKUPS).fill('bottles'), ...Array<PickupKind>(JERRYCAN_PICKUPS).fill('jerrycan'),
    ...Array.from({ length: GEAR_PICKUPS }, (): PickupKind => (chance(rng, 0.5) ? 'vest' : 'helmet')),
  ];
  const taken = [...busy, ...crates.map((c) => c.pos)];
  const pickups: Pickup[] = [];
  for (const kind of kinds) {
    const minFromStart = kind === 'rifle' ? 70 : kind === 'shotgun' || kind === 'machete' || kind === 'vest' || kind === 'helmet' ? 30 : 12;
    const p = shuffle(rng, map.points).find((q) => dist(q, spawn) > minFromStart && taken.every((t) => dist(q, t) > 14));
    if (!p) continue;
    const pos = pavement(map, p, chance(rng, 0.5) ? 1 : -1) ?? { ...p };
    taken.push(pos);
    pickups.push({ id: pickups.length + 1, kind, pos, taken: false });
  }
  // Fuel: most cars have some left in the tank, rarely much; the one by the start has enough to matter.
  const frng = fork(seed, 'fuel');
  vehicles.forEach((v, i) => { v.fuel = i === 0 ? range(frng, 0.45, 0.7) : range(frng, 0.15, 0.85); });

  // Searchable houses: the front door of a house, on the street side, reachable from the start.
  const hrng = fork(seed, 'houses');
  const doors: Vec2[] = [];
  for (const b of shuffle(hrng, map.buildings.filter((o) => o.kind === 'house'))) {
    const door = { x: b.x + b.w / 2, y: b.y + b.h + 1.2 };
    if (map.blocked[cellOf(map, door)] === 1 || (field[cellOf(map, door)] as number) === UNREACHABLE) continue;
    if ([...busy, ...doors].some((q) => dist(q, door) < 12)) continue;
    doors.push(door);
  }
  const houses: House[] = doors.slice(0, HOUSE_COUNT).map((pos, i) => {
    const r = next(hrng);
    // now and then someone left their protective gear behind
    const loot: Loot = r < 0.23 ? 'medkit' : r < 0.46 ? 'supplies' : r < 0.69 ? 'ammo' : r < 0.84 ? 'bottles' : r < 0.9 ? (r < 0.87 ? 'helmet' : 'vest') : 'empty';
    return { id: i + 1, pos, loot, ambush: chance(hrng, AMBUSH_CHANCE), searched: false };
  });

  // Survivors: holed up on the pavement well apart, each with something they need.
  const srng = fork(seed, 'survivors');
  const survivors: Survivor[] = [];
  const names = shuffle(srng, [...SURVIVOR_NAMES]);
  const taken2 = [...taken, ...doors];
  for (const p of shuffle(srng, map.points)) {
    if (survivors.length >= SURVIVOR_COUNT) break;
    if (dist(p, spawn) < 40 || taken2.some((q) => dist(p, q) < 10) || survivors.some((v) => dist(v.pos, p) < 60)) continue;
    const pos = pavement(map, p, chance(srng, 0.5) ? 1 : -1);
    if (!pos) continue;
    const request: SurvivorRequest = survivors.length === 0 ? 'fetch' : pick(srng, ['clear', 'fetch'] as const);
    const reward: SurvivorReward = pick(srng, ['funds', 'ammo', 'weapon', 'intel'] as const);
    // what they need lies 25-60 units away, on the pavement
    const far = shuffle(srng, map.points).find((q) => { const d = dist(q, pos); return d > 25 && d < 60 && taken2.every((t) => dist(q, t) > 6); }) ?? p;
    const fetchPos = pavement(map, far, 1) ?? pavement(map, far, -1) ?? { ...far };
    survivors.push({ id: survivors.length + 1, name: names[survivors.length]!, pos, request, reward, status: 'waiting', fetchPos, carrying: false, targets: [], skin: survivors.length % 2 });
    taken2.push(pos, fetchPos);
  }

  return { seed, map, spawn, safehouse, tasks, timeLimit, routeSeconds, vehicles, crates, pickups, stores, houses, survivors };
}
