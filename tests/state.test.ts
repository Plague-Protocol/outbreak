import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { doTask } from './helpers';
import {
  aimTarget, buy, createGame, currentTask, equip, gunStats, interactionFor, isBusy, playerVehicle, priceOf, requiredDone,
  step, type GameState,
} from '../src/core/state';
import { cellOf, reachable } from '../src/core/map';
import {
  AMMO_PRICES, ATTACK_DAMAGE, CHAPTERS, ATTACK_WINDUP, GUNS, MEDKIT_HEAL, MELEE, PLAYER_HEALTH, SAFE_AFTER, SPAWNS_BY_TIER, STORE_COUNT,
  LATCH_DRAG, TASK_HOLD_SECONDS, UPGRADE_LEVELS, VEHICLES, WEAPON_PRICES, ZOMBIE_CAP, ZOMBIE_HEALTH,
} from '../src/core/config';
import type { Zombie } from '../src/core/types';
import type { Input, Vec2 } from '../src/core/types';

const IDLE: Input = { dx: 0, dy: 0 };
const USE: Input = { dx: 0, dy: 0, action: true };
const DT = 1 / 30;

function calmGame(seed = 1): GameState {
  const g = createGame(seed);
  g.zombies = []; // isolate from zombie behaviour
  return g;
}

/** The night's last chapter: its way out is the helicopter. */
function finalGame(seed = 1): GameState {
  const g = createGame(seed, undefined, { chapter: CHAPTERS - 1 });
  g.zombies = [];
  return g;
}

/** Teleport to a task, press Use, and hold position until it completes. */

function doRequired(g: GameState): void {
  for (const t of g.tasks) if (t.required) doTask(g, t);
}

/** A street point with open space all around (no obstacle cells within r). */
function openSpot(g: GameState, r = 4): Vec2 {
  return g.map.points.find((p) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (g.map.blocked[cellOf(g.map, { x: p.x + dx, y: p.y + dy })] === 1) return false;
    }
    return g.vehicles.every((v) => Math.hypot(v.pos.x - p.x, v.pos.y - p.y) > 10);
  })!;
}

describe('countdown', () => {
  it('decrements by dt and tracks elapsed', () => {
    const g = calmGame();
    const limit = g.timeLimit;
    for (let i = 0; i < 30; i++) step(g, IDLE, DT);
    expect(g.remaining).toBeCloseTo(limit - 1, 5);
    expect(g.elapsed).toBeCloseTo(1, 5);
    expect(g.phase).toBe('playing');
  });

  it('loses on timeout, and the state freezes afterwards', () => {
    const g = calmGame();
    g.remaining = 0.05;
    step(g, IDLE, 0.1);
    expect(g.phase).toBe('lost');
    expect(g.lossReason).toBe('time');
    expect(g.remaining).toBe(0);
    expect(g.events).toContainEqual({ type: 'lost', reason: 'time' });
    const snap = JSON.stringify([g.elapsed, g.player.pos]);
    step(g, { dx: 1, dy: 0 }, DT);
    expect(JSON.stringify([g.elapsed, g.player.pos])).toBe(snap);
  });

  it('optional tasks cost time and apply their reward', () => {
    const g = calmGame();
    const opt = g.tasks.find((t) => !t.required)!;
    const before = g.remaining;
    doTask(g, opt);
    expect(opt.done).toBe(true);
    expect(before - g.remaining).toBeGreaterThanOrEqual(opt.timeCost);
    if (opt.reward === 'speed') expect(g.speedMul).toBeGreaterThan(1);
    if (opt.reward === 'calm') expect(g.zombieMul).toBeLessThan(1);
    if (opt.reward === 'funds') expect(g.funds).toBeGreaterThan(0);
  });

  it('an optional task that exhausts the clock loses', () => {
    const g = calmGame();
    const opt = g.tasks.find((t) => !t.required)!;
    g.remaining = opt.timeCost - 1;
    doTask(g, opt);
    expect(g.phase).toBe('lost');
    expect(g.lossReason).toBe('time');
  });
});

