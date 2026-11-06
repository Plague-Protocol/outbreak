export interface Vec2 {
  x: number;
  y: number;
}

export type ObstacleKind =
  | 'building' | 'tower' | 'house' | 'warehouse' | 'shop' | 'container'
  | 'car' | 'wreck' | 'dumpster' | 'barrel' | 'barricade' | 'lamp' | 'tree' | 'deadtree' | 'fence' | 'pump' | 'bench'
  | 'water';

export type District = 'downtown' | 'residential' | 'park' | 'industrial' | 'outskirts' | 'water';

export interface Block {
  i: number;
  j: number;
  x: number; // min corner
  y: number;
  size: number;
  district: District;
  /** Landmark name shown on the map, if any. */
  landmark?: string;
}

/** Ground and overhead dressing with no collision (grass, dirt, a gas station canopy, pier planks). */
export interface Decor {
  kind: 'grass' | 'dirt' | 'canopy' | 'pier' | 'plaza' | 'lot';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ParkingSpot {
  x: number;
  y: number;
  heading: number; // radians, along the street
}

/** Any solid axis-aligned box: buildings and street props. All of them block movement and pathing. */
export interface Building {
  kind: ObstacleKind;
  x: number; // min corner
  y: number;
  w: number;
  h: number;
  height: number; // visual only
  tone: number; // visual only, 0..1
}

export interface MapData {
  size: number;
  cols: number; // nav grid is cols x cols, 1 unit per cell
  buildings: Building[]; // every solid obstacle
  blocked: Uint8Array; // 1 = not walkable for pathing
  points: Vec2[]; // candidate street points (all walkable)
  blocks: Block[];
  decor: Decor[];
  parking: ParkingSpot[]; // kerbside spots where drivable vehicles start
  /** Spatial hash of obstacle indices, `gridCell` units per cell, `gridN` x `gridN` cells. */
  grid: number[][];
  gridCell: number;
  gridN: number;
}

export type TaskId =
  | 'map' | 'key' | 'power' | 'gate' | 'keycard' | 'radio'
  | 'fuel' | 'medkit' | 'rescue';

export type Reward = 'speed' | 'calm' | 'funds';

export interface Task {
  id: TaskId;
  label: string;
  hint: string;
  required: boolean;
  requires: TaskId[];
  pos: Vec2;
  timeCost: number; // seconds removed from the clock on completion (optional tasks)
  reward: Reward | null;
  done: boolean;
}

export type ZombieKind = 'walker' | 'runner';
/** What a zombie is doing; the renderer picks its animation from this, not from guessing. */
export type ZombieAction = 'rise' | 'idle' | 'wander' | 'chase' | 'attack' | 'feed' | 'dead';

export interface Zombie {
  id: number;
  kind: ZombieKind;
  pos: Vec2;
  heading: number; // radians
  speed: number; // current ground speed, units/s (drives animation playback rate)
  action: ZombieAction;
  actionT: number; // seconds left in a timed action (rise, attack wind-up)
  cooldown: number; // seconds before it can attack again
  health: number;
  staggerT: number; // flinching from a hit: no moving, no lunging
  alertT: number; // heard gunfire: hunts the player regardless of sight
  wanderT: number;
  wanderDir: Vec2;
}

export type VehicleKind = 'sedan' | 'pickup' | 'van';

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  pos: Vec2;
  heading: number; // radians, direction the nose points
  speed: number; // signed, units/s (negative = reversing)
  health: number;
  wrecked: boolean;
  tone: number; // paint, visual only
}

export type Loot = 'medkit' | 'supplies' | 'ammo' | 'empty';

export type WeaponKind = 'pistol' | 'shotgun' | 'rifle';

export type PickupKind = WeaponKind | 'ammo';

/** Lying in the street: walk over it to take it. */
export interface Pickup {
  id: number;
  kind: PickupKind;
  pos: Vec2;
  taken: boolean;
}

export type StoreItem = 'pistol-ammo' | 'shotgun' | 'shotgun-ammo' | 'rifle' | 'rifle-ammo' | 'medkit';

export interface Store {
  pos: Vec2; // the counter, on the pavement
  name: string;
}

export interface Crate {
  id: number;
  pos: Vec2;
  loot: Loot;
  opened: boolean;
}

/** What the Use button would do right now (for the contextual button label). */
export type Interaction =
  | { kind: 'exit'; vehicleId: number }
  | { kind: 'enter'; vehicleId: number }
  | { kind: 'task'; taskId: TaskId }
  | { kind: 'crate'; crateId: number }
  | { kind: 'store' };

export type Phase = 'playing' | 'won' | 'lost';
export type LossReason = 'time' | 'caught';

export type GameEvent =
  | { type: 'task-done'; id: TaskId }
  | { type: 'task-locked'; id: TaskId; needs: TaskId[] }
  | { type: 'safehouse-locked' }
  | { type: 'tier-up'; tier: number }
  | { type: 'time-penalty'; seconds: number }
  | { type: 'zombie-alert'; id: number }
  | { type: 'zombie-killed'; id: number }
  | { type: 'player-hit'; damage: number; by: number }
  | { type: 'shot'; weapon: WeaponKind; from: Vec2; to: Vec2; hit: number | null }
  | { type: 'zombie-hurt'; id: number }
  | { type: 'reload'; weapon: WeaponKind }
  | { type: 'empty'; weapon: WeaponKind }
  | { type: 'pickup'; kind: PickupKind; amount: number }
  | { type: 'purchase'; item: StoreItem }
  | { type: 'store-open' }
  | { type: 'healed'; amount: number }
  | { type: 'task-started'; id: TaskId }
  | { type: 'crate-opened'; id: number; loot: Loot }
  | { type: 'vehicle-enter'; id: number }
  | { type: 'vehicle-exit'; id: number }
  | { type: 'vehicle-crash'; id: number; force: number }
  | { type: 'vehicle-wrecked'; id: number }
  | { type: 'zombie-attack'; id: number }
  | { type: 'won' }
  | { type: 'lost'; reason: LossReason };

export interface Input {
  dx: number; // -1..1, world space
  dy: number;
  /** The Use button was pressed this step (edge, not held). */
  action?: boolean;
  /** Fire is held. */
  fire?: boolean;
  /** Reload / switch weapon were pressed this step (edges). */
  reload?: boolean;
  swap?: boolean;
}
