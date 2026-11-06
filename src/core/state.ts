// Pure game state. No DOM, no three.js, no Date/Math.random: time comes from dt, randomness from state.rng.
import {
  CALM_FACTOR, PLAYER_RADIUS, PLAYER_SPEED, SAFEHOUSE_RADIUS, SPEED_BOOST, TASK_HOLD_SECONDS, TASK_RADIUS,
  TIER_THRESHOLDS, ZOMBIES_PER_TIER, ZOMBIES_START, ZOMBIE_CAP, ZOMBIE_RADIUS, ZOMBIE_SIGHT_BY_TIER,
  ZOMBIE_SPAWN_MIN_DIST, ZOMBIE_SPEED_BY_TIER,
} from './config';
import { lineClear, resolve } from './collision';
import { generateLevel, type Level } from './level';
import { cellOf, distanceField, UNREACHABLE } from './map';
import { createRng, next, pick, range, type Rng } from './rng';
import type { GameEvent, Input, LossReason, MapData, Phase, Task, TaskId, Vec2, Zombie } from './types';

export interface GameState {
  seed: number;
  phase: Phase;
  lossReason: LossReason | null;
  map: MapData;
  rng: Rng;
  elapsed: number;
  timeLimit: number;
  remaining: number;
  tier: number;
  player: { pos: Vec2; heading: number };
  zombies: Zombie[];
  tasks: Task[];
  safehouse: Vec2;
  safehouseKnown: boolean;
  hold: { taskId: TaskId | null; progress: number };
  speedMul: number;
  zombieMul: number;
  funds: number;
  events: GameEvent[];
  // internals
  flow: Int16Array;
  flowCell: number;
  nextZombieId: number;
  lockedNotice: TaskId | 'safehouse' | null;
}

export function createGame(seed: number, level: Level = generateLevel(seed)): GameState {
  const state: GameState = {
    seed,
    phase: 'playing',
    lossReason: null,
    map: level.map,
    rng: createRng(seed ^ 0x9e3779b9),
    elapsed: 0,
    timeLimit: level.timeLimit,
    remaining: level.timeLimit,
    tier: 0,
    player: { pos: { ...level.spawn }, heading: 0 },
    zombies: [],
    tasks: level.tasks.map((t) => ({ ...t, pos: { ...t.pos }, requires: t.requires.slice() })),
    safehouse: { ...level.safehouse },
    safehouseKnown: !level.tasks.some((t) => t.id === 'map'),
    hold: { taskId: null, progress: 0 },
    speedMul: 1,
    zombieMul: 1,
    funds: 0,
    events: [],
    flow: new Int16Array(level.map.cols * level.map.cols),
    flowCell: -1,
    nextZombieId: 1,
    lockedNotice: null,
  };
  for (let i = 0; i < ZOMBIES_START; i++) spawnZombie(state);
  refreshFlow(state);
  return state;
}

export function requiredDone(s: GameState): boolean {
  return s.tasks.every((t) => !t.required || t.done);
}

/** First incomplete required task whose dependencies are met (chain order). */
export function currentTask(s: GameState): Task | null {
  return s.tasks.find((t) => t.required && !t.done && depsMet(s, t)) ?? null;
}

function depsMet(s: GameState, t: Task): boolean {
  return t.requires.every((id) => s.tasks.some((x) => x.id === id && x.done));
}

function refreshFlow(s: GameState): void {
  const c = cellOf(s.map, s.player.pos);
  if (c === s.flowCell) return;
  s.flowCell = c;
  distanceField(s.map, s.player.pos, s.flow);
}

function spawnZombie(s: GameState): void {
  if (s.zombies.length >= ZOMBIE_CAP) return;
  const far = s.map.points.filter(
    (p) => Math.hypot(p.x - s.player.pos.x, p.y - s.player.pos.y) >= ZOMBIE_SPAWN_MIN_DIST,
  );
  const p = pick(s.rng, far.length > 0 ? far : s.map.points);
  s.zombies.push({
    id: s.nextZombieId++,
    pos: { x: p.x, y: p.y },
    heading: 0,
    wanderT: 0,
    wanderDir: { x: 0, y: 0 },
  });
}

function tierFor(fraction: number): number {
  return fraction > TIER_THRESHOLDS[0] ? 0 : fraction > TIER_THRESHOLDS[1] ? 1 : 2;
}

function lose(s: GameState, reason: LossReason): void {
  s.phase = 'lost';
  s.lossReason = reason;
  s.events.push({ type: 'lost', reason });
}

/** Advance the game by dt seconds. Mutates and returns state. */
export function step(s: GameState, input: Input, dt: number): GameState {
  s.events.length = 0;
  if (s.phase !== 'playing') return s;

  s.elapsed += dt;
  s.remaining -= dt;
  if (s.remaining <= 0) {
    s.remaining = 0;
    lose(s, 'time');
    return s;
  }

  // Escalation tied to the clock fraction
  const tier = tierFor(s.remaining / s.timeLimit);
  while (s.tier < tier) {
    s.tier++;
    s.events.push({ type: 'tier-up', tier: s.tier });
    for (let i = 0; i < ZOMBIES_PER_TIER; i++) spawnZombie(s);
  }

  movePlayer(s, input, dt);
  refreshFlow(s);
  updateTasks(s, dt);
  if (s.phase !== 'playing') return s;
  updateSafehouse(s);
  if (s.phase !== 'playing') return s;
  updateZombies(s, dt);
  return s;
}