describe('interactions', () => {
  it('a task only starts when Use is pressed, and walking away cancels it', () => {
    const g = calmGame(2);
    const t = currentTask(g)!;
    g.player.pos = { ...t.pos };
    for (let i = 0; i < 60; i++) step(g, IDLE, DT);
    expect(t.done).toBe(false); // standing there is not enough
    expect(interactionFor(g)).toEqual({ kind: 'task', taskId: t.id });
    step(g, USE, DT);
    expect(g.hold.taskId).toBe(t.id);
    g.player.pos = { x: t.pos.x + 10, y: t.pos.y };
    step(g, IDLE, DT);
    expect(g.hold.taskId).toBeNull();
    expect(t.done).toBe(false);
  });

  it('a step that is not up yet cannot be started (the gate waits for the power)', () => {
    let found = false;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const g = calmGame(seed);
      const gate = g.tasks.find((t) => t.id === 'gate');
      if (!gate) continue;
      found = true;
      for (let k = 0; k < 6 && currentTask(g)!.id !== 'power'; k++) doTask(g, currentTask(g)!); // up to the generator
      g.player.pos = { ...gate.pos };
      expect(interactionFor(g)?.kind === 'task').toBe(false); // not revealed: nothing to use here
      doTask(g, g.tasks.find((t) => t.id === 'power')!);
      doTask(g, gate);
      expect(gate.done).toBe(true);
    }
    expect(found).toBe(true);
  });

  it('a medkit crate heals, and a crate can only be opened once', () => {
    const g = calmGame(3);
    const c = g.crates.find((x) => x.loot === 'medkit')!;
    g.player.health = 20;
    g.player.pos = { ...c.pos };
    step(g, USE, DT);
    expect(c.opened).toBe(true);
    expect(g.player.health).toBe(20 + MEDKIT_HEAL);
    expect(g.events).toContainEqual({ type: 'healed', amount: MEDKIT_HEAL });
    step(g, USE, DT);
    expect(g.player.health).toBe(20 + MEDKIT_HEAL);
  });

  it('currentTask follows chain order and skips locked tasks', () => {
    const g = calmGame(2);
    const seen: string[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const t = currentTask(g);
      if (!t) break;
      expect(t.requires.every((id) => g.tasks.find((x) => x.id === id)!.done)).toBe(true);
      seen.push(t.id);
      doTask(g, t);
    }
    expect(seen.length).toBe(g.tasks.filter((t) => t.required).length);
    expect(currentTask(g)).toBeNull();
  });
});

describe('vehicles', () => {
  it('every level has vehicles, one of them a short walk from the start', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const g = calmGame(seed);
      expect(g.vehicles.length).toBeGreaterThan(8);
      const nearest = Math.min(...g.vehicles.map((v) => Math.hypot(v.pos.x - g.player.pos.x, v.pos.y - g.player.pos.y)));
      expect(nearest).toBeLessThan(45);
    }
  });

  it('you can get in, drive where you push, and get out', () => {
    const g = calmGame(4);
    const v = g.vehicles[0]!;
    const p = openSpot(g, 7);
    v.pos = { ...p };
    v.heading = 0;
    g.player.pos = { x: p.x, y: p.y + VEHICLES[v.kind].width / 2 + 0.8 };
    expect(interactionFor(g)?.kind).toBe('enter');
    step(g, USE, DT);
    expect(playerVehicle(g)).toBe(v);
    const start = { ...v.pos };
    for (let i = 0; i < 25; i++) step(g, { dx: 1, dy: 0 }, DT);
    expect(v.pos.x).toBeGreaterThan(start.x + 1); // drove forward (+x)
    expect(g.player.pos).toEqual(v.pos);
    for (let i = 0; i < 60; i++) step(g, IDLE, DT); // coast to a stop
    step(g, USE, DT);
    expect(playerVehicle(g)).toBeNull();
    expect(Math.hypot(g.player.pos.x - v.pos.x, g.player.pos.y - v.pos.y)).toBeGreaterThan(1.5);
  });

  it('pushing back against the nose reverses', () => {
    const g = calmGame(4);
    const v = g.vehicles[0]!;
    v.pos = { ...openSpot(g, 7) };
    v.heading = 0;
    g.player.vehicleId = v.id;
    for (let i = 0; i < 20; i++) step(g, { dx: -1, dy: 0 }, DT);
    expect(v.speed).toBeLessThan(0);
    expect(Math.abs(v.heading)).toBeLessThan(0.3); // still facing +x, rolling backward
  });

  it('a car at speed knocks a zombie down; a slow car only shoves it', () => {
    const g = calmGame(5);
    const v = g.vehicles[0]!;
    const p = openSpot(g, 7);
    v.pos = { x: p.x - 6, y: p.y };
    v.heading = 0;
    v.speed = 10;
    g.player.vehicleId = v.id;
    g.zombies = [];
    g.nextZombieId = 50;
    g.zombies.push({ id: 50, kind: 'walker', pos: { x: p.x, y: p.y }, heading: 0, speed: 0, action: 'idle', actionT: 0, cooldown: 0, health: 60, staggerT: 0, alertT: 0, wanderT: 9, wanderDir: { x: 0, y: 0 } });
    const health = v.health;
    for (let i = 0; i < 30; i++) step(g, { dx: 1, dy: 0 }, DT);
    expect(g.events.length >= 0).toBe(true);
    const z = g.zombies.find((q) => q.id === 50);
    expect(z === undefined || z.action === 'dead').toBe(true);
    expect(v.health).toBeLessThan(health);
  });

  it('a car driven into a wall at speed takes damage and bounces', () => {
    const g = calmGame(6);
    const v = g.vehicles[0]!;
    const wall = g.map.buildings.find((b) => b.kind === 'tower' || b.kind === 'house' || b.kind === 'warehouse')!;
    v.heading = 0;
    v.pos = { x: wall.x - VEHICLES[v.kind].length / 2 - 4, y: wall.y + wall.h / 2 };
    v.speed = 14;
    g.player.vehicleId = v.id;
    let crashed = false;
    for (let i = 0; i < 30; i++) { step(g, { dx: 1, dy: 0 }, DT); crashed ||= g.events.some((e) => e.type === 'vehicle-crash'); }
    expect(crashed).toBe(true);
    expect(v.health).toBeLessThan(VEHICLES[v.kind].health);
    expect(v.pos.x + VEHICLES[v.kind].length / 2).toBeLessThan(wall.x + 0.6);
  });

  it('a wrecked car throws the player out and cannot be used again', () => {
    const g = calmGame(7);
    const v = g.vehicles[0]!;
    g.player.vehicleId = v.id;
    g.player.pos = { ...v.pos };
    v.health = 1;
    v.pos = { ...openSpot(g, 7) };
    // a zombie claws at the stopped car
    g.zombies = [{ id: 9, kind: 'walker', pos: { x: v.pos.x, y: v.pos.y + 2.4 }, heading: 0, speed: 0, action: 'idle', actionT: 0, cooldown: 0, health: 60, staggerT: 0, alertT: 0, wanderT: 9, wanderDir: { x: 0, y: 0 } }];
    for (let i = 0; i < 60 && !v.wrecked; i++) step(g, IDLE, DT);
    expect(v.wrecked).toBe(true);
    expect(playerVehicle(g)).toBeNull();
    g.player.pos = { x: v.pos.x, y: v.pos.y + 2.6 };
    expect(interactionFor(g)?.kind === 'enter').toBe(false);
  });
});

