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
/** Zombies added at the start (tier 0) and when each tier begins. */
export const SPAWNS_BY_TIER = [
  { walker: 6, runner: 0 },
  { walker: 3, runner: 1 },
  { walker: 2, runner: 2 },
] as const;
export const ZOMBIE_CAP = 14;
export const ZOMBIE_SPAWN_MIN_DIST = 22;
export const RISE_SECONDS = 1.5; // zombies that appear mid-run climb up off the ground first
export const ATTACK_RANGE = 1.35; // starts a lunge
export const ATTACK_REACH = 1.75; // the lunge lands if the player is still this close when it ends
export const ATTACK_WINDUP = { walker: 0.6, runner: 0.4 } as const; // time to dodge
export const ATTACK_COOLDOWN = 1.0;

export const TIER_THRESHOLDS = [0.66, 0.33] as const; // remaining/limit below which tier rises
export const TASK_RADIUS = 2.2;
export const TASK_HOLD_SECONDS = 1.2;
export const SAFEHOUSE_RADIUS = 3;
export const TIME_SLACK = 1.6;
export const TIME_PAD = 15;
export const SPEED_BOOST = 1.12;
export const CALM_FACTOR = 0.85;
