import { describe, expect, it } from 'vitest';
import { buy, createGame, interactionFor, isBusy, playerVehicle, step, type GameState } from '../src/core/state';
import { cellOf, reachable } from '../src/core/map';
import {
  ALARM_SECONDS, BOTTLE_FLIGHT, CLEAR_COUNT, JERRYCAN_FUEL, PILEUPS, REFUEL_SECONDS, SEARCH_SECONDS, START_BOTTLES,
  SURVIVOR_COUNT, TALK_SECONDS, ZOMBIE_HEALTH,
} from '../src/core/config';
import type { Input, Vec2, Zombie } from '../src/core/types';

const IDLE: Input = { dx: 0, dy: 0 };
const USE: Input = { dx: 0, dy: 0, action: true };
const DT = 1 / 30;
const run = (g: GameState, seconds: number, input: Input = IDLE) => { for (let i = 0; i < Math.ceil(seconds / DT); i++) step(g, input, DT); };

function calm(seed: number): GameState {
  const g = createGame(seed);
  g.zombies = [];
  g.remaining = g.timeLimit = 9999;
  return g;
}

function walker(id: number, pos: Vec2): Zombie {
  return { id, kind: 'walker', pos: { ...pos }, heading: 0, speed: 0, action: 'idle', actionT: 0, cooldown: 0, health: ZOMBIE_HEALTH.walker, staggerT: 0, alertT: 0, wanderT: 99, wanderDir: { x: 0, y: 0 } };
}

/** A street point with open space all around. */
function openSpot(g: GameState, r = 6): Vec2 {
  return g.map.points.find((p) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (g.map.blocked[cellOf(g.map, { x: p.x + dx, y: p.y + dy })] === 1) return false;
    return true;
  })!;
}

describe('the abandoned city', () => {
  it('has pile-ups, a checkpoint, a hospital and a gas station, and every street point is still connected', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = createGame(seed);
      const kinds = g.map.buildings.map((b) => b.kind);
      expect(kinds.filter((k) => k === 'bus').length, `seed ${seed}`).toBe(PILEUPS);
      expect(kinds).toContain('sandbag');
      expect(kinds).toContain('truck');
      expect(kinds).toContain('hospital');
      expect(kinds).toContain('pump');
      expect(g.map.labels.map((l) => l.name)).toContain('Checkpoint');
      const from = g.map.points[0]!;
      for (const p of g.map.points.filter((_, i) => i % 7 === 0)) expect(reachable(g.map, from, p)).toBe(true);
    }
  });
});

describe('distractions', () => {
  it('a thrown bottle draws zombies near where it lands, away from you', () => {
    const g = calm(50);
    const p = openSpot(g, 8);
    g.player.pos = { ...p };
    g.player.heading = 0;
    const z = walker(1, { x: p.x + 11 + 6, y: p.y }); // near the landing spot
    z.alertT = 5; // it was hunting you
    g.zombies = [z];
    expect(g.arsenal.bottles).toBe(START_BOTTLES);
    step(g, { dx: 0, dy: 0, throw: true }, DT);
    expect(g.arsenal.bottles).toBe(START_BOTTLES - 1);
    expect(g.thrown.length).toBe(1);
    let smashed = false;
    for (let i = 0; i < Math.ceil(BOTTLE_FLIGHT / DT) + 2; i++) { step(g, IDLE, DT); smashed ||= g.events.some((e) => e.type === 'bottle-smash'); }
    expect(smashed).toBe(true);
    expect(z.lureT).toBeGreaterThan(0);
    const to = z.lure!;
    const d0 = Math.hypot(z.pos.x - to.x, z.pos.y - to.y);
    run(g, 1.5);
    expect(Math.hypot(z.pos.x - to.x, z.pos.y - to.y)).toBeLessThan(d0);
  });

  it('a parked car alarm sets off once, draws them for a while, then stops', () => {
    const g = calm(51);
    const idx = g.map.buildings.findIndex((b) => b.kind === 'car');
    expect(idx).toBeGreaterThanOrEqual(0);
    const car = g.map.buildings[idx]!;
    g.player.pos = { x: car.x - 0.9, y: car.y + car.h / 2 };
    expect(interactionFor(g)).toEqual({ kind: 'alarm', car: idx });
    const z = walker(2, { x: car.x + 20, y: car.y });
    g.zombies = [z];
    step(g, USE, DT);
    expect(g.alarms.length).toBe(1);
    expect(z.lure).toBeTruthy();
    expect(interactionFor(g)?.kind).not.toBe('alarm'); // only once
    run(g, ALARM_SECONDS + 0.5);
    expect(g.alarms.length).toBe(0);
  });

  it('gunfire right next to a parked car sets its alarm off', () => {
    const g = calm(52);
    const idx = g.map.buildings.findIndex((b) => b.kind === 'car');
    const car = g.map.buildings[idx]!;
    g.player.pos = { x: car.x - 1.2, y: car.y + car.h / 2 };
    step(g, { dx: 0, dy: 0, fire: true }, DT);
    expect(g.alarmUsed).toContain(idx);
  });
});