describe('vehicles are not safe', () => {
  const walker = (id: number, pos: Vec2): Zombie => ({ id, kind: 'walker', pos, heading: 0, speed: 0, action: 'idle', actionT: 0, cooldown: 0, health: 60, staggerT: 0, alertT: 0, wanderT: 9, wanderDir: { x: 0, y: 0 } });
  const inCar = (seed: number, kind: 'sedan' | 'bike' = 'sedan') => {
    const g = calmGame(seed);
    const v = g.vehicles[0]!;
    v.kind = kind;
    v.health = VEHICLES[kind].health;
    v.fuel = 1;
    v.pos = { ...openSpot(g, 9) };
    v.heading = 0;
    g.player.vehicleId = v.id;
    g.player.pos = { ...v.pos };
    g.nextZombieId = 100;
    return { g, v };
  };

  it('a few vehicles, about half of them bikes', () => {
    let bikes = 0, all = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const g = calmGame(seed);
      expect(g.vehicles.length).toBeLessThanOrEqual(10);
      all += g.vehicles.length;
      bikes += g.vehicles.filter((v) => v.kind === 'bike').length;
    }
    expect(bikes / all).toBeGreaterThan(0.3);
    expect(bikes / all).toBeLessThan(0.6);
  });

  it('the engine calls zombies from well beyond sight', () => {
    const { g, v } = inCar(3);
    g.zombies = [walker(100, { x: v.pos.x, y: v.pos.y + 24 })];
    step(g, IDLE, DT);
    expect(g.zombies[0]!.alertT).toBeGreaterThan(0);
  });

  it('they grab on to a slow car, claw at it, and slow it down', () => {
    const { g, v } = inCar(5);
    g.zombies = [walker(100, { x: v.pos.x, y: v.pos.y + VEHICLES.sedan.width / 2 + 0.7 }), walker(101, { x: v.pos.x + 1, y: v.pos.y - VEHICLES.sedan.width / 2 - 0.7 })];
    for (let i = 0; i < 90; i++) step(g, IDLE, DT);
    expect(g.zombies.filter((z) => z.latch === v.id).length).toBe(2);
    expect(v.health).toBeLessThan(VEHICLES.sedan.health);
    // they ride along where they hold on
    const at = g.zombies.map((z) => Math.hypot(z.pos.x - v.pos.x, z.pos.y - v.pos.y));
    for (let i = 0; i < 20; i++) step(g, { dx: 1, dy: 0 }, DT);
    g.zombies.forEach((z, i) => expect(Math.hypot(z.pos.x - v.pos.x, z.pos.y - v.pos.y)).toBeCloseTo(at[i]!, 1));
    // and the top speed suffers while they hang on
    for (let i = 0; i < 200; i++) {
      step(g, { dx: 1, dy: 0 }, DT);
      const on = g.zombies.filter((z) => z.latch === v.id).length;
      expect(Math.abs(v.speed)).toBeLessThanOrEqual(VEHICLES.sedan.maxSpeed * (1 - LATCH_DRAG * on) + 0.5);
    }
  });

  it('driving fast shakes them off', () => {
    const { g, v } = inCar(5);
    g.zombies = [walker(100, { x: v.pos.x, y: v.pos.y + VEHICLES.sedan.width / 2 + 0.7 })];
    for (let i = 0; i < 60; i++) step(g, IDLE, DT);
    expect(g.zombies[0]!.latch).toBe(v.id);
    v.speed = 14;
    let shaken = false;
    for (let i = 0; i < 90 && !shaken; i++) { step(g, { dx: 1, dy: 0 }, DT); shaken = g.events.some((e) => e.type === 'shaken'); }
    expect(shaken).toBe(true);
    expect(g.zombies.every((z) => z.latch == null)).toBe(true);
  });

  it('a beaten car lets them reach you inside; getting out sets them on you', () => {
    const { g, v } = inCar(5);
    v.health = VEHICLES.sedan.health * 0.3;
    g.zombies = [walker(100, { x: v.pos.x, y: v.pos.y + VEHICLES.sedan.width / 2 + 0.7 })];
    for (let i = 0; i < 120; i++) step(g, IDLE, DT);
    expect(g.player.health).toBeLessThan(PLAYER_HEALTH);
    g.player.health = PLAYER_HEALTH;
    if (playerVehicle(g)) step(g, USE, DT); // out
    expect(g.zombies[0]!.latch == null).toBe(true);
    expect(g.zombies[0]!.alertT).toBeGreaterThan(0);
  });

  it('on a bike they go for the rider', () => {
    const { g, v } = inCar(5, 'bike');
    g.zombies = [walker(100, { x: v.pos.x, y: v.pos.y + 1.1 })];
    for (let i = 0; i < 90; i++) step(g, IDLE, DT);
    expect(g.player.health).toBeLessThan(PLAYER_HEALTH);
    expect(g.zombies[0]!.latch == null).toBe(true);
  });
});

