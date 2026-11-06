// Pure game state. No DOM, no three.js, no Date/Math.random: time comes from dt, randomness from state.rng.
import {
  ATTACK_COOLDOWN, ATTACK_RANGE, ATTACK_REACH, ATTACK_WINDUP, CALM_FACTOR, PLAYER_ACCEL, PLAYER_RADIUS, PLAYER_SPEED,
  RISE_SECONDS, RUNNER_SIGHT, RUNNER_SPEED, SAFEHOUSE_RADIUS, SPAWNS_BY_TIER, SPEED_BOOST, TASK_HOLD_SECONDS,
  TASK_RADIUS, TIER_THRESHOLDS, WALKER_SIGHT_BY_TIER, WALKER_SPEED_BY_TIER, ZOMBIE_CAP, ZOMBIE_RADIUS,
  ZOMBIE_SPAWN_MIN_DIST,
} from './config';
import { lineClear, resolve } from './collision';
import { generateLevel, type Level } from './level';
import { cellOf, distanceField, UNREACHABLE } from './map';
import { createRng, next, pick, range, type Rng } from './rng';
import type { GameEvent, Input, LossReason, MapData, Phase, Task, TaskId, Vec2, Zombie, ZombieKind } from './types';

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
  player: { pos: Vec2; vel: Vec2; heading: number };
  /** Zombie that caught the player, if any (the renderer stages the ending around it). */
  killerId: number | null;
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
    player: { pos: { ...level.spawn }, vel: { x: 0, y: 0 }, heading: 0 },
    killerId: null,
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
  spawnWave(state, 0, false);
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

function spawnWave(s: GameState, tier: number, rising: boolean): void {
  const wave = SPAWNS_BY_TIER[tier]!;
  for (let i = 0; i < wave.runner; i++) spawnZombie(s, 'runner', rising);
  for (let i = 0; i < wave.walker; i++) spawnZombie(s, 'walker', rising);
}

