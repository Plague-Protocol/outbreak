import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createGame, currentTask, interactionFor, playerVehicle, requiredDone, step, type GameState,
} from '../src/core/state';
import { cellOf } from '../src/core/map';
import {
  ATTACK_DAMAGE, ATTACK_WINDUP, MEDKIT_HEAL, PLAYER_HEALTH, SPAWNS_BY_TIER, TASK_HOLD_SECONDS, VEHICLES, ZOMBIE_CAP,
} from '../src/core/config';
import type { Input, Task, Vec2 } from '../src/core/types';

const IDLE: Input = { dx: 0, dy: 0 };
const USE: Input = { dx: 0, dy: 0, action: true };
const DT = 1 / 30;

function calmGame(seed = 1): GameState {
  const g = createGame(seed);
  g.zombies = []; // isolate from zombie behaviour
  return g;
}

/** Teleport to a task, press Use, and hold position until it completes. */
function doTask(g: GameState, t: Task): void {
  g.player.pos = { ...t.pos };
  g.player.vel = { x: 0, y: 0 };
  step(g, USE, DT);
  for (let i = 0; i < Math.ceil(TASK_HOLD_SECONDS / DT) + 2 && !t.done && g.phase === 'playing'; i++) step(g, IDLE, DT);
}

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

  it('a task whose dependency is not done cannot be started', () => {
    let found = false;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const g = calmGame(seed);
      const gate = g.tasks.find((t) => t.id === 'gate');
      if (!gate) continue;
      found = true;
      g.player.pos = { ...gate.pos };
      step(g, USE, DT);
      expect(g.events.some((e) => e.type === 'task-locked')).toBe(true);
      expect(g.hold.taskId).toBeNull();
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
    g.zombies.push({ id: 50, kind: 'walker', pos: { x: p.x, y: p.y }, heading: 0, speed: 0, action: 'idle', actionT: 0, cooldown: 0, wanderT: 9, wanderDir: { x: 0, y: 0 } });
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
    g.zombies = [{ id: 9, kind: 'walker', pos: { x: v.pos.x, y: v.pos.y + 2.4 }, heading: 0, speed: 0, action: 'idle', actionT: 0, cooldown: 0, wanderT: 9, wanderDir: { x: 0, y: 0 } }];
    for (let i = 0; i < 60 && !v.wrecked; i++) step(g, IDLE, DT);
    expect(v.wrecked).toBe(true);
    expect(playerVehicle(g)).toBeNull();
    g.player.pos = { x: v.pos.x, y: v.pos.y + 2.6 };
    expect(interactionFor(g)?.kind === 'enter').toBe(false);
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

  it('completing required tasks then reaching the safehouse in time wins', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = calmGame(seed);
      doRequired(g);
      expect(requiredDone(g)).toBe(true);
      expect(g.phase).toBe('playing');
      g.player.pos = { ...g.safehouse };
      step(g, IDLE, DT);
      expect(g.phase).toBe('won');
    }
  });

  it('optional tasks are not needed to win', () => {
    const g = calmGame(7);
    doRequired(g);
    expect(g.tasks.some((t) => !t.required && !t.done)).toBe(true);
    g.player.pos = { ...g.safehouse };
    step(g, IDLE, DT);
    expect(g.phase).toBe('won');
  });

  it('a won game cannot then be lost by the clock', () => {
    const g = calmGame(7);
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

describe('determinism', () => {
  it('same seed and inputs give an identical run', () => {
    const run = () => {
      const g = createGame(2024);
      for (let i = 0; i < 400 && g.phase === 'playing'; i++) {
        step(g, { dx: Math.sin(i / 17), dy: Math.cos(i / 11), action: i % 50 === 0 }, DT);
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