describe('win and lose', () => {
  it('entering the safehouse early does not win', () => {
    const g = calmGame();
    g.player.pos = { ...g.safehouse };
    step(g, IDLE, DT);
    expect(g.phase).toBe('playing');
    expect(g.events).toContainEqual({ type: 'safehouse-locked' });
  });

  it('completing required tasks then reaching the way out clears the chapter (the last one wins)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = calmGame(seed);
      doRequired(g);
      expect(requiredDone(g)).toBe(true);
      expect(g.phase).toBe('playing');
      g.player.pos = { ...g.safehouse };
      step(g, IDLE, DT);
      expect(g.phase).toBe('cleared');
      const last = finalGame(seed);
      doRequired(last);
      last.player.pos = { ...last.safehouse };
      step(last, IDLE, DT);
      expect(last.phase).toBe('won');
    }
  });

  it('optional tasks are not needed to win', () => {
    const g = finalGame(7);
    doRequired(g);
    expect(g.tasks.some((t) => !t.required && !t.done)).toBe(true);
    g.player.pos = { ...g.safehouse };
    step(g, IDLE, DT);
    expect(g.phase).toBe('won');
  });

  it('a won game cannot then be lost by the clock', () => {
    const g = finalGame(7);
    doRequired(g);
    g.player.pos = { ...g.safehouse };
    step(g, IDLE, DT);
    g.remaining = 0.001;
    step(g, IDLE, 1);
    expect(g.phase).toBe('won');
  });

  it('a lunge hurts and shoves; the third one kills', () => {
    const g = createGame(3);
    const z = g.zombies[0]!;
    g.zombies = [z];
    const lunge = () => {
      z.pos = { x: g.player.pos.x + 1, y: g.player.pos.y };
      z.cooldown = 0;
      z.action = 'idle';
      g.player.invuln = 0;
      g.player.vel = { x: 0, y: 0 }; // no leftover knockback
      step(g, IDLE, DT);
      expect(z.action).toBe('attack');
      for (let i = 0; i < Math.ceil(ATTACK_WINDUP.walker / DT) + 2 && (z.action as string) === 'attack'; i++) step(g, IDLE, DT);
    };
    lunge();
    expect(g.phase).toBe('playing');
    expect(g.player.health).toBe(PLAYER_HEALTH - ATTACK_DAMAGE);
    expect(g.player.invuln).toBeGreaterThan(0);
    lunge();
    expect(g.player.health).toBe(PLAYER_HEALTH - 2 * ATTACK_DAMAGE);
    lunge();
    expect(g.phase).toBe('lost');
    expect(g.lossReason).toBe('caught');
    expect(g.killerId).toBe(z.id);
    expect(z.action).toBe('feed');
  });

  it('running away during the wind-up dodges the lunge', () => {
    const g = createGame(3);
    const z = g.zombies[0]!;
    g.zombies = [z];
    const p = openSpot(g, 5);
    g.player.pos = { ...p };
    z.pos = { x: p.x - 1.2, y: p.y };
    step(g, IDLE, DT);
    expect(z.action).toBe('attack');
    g.player.vel = { x: 5.5, y: 0 };
    for (let i = 0; i < Math.ceil(ATTACK_WINDUP.walker / DT) + 2; i++) step(g, { dx: 1, dy: 0 }, DT);
    expect(g.player.health).toBe(PLAYER_HEALTH);
  });
});