function movePlayer(s: GameState, input: Input, dt: number): void {
  let dx = input.dx, dy = input.dy;
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  if (len > 0.01) {
    const v = PLAYER_SPEED * s.speedMul;
    s.player.pos.x += dx * v * dt;
    s.player.pos.y += dy * v * dt;
    s.player.heading = Math.atan2(dy, dx);
    resolve(s.map, s.player.pos, PLAYER_RADIUS);
  }
}

function updateTasks(s: GameState, dt: number): void {
  const p = s.player.pos;
  const near = s.tasks.find((t) => !t.done && Math.hypot(t.pos.x - p.x, t.pos.y - p.y) < TASK_RADIUS);
  if (!near) {
    s.hold.taskId = null;
    s.hold.progress = 0;
    s.lockedNotice = null;
    return;
  }
  if (!depsMet(s, near)) {
    if (s.lockedNotice !== near.id) {
      s.lockedNotice = near.id;
      s.events.push({ type: 'task-locked', id: near.id, needs: near.requires.filter((id) => !s.tasks.some((x) => x.id === id && x.done)) });
    }
    s.hold.taskId = null;
    s.hold.progress = 0;
    return;
  }
  if (s.hold.taskId !== near.id) {
    s.hold.taskId = near.id;
    s.hold.progress = 0;
  }
  s.hold.progress += dt / TASK_HOLD_SECONDS;
  if (s.hold.progress < 1) return;

  near.done = true;
  s.hold.taskId = null;
  s.hold.progress = 0;
  s.events.push({ type: 'task-done', id: near.id });
  if (near.id === 'map') s.safehouseKnown = true;
  if (near.timeCost > 0) {
    s.remaining -= near.timeCost;
    s.events.push({ type: 'time-penalty', seconds: near.timeCost });
    if (s.remaining <= 0) { s.remaining = 0; lose(s, 'time'); return; }
  }
  if (near.reward === 'speed') s.speedMul = SPEED_BOOST;
  else if (near.reward === 'calm') s.zombieMul = CALM_FACTOR;
  else if (near.reward === 'funds') s.funds += 50;
}

function updateSafehouse(s: GameState): void {
  const p = s.player.pos;
  const inside = Math.hypot(s.safehouse.x - p.x, s.safehouse.y - p.y) < SAFEHOUSE_RADIUS;
  if (!inside) {
    if (s.lockedNotice === 'safehouse') s.lockedNotice = null;
    return;
  }
  if (requiredDone(s)) {
    s.phase = 'won';
    s.events.push({ type: 'won' });
  } else if (s.lockedNotice !== 'safehouse') {
    s.lockedNotice = 'safehouse';
    s.events.push({ type: 'safehouse-locked' });
  }
}

function updateZombies(s: GameState, dt: number): void {
  const speed = ZOMBIE_SPEED_BY_TIER[s.tier]! * s.zombieMul;
  const sight = ZOMBIE_SIGHT_BY_TIER[s.tier]!;
  const p = s.player.pos;
  const cols = s.map.cols;
  const catchDist = PLAYER_RADIUS + ZOMBIE_RADIUS;

  for (const z of s.zombies) {
    const dx = p.x - z.pos.x, dy = p.y - z.pos.y;
    const d = Math.hypot(dx, dy);
    let vx = 0, vy = 0;
    if (d < sight) {
      if (d < 3 || lineClear(s.map, z.pos, p, ZOMBIE_RADIUS)) {
        if (d > 1e-6) { vx = dx / d; vy = dy / d; }
      } else {
        // follow the BFS gradient toward the player through the streets
        const c = cellOf(s.map, z.pos);
        let best = s.flow[c] as number, bc = -1;
        for (const n of [c - 1, c + 1, c - cols, c + cols]) {
          if (n < 0 || n >= s.flow.length) continue;
          const v = s.flow[n] as number;
          if (v < best) { best = v; bc = n; }
        }
        if (bc >= 0 && best !== UNREACHABLE) {
          const tx = (bc % cols) + 0.5 - z.pos.x;
          const ty = Math.floor(bc / cols) + 0.5 - z.pos.y;
          const tl = Math.hypot(tx, ty) || 1;
          vx = tx / tl; vy = ty / tl;
        }
      }
    } else {
      // idle shamble
      z.wanderT -= dt;
      if (z.wanderT <= 0) {
        z.wanderT = range(s.rng, 1, 3);
        if (next(s.rng) < 0.4) z.wanderDir = { x: 0, y: 0 };
        else {
          const a = next(s.rng) * Math.PI * 2;
          z.wanderDir = { x: Math.cos(a), y: Math.sin(a) };
        }
      }
      vx = z.wanderDir.x; vy = z.wanderDir.y;
    }
    const v = d < sight ? speed : speed * 0.4;
    z.pos.x += vx * v * dt;
    z.pos.y += vy * v * dt;
    resolve(s.map, z.pos, ZOMBIE_RADIUS);
    if (vx !== 0 || vy !== 0) z.heading = Math.atan2(vy, vx);

    if (Math.hypot(p.x - z.pos.x, p.y - z.pos.y) < catchDist) {
      lose(s, 'caught');
      return;
    }
  }
}
