// Pure game state. No DOM, no three.js, no Date/Math.random: time comes from dt, randomness from state.rng.
import {
  ATTACK_COOLDOWN, ATTACK_DAMAGE, ATTACK_RANGE, ATTACK_REACH, ATTACK_WINDUP, CALM_FACTOR, CORPSE_SECONDS,
  HIT_INVULNERABLE, KNOCKBACK, MEDKIT_HEAL, PLAYER_ACCEL, PLAYER_HEALTH, PLAYER_RADIUS, PLAYER_SPEED, RISE_SECONDS,
  RUN_OVER_SPEED, RUNNER_SIGHT, RUNNER_SPEED, SAFEHOUSE_RADIUS, SPAWNS_BY_TIER, SPEED_BOOST, TASK_HOLD_SECONDS,
  TASK_RADIUS, TIER_THRESHOLDS, USE_RADIUS, VEHICLES, WALKER_SIGHT_BY_TIER, WALKER_SPEED_BY_TIER, WAVE_SPAWN_MAX_DIST,
  ZOMBIE_ACTIVE_RADIUS, ZOMBIE_CAP, ZOMBIE_RADIUS, ZOMBIE_SPAWN_MIN_DIST, ZOMBIES_PER_BLOCK,
  AIM_CONE, ALERT_SECONDS, BITE_SECONDS, CORPSES_KEPT, SEATS, SWARM, SWARM_EVERY, SWARM_SPEED, BREACH_AT, CHASE, CHASE_ALERT, GUARD_CHANCE, GUARDS, BREACH_DAMAGE, ENGINE_NOISE, ENGINE_NOISE_EVERY, LATCH_DAMAGE, LATCH_DRAG, LATCH_EVERY, LATCH_GRIP,
  LATCH_MAX, LATCH_SHAKE_SPEED, AMMO_PRICES, GUNS, KILL_REWARD, MEDKIT_PRICE, MELEE, MELEE_KNOCKBACK, PICKUP_RADIUS,
  SAFE_AFTER, STAGGER_SECONDS, START_AMMO, START_FUNDS, STORE_DOOR_RADIUS, UPGRADE_BASE, UPGRADE_EFFECT, UPGRADE_FACTOR,
  UPGRADE_LEVELS, WEAPON_PRICES, ZOMBIE_HEALTH,
  ALARM_RADIUS, ALARM_SECONDS, ALARM_SHOT_RADIUS, BOTTLE_FLIGHT, BOTTLE_RANGE, BOTTLES_PRICE, CLEAR_COUNT, FUEL_SECONDS,
  JERRYCAN_FUEL, JERRYCAN_PRICE, LURE_RADIUS, LURE_SECONDS, PUMP_RATE, REFUEL_SECONDS, SEARCH_SECONDS, START_BOTTLES,
  SURVIVOR_FUNDS, TALK_SECONDS,
  CHAPTER_BONUS, CHAPTER_HEAL, CHAPTER_RUNNERS, CHAPTER_WAVES, CHAPTERS, GEAR,
  ESCORT_NEAR, ESCORT_SPEED, FLARE_RADIUS, FLARE_SECONDS,
} from './config';
import { nearbyObstacles } from './collision';
import { lineClear, resolve } from './collision';
import { generateLevel, type Level } from './level';
import { cellOf, distanceField, UNREACHABLE } from './map';
import { createRng, next, pick, range, type Rng } from './rng';
import type {
  Alarm, House, Loot, Survivor, Thrown,
  Crate, Escort, GameEvent, GearKind, GunKind, Input, Interaction, LossReason, MapData, MeleeKind, Phase, Pickup, Store, StoreItem, Task,
  TaskId, UpgradeKind, Vec2, Vehicle, WeaponKind, Zombie, ZombieKind,
} from './types';

export interface Arsenal {
  weapon: WeaponKind | null; // in hand
  owned: WeaponKind[];
  mag: Record<GunKind, number>; // rounds in the magazine
  ammo: Record<GunKind, number>; // spare rounds
  /** Upgrade level bought for each weapon (0..UPGRADE_LEVELS). Melee weapons only take damage. */
  upgrades: Record<WeaponKind, Record<UpgradeKind, number>>;
  fireCd: number;
  reloadT: number; // seconds left on a reload (0 = not reloading)
  swing: number; // counts swings, so the renderer can alternate them
  bottles: number; // to throw as a distraction
  cans: number; // jerrycans of fuel
  /** Protective gear worn, as durability left (0 = not wearing it). */
  gear: Record<GearKind, number>;
}

/** What you bring into a chapter (and start it again with, if you retry it). */
export interface Carry {
  arsenal: Arsenal;
  health: number;
  funds: number;
  kills: number;
}

const cloneArsenal = (a: Arsenal): Arsenal => ({
  ...a,
  owned: a.owned.slice(),
  mag: { ...a.mag },
  ammo: { ...a.ammo },
  upgrades: Object.fromEntries(Object.entries(a.upgrades).map(([k, v]) => [k, { ...v }])) as Arsenal['upgrades'],
  gear: { ...a.gear },
  fireCd: 0,
  reloadT: 0,
});

