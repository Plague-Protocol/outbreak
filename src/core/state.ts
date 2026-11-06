// Pure game state. No DOM, no three.js, no Date/Math.random: time comes from dt, randomness from state.rng.
import {
  ATTACK_COOLDOWN, ATTACK_DAMAGE, ATTACK_RANGE, ATTACK_REACH, ATTACK_WINDUP, CALM_FACTOR, CORPSE_SECONDS,
  HIT_INVULNERABLE, KNOCKBACK, MEDKIT_HEAL, PLAYER_ACCEL, PLAYER_HEALTH, PLAYER_RADIUS, PLAYER_SPEED, RISE_SECONDS,
  RUN_OVER_SPEED, RUNNER_SIGHT, RUNNER_SPEED, SAFEHOUSE_RADIUS, SPAWNS_BY_TIER, SPEED_BOOST, TASK_HOLD_SECONDS,
  TASK_RADIUS, TIER_THRESHOLDS, USE_RADIUS, VEHICLES, WALKER_SIGHT_BY_TIER, WALKER_SPEED_BY_TIER, WAVE_SPAWN_MAX_DIST,
  ZOMBIE_ACTIVE_RADIUS, ZOMBIE_CAP, ZOMBIE_RADIUS, ZOMBIE_SPAWN_MIN_DIST, ZOMBIES_PER_BLOCK,
} from './config';
import { lineClear, resolve } from './collision';
import { generateLevel, type Level } from './level';
import { cellOf, distanceField, UNREACHABLE } from './map';
import { createRng, next, pick, range, type Rng } from './rng';
import type {
  Crate, GameEvent, Input, Interaction, LossReason, MapData, Phase, Task, TaskId, Vec2, Vehicle, Zombie, ZombieKind,
} from './types';

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
  player: { pos: Vec2; vel: Vec2; heading: number; health: number; invuln: number; vehicleId: number | null };
  /** Zombie that caught the player, if any (the renderer stages the ending around it). */
  killerId: number | null;
  zombies: Zombie[];
  vehicles: Vehicle[];
  crates: Crate[];
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
  lockedNotice: 'safehouse' | null;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (v: number, target: number, step: number) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

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
    player: { pos: { ...level.spawn }, vel: { x: 0, y: 0 }, heading: 0, health: PLAYER_HEALTH, invuln: 0, vehicleId: null },
    killerId: null,
    zombies: [],
    vehicles: level.vehicles.map((v) => ({ ...v, pos: { ...v.pos } })),
    crates: level.crates.map((c) => ({ ...c, pos: { ...c.pos } })),
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
  populate(state);
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

export function playerVehicle(s: GameState): Vehicle | null {
  return s.player.vehicleId === null ? null : s.vehicles.find((v) => v.id === s.player.vehicleId) ?? null;
}

/** Current ground speed of the player (or their vehicle), units/s. */
export function playerSpeed(s: GameState): number {
  return Math.hypot(s.player.vel.x, s.player.vel.y);
}

function refreshFlow(s: GameState): void {
  const c = cellOf(s.map, s.player.pos);
  if (c === s.flowCell) return;
  s.flowCell = c;
  withVehiclesBlocked(s, () => distanceField(s.map, s.player.pos, s.flow));
}