describe('searching houses', () => {
  it('takes a couple of seconds standing still, keeps them back, and gives the loot', () => {
    const g = calm(53);
    const h = g.houses[0]!;
    expect(g.houses.length).toBeGreaterThan(5);
    h.loot = 'supplies';
    h.ambush = false;
    g.player.pos = { ...h.pos };
    expect(interactionFor(g)).toEqual({ kind: 'house', houseId: h.id });
    const funds = g.funds;
    step(g, USE, DT);
    expect(isBusy(g)).toBe(true);
    run(g, SEARCH_SECONDS + 0.2);
    expect(h.searched).toBe(true);
    expect(g.funds).toBe(funds + 25);
    expect(interactionFor(g)?.kind).not.toBe('house');
  });

  it('sometimes one of them was inside', () => {
    const g = calm(54);
    const h = g.houses[0]!;
    h.ambush = true;
    g.player.pos = { ...h.pos };
    step(g, USE, DT);
    run(g, SEARCH_SECONDS + 0.2);
    expect(g.zombies.length).toBe(1);
    expect(g.zombies[0]!.action).not.toBe('dead');
  });

  it('walking away calls the search off', () => {
    const g = calm(55);
    const h = g.houses[0]!;
    g.player.pos = { ...h.pos };
    step(g, USE, DT);
    g.player.pos = { x: h.pos.x + 8, y: h.pos.y };
    step(g, IDLE, DT);
    expect(g.work).toBeNull();
    expect(h.searched).toBe(false);
  });
});

describe('survivors', () => {
  it('every night has survivors, each with a request', () => {
    for (const seed of [1, 2, 3, 4]) expect(createGame(seed).survivors.length).toBe(SURVIVOR_COUNT);
  });

  it('fetch: talk, find their bag, bring it back, get paid', () => {
    const g = calm(56);
    const v = g.survivors.find((x) => x.request === 'fetch')!;
    v.reward = 'funds';
    g.player.pos = { ...v.pos };
    expect(interactionFor(g)).toEqual({ kind: 'talk', survivorId: v.id });
    step(g, USE, DT);
    run(g, TALK_SECONDS + 0.1);
    expect(v.status).toBe('asked');
    g.player.pos = { ...v.fetchPos };
    step(g, IDLE, DT);
    expect(v.carrying).toBe(true);
    g.player.pos = { ...v.pos };
    const funds = g.funds;
    step(g, USE, DT);
    run(g, TALK_SECONDS + 0.1);
    expect(v.status).toBe('done');
    expect(g.funds).toBeGreaterThan(funds);
  });

  it('clear: the ones around them come out; kill them all, then collect', () => {
    const g = calm(57);
    const v = g.survivors[0]!;
    v.request = 'clear';
    v.reward = 'ammo';
    g.player.pos = { ...v.pos };
    step(g, USE, DT);
    run(g, TALK_SECONDS + 0.1);
    expect(v.targets.length).toBeGreaterThan(0);
    expect(v.targets.length).toBeLessThanOrEqual(CLEAR_COUNT);
    for (const z of g.zombies) if (v.targets.includes(z.id)) { z.action = 'dead'; z.actionT = 5; }
    step(g, IDLE, DT);
    expect(v.status).toBe('ready');
    const ammo = g.arsenal.ammo.pistol;
    step(g, USE, DT);
    run(g, TALK_SECONDS + 0.1);
    expect(v.status).toBe('done');
    expect(g.arsenal.ammo.pistol).toBeGreaterThan(ammo);
  });
});

describe('fuel', () => {
  it('driving burns fuel; an empty tank coasts; a jerrycan puts some back', () => {
    const g = calm(58);
    const v = g.vehicles[0]!;
    g.player.vehicleId = v.id;
    v.fuel = 0.002;
    let out = false;
    for (let i = 0; i < 90; i++) { step(g, { dx: Math.cos(v.heading), dy: Math.sin(v.heading) }, DT); out ||= g.events.some((e) => e.type === 'out-of-fuel'); }
    expect(out).toBe(true);
    expect(v.fuel).toBe(0);
    run(g, 3, { dx: Math.cos(v.heading), dy: Math.sin(v.heading) });
    expect(Math.abs(v.speed)).toBeLessThan(0.5); // coasted to a stop, no throttle
    step(g, USE, DT); // get out
    expect(playerVehicle(g)).toBeNull();
    g.arsenal.cans = 1;
    expect(interactionFor(g)).toEqual({ kind: 'refuel', vehicleId: v.id });
    step(g, USE, DT);
    run(g, REFUEL_SECONDS + 0.2);
    expect(v.fuel).toBeCloseTo(JERRYCAN_FUEL, 5);
    expect(g.arsenal.cans).toBe(0);
  });

  it('a store sells bottles and jerrycans', () => {
    const g = calm(59);
    g.funds = 100;
    expect(buy(g, { kind: 'bottles' })).toBe(true);
    expect(g.arsenal.bottles).toBe(START_BOTTLES + 3);
    expect(buy(g, { kind: 'jerrycan' })).toBe(true);
    expect(g.arsenal.cans).toBe(1);
  });
});