/** The level seed for a chapter of a night (chapter 0 is the night's own seed). */
export function chapterSeed(night: number, chapter: number): number {
  if (chapter === 0) return night >>> 0;
  let h = (night ^ Math.imul(chapter, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A short job you stand still for: searching a house, talking to a survivor, refuelling a car. */
export interface Work {
  kind: 'search' | 'talk' | 'refuel';
  id: number;
  progress: number; // 0..1
  seconds: number;
}

export const isMelee = (w: WeaponKind): w is MeleeKind => w in MELEE;
export const isGun = (w: WeaponKind): w is GunKind => w in GUNS;

const noUpgrades = () => ({ damage: 0, mag: 0, reload: 0 });

/** A gun's numbers with its upgrades applied. */
export function gunStats(a: Arsenal, w: GunKind) {
  const base = GUNS[w], u = a.upgrades[w];
  return {
    ...base,
    damage: base.damage * (1 + UPGRADE_EFFECT.damage * u.damage),
    mag: Math.round(base.mag * (1 + UPGRADE_EFFECT.mag * u.mag)),
    reload: base.reload * (1 - UPGRADE_EFFECT.reload * u.reload),
  };
}

/** A melee weapon's numbers with its upgrades applied. */
export function meleeStats(a: Arsenal, w: MeleeKind) {
  const base = MELEE[w];
  return { ...base, damage: base.damage * (1 + UPGRADE_EFFECT.damage * a.upgrades[w].damage) };
}

export interface GameState {
  seed: number; // this chapter's level
  night: number; // the night's seed: every chapter's level comes from it
  chapter: number; // 0-based; the last one ends at the helicopter
  carry: Carry; // what you came into this chapter with
  phase: Phase;
  lossReason: LossReason | null;
  map: MapData;
  rng: Rng;
  elapsed: number;
  timeLimit: number;
  remaining: number;
  tier: number;
  player: { pos: Vec2; vel: Vec2; heading: number; health: number; invuln: number; vehicleId: number | null };
  arsenal: Arsenal;
  pickups: Pickup[];
  stores: Store[];
  /** The store whose doorway you are standing in after leaving it (no re-entry until you step out). */
  storeLatch: number | null;
  /** Grace after finishing an objective: zombies keep holding back while you step away. */
  safeT: number;
  houses: House[];
  survivors: Survivor[];
  alarms: Alarm[];
  alarmUsed: number[]; // parked cars (map.buildings indices) whose alarm has gone off
  thrown: Thrown[];
  work: Work | null;
  pumping: boolean;
  kills: number;
  /** Zombie that caught the player, if any (the renderer stages the ending around it). */
  killerId: number | null;
  /** Seconds to the engine's next call to every zombie in earshot. */
  engineT: number;
  /** Seconds until the next "they are on someone" warning. */
  dangerT: number;
  /** Where the dead lie (bodies stay for the chapter). */
  corpses: Array<{ id: number; pos: Vec2; heading: number }>;
  /** Seconds to the next swarm while you drive. */
  swarmT: number;
  /** Objectives already looked at for guards (each gets its chance once, when it comes up). */
  guarded: TaskId[];
  zombies: Zombie[];
  vehicles: Vehicle[];
  crates: Crate[];
  tasks: Task[];
  safehouse: Vec2;
  safehouseKnown: boolean;
  /** Someone following you to safety (Nora), once found. */
  escort: Escort | null;
  /** A lit signal flare: everything near it goes to it while it burns. */
  flare: { pos: Vec2; t: number } | null;
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

export function createGame(
  seed: number,
  lvl?: Level,
  opts: { night?: number; chapter?: number; carry?: Carry } = {},
): GameState {
  const level = lvl ?? generateLevel(seed, { night: opts.night ?? seed, chapter: opts.chapter ?? 0 });
  const carry: Carry = opts.carry ?? {
    arsenal: {
      weapon: 'pistol', owned: ['pistol', 'baton'],
      mag: { pistol: GUNS.pistol.mag, shotgun: 0, rifle: 0 },
      ammo: { ...START_AMMO },
      upgrades: { pistol: noUpgrades(), shotgun: noUpgrades(), rifle: noUpgrades(), baton: noUpgrades(), bat: noUpgrades(), machete: noUpgrades() },
      fireCd: 0, reloadT: 0, swing: 0, bottles: START_BOTTLES, cans: 0, gear: { vest: 0, helmet: 0 },
    },
    health: PLAYER_HEALTH,
    funds: START_FUNDS,
    kills: 0,
  };
  const state: GameState = {
    seed,
    night: opts.night ?? seed,
    chapter: opts.chapter ?? 0,
    carry: { ...carry, arsenal: cloneArsenal(carry.arsenal) },
    phase: 'playing',
    lossReason: null,
    map: level.map,
    rng: createRng(seed ^ 0x9e3779b9),
    elapsed: 0,
    timeLimit: level.timeLimit,
    remaining: level.timeLimit,
    tier: 0,
    player: { pos: { ...level.spawn }, vel: { x: 0, y: 0 }, heading: 0, health: carry.health, invuln: 0, vehicleId: null },
    killerId: null,
    engineT: 0,
    dangerT: 0,
    guarded: [],
    corpses: [],
    swarmT: 0,
    arsenal: cloneArsenal(carry.arsenal),
    pickups: level.pickups.map((p) => ({ ...p, pos: { ...p.pos } })),
    stores: level.stores.map((st) => ({ ...st, pos: { ...st.pos } })),
    storeLatch: null,
    safeT: 0,
    houses: level.houses.map((h) => ({ ...h, pos: { ...h.pos } })),
    survivors: level.survivors.map((v) => ({ ...v, pos: { ...v.pos }, fetchPos: { ...v.fetchPos }, targets: [] })),
    alarms: [],
    alarmUsed: [],
    thrown: [],
    work: null,
    pumping: false,
    kills: carry.kills,
    zombies: [],
    vehicles: level.vehicles.map((v) => ({ ...v, pos: { ...v.pos } })),
    crates: level.crates.map((c) => ({ ...c, pos: { ...c.pos } })),
    tasks: level.tasks.map((t) => ({
      ...t, pos: { ...t.pos }, requires: t.requires.slice(),
      ...(t.parts ? { parts: t.parts.map((q) => ({ ...q })), got: t.got!.slice() } : {}),
    })),
    safehouse: { ...level.safehouse },
    escort: null,
    flare: null,
    safehouseKnown: !level.tasks.some((t) => t.effect === 'reveal-exit'),
    hold: { taskId: null, progress: 0 },
    speedMul: 1,
    zombieMul: 1,
    funds: carry.funds,
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

/** The last chapter: its way out is the helicopter, not a door. */
export function finalChapter(s: GameState): boolean {
  return s.chapter >= CHAPTERS - 1;
}

/** Through the door: the next district, with everything you carry (and a bonus for time left). */
export function nextChapter(s: GameState): GameState {
  const chapter = s.chapter + 1;
  const carry: Carry = {
    arsenal: s.arsenal,
    health: Math.min(PLAYER_HEALTH, s.player.health + CHAPTER_HEAL),
    funds: s.funds + chapterBonus(s),
    kills: s.kills,
  };
  return createGame(chapterSeed(s.night, chapter), undefined, { night: s.night, chapter, carry });
}

/** Funds for the seconds left on the clock when you got out. */
export function chapterBonus(s: GameState): number {
  return Math.floor(s.remaining * CHAPTER_BONUS);
}

/** Start this chapter again, with what you came into it with. */
export function restartChapter(s: GameState): GameState {
  return createGame(s.seed, undefined, { night: s.night, chapter: s.chapter, carry: s.carry });
}

/** Where to go for a step right now: the nearest piece still to find, else the step itself. */
export function taskTarget(s: GameState, t: Task): Vec2 {
  if (t.parts && t.got) {
    let best: Vec2 | null = null, bd = Infinity;
    t.parts.forEach((q, i) => { if (!t.got![i]) { const d = dist(q, s.player.pos); if (d < bd) { bd = d; best = q; } } });
    if (best) return best;
  }
  return t.pos;
}

/** Pieces of a step found so far, and how many there are (null if it has none). */
export function partsOf(t: Task): { got: number; of: number } | null {
  return t.parts && t.got ? { got: t.got.filter(Boolean).length, of: t.parts.length } : null;
}

/** Objectives show up one at a time: done ones, optional ones, and the one you are on now. */
export function isRevealed(s: GameState, t: Task): boolean {
  return t.done || !t.required || t === currentTask(s);
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

/** Working an objective or talking to someone (or just finished): zombies hold back. */
export function isBusy(s: GameState): boolean {
  return s.hold.taskId !== null || s.work !== null || s.safeT > 0;
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
    health: ZOMBIE_HEALTH[kind], staggerT: 0, alertT: 0,
    wanderT: range(s.rng, 0, 3), wanderDir: { x: 0, y: 0 },
  });
}

/** The city's resting population: denser downtown, thin in the outskirts, none near the start. */
function populate(s: GameState): void {
  const cap = ZOMBIE_CAP - 16; // leave room for the waves
  const runners = CHAPTER_RUNNERS[Math.min(s.chapter, CHAPTER_RUNNERS.length - 1)]!; // deeper in, some of them run
  for (const b of s.map.blocks) {
    const rate = ZOMBIES_PER_BLOCK[b.district];
    const n = Math.floor(rate + next(s.rng));
    for (let k = 0; k < n && s.zombies.length < cap; k++) {
      for (let tries = 0; tries < 8; tries++) {
        // inside the block (yards, plazas, lots) or on its kerb
        const p = { x: b.x + range(s.rng, -3, b.size + 3), y: b.y + range(s.rng, -3, b.size + 3) };
        if (s.map.blocked[cellOf(s.map, p)] === 1 || dist(p, s.player.pos) < 28) continue;
        addZombie(s, runners > 0 && next(s.rng) < runners ? 'runner' : 'walker', p, false);
        break;
      }
    }
  }
}

/** A wave arrives from just out of sight. Far-off zombies are recycled to make room. */
/** Make room under the cap by dropping the farthest one, if it is far enough not to be missed. */
function roomFor(s: GameState): boolean {
  if (s.zombies.length < ZOMBIE_CAP) return true;
  let far = -1, farD = 0;
  s.zombies.forEach((z, i) => { const d = dist(z.pos, s.player.pos); if (d > farD) { farD = d; far = i; } });
  if (far < 0 || farD < ZOMBIE_ACTIVE_RADIUS) return false;
  s.zombies.splice(far, 1);
  return true;
}

/**
 * When an objective comes up, it may be guarded: a pack milling about over the thing you need (or
 * over the pieces lying around). They stay put until they see or hear you.
 */
function guardCurrent(s: GameState): void {
  const t = currentTask(s);
  if (!t || s.guarded.includes(t.id)) return;
  s.guarded.push(t.id);
  if (t.kind === 'clear' || t.effect === 'escort-end' || t.needsEscort) return; // those bring their own trouble
  const ch = Math.min(s.chapter, GUARD_CHANCE.length - 1);
  if (next(s.rng) >= GUARD_CHANCE[ch]!) return;
  const spots = t.parts && t.got ? t.parts.filter((_, i) => !t.got![i]) : [t.pos];
  let n = 0;
  for (let k = 0; k < GUARDS[ch]!; k++) {
    const at = spots[k % spots.length]!;
    if (dist(at, s.player.pos) < 18 || !roomFor(s)) continue; // never drop them on top of you
    const a = next(s.rng) * Math.PI * 2, r = range(s.rng, 4, 7);
    addZombie(s, next(s.rng) < 0.25 + 0.15 * ch ? 'runner' : 'walker', { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r }, false);
    const z = s.zombies[s.zombies.length - 1]!;
    z.lure = { ...at };
    z.lureT = 1e9; // they stay with it
    n++;
  }
  if (n) s.events.push({ type: 'guarded', id: t.id, count: n });
}

/** They heard the engine: runners come out of the side streets ahead of you and to the sides, to cut you off. */
function releaseSwarm(s: GameState, v: Vehicle): void {
  const n = SWARM[Math.min(s.chapter, SWARM.length - 1)]!;
  const ahead = { x: v.pos.x + Math.cos(v.heading) * 20, y: v.pos.y + Math.sin(v.heading) * 20 };
  const ring = s.map.points.filter((p) => { const d = dist(p, v.pos); return d >= 18 && d <= 40 && dist(p, ahead) < 30; });
  let k = 0;
  for (; k < n && roomFor(s); k++) {
    const p = pick(s.rng, ring.length > 0 ? ring : s.map.points);
    addZombie(s, 'runner', { x: p.x + range(s.rng, -2, 2), y: p.y + range(s.rng, -2, 2) }, false);
    s.zombies[s.zombies.length - 1]!.alertT = 20;
  }
  if (k) s.events.push({ type: 'swarm', count: k });
}

/** The way out is shown: a pack comes hunting from all round, and keeps coming for a while. */
function releaseChase(s: GameState): void {
  const c = CHASE[Math.min(s.chapter, CHASE.length - 1)]!;
  const kinds: ZombieKind[] = [...Array<ZombieKind>(c.runner).fill('runner'), ...Array<ZombieKind>(c.walker).fill('walker')];
  const ring = s.map.points.filter((p) => { const d = dist(p, s.player.pos); return d >= 24 && d <= 40; });
  let n = 0;
  for (const kind of kinds) {
    if (!roomFor(s)) break;
    const p = pick(s.rng, ring.length > 0 ? ring : s.map.points);
    addZombie(s, kind, { x: p.x + range(s.rng, -2, 2), y: p.y + range(s.rng, -2, 2) }, true);
    s.zombies[s.zombies.length - 1]!.alertT = CHASE_ALERT;
    n++;
  }
  s.events.push({ type: 'chase', count: n });
}

function spawnWave(s: GameState, tier: number): void {
  const wave = SPAWNS_BY_TIER[tier]!;
  const more = CHAPTER_WAVES[Math.min(s.chapter, CHAPTER_WAVES.length - 1)]!;
  const kinds: ZombieKind[] = [
    ...Array<ZombieKind>(Math.round(wave.runner * more)).fill('runner'), ...Array<ZombieKind>(Math.round(wave.walker * more)).fill('walker'),
  ];
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
  if (s.player.vehicleId === null) {
    updateWeapons(s, input, dt);
    if (input.throw) throwBottle(s);
    takePickups(s);
  }
  takeParts(s);
  guardCurrent(s);

  const driving = playerVehicle(s);
  if (driving) {
    drive(driving, input, dt, 1 - LATCH_DRAG * latchedOn(s, driving.id));
    burnFuel(s, driving, dt);
    s.engineT -= dt;
    s.swarmT -= dt;
    if (s.swarmT <= 0) { s.swarmT = SWARM_EVERY; releaseSwarm(s, driving); }
    if (s.engineT <= 0) { s.engineT = ENGINE_NOISE_EVERY; alertWithin(s, driving.kind === 'bike' ? ENGINE_NOISE.bike : ENGINE_NOISE.car); }
  }
  else movePlayer(s, input, dt);
  pumpFuel(s, dt);
  for (const v of s.vehicles) moveVehicle(s, v, dt, v === driving);
  const still = playerVehicle(s); // a wreck may have thrown the player out
  if (still) {
    s.player.pos.x = still.pos.x;
    s.player.pos.y = still.pos.y;
    s.player.vel = { x: Math.cos(still.heading) * still.speed, y: Math.sin(still.heading) * still.speed };
    s.player.heading = still.heading;
  }

  enterStores(s);
  updateWork(s, dt);
  updateThrown(s, dt);
  updateAlarms(s, dt);
  updateSurvivors(s);
  updateEscort(s, dt);
  updateFlare(s, dt);
  updateClear(s);
  s.safeT = Math.max(0, s.safeT - dt);
  s.dangerT = Math.max(0, s.dangerT - dt);
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
  const task = s.tasks.find((t) => !t.done && isRevealed(s, t) && s.hold.taskId !== t.id && dist(t.pos, p) < TASK_RADIUS
    && (!t.got || t.got.every(Boolean)) && t.kind !== 'clear');
  if (task) return { kind: 'task', taskId: task.id };
  const store = s.stores.find((st) => dist(st.pos, p) < USE_RADIUS);
  if (store) return { kind: 'store', storeId: store.id };
  if (s.work) return null; // busy: one job at a time
  const sv = s.survivors.find((v) => v.status !== 'done' && dist(v.pos, p) < 2.6);
  if (sv) return { kind: 'talk', survivorId: sv.id };
  const house = s.houses.find((h) => !h.searched && dist(h.pos, p) < 1.8);
  if (house) return { kind: 'house', houseId: house.id };
  const crate = s.crates.find((c) => !c.opened && dist(c.pos, p) < USE_RADIUS * 0.75);
  if (crate) return { kind: 'crate', crateId: crate.id };
  let best: Vehicle | null = null, bestD = 1.6;
  for (const c of s.vehicles) {
    if (c.wrecked) continue;
    const d = vehicleReach(c, p);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best && s.arsenal.cans > 0 && best.fuel < 0.95) return { kind: 'refuel', vehicleId: best.id };
  if (best) return { kind: 'enter', vehicleId: best.id };
  const parked = parkedCarNear(s, p, 1.6);
  return parked !== null ? { kind: 'alarm', car: parked } : null;
}

/** A parked (undrivable) car within reach whose alarm has not gone off yet. */
function parkedCarNear(s: GameState, p: Vec2, reach: number): number | null {
  for (const idx of nearbyObstacles(s.map, p, reach, [])) {
    const b = s.map.buildings[idx]!;
    if (b.kind !== 'car' || s.alarmUsed.includes(idx)) continue;
    const nx = Math.max(b.x, Math.min(p.x, b.x + b.w)), ny = Math.max(b.y, Math.min(p.y, b.y + b.h));
    if (Math.hypot(p.x - nx, p.y - ny) < reach) return idx;
  }
  return null;
}

function interact(s: GameState): void {
  const it = interactionFor(s);
  if (!it) return;
  switch (it.kind) {
    case 'exit': exitVehicle(s); break;
    case 'enter': {
      const v = s.vehicles.find((x) => x.id === it.vehicleId)!;
      const need = escortGroup(s).length, seats = SEATS[v.kind];
      if (need > seats) { s.events.push({ type: 'no-room', need, seats }); return; } // a car, then
      s.player.vehicleId = it.vehicleId;
      s.swarmT = 0;
      s.hold.taskId = null;
      s.hold.progress = 0;
      s.events.push({ type: 'vehicle-enter', id: it.vehicleId });
      break;
    }
    case 'task': {
      const t = s.tasks.find((x) => x.id === it.taskId)!;
      if (!depsMet(s, t)) {
        s.events.push({ type: 'task-locked', id: t.id, needs: t.requires.filter((id) => !s.tasks.some((x) => x.id === id && x.done)) });
        return;
      }
      if (t.needsEscort && (!s.escort || escortGroup(s).some((m) => dist(m.pos, s.player.pos) > ESCORT_NEAR + 2.5))) {
        s.events.push({ type: 'escort-behind' }); // they have to be with you
        return;
      }
      if (t.kind === 'puzzle') { // the puzzle page: solved there, through solvePuzzle
        s.events.push({ type: 'puzzle-open', id: t.id });
        return;
      }
      s.work = null;
      s.hold.taskId = t.id;
      s.hold.progress = 0;
      s.events.push({ type: 'task-started', id: t.id });
      break;
    }
    case 'store':
      s.storeLatch = it.storeId;
      s.events.push({ type: 'store-open', id: it.storeId });
      break;
    case 'crate': {
      const c = s.crates.find((x) => x.id === it.crateId)!;
      c.opened = true;
      s.events.push({ type: 'crate-opened', id: c.id, loot: c.loot });
      giveLoot(s, c.loot);
      break;
    }
    case 'house': startWork(s, 'search', it.houseId, SEARCH_SECONDS); break;
    case 'talk': startWork(s, 'talk', it.survivorId, TALK_SECONDS); break;
    case 'refuel': startWork(s, 'refuel', it.vehicleId, REFUEL_SECONDS); break;
    case 'alarm': startAlarm(s, it.car); break;
  }
}

function giveLoot(s: GameState, loot: Loot): void {
  if (loot === 'medkit') {
    const before = s.player.health;
    s.player.health = Math.min(PLAYER_HEALTH, s.player.health + MEDKIT_HEAL);
    s.events.push({ type: 'healed', amount: s.player.health - before });
  } else if (loot === 'vest' || loot === 'helmet') wearGear(s, loot);
  else if (loot === 'supplies') s.funds += 25;
  else if (loot === 'ammo') {
    const w = ammoTarget(s);
    const n = Math.ceil(GUNS[w].ammoPack / 2);
    s.arsenal.ammo[w] += n;
    s.events.push({ type: 'pickup', kind: 'ammo', amount: n });
  } else if (loot === 'bottles') {
    s.arsenal.bottles += 2;
    s.events.push({ type: 'pickup', kind: 'bottles', amount: 2 });
  }
}

// ---------------------------------------------------------------- short jobs: search, talk, refuel

function startWork(s: GameState, kind: Work['kind'], id: number, seconds: number): void {
  s.work = { kind, id, progress: 0, seconds };
  s.hold.taskId = null;
  s.hold.progress = 0;
  s.events.push({ type: 'work-started', kind });
}

function workTarget(s: GameState, w: Work): Vec2 | null {
  if (w.kind === 'search') return s.houses.find((h) => h.id === w.id)?.pos ?? null;
  if (w.kind === 'talk') return s.survivors.find((v) => v.id === w.id)?.pos ?? null;
  return s.vehicles.find((v) => v.id === w.id)?.pos ?? null;
}

function updateWork(s: GameState, dt: number): void {
  const w = s.work;
  if (!w) return;
  const at = workTarget(s, w);
  const reach = w.kind === 'refuel' ? 5 : 3;
  if (!at || s.player.vehicleId !== null || dist(at, s.player.pos) > reach) { s.work = null; return; } // walked off
  w.progress += dt / w.seconds;
  if (w.progress < 1) return;
  s.work = null;
  s.safeT = SAFE_AFTER;
  if (w.kind === 'search') {
    const h = s.houses.find((x) => x.id === w.id)!;
    h.searched = true;
    s.events.push({ type: 'house-searched', id: h.id, loot: h.loot, ambush: h.ambush });
    giveLoot(s, h.loot);
    if (h.ambush) {
      // one of them was inside: it comes through the door after you
      const before = s.zombies.length;
      addZombie(s, 'walker', { x: h.pos.x, y: h.pos.y - 1.6 }, false);
      const z = s.zombies[before];
      if (z) { z.alertT = ALERT_SECONDS; z.action = 'chase'; z.heading = Math.PI / 2; }
    }
  } else if (w.kind === 'talk') {
    talkTo(s, s.survivors.find((x) => x.id === w.id)!);
  } else {
    const v = s.vehicles.find((x) => x.id === w.id)!;
    v.fuel = Math.min(1, v.fuel + JERRYCAN_FUEL);
    s.arsenal.cans--;
    s.events.push({ type: 'refueled', id: v.id, from: 'can' });
  }
}

// ---------------------------------------------------------------- survivors

function talkTo(s: GameState, v: Survivor): void {
  if (v.status === 'waiting') {
    v.status = 'asked';
    if (v.request === 'clear') {
      // they were cornered: the infected around them come out of hiding
      for (let k = 0; k < CLEAR_COUNT; k++) {
        const a = (k / CLEAR_COUNT) * Math.PI * 2 + next(s.rng);
        const r = range(s.rng, 7, 10);
        const pos = { x: v.pos.x + Math.cos(a) * r, y: v.pos.y + Math.sin(a) * r };
        if (s.map.blocked[cellOf(s.map, pos)] === 1) continue;
        const id = s.nextZombieId;
        addZombie(s, 'walker', pos, true);
        v.targets.push(id);
      }
      if (v.targets.length === 0) v.status = 'ready';
    }
    s.events.push({ type: 'survivor-asked', id: v.id, first: true });
    return;
  }
  if (v.status === 'ready' || (v.status === 'asked' && v.request === 'fetch' && v.carrying)) {
    v.status = 'done';
    v.carrying = false;
    reward(s, v);
    return;
  }
  s.events.push({ type: 'survivor-asked', id: v.id, first: false }); // a reminder
}

function reward(s: GameState, v: Survivor): void {
  const a = s.arsenal;
  let what = v.reward;
  if (what === 'weapon') {
    const w = (['shotgun', 'machete', 'rifle'] as const).find((x) => !a.owned.includes(x));
    if (w) giveWeapon(s, w); else what = 'funds';
  }
  if (what === 'intel') {
    if (!s.safehouseKnown) s.safehouseKnown = true; else what = 'funds';
  }
  if (what === 'ammo') for (const g of a.owned) if (isGun(g)) a.ammo[g] += GUNS[g].ammoPack;
  if (what === 'funds') s.funds += SURVIVOR_FUNDS;
  s.events.push({ type: 'survivor-done', id: v.id, reward: what });
}

function updateSurvivors(s: GameState): void {
  for (const v of s.survivors) {
    if (v.status !== 'asked') continue;
    if (v.request === 'fetch' && !v.carrying && s.player.vehicleId === null && dist(v.fetchPos, s.player.pos) < PICKUP_RADIUS) {
      v.carrying = true;
      s.events.push({ type: 'fetched', id: v.id });
    }
    if (v.request === 'clear' && v.targets.every((id) => { const z = s.zombies.find((q) => q.id === id); return !z || z.action === 'dead'; })) {
      v.status = 'ready';
      s.events.push({ type: 'survivor-ready', id: v.id });
    }
  }
}

// ---------------------------------------------------------------- distractions: bottles, car alarms

/** Everything within `radius` of a noise stops hunting and walks over to it. */
function lure(s: GameState, pos: Vec2, radius: number, seconds: number): void {
  for (const z of s.zombies) {
    if (z.action === 'dead' || z.action === 'rise' || z.action === 'feed') continue;
    if (dist(z.pos, pos) > radius) continue;
    z.lure = { ...pos };
    z.lureT = Math.max(z.lureT ?? 0, seconds);
    z.alertT = 0;
  }
}

function throwBottle(s: GameState): void {
  const a = s.arsenal;
  if (a.bottles <= 0) return;
  const p = s.player.pos;
  const hx = Math.cos(s.player.heading), hy = Math.sin(s.player.heading);
  // it flies over cars and fences, but lands on open ground: pull it back if it would land inside something
  let r = BOTTLE_RANGE;
  let to = { x: p.x + hx * r, y: p.y + hy * r };
  while (r > 2 && (to.x < 1 || to.y < 1 || to.x > s.map.size - 1 || to.y > s.map.size - 1 || s.map.blocked[cellOf(s.map, to)] === 1)) {
    r -= 0.5;
    to = { x: p.x + hx * r, y: p.y + hy * r };
  }
  a.bottles--;
  s.thrown.push({ from: { ...p }, to, t: 0, dur: BOTTLE_FLIGHT });
  s.events.push({ type: 'throw', to });
}

function updateThrown(s: GameState, dt: number): void {
  for (const b of s.thrown) {
    b.t += dt;
    if (b.t < b.dur) continue;
    s.events.push({ type: 'bottle-smash', pos: b.to });
    lure(s, b.to, LURE_RADIUS, LURE_SECONDS);
  }
  s.thrown = s.thrown.filter((b) => b.t < b.dur);
}

function startAlarm(s: GameState, idx: number): void {
  if (s.alarmUsed.includes(idx)) return;
  const b = s.map.buildings[idx]!;
  const pos = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  s.alarmUsed.push(idx);
  s.alarms.push({ car: idx, pos, t: ALARM_SECONDS });
  s.events.push({ type: 'alarm-start', car: idx, pos });
  lure(s, pos, ALARM_RADIUS, 2);
}

function updateAlarms(s: GameState, dt: number): void {
  for (const al of s.alarms) {
    al.t -= dt;
    if (al.t > 0) lure(s, al.pos, ALARM_RADIUS, 2); // keeps calling while it sounds
    else s.events.push({ type: 'alarm-stop', car: al.car });
  }
  s.alarms = s.alarms.filter((al) => al.t > 0);
}

// ---------------------------------------------------------------- fuel

function burnFuel(s: GameState, v: Vehicle, dt: number): void {
  if (v.fuel <= 0) return;
  v.fuel = Math.max(0, v.fuel - (Math.abs(v.speed) / VEHICLES[v.kind].maxSpeed) * (dt / FUEL_SECONDS));
  if (v.fuel === 0) s.events.push({ type: 'out-of-fuel', id: v.id });
}

/** Stopped at a gas pump in a car: the tank fills. */
function pumpFuel(s: GameState, dt: number): void {
  const v = playerVehicle(s);
  const at = v && Math.abs(v.speed) < 1 && v.fuel < 1 && nearbyObstacles(s.map, v.pos, 4.5, []).some((i) => s.map.buildings[i]!.kind === 'pump');
  if (!v || !at) { s.pumping = false; return; }
  if (!s.pumping) s.events.push({ type: 'refueled', id: v.id, from: 'pump' });
  s.pumping = true;
  v.fuel = Math.min(1, v.fuel + PUMP_RATE * dt);
}

// ---------------------------------------------------------------- weapons, pickups and the store

/** Which gun loose ammo goes to: the gun in hand, else the first gun you own. */
function ammoTarget(s: GameState): GunKind {
  const a = s.arsenal;
  if (a.weapon && isGun(a.weapon)) return a.weapon;
  return (a.owned.find(isGun) as GunKind | undefined) ?? 'pistol';
}

function takePickups(s: GameState): void {
  const a = s.arsenal;
  for (const pk of s.pickups) {
    if (pk.taken || dist(pk.pos, s.player.pos) > PICKUP_RADIUS) continue;
    pk.taken = true;
    if (pk.kind === 'ammo') {
      const w = ammoTarget(s);
      a.ammo[w] += GUNS[w].ammoPack;
      s.events.push({ type: 'pickup', kind: 'ammo', amount: GUNS[w].ammoPack });
    } else if (pk.kind === 'bottles') {
      a.bottles += 3;
      s.events.push({ type: 'pickup', kind: 'bottles', amount: 3 });
    } else if (pk.kind === 'jerrycan') {
      a.cans += 1;
      s.events.push({ type: 'pickup', kind: 'jerrycan', amount: 1 });
    } else if (pk.kind === 'vest' || pk.kind === 'helmet') {
      wearGear(s, pk.kind);
      s.events.push({ type: 'pickup', kind: pk.kind, amount: GEAR[pk.kind].durability });
    } else {
      giveWeapon(s, pk.kind);
      s.events.push({ type: 'pickup', kind: pk.kind, amount: isGun(pk.kind) ? GUNS[pk.kind].mag : 0 });
    }
  }
}

/** Put on (or replace) a piece of protective gear, good as new. */
function wearGear(s: GameState, g: GearKind): void {
  s.arsenal.gear[g] = GEAR[g].durability;
}

/** Hurt the player. Gear takes its share first, and wears down by what it took. Returns the damage
 * that got through. */
export function hurtPlayer(s: GameState, amount: number): number {
  let through = amount;
  for (const g of ['vest', 'helmet'] as const) {
    const left = s.arsenal.gear[g];
    if (left <= 0) continue;
    const took = Math.min(left, amount * GEAR[g].absorb);
    s.arsenal.gear[g] = left - took;
    through -= took;
    s.events.push({ type: 'gear-hit', gear: g, absorbed: took });
    if (s.arsenal.gear[g] <= 1e-6) { s.arsenal.gear[g] = 0; s.events.push({ type: 'gear-broken', gear: g }); }
  }
  s.player.health -= through;
  return through;
}

function giveWeapon(s: GameState, w: WeaponKind): void {
  const a = s.arsenal;
  if (isGun(w)) {
    if (!a.owned.includes(w)) a.mag[w] = gunStats(a, w).mag;
    a.ammo[w] += GUNS[w].ammoPack;
  }
  if (!a.owned.includes(w)) a.owned.push(w);
  a.weapon = w; // pick it up, hold it
  a.reloadT = 0;
}

/** Walk through a store's doorway to go in. Leaving puts you back in the doorway, so the store
 * stays shut until you step out of it. */
function enterStores(s: GameState): void {
  if (s.player.vehicleId !== null) return;
  const p = s.player.pos;
  if (s.storeLatch !== null) {
    const st = s.stores.find((x) => x.id === s.storeLatch);
    if (!st || dist(st.pos, p) > STORE_DOOR_RADIUS + 1.5) s.storeLatch = null;
    return;
  }
  for (const st of s.stores) {
    if (dist(st.pos, p) > STORE_DOOR_RADIUS) continue;
    // only when heading in, not when walking past along the pavement
    const into = -(s.player.vel.x * st.front.facing.x + s.player.vel.y * st.front.facing.y);
    if (into < 0.5) continue;
    s.storeLatch = st.id;
    s.events.push({ type: 'store-open', id: st.id });
    return;
  }
}

/** Price of a store item right now, or null if it is not for sale to you (owned, maxed out). */
export function priceOf(s: GameState, item: StoreItem): number | null {
  const a = s.arsenal;
  switch (item.kind) {
    case 'weapon': return a.owned.includes(item.weapon) ? null : WEAPON_PRICES[item.weapon];
    case 'ammo': return a.owned.includes(item.weapon) ? AMMO_PRICES[item.weapon] : null;
    case 'medkit': return MEDKIT_PRICE;
    case 'bottles': return BOTTLES_PRICE;
    case 'jerrycan': return JERRYCAN_PRICE;
    case 'gear': {
      // new, or a worn one swapped for new at the price of the wear
      const left = a.gear[item.gear] / GEAR[item.gear].durability;
      if (left >= 0.999) return null;
      return Math.max(10, Math.round(GEAR[item.gear].price * (1 - left)));
    }
    case 'upgrade': {
      if (!a.owned.includes(item.weapon)) return null;
      if (isMelee(item.weapon) && item.upgrade !== 'damage') return null;
      const level = a.upgrades[item.weapon][item.upgrade];
      if (level >= UPGRADE_LEVELS) return null;
      return Math.round(UPGRADE_BASE[item.weapon] * UPGRADE_FACTOR[item.upgrade] * (level + 1));
    }
  }
}

/** Buy from a weapon store. Pure: returns false (and changes nothing) if it is not for sale or you
 * cannot afford it. */
export function buy(s: GameState, item: StoreItem): boolean {
  const price = priceOf(s, item);
  if (price === null || s.funds < price) return false;
  s.funds -= price;
  const a = s.arsenal;
  switch (item.kind) {
    case 'weapon': giveWeapon(s, item.weapon); break;
    case 'ammo': a.ammo[item.weapon] += GUNS[item.weapon].ammoPack; break;
    case 'medkit': s.player.health = Math.min(PLAYER_HEALTH, s.player.health + MEDKIT_HEAL); break;
    case 'bottles': a.bottles += 3; break;
    case 'jerrycan': a.cans += 1; break;
    case 'gear': wearGear(s, item.gear); break;
    case 'upgrade': {
      a.upgrades[item.weapon][item.upgrade]++;
      // a bigger magazine comes loaded
      if (item.upgrade === 'mag' && isGun(item.weapon)) {
        const w = item.weapon;
        const take = Math.min(gunStats(a, w).mag - a.mag[w], a.ammo[w]);
        a.mag[w] += Math.max(0, take);
        a.ammo[w] -= Math.max(0, take);
      }
      break;
    }
  }
  s.events.push({ type: 'purchase', item });
  return true;
}

/** Take a weapon you own in hand (from the store's page or a weapon wheel). */
export function equip(s: GameState, w: WeaponKind): boolean {
  const a = s.arsenal;
  if (!a.owned.includes(w) || a.weapon === w) return false;
  a.weapon = w;
  a.reloadT = 0;
  a.fireCd = 0.25;
  s.events.push({ type: 'equip', weapon: w });
  return true;
}

/** Where the first obstacle blocks a ray, as a distance (Infinity if none within range). */
function rayToWall(s: GameState, from: Vec2, dx: number, dy: number, range: number): number {
  const near: number[] = [];
  for (let t = 0.5; t <= range; t += 0.5) {
    const x = from.x + dx * t, y = from.y + dy * t;
    if (x < 0 || y < 0 || x > s.map.size || y > s.map.size) return t;
    for (const idx of nearbyObstacles(s.map, { x, y }, 0.1, near)) {
      const b = s.map.buildings[idx]!;
      if (b.kind === 'water' || b.height < 1.2) continue; // shoot over water, fences, barrels
      if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return t;
    }
  }
  return Infinity;
}

/** Aim assist: the best zombie in front of you within range and in the open, if any. */
export function aimTarget(s: GameState, w: WeaponKind): Zombie | null {
  const range = isGun(w) ? GUNS[w].range : MELEE[w].range + 1.5; // melee turns you to face one in reach
  const p = s.player.pos;
  let best: Zombie | null = null, bestScore = Infinity;
  for (const z of s.zombies) {
    if (z.action === 'dead') continue;
    const dx = z.pos.x - p.x, dy = z.pos.y - p.y, d = Math.hypot(dx, dy);
    if (d > range || d < 1e-3) continue;
    const off = Math.abs(wrap(Math.atan2(dy, dx) - s.player.heading));
    if (off > AIM_CONE && d > 3) continue; // behind you, unless it is right on top of you
    if (rayToWall(s, p, dx / d, dy / d, d) < d) continue;
    const score = d + off * 6;
    if (score < bestScore) { bestScore = score; best = z; }
  }
  return best;
}

function hurtZombie(s: GameState, z: Zombie, damage: number, dirX: number, dirY: number, stagger = STAGGER_SECONDS, knock = 0.25): void {
  z.health -= damage;
  z.alertT = ALERT_SECONDS;
  if (z.health <= 0) {
    z.action = 'dead';
    z.actionT = CORPSE_SECONDS;
    z.speed = 0;
    z.heading = Math.atan2(-dirY, -dirX); // falls away from the shot
    s.kills++;
    s.funds += KILL_REWARD;
    s.events.push({ type: 'zombie-killed', id: z.id });
    return;
  }
  // a hit makes it flinch, and spoils a lunge
  z.staggerT = stagger;
  if (z.action === 'attack') { z.action = 'chase'; z.cooldown = ATTACK_COOLDOWN * 0.5; }
  z.pos.x += dirX * knock;
  z.pos.y += dirY * knock;
  s.events.push({ type: 'zombie-hurt', id: z.id });
}

function startReload(s: GameState, w: GunKind): void {
  const a = s.arsenal;
  if (a.reloadT > 0 || a.ammo[w] <= 0 || a.mag[w] >= gunStats(a, w).mag) return;
  a.reloadT = gunStats(a, w).reload;
  s.events.push({ type: 'reload', weapon: w });
}

function updateWeapons(s: GameState, input: Input, dt: number): void {
  const a = s.arsenal;
  a.fireCd = Math.max(0, a.fireCd - dt);
  if (input.swap && a.owned.length > 1) {
    const i = a.weapon ? a.owned.indexOf(a.weapon) : -1;
    a.weapon = a.owned[(i + 1) % a.owned.length]!;
    a.reloadT = 0;
    a.fireCd = 0.25;
  }
  const w = a.weapon;
  if (!w) return;
  if (isMelee(w)) { swingMelee(s, w, input); return; }
  const spec = gunStats(a, w);
  if (a.reloadT > 0) {
    a.reloadT -= dt;
    if (a.reloadT <= 0) {
      a.reloadT = 0;
      const take = Math.min(spec.mag - a.mag[w], a.ammo[w]);
      a.mag[w] += take;
      a.ammo[w] -= take;
    }
    return;
  }
  if (input.reload) { startReload(s, w); return; }
  if (!input.fire || a.fireCd > 0) return;
  if (a.mag[w] <= 0) {
    if (a.ammo[w] > 0) startReload(s, w);
    else { s.events.push({ type: 'empty', weapon: w }); a.fireCd = 0.4; }
    return;
  }

  // aim: snap to the best target in front, otherwise fire where you face
  const p = s.player.pos;
  const target = aimTarget(s, w);
  const aim = target ? Math.atan2(target.pos.y - p.y, target.pos.x - p.x) : s.player.heading;
  s.player.heading = aim;
  a.mag[w]--;
  a.fireCd = spec.interval;

  for (let k = 0; k < spec.pellets; k++) {
    const ang = aim + (next(s.rng) - 0.5) * spec.spread;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const wall = rayToWall(s, p, dx, dy, spec.range);
    const reach = Math.min(spec.range, wall);
    // first zombie the ray passes through
    let hit: Zombie | null = null, hitT = reach;
    for (const z of s.zombies) {
      if (z.action === 'dead') continue;
      const ox = z.pos.x - p.x, oy = z.pos.y - p.y;
      const t = ox * dx + oy * dy;
      if (t <= 0 || t >= hitT) continue;
      if (Math.abs(ox * dy - oy * dx) > ZOMBIE_RADIUS + 0.2) continue;
      hit = z; hitT = t;
    }
    if (hit) hurtZombie(s, hit, spec.damage * (hitT > spec.range * 0.6 ? 0.7 : 1), dx, dy);
    if (k === 0) s.events.push({ type: 'shot', weapon: w, from: { ...p }, to: { x: p.x + dx * hitT, y: p.y + dy * hitT }, hit: hit?.id ?? null });
  }

  alertWithin(s, spec.noise);
  const car = parkedCarNear(s, p, ALARM_SHOT_RADIUS); // shooting next to a parked car sets it off
  if (car !== null) startAlarm(s, car);
}

/** Noise carries: everything within earshot comes looking. */
function alertWithin(s: GameState, radius: number): void {
  const p = s.player.pos;
  for (const z of s.zombies) {
    if (z.action !== 'dead' && z.action !== 'rise' && dist(z.pos, p) < radius) { z.alertT = Math.max(z.alertT, ALERT_SECONDS); z.lureT = 0; }
  }
}

/** A melee swing: turn to the nearest one in reach, hit whatever is in the arc (a bat can hit
 * several), shove them back. Quiet, no ammo, but you have to be close. */
function swingMelee(s: GameState, w: MeleeKind, input: Input): void {
  const a = s.arsenal;
  if (!input.fire || a.fireCd > 0) return;
  const spec = meleeStats(a, w);
  const p = s.player.pos;
  const target = aimTarget(s, w);
  if (target) s.player.heading = Math.atan2(target.pos.y - p.y, target.pos.x - p.x);
  a.fireCd = spec.interval;
  a.swing++;
  const inArc = s.zombies
    .filter((z) => z.action !== 'dead')
    .map((z) => ({ z, d: dist(z.pos, p) }))
    .filter(({ z, d }) => d < spec.range + ZOMBIE_RADIUS && (d < 0.8 || Math.abs(wrap(Math.atan2(z.pos.y - p.y, z.pos.x - p.x) - s.player.heading)) < spec.arc / 2))
    .sort((x, y) => x.d - y.d)
    .slice(0, spec.cleave);
  for (const { z, d } of inArc) {
    const dx = d > 1e-6 ? (z.pos.x - p.x) / d : Math.cos(s.player.heading);
    const dy = d > 1e-6 ? (z.pos.y - p.y) / d : Math.sin(s.player.heading);
    hurtZombie(s, z, spec.damage, dx, dy, spec.stagger, MELEE_KNOCKBACK);
  }
  s.events.push({ type: 'swing', weapon: w, hits: inArc.length });
  alertWithin(s, spec.noise);
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
function drive(v: Vehicle, input: Input, dt: number, load = 1): void {
  if (v.wrecked) return;
  const base = VEHICLES[v.kind];
  const spec = { ...base, maxSpeed: base.maxSpeed * load };
  const mag = v.fuel > 0 ? Math.min(1, Math.hypot(input.dx, input.dy)) : 0; // an empty tank coasts
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
      for (const z of s.zombies) if (z.latch === v.id) shakeOff(s, z, v, 0.6);
      v.speed *= -0.2;
      damageVehicle(s, v, (force - 5) * 3);
    } else {
      v.speed *= 0.6;
    }
  }

  // zombies: knocked down at speed, shoved aside when slow
  for (const z of s.zombies) {
    if (z.action === 'dead' || z.latch != null) continue;
    for (const c of vehicleCircles(v)) {
      if (Math.hypot(z.pos.x - c.x, z.pos.y - c.y) >= c.r + ZOMBIE_RADIUS) continue;
      if (Math.abs(v.speed) > RUN_OVER_SPEED) {
        z.action = 'dead';
        z.actionT = CORPSE_SECONDS;
        z.speed = 0;
        z.heading = v.heading + Math.PI; // falls back from the bumper
        v.speed *= 0.82;
        s.kills++;
        s.funds += KILL_REWARD;
        s.events.push({ type: 'zombie-killed', id: z.id });
        damageVehicle(s, v, spec.health * 0.03);
      } else {
        pushOutOfVehicle(v, z.pos, ZOMBIE_RADIUS);
      }
      break;
    }
  }
}

/** How many are hanging on to a vehicle. */
export function latchedOn(s: GameState, id: number): number {
  let n = 0;
  for (const z of s.zombies) if (z.latch === id && z.action !== 'dead') n++;
  return n;
}

/** Off it goes: thrown clear of the body, dazed, hurt by the fall. */
function shakeOff(s: GameState, z: Zombie, v: Vehicle, hurt: number): void {
  z.latch = null;
  z.latchT = 0;
  z.action = 'chase';
  z.staggerT = 1.2;
  const dx = z.pos.x - v.pos.x, dy = z.pos.y - v.pos.y, d = Math.hypot(dx, dy) || 1;
  z.pos.x += (dx / d) * 1.2;
  z.pos.y += (dy / d) * 1.2;
  resolve(s.map, z.pos, ZOMBIE_RADIUS);
  z.health -= hurt * 100;
  if (z.health <= 0) {
    z.action = 'dead';
    z.actionT = CORPSE_SECONDS;
    z.speed = 0;
    s.kills++;
    s.funds += KILL_REWARD;
    s.events.push({ type: 'zombie-killed', id: z.id });
  }
  s.events.push({ type: 'shaken', id: z.id });
}

/** Grab on to the vehicle at the point of the body nearest to it. */
function latchOn(s: GameState, z: Zombie, v: Vehicle): boolean {
  if (latchedOn(s, v.id) >= LATCH_MAX) return false;
  const spec = VEHICLES[v.kind];
  const c = Math.cos(v.heading), sn = Math.sin(v.heading);
  const rx = z.pos.x - v.pos.x, ry = z.pos.y - v.pos.y;
  const along = Math.max(-spec.length / 2, Math.min(spec.length / 2, rx * c + ry * sn));
  const across = rx * -sn + ry * c;
  // on the sides it holds the door frame; at the ends, the bonnet or the boot
  const side = Math.abs(along) < spec.length / 2 - 0.4;
  z.latch = v.id;
  z.latchT = 0;
  z.latchAt = side
    ? { x: along, y: Math.sign(across || 1) * (spec.width / 2 + ZOMBIE_RADIUS * 0.6) }
    : { x: Math.sign(along) * (spec.length / 2 + ZOMBIE_RADIUS * 0.6), y: Math.max(-spec.width / 3, Math.min(spec.width / 3, across)) };
  z.action = 'cling';
  z.cooldown = LATCH_EVERY * 0.5;
  s.events.push({ type: 'latched', id: z.id, count: latchedOn(s, v.id) });
  return true;
}

/** Hanging on: rides along, claws at the car, reaches in once it is beaten enough; lets go at speed. */
function updateLatched(s: GameState, z: Zombie, dt: number): void {
  const v = s.vehicles.find((x) => x.id === z.latch);
  if (!v || v.wrecked || s.player.vehicleId !== v.id) { // the car is dead or you got out: after you
    z.latch = null;
    z.action = 'chase';
    z.alertT = Math.max(z.alertT, ALERT_SECONDS);
    return;
  }
  const c = Math.cos(v.heading), sn = Math.sin(v.heading), at = z.latchAt!;
  z.pos.x = v.pos.x + at.x * c - at.y * sn;
  z.pos.y = v.pos.y + at.x * sn + at.y * c;
  z.heading = Math.atan2(v.pos.y - z.pos.y, v.pos.x - z.pos.x);
  z.speed = 0;
  if (Math.abs(v.speed) > LATCH_SHAKE_SPEED) {
    z.latchT = (z.latchT ?? 0) + dt;
    if (z.latchT > LATCH_GRIP) { shakeOff(s, z, v, Math.abs(v.speed) > 15 ? 0.8 : 0.3); return; }
  } else z.latchT = Math.max(0, (z.latchT ?? 0) - dt * 0.5);
  z.cooldown = Math.max(0, z.cooldown - dt);
  if (z.cooldown > 0) return;
  z.cooldown = LATCH_EVERY;
  const spec = VEHICLES[v.kind];
  const wasWhole = v.health > spec.health * BREACH_AT;
  s.events.push({ type: 'vehicle-crash', id: v.id, force: 2 });
  damageVehicle(s, v, LATCH_DAMAGE);
  if (s.player.vehicleId !== v.id) return; // wrecked: you were thrown out
  if (v.health > spec.health * BREACH_AT) return;
  if (wasWhole) s.events.push({ type: 'vehicle-breached', id: v.id });
  // the glass is gone: it reaches in
  const took = hurtPlayer(s, BREACH_DAMAGE);
  s.events.push({ type: 'player-hit', damage: took, by: z.id });
  if (s.player.health <= 0) {
    s.player.health = 0;
    s.killerId = z.id;
    exitVehicle(s);
    z.latch = null;
    z.action = 'feed';
    lose(s, 'caught');
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
  s.hold.progress += dt / (t.seconds ?? TASK_HOLD_SECONDS);
  if (s.hold.progress < 1) return;
  s.hold.taskId = null;
  s.hold.progress = 0;
  completeTask(s, t);
}

/** A step is done: the grace moment, its effect, its cost and reward. */
function completeTask(s: GameState, t: Task): void {
  t.done = true;
  s.safeT = SAFE_AFTER;
  s.events.push({ type: 'task-done', id: t.id });
  stepDone(s, t);
  if (t.timeCost > 0) {
    s.remaining -= t.timeCost;
    s.events.push({ type: 'time-penalty', seconds: t.timeCost });
    if (s.remaining <= 0) { s.remaining = 0; lose(s, 'time'); return; }
  }
  if (t.reward === 'speed') s.speedMul = SPEED_BOOST;
  else if (t.reward === 'calm') s.zombieMul = CALM_FACTOR;
  else if (t.reward === 'funds') s.funds += 50;
}

/** What finishing a step does to the night (its effect, from the task content). */
function stepDone(s: GameState, t: Task): void {
  switch (t.effect) {
    case 'reveal-exit': s.safehouseKnown = true; releaseChase(s); break;
    case 'escort-start': { // they come out of hiding and follow you, the rest of a group in a line behind
      const { party, ...lead } = t.escort!;
      const at = (k: number) => ({ pos: { x: t.pos.x + 1 + k * 0.8, y: t.pos.y + 1 }, heading: 0, speed: 0, riding: false });
      s.escort = { ...at(0), ...lead, party: party?.map((m, k) => ({ ...at(k + 1), ...m })) };
      break;
    }
      break;
    case 'escort-end': s.escort = null; break; // safe inside
    case 'lure': // a flare, bait: everything near it goes to it for a while
      s.flare = { pos: { ...t.pos }, t: FLARE_SECONDS };
      s.events.push({ type: 'flare-lit', pos: { ...t.pos } });
      lure(s, t.pos, FLARE_RADIUS, 3);
      break;
    case 'horde': // the noise brings them
      s.events.push({ type: 'horde', pos: { ...t.pos } });
      spawnWave(s, Math.max(1, s.tier));
      break;
    default: break;
  }
}

/** The puzzle page's answer. Checked here (so a replay checks it too); right completes the step.
 * tiles: turns made on each tile; keypad: the digits; wires: for each left wire, the right end it
 * was joined to. */
export function solvePuzzle(s: GameState, id: TaskId, answer: number[] | string): boolean {
  const t = s.tasks.find((x) => x.id === id);
  if (!t || t.done || t.kind !== 'puzzle' || !isRevealed(s, t) || s.phase !== 'playing') return false;
  let right = false;
  if (t.puzzle === 'keypad') right = typeof answer === 'string' && answer === t.code;
  else if (t.puzzle === 'tiles') right = Array.isArray(answer) && answer.length === 9 && t.scramble!.every((r, i) => (r + answer[i]!) % 4 === 0);
  else if (t.puzzle === 'wires') right = Array.isArray(answer) && answer.length === 4 && answer.every((j, i) => t.scramble![j] === i);
  if (!right) { s.events.push({ type: 'puzzle-wrong', id }); return false; }
  completeTask(s, t);
  return true;
}

/** A clear step: they come for you once you get close; it is done when they are all down. */
function updateClear(s: GameState): void {
  const t = currentTask(s);
  if (!t || t.kind !== 'clear') return;
  if (!t.targets) {
    if (dist(t.pos, s.player.pos) > 26) return;
    t.targets = [];
    for (let k = 0; k < (t.clear ?? 4); k++) {
      const a = (k / (t.clear ?? 4)) * Math.PI * 2 + next(s.rng);
      t.targets.push(s.nextZombieId);
      addZombie(s, k % 3 === 2 ? 'runner' : 'walker', { x: t.pos.x + Math.cos(a) * range(s.rng, 4, 8), y: t.pos.y + Math.sin(a) * range(s.rng, 4, 8) }, true);
      s.zombies[s.zombies.length - 1]!.alertT = 30; // they know you are there
    }
    s.events.push({ type: 'clear-start', id: t.id, count: t.targets.length });
    return;
  }
  const left = s.zombies.filter((z) => t.targets!.includes(z.id) && z.action !== 'dead').length;
  if (left === 0) completeTask(s, t);
}

/** How many are left to clear at a clear step (null if they have not come yet). */
export function clearLeft(s: GameState, t: Task): number | null {
  if (!t.targets) return null;
  return s.zombies.filter((z) => t.targets!.includes(z.id) && z.action !== 'dead').length;
}

/** Walk over a piece of the current step (a fuse) to take it. */
function takeParts(s: GameState): void {
  const t = currentTask(s);
  if (!t?.parts || !t.got) return;
  t.parts.forEach((q, i) => {
    const v = playerVehicle(s);
    const reach = PICKUP_RADIUS + 0.4 + (v ? VEHICLES[v.kind].length / 2 : 0); // lean out and grab it
    if (t.got![i] || dist(q, s.player.pos) > reach) return;
    t.got![i] = true;
    const n = partsOf(t)!;
    s.events.push({ type: 'part-taken', id: t.id, got: n.got, of: n.of });
  });
}

/** Nora follows you through the streets (the same way they do), and rides along in a car. */
/** Everyone you are bringing in: the one you found first, then the rest of the group. */
export function escortGroup(s: GameState): Escort[] {
  return s.escort ? [s.escort, ...(s.escort.party ?? [])] : [];
}

/** Your group follows you through the streets in a line (the same way they do), and rides along in a car. */
function updateEscort(s: GameState, dt: number): void {
  let ahead = s.player.pos;
  for (const e of escortGroup(s)) { follow(s, e, ahead, dt); ahead = e.pos; }
}

function follow(s: GameState, e: Escort, p: Vec2, dt: number): void {
  const car = playerVehicle(s);
  if (car) { e.riding = true; e.pos = { ...car.pos }; e.speed = 0; return; }
  if (e.riding) { e.riding = false; e.pos = { x: s.player.pos.x + 1, y: s.player.pos.y }; resolve(s.map, e.pos, PLAYER_RADIUS); }
  const dx = p.x - e.pos.x, dy = p.y - e.pos.y, d = Math.hypot(dx, dy);
  let vx = 0, vy = 0;
  if (d > (p === s.player.pos ? 2.2 : 1.5)) {
    if (d < 3 || lineClear(s.map, e.pos, p, PLAYER_RADIUS)) { vx = dx / d; vy = dy / d; }
    else {
      const cols = s.map.cols, c = cellOf(s.map, e.pos);
      let best = s.flow[c] as number, bc = -1;
      for (const n of [c - 1, c + 1, c - cols, c + cols]) {
        if (n < 0 || n >= s.flow.length) continue;
        if ((s.flow[n] as number) < best) { best = s.flow[n] as number; bc = n; }
      }
      if (bc >= 0 && best !== UNREACHABLE) {
        const tx = (bc % cols) + 0.5 - e.pos.x, ty = Math.floor(bc / cols) + 0.5 - e.pos.y, tl = Math.hypot(tx, ty) || 1;
        vx = tx / tl; vy = ty / tl;
      }
    }
  }
  // left far behind (you drove off and got out somewhere else): she catches up the back way
  if (d > 45) { e.pos = { x: p.x - Math.cos(s.player.heading) * 2, y: p.y - Math.sin(s.player.heading) * 2 }; resolve(s.map, e.pos, PLAYER_RADIUS); }
  if (d > 45) return;
  const before = { ...e.pos };
  const v = ESCORT_SPEED * (d > 8 ? 1.15 : 1);
  e.pos.x += vx * v * dt;
  e.pos.y += vy * v * dt;
  resolve(s.map, e.pos, PLAYER_RADIUS);
  for (const c of s.vehicles) pushOutOfVehicle(c, e.pos, PLAYER_RADIUS);
  e.speed = dt > 0 ? Math.hypot(e.pos.x - before.x, e.pos.y - before.y) / dt : 0;
  if (vx !== 0 || vy !== 0) e.heading = Math.atan2(vy, vx);
}

/** A burning flare keeps pulling everything near it. */
function updateFlare(s: GameState, dt: number): void {
  const f = s.flare;
  if (!f) return;
  f.t -= dt;
  if (f.t <= 0) { s.flare = null; return; }
  lure(s, f.pos, FLARE_RADIUS, 1);
}

function updateSafehouse(s: GameState): void {
  const inside = dist(s.safehouse, s.player.pos) < SAFEHOUSE_RADIUS + (s.player.vehicleId !== null ? 2 : 0);
  if (!inside) {
    s.lockedNotice = null;
    return;
  }
  if (requiredDone(s) && !finalChapter(s)) {
    s.phase = 'cleared'; // through the door into the next district
    s.events.push({ type: 'chapter-cleared', chapter: s.chapter });
  } else if (requiredDone(s)) {
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
  const ride = playerVehicle(s);
  const car = ride && ride.kind !== 'bike' ? ride : null; // on a bike they go for you, not the bike
  const reachBonus = car ? VEHICLES[car.kind].length / 2 - 0.4 : ride ? 0.3 : 0; // a car is a bigger target
  const busy = isBusy(s);

  for (const z of s.zombies) {
    if (z.action === 'dead') { z.actionT -= dt; continue; }
    if (z.latch != null) { updateLatched(s, z, dt); if (s.phase !== 'playing') return; continue; }
    // someone you are protecting: it takes hold (a second to shoot it or shove it off), then a bite is the end
    if (s.escort && z.action !== 'rise' && z.staggerT <= 0 && !busy) {
      let held = false;
      for (const m of escortGroup(s)) {
        if (m.riding) continue;
        const dm = dist(z.pos, m.pos);
        if (dm < 4 && s.dangerT <= 0) { s.dangerT = 4; s.events.push({ type: 'escort-danger', name: m.name }); }
        if (dm > ZOMBIE_RADIUS + PLAYER_RADIUS + 0.3) continue;
        held = true;
        z.biteT = (z.biteT ?? 0) + dt;
        if (z.biteT < BITE_SECONDS) break;
        z.action = 'feed';
        z.heading = Math.atan2(m.pos.y - z.pos.y, m.pos.x - z.pos.x);
        s.killerId = z.id;
        lose(s, 'infected');
        return;
      }
      if (!held) z.biteT = 0;
    }
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
    z.alertT = Math.max(0, z.alertT - dt);
    if (z.staggerT > 0) {
      z.staggerT -= dt;
      z.speed = 0;
      continue;
    }

    // working an objective or talking to someone: the ones that were after you hold back and wait
    if (busy && (z.action === 'chase' || z.action === 'attack' || d < 12)) {
      if (z.action === 'attack') z.cooldown = ATTACK_COOLDOWN;
      z.action = 'idle';
      z.speed = 0;
      if (d > 1e-6) z.heading = Math.atan2(dy, dx);
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
        if (Math.abs(car.speed) < 8.5 && !latchOn(s, z, car)) { // no room left on it: it beats on the body
          s.events.push({ type: 'vehicle-crash', id: car.id, force: 2 });
          damageVehicle(s, car, LATCH_DAMAGE);
        }
        continue;
      }
      if (s.player.invuln > 0) continue;
      const took = hurtPlayer(s, ATTACK_DAMAGE);
      s.player.invuln = HIT_INVULNERABLE;
      if (d > 1e-6) {
        s.player.vel.x += (dx / d) * KNOCKBACK;
        s.player.vel.y += (dy / d) * KNOCKBACK;
      }
      s.events.push({ type: 'player-hit', damage: took, by: z.id });
      if (s.player.health <= 0) {
        s.player.health = 0;
        z.action = 'feed';
        s.killerId = z.id;
        lose(s, 'caught');
        return;
      }
      continue;
    }

    // drawn to a noise: walk to it and mill about, unless you are right there
    if ((z.lureT ?? 0) > 0 && z.lure && d > 4.5) {
      z.lureT = (z.lureT ?? 0) - dt;
      const lx = z.lure.x - z.pos.x, ly = z.lure.y - z.pos.y, ld = Math.hypot(lx, ly);
      const before = { x: z.pos.x, y: z.pos.y };
      const v = ld > 1.5 ? (z.kind === 'runner' ? RUNNER_SPEED * 0.7 : WALKER_SPEED_BY_TIER[s.tier]!) * s.zombieMul : 0;
      z.action = v > 0 ? 'wander' : 'idle';
      if (ld > 1e-6) {
        z.pos.x += (lx / ld) * v * dt;
        z.pos.y += (ly / ld) * v * dt;
        if (v > 0) z.heading = Math.atan2(ly, lx);
      }
      resolve(s.map, z.pos, ZOMBIE_RADIUS);
      for (const c of s.vehicles) pushOutOfVehicle(c, z.pos, ZOMBIE_RADIUS);
      z.speed = dt > 0 ? Math.hypot(z.pos.x - before.x, z.pos.y - before.y) / dt : 0;
      continue;
    }

    const sight = z.alertT > 0 ? Infinity : z.kind === 'runner' ? RUNNER_SIGHT : WALKER_SIGHT_BY_TIER[s.tier]!;
    const chaseSpeed = (ride && z.alertT > 0 ? (z.kind === 'runner' ? SWARM_SPEED : WALKER_SPEED_BY_TIER[s.tier]! * 1.5) : z.kind === 'runner' ? RUNNER_SPEED : WALKER_SPEED_BY_TIER[s.tier]!) * s.zombieMul;

    if (d < ATTACK_RANGE + reachBonus && z.cooldown <= 0 && !(ride && Math.abs(ride.speed) > (car ? 8 : 3))) {
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
        // after a vehicle, they run for where it will be, to get in front of it
        const lead = ride ? Math.min(1.2, d / 12) : 0;
        const tx = dx + s.player.vel.x * lead, ty = dy + s.player.vel.y * lead, tl = Math.hypot(tx, ty);
        if (tl > 1e-6) { vx = tx / tl; vy = ty / tl; }
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
  for (const z of s.zombies) if (z.action === 'dead' && z.actionT <= 0) s.corpses.push({ id: z.id, pos: { ...z.pos }, heading: z.heading });
  if (s.corpses.length > CORPSES_KEPT) s.corpses.splice(0, s.corpses.length - CORPSES_KEPT);
  s.zombies = s.zombies.filter((z) => z.action !== 'dead' || z.actionT > 0);
  separate(s);
}

/** Push overlapping zombies apart so a crowd spreads out instead of stacking. */
function separate(s: GameState): void {
  const p = s.player.pos;
  const zs = s.zombies.filter((z) => z.action !== 'dead' && z.latch == null && dist(z.pos, p) < ZOMBIE_ACTIVE_RADIUS);
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