/** Run a path search with the cells under vehicles treated as blocked, so paths go around cars. */
export function withVehiclesBlocked<T>(s: GameState, fn: () => T): T {
  const cols = s.map.cols, blocked = s.map.blocked, stamped: number[] = [];
  for (const v of s.vehicles) {
    for (const c of vehicleCircles(v)) {
      const r = c.r + 0.6;
      for (let y = Math.floor(c.y - r); y <= Math.ceil(c.y + r); y++) for (let x = Math.floor(c.x - r); x <= Math.ceil(c.x + r); x++) {
        if (x < 0 || y < 0 || x >= cols || y >= cols) continue;
        const i = y * cols + x;
        if (blocked[i] === 0 && (x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2 < r * r) { blocked[i] = 1; stamped.push(i); }
      }
    }
  }
  try {
    return fn();
  } finally {
    for (const i of stamped) blocked[i] = 0;
  }
}

// ---------------------------------------------------------------- zombies: population and waves

function addZombie(s: GameState, kind: ZombieKind, pos: Vec2, rising: boolean): void {
  resolve(s.map, pos, ZOMBIE_RADIUS);
  s.zombies.push({
    id: s.nextZombieId++, kind, pos, heading: next(s.rng) * Math.PI * 2, speed: 0,
    action: rising ? 'rise' : 'idle', actionT: rising ? RISE_SECONDS : 0, cooldown: 0,
    wanderT: range(s.rng, 0, 3), wanderDir: { x: 0, y: 0 },
  });
}

/** The city's resting population: denser downtown, thin in the outskirts, none near the start. */
function populate(s: GameState): void {
  const cap = ZOMBIE_CAP - 16; // leave room for the waves
  for (const b of s.map.blocks) {
    const rate = ZOMBIES_PER_BLOCK[b.district];
    const n = Math.floor(rate + next(s.rng));
    for (let k = 0; k < n && s.zombies.length < cap; k++) {
      for (let tries = 0; tries < 8; tries++) {
        // inside the block (yards, plazas, lots) or on its kerb
        const p = { x: b.x + range(s.rng, -3, b.size + 3), y: b.y + range(s.rng, -3, b.size + 3) };
        if (s.map.blocked[cellOf(s.map, p)] === 1 || dist(p, s.player.pos) < 28) continue;
        addZombie(s, 'walker', p, false);
        break;
      }
    }
  }
}

/** A wave arrives from just out of sight. Far-off zombies are recycled to make room. */
function spawnWave(s: GameState, tier: number): void {
  const wave = SPAWNS_BY_TIER[tier]!;
  const kinds: ZombieKind[] = [...Array<ZombieKind>(wave.runner).fill('runner'), ...Array<ZombieKind>(wave.walker).fill('walker')];
  const ring = s.map.points.filter((p) => {
    const d = dist(p, s.player.pos);
    return d >= ZOMBIE_SPAWN_MIN_DIST && d <= WAVE_SPAWN_MAX_DIST;
  });
  for (const kind of kinds) {
    if (s.zombies.length >= ZOMBIE_CAP) {
      let far = -1, farD = 0;
      s.zombies.forEach((z, i) => { const d = dist(z.pos, s.player.pos); if (d > farD) { farD = d; far = i; } });
      if (far < 0 || farD < ZOMBIE_ACTIVE_RADIUS) break;
      s.zombies.splice(far, 1);
    }
    const p = pick(s.rng, ring.length > 0 ? ring : s.map.points);
    addZombie(s, kind, { x: p.x + range(s.rng, -2, 2), y: p.y + range(s.rng, -2, 2) }, true);
  }
}

function tierFor(fraction: number): number {
  return fraction > TIER_THRESHOLDS[0] ? 0 : fraction > TIER_THRESHOLDS[1] ? 1 : 2;
}

function lose(s: GameState, reason: LossReason): void {
  s.phase = 'lost';
  s.lossReason = reason;
  s.events.push({ type: 'lost', reason });
}

// ---------------------------------------------------------------- the step

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

  // escalation tied to the clock fraction
  const tier = tierFor(s.remaining / s.timeLimit);
  while (s.tier < tier) {
    s.tier++;
    s.events.push({ type: 'tier-up', tier: s.tier });
    spawnWave(s, s.tier);
  }

  if (input.action) interact(s);
  s.player.invuln = Math.max(0, s.player.invuln - dt);

  const driving = playerVehicle(s);
  if (driving) drive(driving, input, dt);
  else movePlayer(s, input, dt);
  for (const v of s.vehicles) moveVehicle(s, v, dt, v === driving);
  const still = playerVehicle(s); // a wreck may have thrown the player out
  if (still) {
    s.player.pos.x = still.pos.x;
    s.player.pos.y = still.pos.y;
    s.player.vel = { x: Math.cos(still.heading) * still.speed, y: Math.sin(still.heading) * still.speed };
    s.player.heading = still.heading;
  }

  refreshFlow(s);
  updateTasks(s, dt);
  if (s.phase !== 'playing') return s;
  updateSafehouse(s);
  if (s.phase !== 'playing') return s;
  updateZombies(s, dt);
  return s;
}

// ---------------------------------------------------------------- interactions

/** Distance from p to a vehicle's body (0 or less means touching). */
function vehicleReach(v: Vehicle, p: Vec2): number {
  const spec = VEHICLES[v.kind];
  const hx = Math.cos(v.heading), hy = Math.sin(v.heading);
  const t = Math.max(-spec.length / 2, Math.min(spec.length / 2, (p.x - v.pos.x) * hx + (p.y - v.pos.y) * hy));
  return Math.hypot(p.x - (v.pos.x + hx * t), p.y - (v.pos.y + hy * t)) - spec.width / 2;
}

