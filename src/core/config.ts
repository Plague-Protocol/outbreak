// Tuning constants. Pace is meant to be found by playtesting.
export const PLAYER_SPEED = 6; // units/s
export const PLAYER_RADIUS = 0.45;
export const ZOMBIE_RADIUS = 0.45;
export const ZOMBIE_SPEED_BY_TIER = [3.6, 4.2, 4.8] as const;
export const ZOMBIE_SIGHT_BY_TIER = [11, 15, Infinity] as const;
export const ZOMBIES_START = 3;
export const ZOMBIES_PER_TIER = 3;
export const ZOMBIE_CAP = 14;
export const ZOMBIE_SPAWN_MIN_DIST = 18;
export const TIER_THRESHOLDS = [0.66, 0.33] as const; // remaining/limit below which tier rises
export const TASK_RADIUS = 2.0;
export const TASK_HOLD_SECONDS = 1.0;
export const SAFEHOUSE_RADIUS = 2.5;
export const TIME_SLACK = 1.6;
export const TIME_PAD = 12;
export const SPEED_BOOST = 1.12;
export const CALM_FACTOR = 0.9;