function spawnZombie(s: GameState, kind: ZombieKind, rising: boolean): void {
  if (s.zombies.length >= ZOMBIE_CAP) return;
  const far = s.map.points.filter(
    (p) => Math.hypot(p.x - s.player.pos.x, p.y - s.player.pos.y) >= ZOMBIE_SPAWN_MIN_DIST,
  );
  const p = pick(s.rng, far.length > 0 ? far : s.map.points);
  // scatter around the street point so a wave does not stand in one spot
  const pos = { x: p.x + range(s.rng, -1.5, 1.5), y: p.y + range(s.rng, -1.5, 1.5) };
  resolve(s.map, pos, ZOMBIE_RADIUS);
  s.zombies.push({
    id: s.nextZombieId++,
    kind,
    pos,
    heading: next(s.rng) * Math.PI * 2,
    speed: 0,
    action: rising ? 'rise' : 'idle',
    actionT: rising ? RISE_SECONDS : 0,
    cooldown: 0,
    wanderT: range(s.rng, 0, 2),
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
    spawnWave(s, s.tier, true);
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
  const top = PLAYER_SPEED * s.speedMul;
  const tx = dx * top, ty = dy * top; // analog: a light push walks, a full push runs
  const v = s.player.vel;
  const ex = tx - v.x, ey = ty - v.y;
  const e = Math.hypot(ex, ey);
  const stepV = PLAYER_ACCEL * dt;
  if (e <= stepV) { v.x = tx; v.y = ty; } else { v.x += (ex / e) * stepV; v.y += (ey / e) * stepV; }
  const sp = Math.hypot(v.x, v.y);
  if (sp < 1e-4) { v.x = 0; v.y = 0; return; }
  const before = { x: s.player.pos.x, y: s.player.pos.y };
  s.player.pos.x += v.x * dt;
  s.player.pos.y += v.y * dt;
  resolve(s.map, s.player.pos, PLAYER_RADIUS);
  // sliding along a wall: keep only the velocity that actually happened
  if (dt > 0) { v.x = (s.player.pos.x - before.x) / dt; v.y = (s.player.pos.y - before.y) / dt; }
  if (len > 0.05) s.player.heading = Math.atan2(dy, dx);
  else if (sp > 0.2) s.player.heading = Math.atan2(v.y, v.x);
}

/** Current ground speed of the player, units/s. */
export function playerSpeed(s: GameState): number {
  return Math.hypot(s.player.vel.x, s.player.vel.y);
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
  const p = s.player.pos;
  const cols = s.map.cols;

  for (const z of s.zombies) {
    z.cooldown = Math.max(0, z.cooldown - dt);
    const dx = p.x - z.pos.x, dy = p.y - z.pos.y;
    const d = Math.hypot(dx, dy);

    if (z.action === 'rise') {
      z.speed = 0;
      z.actionT -= dt;
      if (z.actionT <= 0) z.action = 'idle';
      continue;
    }

    if (z.action === 'attack') {
      z.speed = 0;
      if (d > 1e-6) z.heading = Math.atan2(dy, dx); // track the target during the wind-up
      z.actionT -= dt;
      if (z.actionT > 0) continue;
      if (d < ATTACK_REACH) {
        z.action = 'feed';
        s.killerId = z.id;
        lose(s, 'caught');
        return;
      }
      z.action = 'chase';
      z.cooldown = ATTACK_COOLDOWN;
    }

    const sight = z.kind === 'runner' ? RUNNER_SIGHT : WALKER_SIGHT_BY_TIER[s.tier]!;
    const chaseSpeed = (z.kind === 'runner' ? RUNNER_SPEED : WALKER_SPEED_BY_TIER[s.tier]!) * s.zombieMul;

    if (d < ATTACK_RANGE && z.cooldown <= 0) {
      z.action = 'attack';
      z.actionT = ATTACK_WINDUP[z.kind];
      z.speed = 0;
      s.events.push({ type: 'zombie-attack', id: z.id });
      continue;
    }

    let vx = 0, vy = 0, v = 0;
    if (d < sight) {
      if (z.action !== 'chase') {
        z.action = 'chase';
        s.events.push({ type: 'zombie-alert', id: z.id });
      }
      v = chaseSpeed;
      if (d < 3 || lineClear(s.map, z.pos, p, ZOMBIE_RADIUS)) {
        if (d > 1e-6) { vx = dx / d; vy = dy / d; }
      } else {
        // follow the BFS gradient toward the player through the streets
        const c = cellOf(s.map, z.pos);
        let best = s.flow[c] as number, bc = -1;
        for (const n of [c - 1, c + 1, c - cols, c + cols]) {
          if (n < 0 || n >= s.flow.length) continue;
          const fv = s.flow[n] as number;
          if (fv < best) { best = fv; bc = n; }
        }
        if (bc >= 0 && best !== UNREACHABLE) {
          const tx = (bc % cols) + 0.5 - z.pos.x;
          const ty = Math.floor(bc / cols) + 0.5 - z.pos.y;
          const tl = Math.hypot(tx, ty) || 1;
          vx = tx / tl; vy = ty / tl;
        }
      }
    } else {
      // lost interest: stand, or shuffle about
      z.wanderT -= dt;
      if (z.wanderT <= 0) {
        z.wanderT = range(s.rng, 2, 5);
        if (next(s.rng) < 0.45) z.wanderDir = { x: 0, y: 0 };
        else {
          const a = next(s.rng) * Math.PI * 2;
          z.wanderDir = { x: Math.cos(a), y: Math.sin(a) };
        }
      }
      vx = z.wanderDir.x; vy = z.wanderDir.y;
      const moving = vx !== 0 || vy !== 0;
      z.action = moving ? 'wander' : 'idle';
      v = moving ? WALKER_SPEED_BY_TIER[0] * 0.7 : 0;
    }

    const before = { x: z.pos.x, y: z.pos.y };
    z.pos.x += vx * v * dt;
    z.pos.y += vy * v * dt;
    resolve(s.map, z.pos, ZOMBIE_RADIUS);
    z.speed = dt > 0 ? Math.hypot(z.pos.x - before.x, z.pos.y - before.y) / dt : 0;
    if (vx !== 0 || vy !== 0) z.heading = Math.atan2(vy, vx);
    // a wanderer that hits a wall turns around next time
    if (z.action === 'wander' && z.speed < v * 0.3) z.wanderT = 0;
  }
  separate(s);
}

/** Push overlapping zombies apart so a crowd spreads out instead of stacking. */
function separate(s: GameState): void {
  const zs = s.zombies;
  const min = ZOMBIE_RADIUS * 2;
  for (let i = 0; i < zs.length; i++) {
    for (let j = i + 1; j < zs.length; j++) {
      const a = zs[i]!.pos, b = zs[j]!.pos;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= min || d < 1e-6) continue;
      const push = (min - d) / 2;
      a.x -= (dx / d) * push; a.y -= (dy / d) * push;
      b.x += (dx / d) * push; b.y += (dy / d) * push;
    }
  }
  for (const z of zs) resolve(s.map, z.pos, ZOMBIE_RADIUS);
}