/** What the Use button would do right now, if anything. */
export function interactionFor(s: GameState): Interaction | null {
  if (s.phase !== 'playing') return null;
  const v = playerVehicle(s);
  if (v) return { kind: 'exit', vehicleId: v.id };
  const p = s.player.pos;
  const task = s.tasks.find((t) => !t.done && s.hold.taskId !== t.id && dist(t.pos, p) < TASK_RADIUS);
  if (task) return { kind: 'task', taskId: task.id };
  const crate = s.crates.find((c) => !c.opened && dist(c.pos, p) < USE_RADIUS * 0.75);
  if (crate) return { kind: 'crate', crateId: crate.id };
  let best: Vehicle | null = null, bestD = 1.6;
  for (const c of s.vehicles) {
    if (c.wrecked) continue;
    const d = vehicleReach(c, p);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best ? { kind: 'enter', vehicleId: best.id } : null;
}

function interact(s: GameState): void {
  const it = interactionFor(s);
  if (!it) return;
  switch (it.kind) {
    case 'exit': exitVehicle(s); break;
    case 'enter':
      s.player.vehicleId = it.vehicleId;
      s.hold.taskId = null;
      s.hold.progress = 0;
      s.events.push({ type: 'vehicle-enter', id: it.vehicleId });
      break;
    case 'task': {
      const t = s.tasks.find((x) => x.id === it.taskId)!;
      if (!depsMet(s, t)) {
        s.events.push({ type: 'task-locked', id: t.id, needs: t.requires.filter((id) => !s.tasks.some((x) => x.id === id && x.done)) });
        return;
      }
      s.hold.taskId = t.id;
      s.hold.progress = 0;
      s.events.push({ type: 'task-started', id: t.id });
      break;
    }
    case 'crate': {
      const c = s.crates.find((x) => x.id === it.crateId)!;
      c.opened = true;
      s.events.push({ type: 'crate-opened', id: c.id, loot: c.loot });
      if (c.loot === 'medkit') {
        const before = s.player.health;
        s.player.health = Math.min(PLAYER_HEALTH, s.player.health + MEDKIT_HEAL);
        s.events.push({ type: 'healed', amount: s.player.health - before });
      } else if (c.loot === 'supplies') s.funds += 25;
      break;
    }
  }
}

function exitVehicle(s: GameState): void {
  const v = playerVehicle(s);
  if (!v) return;
  const spec = VEHICLES[v.kind];
  // step out on the driver's side, or the other side if that is blocked
  for (const side of [1, -1]) {
    const nx = -Math.sin(v.heading) * side, ny = Math.cos(v.heading) * side;
    const p = { x: v.pos.x + nx * (spec.width / 2 + 0.9), y: v.pos.y + ny * (spec.width / 2 + 0.9) };
    const before = { ...p };
    resolve(s.map, p, PLAYER_RADIUS);
    if (dist(p, before) < 0.3 || side === -1) {
      s.player.pos = p;
      break;
    }
  }
  s.player.vel = { x: 0, y: 0 };
  s.player.vehicleId = null;
  s.events.push({ type: 'vehicle-exit', id: v.id });
}

// ---------------------------------------------------------------- movement

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
  for (const c of s.vehicles) pushOutOfVehicle(c, s.player.pos, PLAYER_RADIUS);
  // sliding along a wall: keep only the velocity that actually happened
  if (dt > 0) { v.x = (s.player.pos.x - before.x) / dt; v.y = (s.player.pos.y - before.y) / dt; }
  if (len > 0.05) s.player.heading = Math.atan2(dy, dx);
  else if (sp > 0.2) s.player.heading = Math.atan2(v.y, v.x);
}

/** Vehicles collide as three circles along their length. */
export function vehicleCircles(v: Vehicle): Array<{ x: number; y: number; r: number }> {
  const spec = VEHICLES[v.kind];
  const half = spec.length / 2 - spec.width / 2;
  const hx = Math.cos(v.heading), hy = Math.sin(v.heading);
  return [-half, 0, half].map((o) => ({ x: v.pos.x + hx * o, y: v.pos.y + hy * o, r: spec.width / 2 }));
}

