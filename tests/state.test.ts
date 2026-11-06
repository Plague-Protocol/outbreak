import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGame, currentTask, requiredDone, step, type GameState } from '../src/core/state';
import { cellOf } from '../src/core/map';
import { ATTACK_WINDUP, SPAWNS_BY_TIER, TASK_HOLD_SECONDS } from '../src/core/config';
import type { Input, Task } from '../src/core/types';

const IDLE: Input = { dx: 0, dy: 0 };
const DT = 1 / 30;

function calmGame(seed = 1): GameState {
  const g = createGame(seed);
  g.zombies = []; // isolate from zombie behaviour
  return g;
}

/** Teleport to a task and hold until it completes. */
function doTask(g: GameState, t: Task): void {
  g.player.pos = { ...t.pos };
  for (let i = 0; i < Math.ceil(TASK_HOLD_SECONDS / DT) + 2 && !t.done && g.phase === 'playing'; i++) step(g, IDLE, DT);
}

function doRequired(g: GameState): void {
  for (const t of g.tasks) if (t.required) doTask(g, t);
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

  it('losing on timeout, and the state freezes afterwards', () => {
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
    expect(g.events.some((e) => e.type === 'time-penalty') || opt.done).toBe(true);
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
      expect(g.events).toContainEqual({ type: 'won' });
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

  it('a zombie that reaches you lunges, and the lunge lands if you stay', () => {
    const g = createGame(3);
    const z = g.zombies[0]!;
    z.pos = { x: g.player.pos.x + 1, y: g.player.pos.y };
    step(g, IDLE, DT);
    expect(z.action).toBe('attack');
    expect(g.phase).toBe('playing'); // the wind-up is the window to dodge
    for (let i = 0; i < Math.ceil(ATTACK_WINDUP.walker / DT) + 2 && g.phase === 'playing'; i++) step(g, IDLE, DT);
    expect(g.phase).toBe('lost');
    expect(g.lossReason).toBe('caught');
    expect(g.killerId).toBe(z.id);
    expect(z.action).toBe('feed');
  });

  it('running away during the wind-up dodges the lunge', () => {
    const g = createGame(3);
    g.zombies = [g.zombies[0]!];
    const z = g.zombies[0]!;
    // put the zombie beside the player in open street, then sprint directly away from it
    const p = g.map.points.find((q) => g.map.points.filter((r) => Math.hypot(r.x - q.x, r.y - q.y) < 1).length === 1)!;
    g.player.pos = { ...p };
    z.pos = { x: p.x - 1.2, y: p.y };
    step(g, IDLE, DT);
    expect(z.action).toBe('attack');
    g.player.vel = { x: 5.5, y: 0 };
    for (let i = 0; i < Math.ceil(ATTACK_WINDUP.walker / DT) + 2; i++) step(g, { dx: 1, dy: 0 }, DT);
    expect(g.phase).toBe('playing');
    expect(z.action).toBe('chase');
  });

  it('a task whose dependency is not done cannot be completed', () => {
    let found = false;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const g = calmGame(seed);
      const gate = g.tasks.find((t) => t.id === 'gate');
      if (!gate) continue;
      found = true;
      doTask(g, gate);
      expect(gate.done).toBe(false);
      expect(g.events.some((e) => e.type === 'task-locked') || g.lockedNotice === 'gate').toBe(true);
      doTask(g, g.tasks.find((t) => t.id === 'power')!);
      doTask(g, gate);
      expect(gate.done).toBe(true);
    }
    expect(found).toBe(true);
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

describe('zombies and escalation', () => {
  it('starts with a few walkers and none near the player', () => {
    const g = createGame(9);
    expect(g.zombies.length).toBe(SPAWNS_BY_TIER[0].walker + SPAWNS_BY_TIER[0].runner);
    expect(g.zombies.every((z) => z.kind === 'walker' && z.action === 'idle')).toBe(true);
    for (const z of g.zombies) expect(Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y)).toBeGreaterThanOrEqual(18);
  });

  it('escalates as the clock runs down, by clock fraction, not elapsed time', () => {
    const g = createGame(9);
    g.remaining = g.timeLimit * 0.6;
    step(g, IDLE, 0.001);
    const count = (t: number) => SPAWNS_BY_TIER.slice(0, t + 1).reduce((n, w) => n + w.walker + w.runner, 0);
    expect(g.tier).toBe(1);
    expect(g.zombies.length).toBe(count(1));
    expect(g.zombies.some((z) => z.kind === 'runner')).toBe(true);
    expect(g.zombies.filter((z) => z.action === 'rise').length).toBe(count(1) - count(0)); // new ones climb up first
    g.remaining = g.timeLimit * 0.3;
    step(g, IDLE, 0.001);
    expect(g.tier).toBe(2);
    expect(g.zombies.length).toBe(Math.min(14, count(2)));
    expect(g.events.filter((e) => e.type === 'tier-up').length).toBeLessThanOrEqual(1);
  });

  it('a chasing zombie closes distance on a standing player', () => {
    const g = createGame(11);
    g.tier = 2; // always chasing
    const z = g.zombies[0]!;
    const near = g.map.points.find((p) => {
      const d = Math.hypot(p.x - g.player.pos.x, p.y - g.player.pos.y);
      return d > 7 && d < 9.5;
    })!;
    z.pos = { ...near }; // inside sight range
    const pathDist = () => g.flow[cellOf(g.map, z.pos)] as number; // BFS steps to the player
    const d0 = pathDist();
    for (let i = 0; i < 120 && g.phase === 'playing'; i++) step(g, IDLE, DT);
    expect(g.phase === 'lost' || pathDist() < d0 - 3).toBe(true);
    expect(['chase', 'attack', 'feed']).toContain(z.action);
  });

  it('player and zombies never end up inside buildings', () => {
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
    step(g, { dx: 1, dy: 0 }, DT);
    const first = Math.hypot(g.player.vel.x, g.player.vel.y);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1);
    for (let i = 0; i < 30; i++) step(g, { dx: 1, dy: 0 }, DT);
    expect(Math.hypot(g.player.vel.x, g.player.vel.y)).toBeGreaterThan(5);
    step(g, IDLE, DT);
    expect(Math.hypot(g.player.vel.x, g.player.vel.y)).toBeGreaterThan(4); // still carrying momentum
    for (let i = 0; i < 30; i++) step(g, IDLE, DT);
    expect(Math.hypot(g.player.vel.x, g.player.vel.y)).toBe(0);
  });

  it('a light push walks and a full push runs', () => {
    const run = (mag: number) => {
      const g = calmGame(4);
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
        step(g, { dx: Math.sin(i / 17), dy: Math.cos(i / 11) }, DT);
      }
      return JSON.stringify({ p: g.player.pos, z: g.zombies.map((z) => z.pos), r: g.remaining, ph: g.phase, t: g.tier });
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