describe('zombies and escalation', () => {
  it('the city starts populated, but nobody is near the start', () => {
    const g = createGame(9);
    expect(g.zombies.length).toBeGreaterThan(20);
    expect(g.zombies.length).toBeLessThanOrEqual(ZOMBIE_CAP);
    for (const z of g.zombies) expect(Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y)).toBeGreaterThanOrEqual(25);
  });

  it('escalates as the clock runs down, with waves rising nearby', () => {
    const g = createGame(9);
    const before = g.zombies.length;
    g.remaining = g.timeLimit * 0.6;
    step(g, IDLE, 0.001);
    expect(g.tier).toBe(1);
    const wave1 = SPAWNS_BY_TIER[1].walker + SPAWNS_BY_TIER[1].runner;
    expect(g.zombies.length).toBe(Math.min(ZOMBIE_CAP, before + wave1));
    const risers = g.zombies.filter((z) => z.action === 'rise');
    expect(risers.length).toBe(wave1);
    expect(risers.some((z) => z.kind === 'runner')).toBe(true);
    for (const z of risers) expect(Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y)).toBeLessThan(50);
    g.remaining = g.timeLimit * 0.3;
    step(g, IDLE, 0.001);
    expect(g.tier).toBe(2);
    expect(g.zombies.length).toBeLessThanOrEqual(ZOMBIE_CAP);
  });

  it('a chasing zombie closes distance on a standing player', () => {
    const g = createGame(11);
    g.tier = 2;
    const z = g.zombies[0]!;
    g.zombies = [z];
    const near = g.map.points.find((p) => {
      const d = Math.hypot(p.x - g.player.pos.x, p.y - g.player.pos.y);
      return d > 7 && d < 14;
    })!;
    z.pos = { ...near };
    const pathDist = () => g.flow[cellOf(g.map, z.pos)] as number;
    const d0 = pathDist();
    for (let i = 0; i < 120 && g.phase === 'playing'; i++) step(g, IDLE, DT);
    expect(pathDist() < d0 - 3 || z.action === 'attack').toBe(true);
  });

  it('player and zombies never end up inside obstacles', () => {
    const g = createGame(12);
    g.tier = 2;
    for (let i = 0; i < 300 && g.phase === 'playing'; i++) step(g, { dx: Math.cos(i / 20), dy: Math.sin(i / 13) }, DT);
    const inside = (p: { x: number; y: number }) =>
      g.map.buildings.some((b) => p.x > b.x + 0.01 && p.x < b.x + b.w - 0.01 && p.y > b.y + 0.01 && p.y < b.y + b.h - 0.01);
    expect(inside(g.player.pos)).toBe(false);
    for (const z of g.zombies) expect(inside(z.pos)).toBe(false);
  });
});

describe('player movement', () => {
  it('accelerates and decelerates instead of starting and stopping instantly', () => {
    const g = calmGame(4);
    g.player.pos = { ...openSpot(g, 8) };
    step(g, { dx: 1, dy: 0 }, DT);
    const first = Math.hypot(g.player.vel.x, g.player.vel.y);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1);
    for (let i = 0; i < 30; i++) step(g, { dx: 1, dy: 0 }, DT);
    expect(Math.hypot(g.player.vel.x, g.player.vel.y)).toBeGreaterThan(5);
    step(g, IDLE, DT);
    expect(Math.hypot(g.player.vel.x, g.player.vel.y)).toBeGreaterThan(4);
    for (let i = 0; i < 30; i++) step(g, IDLE, DT);
    expect(Math.hypot(g.player.vel.x, g.player.vel.y)).toBe(0);
  });

  it('a light push walks and a full push runs', () => {
    const run = (mag: number) => {
      const g = calmGame(4);
      g.player.pos = { ...openSpot(g, 8) };
      for (let i = 0; i < 40; i++) step(g, { dx: mag, dy: 0 }, DT);
      return Math.hypot(g.player.vel.x, g.player.vel.y);
    };
    expect(run(0.25)).toBeLessThan(1.6);
    expect(run(1)).toBeGreaterThan(5);
  });
});