function pushOutOfVehicle(v: Vehicle, p: Vec2, r: number): boolean {
  let hit = false;
  for (const c of vehicleCircles(v)) {
    const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy), min = c.r + r;
    if (d >= min) continue;
    hit = true;
    if (d < 1e-6) { p.x += min; continue; }
    p.x = c.x + (dx / d) * min;
    p.y = c.y + (dy / d) * min;
  }
  return hit;
}

/**
 * Arcade driving for touch: push the stick where you want to go and the car steers toward it.
 * Pushing back against the nose when slow reverses.
 */
function drive(v: Vehicle, input: Input, dt: number): void {
  if (v.wrecked) return;
  const spec = VEHICLES[v.kind];
  const mag = Math.min(1, Math.hypot(input.dx, input.dy));
  let target = 0;
  let steerTo: number | null = null;
  if (mag > 0.1) {
    const want = Math.atan2(input.dy, input.dx);
    const diff = wrap(want - v.heading);
    if (Math.abs(diff) > 2.0 && v.speed < 2) {
      target = -spec.reverse * mag;
      steerTo = wrap(want + Math.PI);
    } else {
      target = spec.maxSpeed * mag * Math.max(0.35, Math.cos(diff));
      steerTo = want;
    }
  }
  const braking = target === 0 || (Math.sign(target) !== Math.sign(v.speed) && Math.abs(v.speed) > 0.5);
  v.speed = approach(v.speed, target, (target === 0 ? 6 : braking ? 22 : spec.accel) * dt);
  if (steerTo !== null) {
    const d = wrap(steerTo - v.heading);
    const rate = spec.steer * Math.min(1, Math.abs(v.speed) / 4) * dt;
    v.heading = wrap(v.heading + Math.max(-rate, Math.min(rate, d)));
  }
}

function moveVehicle(s: GameState, v: Vehicle, dt: number, driven: boolean): void {
  if (v.wrecked) { v.speed = 0; return; }
  if (!driven) v.speed = approach(v.speed, 0, 6 * dt);
  if (Math.abs(v.speed) < 1e-3) return;
  const spec = VEHICLES[v.kind];
  v.pos.x += Math.cos(v.heading) * v.speed * dt;
  v.pos.y += Math.sin(v.heading) * v.speed * dt;

  // collide each circle with the city and with other vehicles; apply the average push
  let px = 0, py = 0, hits = 0;
  for (const c of vehicleCircles(v)) {
    const p = { x: c.x, y: c.y };
    let hit = resolve(s.map, p, c.r);
    for (const o of s.vehicles) if (o !== v) hit = pushOutOfVehicle(o, p, c.r) || hit;
    if (hit) { px += p.x - c.x; py += p.y - c.y; hits++; }
  }
  if (hits > 0) {
    v.pos.x += px / hits;
    v.pos.y += py / hits;
    const force = Math.abs(v.speed);
    if (force > 5) {
      s.events.push({ type: 'vehicle-crash', id: v.id, force });
      v.speed *= -0.2;
      damageVehicle(s, v, (force - 5) * 3);
    } else {
      v.speed *= 0.6;
    }
  }

  // zombies: knocked down at speed, shoved aside when slow
  for (const z of s.zombies) {
    if (z.action === 'dead') continue;
    for (const c of vehicleCircles(v)) {
      if (Math.hypot(z.pos.x - c.x, z.pos.y - c.y) >= c.r + ZOMBIE_RADIUS) continue;
      if (Math.abs(v.speed) > RUN_OVER_SPEED) {
        z.action = 'dead';
        z.actionT = CORPSE_SECONDS;
        z.speed = 0;
        z.heading = v.heading + Math.PI; // falls back from the bumper
        v.speed *= 0.9;
        s.events.push({ type: 'zombie-killed', id: z.id });
        damageVehicle(s, v, spec.health * 0.03);
      } else {
        pushOutOfVehicle(v, z.pos, ZOMBIE_RADIUS);
      }
      break;
    }
  }
}

function damageVehicle(s: GameState, v: Vehicle, amount: number): void {
  if (v.wrecked) return;
  v.health -= amount;
  if (v.health > 0) return;
  v.health = 0;
  v.wrecked = true;
  v.speed = 0;
  s.events.push({ type: 'vehicle-wrecked', id: v.id });
  if (s.player.vehicleId === v.id) exitVehicle(s);
}

// ---------------------------------------------------------------- tasks and the safehouse

