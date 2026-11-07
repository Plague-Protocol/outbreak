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

// ---- weapons. Aim assist picks a target in front of you; gunfire draws zombies, melee is quiet.
export const GUNS = {
  pistol: { name: 'Pistol', damage: 34, pellets: 1, spread: 0.04, range: 20, interval: 0.3, mag: 12, reload: 1.3, noise: 28, ammoPack: 24 },
  shotgun: { name: 'Shotgun', damage: 22, pellets: 6, spread: 0.3, range: 11, interval: 0.85, mag: 6, reload: 2.2, noise: 40, ammoPack: 12 },
  rifle: { name: 'Assault rifle', damage: 26, pellets: 1, spread: 0.07, range: 28, interval: 0.11, mag: 30, reload: 2.0, noise: 45, ammoPack: 60 },
} as const;
/** Melee: `range` is reach, `arc` the swing's width (radians), `cleave` how many it can hit at once. */
export const MELEE = {
  baton: { name: 'Police baton', damage: 30, range: 2.3, arc: 1.5, cleave: 1, interval: 0.42, noise: 4, stagger: 0.5 },
  bat: { name: 'Baseball bat', damage: 40, range: 2.6, arc: 1.8, cleave: 3, interval: 0.62, noise: 5, stagger: 0.7 },
  machete: { name: 'Machete', damage: 60, range: 2.4, arc: 1.4, cleave: 2, interval: 0.5, noise: 3, stagger: 0.4 },
} as const;
export const WEAPON_NAMES: Record<keyof typeof GUNS | keyof typeof MELEE, string> = {
  pistol: GUNS.pistol.name, shotgun: GUNS.shotgun.name, rifle: GUNS.rifle.name,
  baton: MELEE.baton.name, bat: MELEE.bat.name, machete: MELEE.machete.name,
};
export const START_AMMO = { pistol: 24, shotgun: 0, rifle: 0 } as const;
export const ZOMBIE_HEALTH = { walker: 60, runner: 45 } as const;
export const STAGGER_SECONDS = 0.3;
export const MELEE_KNOCKBACK = 0.7; // a solid hit shoves the zombie back this far
export const ALERT_SECONDS = 7;
export const KILL_REWARD = 5;
export const AIM_CONE = 1.3; // radians either side of facing that aim assist will snap to
export const PICKUP_RADIUS = 1.6;

// ---- weapon stores
export const STORE_COUNT = 3;
export const STORE_NAMES = ['Halden Arms', 'Liberty Outfitters', 'Harbour Gun & Tackle'] as const;
export const STORE_DOOR_RADIUS = 1.5; // walk into the doorway to go in
export const WEAPON_PRICES = { pistol: 60, shotgun: 120, rifle: 220, baton: 20, bat: 35, machete: 60 } as const;
export const AMMO_PRICES = { pistol: 15, shotgun: 25, rifle: 35 } as const;
export const MEDKIT_PRICE = 40;
/** Each upgrade has two levels. Damage: +20% per level; magazine: +40%; reload time: -20%. */
export const UPGRADE_LEVELS = 2;
export const UPGRADE_EFFECT = { damage: 0.2, mag: 0.4, reload: 0.2 } as const;
/** Price of an upgrade level = base for the weapon x factor for the kind x level (1 or 2). */
export const UPGRADE_BASE = { pistol: 35, shotgun: 50, rifle: 65, baton: 25, bat: 30, machete: 40 } as const;
export const UPGRADE_FACTOR = { damage: 1.2, mag: 1, reload: 0.8 } as const;
export const START_FUNDS = 50;

// ---- safe while busy: zombies hold back while you work an objective or talk to someone
export const SAFE_AFTER = 1.0; // seconds of grace after finishing, to step away

// ---- the abandoned city
export const PILEUPS = 3; // street segments choked by crashed cars (cars cannot pass; on foot, maybe)

// ---- distractions
export const START_BOTTLES = 2;
export const BOTTLE_PICKUPS = 4;
export const BOTTLE_RANGE = 11; // how far you throw
export const BOTTLE_FLIGHT = 0.6; // seconds in the air
export const LURE_RADIUS = 18; // a smashed bottle draws everything within this
export const LURE_SECONDS = 6;
export const ALARM_SECONDS = 10;
export const ALARM_RADIUS = 30; // a car alarm carries much further
export const ALARM_SHOT_RADIUS = 4; // gunfire this close to a parked car sets it off

// ---- searchable houses
export const HOUSE_COUNT = 12;
export const SEARCH_SECONDS = 2.0;
export const AMBUSH_CHANCE = 0.3;

// ---- survivors with requests
export const SURVIVOR_COUNT = 2;
export const SURVIVOR_NAMES = ['Dana', 'Marcus', 'Ines', 'Theo', 'Ruth', 'Kofi'] as const;
export const TALK_SECONDS = 1.0;
export const CLEAR_COUNT = 4; // zombies that come for a survivor who asks to be cleared
export const SURVIVOR_FUNDS = 70;

// ---- fuel
export const FUEL_SECONDS = 80; // seconds of driving at full speed on a full tank
export const JERRYCAN_FUEL = 0.6;
export const JERRYCAN_PICKUPS = 4;
export const REFUEL_SECONDS = 1.5;
export const PUMP_RATE = 0.3; // tank per second, stopped at a pump
export const BOTTLES_PRICE = 10; // three bottles
export const JERRYCAN_PRICE = 20;

// ---- chapters: a night crosses several districts. Each ends at a door into the next (its map shows
// where); the last ends at the helicopter. Every district has its own clock.
export const CHAPTERS = 3;
export const CHAPTER_BONUS = 0.5; // $ per second left on the clock when you leave a district
export const CHAPTER_HEAL = 25; // you catch your breath on the way through
/** Deeper in, it gets worse (the city is already at its population cap): a share of the resting
 * crowd are runners, and the waves are bigger. By chapter. */
export const CHAPTER_RUNNERS = [0, 0.08, 0.15] as const;
export const CHAPTER_WAVES = [1, 1.25, 1.5] as const;

// ---- protective gear: takes a share of every hit and wears down doing it (from zombies now, and
// from anything else that hurts the player later)
export const GEAR = {
  vest: { name: 'Kevlar vest', absorb: 0.5, durability: 60, price: 70 },
  helmet: { name: 'Riot helmet', absorb: 0.25, durability: 40, price: 40 },
} as const;
export const GEAR_PICKUPS = 1; // lying somewhere in each district