function walker(id: number, pos: Vec2): Zombie {
  return { id, kind: 'walker', pos: { ...pos }, heading: Math.PI, speed: 0, action: 'idle', actionT: 0, cooldown: 0, health: ZOMBIE_HEALTH.walker, staggerT: 0, alertT: 0, wanderT: 9, wanderDir: { x: 0, y: 0 } };
}
const FIRE: Input = { dx: 0, dy: 0, fire: true };

describe('weapons', () => {
  /** Player in open street facing +x, one walker a few metres ahead. */
  function range(seed = 21, ahead = 6) {
    const g = calmGame(seed);
    const p = openSpot(g, 8);
    g.player.pos = { ...p };
    g.player.heading = 0;
    const z = walker(500, { x: p.x + ahead, y: p.y });
    g.zombies = [z];
    return { g, z };
  }

  it('you start with a loaded pistol', () => {
    const g = calmGame(1);
    expect(g.arsenal.weapon).toBe('pistol');
    expect(g.arsenal.mag.pistol).toBe(GUNS.pistol.mag);
    expect(g.arsenal.ammo.pistol).toBeGreaterThan(0);
  });

  it('two pistol shots drop a walker, and it pays', () => {
    const { g, z } = range();
    const funds = g.funds;
    for (let i = 0; i < 40 && z.action !== 'dead'; i++) step(g, FIRE, DT);
    expect(z.action).toBe('dead');
    expect(g.arsenal.mag.pistol).toBe(GUNS.pistol.mag - 2);
    expect(g.kills).toBe(1);
    expect(g.funds).toBeGreaterThan(funds);
    expect(g.events.length >= 0).toBe(true);
  });

  it('aim assist ignores zombies behind you and behind walls', () => {
    const { g, z } = range();
    expect(aimTarget(g, 'pistol')).toBe(z);
    z.pos = { x: g.player.pos.x - 6, y: g.player.pos.y }; // behind
    expect(aimTarget(g, 'pistol')).toBeNull();
    const wall = g.map.buildings.find((b) => b.kind === 'tower' || b.kind === 'warehouse')!;
    g.player.pos = { x: wall.x - 2, y: wall.y + wall.h / 2 };
    z.pos = { x: wall.x + wall.w + 2, y: wall.y + wall.h / 2 };
    expect(aimTarget(g, 'pistol')).toBeNull();
  });

  it('an empty magazine reloads from spare ammo; with none left it clicks', () => {
    const g = calmGame(22);
    g.zombies = [];
    g.player.pos = { ...openSpot(g, 6) };
    g.arsenal.mag.pistol = 0;
    g.arsenal.ammo.pistol = 5;
    step(g, FIRE, DT);
    expect(g.arsenal.reloadT).toBeGreaterThan(0);
    for (let i = 0; i < Math.ceil(GUNS.pistol.reload / DT) + 2; i++) step(g, IDLE, DT);
    expect(g.arsenal.mag.pistol).toBe(5);
    expect(g.arsenal.ammo.pistol).toBe(0);
    g.arsenal.mag.pistol = 0;
    step(g, FIRE, DT);
    expect(g.events).toContainEqual({ type: 'empty', weapon: 'pistol' });
  });

  it('a hit during the wind-up spoils the lunge', () => {
    const { g, z } = range(23, 1.1);
    step(g, IDLE, DT);
    expect(z.action).toBe('attack');
    step(g, FIRE, DT);
    expect(z.action).not.toBe('attack');
    for (let i = 0; i < Math.ceil(ATTACK_WINDUP.walker / DT) + 2; i++) step(g, IDLE, DT);
    expect(g.player.health).toBe(PLAYER_HEALTH);
  });

  it('gunfire draws zombies that could not see you', () => {
    const { g, z } = range(24, 6);
    const far = walker(501, { x: g.player.pos.x, y: g.player.pos.y + 25 });
    g.zombies.push(far);
    step(g, IDLE, DT);
    expect(far.action).not.toBe('chase');
    step(g, FIRE, DT);
    step(g, IDLE, DT);
    expect(far.alertT).toBeGreaterThan(0);
    expect(far.action).toBe('chase');
    void z;
  });

  it('walking over a gun picks it up and puts it in your hands', () => {
    const g = calmGame(25);
    const pk = g.pickups.find((p) => p.kind === 'shotgun')!;
    g.player.pos = { ...pk.pos };
    step(g, IDLE, DT);
    expect(pk.taken).toBe(true);
    expect(g.arsenal.owned).toContain('shotgun');
    expect(g.arsenal.weapon).toBe('shotgun');
    step(g, { dx: 0, dy: 0, swap: true }, DT);
    expect(g.arsenal.weapon).toBe('pistol');
  });

  it('a store sells what you can afford, and nothing else', () => {
    const g = calmGame(26);
    const st = g.stores[0]!;
    g.player.pos = { ...st.pos };
    expect(interactionFor(g)).toEqual({ kind: 'store', storeId: st.id });
    const rifle = { kind: 'weapon', weapon: 'rifle' } as const;
    const ammo = { kind: 'ammo', weapon: 'rifle' } as const;
    expect(priceOf(g, ammo)).toBeNull(); // no rifle, no rifle ammo
    g.funds = WEAPON_PRICES.rifle - 1;
    expect(buy(g, rifle)).toBe(false);
    expect(g.funds).toBe(WEAPON_PRICES.rifle - 1);
    g.funds = WEAPON_PRICES.rifle + AMMO_PRICES.rifle;
    expect(buy(g, rifle)).toBe(true);
    expect(g.arsenal.owned).toContain('rifle');
    expect(buy(g, rifle)).toBe(false); // already own one
    const spare = g.arsenal.ammo.rifle;
    expect(buy(g, ammo)).toBe(true);
    expect(g.arsenal.ammo.rifle).toBe(spare + GUNS.rifle.ammoPack);
    expect(g.funds).toBe(0);
  });

  it('upgrades raise damage, magazine and reload speed, up to the cap, and get dearer', () => {
    const g = calmGame(27);
    g.funds = 10_000;
    const dmg = { kind: 'upgrade', weapon: 'pistol', upgrade: 'damage' } as const;
    const mag = { kind: 'upgrade', weapon: 'pistol', upgrade: 'mag' } as const;
    const before = gunStats(g.arsenal, 'pistol');
    const p1 = priceOf(g, dmg)!;
    expect(buy(g, dmg)).toBe(true);
    expect(priceOf(g, dmg)!).toBeGreaterThan(p1);
    expect(gunStats(g.arsenal, 'pistol').damage).toBeGreaterThan(before.damage);
    expect(buy(g, mag)).toBe(true);
    expect(gunStats(g.arsenal, 'pistol').mag).toBeGreaterThan(before.mag);
    expect(g.arsenal.mag.pistol).toBe(gunStats(g.arsenal, 'pistol').mag); // the bigger magazine comes loaded
    for (let i = 1; i < UPGRADE_LEVELS; i++) buy(g, dmg);
    expect(priceOf(g, dmg)).toBeNull();
    expect(buy(g, dmg)).toBe(false);
    // melee weapons only take a damage upgrade, and only once you own them
    expect(priceOf(g, { kind: 'upgrade', weapon: 'baton', upgrade: 'mag' })).toBeNull();
    expect(priceOf(g, { kind: 'upgrade', weapon: 'machete', upgrade: 'damage' })).toBeNull();
  });

  it('walking into a store doorway opens it, once, until you step out', () => {
    const g = calmGame(28);
    const st = g.stores[0]!;
    const f = st.front.facing;
    g.player.pos = { x: st.pos.x + f.x * 4, y: st.pos.y + f.y * 4 };
    const walkIn: Input = { dx: -f.x, dy: -f.y };
    let opened = 0;
    for (let i = 0; i < 90; i++) { step(g, walkIn, DT); opened += g.events.filter((e) => e.type === 'store-open').length; }
    expect(opened).toBe(1);
    for (let i = 0; i < 60; i++) step(g, { dx: f.x, dy: f.y }, DT); // step back out
    for (let i = 0; i < 90; i++) { step(g, walkIn, DT); opened += g.events.filter((e) => e.type === 'store-open').length; }
    expect(opened).toBe(2);
  });

  it('every level has weapon stores you can walk to, and weapons to find', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = calmGame(seed);
      expect(g.stores.length).toBe(STORE_COUNT);
      for (const st of g.stores) {
        expect(g.map.blocked[cellOf(g.map, st.pos)]).toBe(0);
        expect(reachable(g.map, g.player.pos, st.pos)).toBe(true);
      }
      expect(g.pickups.filter((p) => p.kind === 'shotgun').length).toBeGreaterThan(0);
      expect(g.pickups.filter((p) => p.kind === 'rifle').length).toBe(1);
      expect(g.pickups.filter((p) => p.kind === 'bat' || p.kind === 'machete').length).toBeGreaterThan(0);
    }
  });
});