function updateTasks(s: GameState, dt: number): void {
  if (!s.hold.taskId) return;
  const t = s.tasks.find((x) => x.id === s.hold.taskId)!;
  // walking away (or driving off) cancels the job
  if (s.player.vehicleId !== null || dist(t.pos, s.player.pos) > TASK_RADIUS + 0.3) {
    s.hold.taskId = null;
    s.hold.progress = 0;
    return;
  }
  s.hold.progress += dt / TASK_HOLD_SECONDS;
  if (s.hold.progress < 1) return;

  t.done = true;
  s.hold.taskId = null;
  s.hold.progress = 0;
  s.events.push({ type: 'task-done', id: t.id });
  if (t.id === 'map') s.safehouseKnown = true;
  if (t.timeCost > 0) {
    s.remaining -= t.timeCost;
    s.events.push({ type: 'time-penalty', seconds: t.timeCost });
    if (s.remaining <= 0) { s.remaining = 0; lose(s, 'time'); return; }
  }
  if (t.reward === 'speed') s.speedMul = SPEED_BOOST;
  else if (t.reward === 'calm') s.zombieMul = CALM_FACTOR;
  else if (t.reward === 'funds') s.funds += 50;
}

function updateSafehouse(s: GameState): void {
  const inside = dist(s.safehouse, s.player.pos) < SAFEHOUSE_RADIUS + (s.player.vehicleId !== null ? 2 : 0);
  if (!inside) {
    s.lockedNotice = null;
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

// ---------------------------------------------------------------- zombies

function updateZombies(s: GameState, dt: number): void {
  const p = s.player.pos;
  const cols = s.map.cols;
  const car = playerVehicle(s);
  const reachBonus = car ? VEHICLES[car.kind].length / 2 - 0.4 : 0; // a car is a bigger target

  for (const z of s.zombies) {
    if (z.action === 'dead') { z.actionT -= dt; continue; }
    const dx = p.x - z.pos.x, dy = p.y - z.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > ZOMBIE_ACTIVE_RADIUS) continue; // dormant
    z.cooldown = Math.max(0, z.cooldown - dt);

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
      z.action = 'chase';
      z.cooldown = ATTACK_COOLDOWN;
      if (d >= ATTACK_REACH + reachBonus) continue; // missed
      if (car) {
        if (Math.abs(car.speed) < 2) {
          s.events.push({ type: 'vehicle-crash', id: car.id, force: 2 });
          damageVehicle(s, car, 15);
        }
        continue;
      }
      if (s.player.invuln > 0) continue;
      s.player.health -= ATTACK_DAMAGE;
      s.player.invuln = HIT_INVULNERABLE;
      if (d > 1e-6) {
        s.player.vel.x += (dx / d) * KNOCKBACK;
        s.player.vel.y += (dy / d) * KNOCKBACK;
      }
      s.events.push({ type: 'player-hit', damage: ATTACK_DAMAGE, by: z.id });
      if (s.player.health <= 0) {
        s.player.health = 0;
        z.action = 'feed';
        s.killerId = z.id;
        lose(s, 'caught');
        return;
      }
      continue;
    }

    const sight = z.kind === 'runner' ? RUNNER_SIGHT : WALKER_SIGHT_BY_TIER[s.tier]!;
    const chaseSpeed = (z.kind === 'runner' ? RUNNER_SPEED : WALKER_SPEED_BY_TIER[s.tier]!) * s.zombieMul;

    if (d < ATTACK_RANGE + reachBonus && z.cooldown <= 0 && !(car && Math.abs(car.speed) > 3)) {
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
    for (const c of s.vehicles) pushOutOfVehicle(c, z.pos, ZOMBIE_RADIUS);
    z.speed = dt > 0 ? Math.hypot(z.pos.x - before.x, z.pos.y - before.y) / dt : 0;
    if (vx !== 0 || vy !== 0) z.heading = Math.atan2(vy, vx);
    if (z.action === 'wander' && z.speed < v * 0.3) z.wanderT = 0; // hit a wall: turn next time
  }
  s.zombies = s.zombies.filter((z) => z.action !== 'dead' || z.actionT > 0);
  separate(s);
}

/** Push overlapping zombies apart so a crowd spreads out instead of stacking. */
function separate(s: GameState): void {
  const p = s.player.pos;
  const zs = s.zombies.filter((z) => z.action !== 'dead' && dist(z.pos, p) < ZOMBIE_ACTIVE_RADIUS);
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
