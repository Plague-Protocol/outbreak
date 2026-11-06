// Tuning constants. Pace is meant to be found by playtesting.
// World scale: characters are 2.8 units tall (about 1.75 m); 1 unit is about 0.63 m.
export const PLAYER_SPEED = 5.5; // top speed, units/s (a light push on the stick walks)
export const PLAYER_ACCEL = 16; // units/s^2: no instant starts, stops or turns
export const PLAYER_RADIUS = 0.5;

export const ZOMBIE_RADIUS = 0.5;
export const WALKER_SPEED_BY_TIER = [1.2, 1.35, 1.5] as const; // a shuffle
export const RUNNER_SPEED = 4.3; // slower than a sprinting player, faster than a walking one
export const WALKER_SIGHT_BY_TIER = [10, 13, 17] as const;
export const RUNNER_SIGHT = 24;
/** Zombies added near the player when each tier begins (tier 0 is the city's resting population). */
export const SPAWNS_BY_TIER = [
  { walker: 0, runner: 0 },
  { walker: 7, runner: 2 },
  { walker: 6, runner: 4 },
] as const;
/** Resting population per block, by district. */
export const ZOMBIES_PER_BLOCK = { downtown: 3, residential: 1.3, park: 1.2, industrial: 1.8, outskirts: 0.7, water: 0 } as const;
export const ZOMBIE_CAP = 80;
export const ZOMBIE_SPAWN_MIN_DIST = 22; // never closer than this to the player
export const WAVE_SPAWN_MAX_DIST = 45; // waves arrive from just out of sight
export const ZOMBIE_ACTIVE_RADIUS = 60; // zombies further away are dormant (not simulated)
export const CORPSE_SECONDS = 6;
export const RISE_SECONDS = 1.5; // zombies that appear mid-run climb up off the ground first
export const ATTACK_RANGE = 1.35; // starts a lunge
export const ATTACK_REACH = 1.75; // the lunge lands if the player is still this close when it ends
export const ATTACK_WINDUP = { walker: 0.6, runner: 0.4 } as const; // time to dodge
export const ATTACK_COOLDOWN = 1.0;
export const ATTACK_DAMAGE = 34; // three lunges and you are down
export const PLAYER_HEALTH = 100;
export const HIT_INVULNERABLE = 1.2; // seconds after a hit
export const KNOCKBACK = 7; // units/s shove away from the attacker
export const MEDKIT_HEAL = 50;

export const USE_RADIUS = 3.0; // reach for vehicles and crates
export const VEHICLES = {
  sedan: { length: 6.4, width: 2.9, maxSpeed: 17, accel: 11, reverse: 6, steer: 2.4, health: 100 },
  pickup: { length: 6.8, width: 3.0, maxSpeed: 15, accel: 10, reverse: 5.5, steer: 2.1, health: 140 },
  van: { length: 7.4, width: 3.1, maxSpeed: 13, accel: 8, reverse: 5, steer: 1.8, health: 180 },
} as const;
export const VEHICLE_COUNT = 16;
export const RUN_OVER_SPEED = 4; // above this a car knocks zombies down
export const CRATE_COUNT = 22;
export const AMMO_PICKUPS = 10;

export const TIER_THRESHOLDS = [0.66, 0.33] as const; // remaining/limit below which tier rises
export const TASK_RADIUS = 2.2;
export const TASK_HOLD_SECONDS = 1.2;
export const SAFEHOUSE_RADIUS = 3;
export const TIME_SLACK = 1.65; // measured on foot; a car buys time back
export const TIME_PAD = 15;
export const SPEED_BOOST = 1.12;
export const CALM_FACTOR = 0.85;

// ---- weapons. Aim assist picks a target in front of you; gunfire draws zombies.
export const WEAPONS = {
  pistol: { name: 'Pistol', damage: 34, pellets: 1, spread: 0.04, range: 20, interval: 0.3, mag: 12, reload: 1.3, noise: 28, ammoPack: 24 },
  shotgun: { name: 'Shotgun', damage: 22, pellets: 6, spread: 0.3, range: 11, interval: 0.85, mag: 6, reload: 2.2, noise: 40, ammoPack: 12 },
  rifle: { name: 'Assault rifle', damage: 26, pellets: 1, spread: 0.07, range: 28, interval: 0.11, mag: 30, reload: 2.0, noise: 45, ammoPack: 60 },
} as const;
export const START_AMMO = { pistol: 24, shotgun: 0, rifle: 0 } as const;
export const ZOMBIE_HEALTH = { walker: 60, runner: 45 } as const;
export const STAGGER_SECONDS = 0.3;
export const ALERT_SECONDS = 7;
export const KILL_REWARD = 5;
export const AIM_CONE = 1.3; // radians either side of facing that aim assist will snap to
export const PICKUP_RADIUS = 1.6;
export const STORE_PRICES = {
  'pistol-ammo': 15, shotgun: 120, 'shotgun-ammo': 25, rifle: 220, 'rifle-ammo': 35, medkit: 40,
} as const;
export const START_FUNDS = 30;