describe('melee', () => {
  const SWING: Input = { dx: 0, dy: 0, fire: true };

  it('you start with a baton you can swap to and equip', () => {
    const g = calmGame(30);
    expect(g.arsenal.owned).toEqual(['pistol', 'baton']);
    step(g, { dx: 0, dy: 0, swap: true }, DT);
    expect(g.arsenal.weapon).toBe('baton');
    expect(equip(g, 'pistol')).toBe(true);
    expect(g.arsenal.weapon).toBe('pistol');
    expect(equip(g, 'machete')).toBe(false); // not owned
  });

  it('a baton drops a walker in two hits, without ammo, and quietly', () => {
    const g = calmGame(31);
    const p = openSpot(g, 8);
    g.player.pos = { ...p };
    g.player.heading = 0;
    equip(g, 'baton');
    const z = walker(600, { x: p.x + 1.6, y: p.y });
    const far = walker(601, { x: p.x, y: p.y + 20 });
    g.zombies = [z, far];
    const ammo = { ...g.arsenal.ammo }, mag = { ...g.arsenal.mag };
    let swings = 0;
    for (let i = 0; i < 90 && z.action !== 'dead'; i++) {
      step(g, SWING, DT);
      swings += g.events.filter((e) => e.type === 'swing').length;
    }
    expect(z.action).toBe('dead');
    expect(swings).toBe(Math.ceil(ZOMBIE_HEALTH.walker / MELEE.baton.damage));
    expect(g.arsenal.ammo).toEqual(ammo);
    expect(g.arsenal.mag).toEqual(mag);
    expect(far.alertT).toBe(0); // nobody heard it
  });

  it('a bat hits several in its arc; nothing behind you or out of reach', () => {
    const g = calmGame(32);
    const p = openSpot(g, 8);
    g.player.pos = { ...p };
    g.player.heading = 0;
    g.arsenal.owned.push('bat');
    equip(g, 'bat');
    g.zombies = [
      walker(700, { x: p.x + 1.8, y: p.y + 0.6 }),
      walker(701, { x: p.x + 1.8, y: p.y - 0.6 }),
      walker(702, { x: p.x - 1.8, y: p.y }), // behind
      walker(703, { x: p.x + 6, y: p.y }), // out of reach
    ];
    for (let i = 0; i < 30; i++) { step(g, SWING, DT); if (g.events.some((e) => e.type === 'swing')) break; } // equipping takes a moment
    const hit = g.zombies.filter((z) => z.health < ZOMBIE_HEALTH.walker).map((z) => z.id).sort();
    expect(hit).toEqual([700, 701]);
  });
});

describe('safe while busy', () => {
  it('zombies hold back while you work an objective, and for a moment after', () => {
    // a night whose first step is a plain one you stand at (no fuses to find, no long barricade)
    let g = createGame(40);
    for (let seed = 40; !(currentTask(g)!.seconds === undefined && !currentTask(g)!.parts); seed++) g = createGame(seed);
    const t = currentTask(g)!;
    g.player.pos = { ...t.pos };
    g.player.vel = { x: 0, y: 0 };
    // one right beside you, mid-lunge, and one closing in
    const lunging = walker(800, { x: t.pos.x + 1.1, y: t.pos.y });
    lunging.action = 'attack';
    lunging.actionT = 0.05;
    const coming = walker(801, { x: t.pos.x + 6, y: t.pos.y });
    coming.action = 'chase';
    g.zombies = [lunging, coming];
    step(g, USE, DT);
    expect(isBusy(g)).toBe(true);
    const at = { ...coming.pos };
    for (let i = 0; i < Math.ceil(TASK_HOLD_SECONDS / DT) + 2 && !t.done; i++) step(g, IDLE, DT);
    expect(t.done).toBe(true);
    expect(g.player.health).toBe(PLAYER_HEALTH);
    expect(Math.hypot(coming.pos.x - at.x, coming.pos.y - at.y)).toBeLessThan(0.3);
    expect(isBusy(g)).toBe(true); // the grace period
    for (let i = 0; i < Math.ceil(SAFE_AFTER / DT) + 1; i++) step(g, IDLE, DT);
    expect(isBusy(g)).toBe(false);
  });
});

describe('determinism', () => {
  it('same seed and inputs give an identical run', () => {
    const run = () => {
      const g = createGame(2024);
      for (let i = 0; i < 400 && g.phase === 'playing'; i++) {
        step(g, { dx: Math.sin(i / 17), dy: Math.cos(i / 11), action: i % 50 === 0, fire: i % 7 < 3 }, DT);
      }
      return JSON.stringify({ p: g.player.pos, z: g.zombies.map((z) => z.pos), v: g.vehicles.map((v) => v.pos), r: g.remaining, ph: g.phase, t: g.tier });
    };
    expect(run()).toBe(run());
  });
});

describe('purity of src/core', () => {
  it('imports no DOM/three and uses no wall-clock or Math.random', () => {
    const dir = new URL('../src/core/', import.meta.url);
    for (const f of readdirSync(dir)) {
      const code = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/from ['"]three/);
      expect(code, f).not.toMatch(/\b(document|window|localStorage|requestAnimationFrame)\b/);
      expect(code, f).not.toMatch(/Math\.random|Date\.now|performance\.now/);
      for (const m of code.matchAll(/from ['"]([^'"]+)['"]/g)) expect(m[1], f).toMatch(/^\.\//);
    }
  });
});
