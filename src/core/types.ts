export interface Vec2 {
  x: number;
  y: number;
}

export type ObstacleKind =
  | 'building' | 'tower' | 'house' | 'warehouse' | 'shop' | 'container'
  | 'car' | 'wreck' | 'dumpster' | 'barrel' | 'barricade' | 'lamp' | 'tree' | 'deadtree' | 'fence' | 'pump' | 'bench'
  | 'water' | 'store'
  | 'bus' | 'truck' | 'sandbag' | 'ambulance' | 'hospital';

export type District = 'downtown' | 'residential' | 'park' | 'industrial' | 'outskirts' | 'water';
/** What part of the city a chapter is in: the centre, the docks and rail yard, or the edge of town. */
export type Theme = 'downtown' | 'docks' | 'edge';

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
  kind: 'grass' | 'dirt' | 'canopy' | 'pier' | 'plaza' | 'lot'
    | 'rubble' | 'litter' | 'luggage' | 'weeds' | 'fallenlamp' | 'scorch' | 'checkpoint' | 'rails';
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

/** A weapon store building with its door on the street. */
export interface Storefront {
  x: number; // the building's footprint (also an obstacle in `buildings`)
  y: number;
  w: number;
  h: number;
  door: Vec2; // just outside the entrance, on the street
  facing: Vec2; // unit vector out of the front of the building
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
  storefronts: Storefront[];
  /** Named places on the street (the checkpoint), for the map. Block landmarks live on blocks. */
  labels: Array<{ name: string; x: number; y: number }>;
  /** Spatial hash of obstacle indices, `gridCell` units per cell, `gridN` x `gridN` cells. */
  grid: number[][];
  gridCell: number;
  gridN: number;
}

import type { Archetype, Effect, PuzzleKind, Skin } from './content';

/** A step's id, from the task content (public/content/tasks.json). */
export type TaskId = string;

export type Reward = 'speed' | 'calm' | 'funds';

export interface Task {
  id: TaskId;
  kind: Archetype;
  required: boolean;
  requires: TaskId[];
  pos: Vec2;
  timeCost: number; // seconds removed from the clock on completion (optional tasks)
  reward: Reward | null;
  done: boolean;
  /** Pieces to find first, scattered nearby (fuses, batteries, map pieces); then you fit them at `pos`. */
  parts?: Vec2[];
  got?: boolean[];
  /** How long it takes, standing at it (default TASK_HOLD_SECONDS). */
  seconds?: number;
  effect?: Effect;
  /** Whoever you are escorting has to be with you. */
  needsEscort?: boolean;
  /** Who comes with you once this is done (escort-start). */
  escort?: { name: string; skin: Skin; scale: number; party?: Array<{ name: string; skin: Skin; scale: number }> };
  /** A door code or phone number for the step's group ({code} in its text). */
  code: string;
  puzzle?: PuzzleKind;
  /** The puzzle's starting position (tile turns, or the far ends of the wires). */
  scramble?: number[];
  /** Infected to clear (a clear step), and the ones that came once you got close. */
  clear?: number;
  targets?: number[];
}

/** Someone you are taking somewhere: they follow you (and ride along in a car). */
export interface Escort {
  pos: Vec2;
  heading: number;
  speed: number;
  riding: boolean;
  name: string;
  skin: Skin;
  scale: number;
  /** The rest of a group you are bringing in, each following the one in front. */
  party?: Escort[];
}

export type ZombieKind = 'walker' | 'runner';
/** What a zombie is doing; the renderer picks its animation from this, not from guessing. */
export type ZombieAction = 'rise' | 'idle' | 'wander' | 'chase' | 'attack' | 'feed' | 'cling' | 'dead';

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
  /** Drawn to a noise (a smashed bottle, a car alarm): walks there instead of hunting you. */
  lure?: Vec2 | null;
  lureT?: number;
  /** Hanging on to a vehicle (its id), at a spot on its body (along, across, in its own frame). */
  latch?: number | null;
  latchAt?: Vec2;
  /** How long it has been shaken at speed; it lets go after LATCH_GRIP seconds. */
  latchT?: number;
  /** How long it has had hold of someone you are protecting. */
  biteT?: number;
}

export type VehicleKind = 'sedan' | 'pickup' | 'van' | 'bike';

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  pos: Vec2;
  heading: number; // radians, direction the nose points
  speed: number; // signed, units/s (negative = reversing)
  health: number;
  wrecked: boolean;
  tone: number; // paint, visual only
  fuel: number; // 0..1; an empty tank coasts to a stop
}

export type GearKind = 'vest' | 'helmet';

export type Loot = 'medkit' | 'supplies' | 'ammo' | 'bottles' | GearKind | 'empty';

/** A house you can search: loot inside, and sometimes one of them. */
export interface House {
  id: number;
  pos: Vec2; // outside the front door
  loot: Loot;
  ambush: boolean;
  searched: boolean;
}

export type SurvivorRequest = 'clear' | 'fetch';
export type SurvivorReward = 'funds' | 'ammo' | 'weapon' | 'intel';

/** Someone holed up who wants help, and pays for it. */
export interface Survivor {
  id: number;
  name: string;
  pos: Vec2;
  request: SurvivorRequest;
  reward: SurvivorReward;
  status: 'waiting' | 'asked' | 'ready' | 'done';
  fetchPos: Vec2; // where the thing they need is (fetch)
  carrying: boolean; // you have picked it up (fetch)
  targets: number[]; // the zombies to clear (clear)
  skin: number; // visual only
}

/** A car alarm going off: a noise everything nearby walks to. */
export interface Alarm {
  car: number; // index into map.buildings
  pos: Vec2;
  t: number; // seconds left
}

/** A bottle in the air. */
export interface Thrown {
  from: Vec2;
  to: Vec2;
  t: number; // seconds in flight so far
  dur: number;
}

export type GunKind = 'pistol' | 'shotgun' | 'rifle';
export type MeleeKind = 'baton' | 'bat' | 'machete';
export type WeaponKind = GunKind | MeleeKind;
export type UpgradeKind = 'damage' | 'mag' | 'reload';

export type PickupKind = WeaponKind | GearKind | 'ammo' | 'bottles' | 'jerrycan';

/** Lying in the street: walk over it to take it. */
export interface Pickup {
  id: number;
  kind: PickupKind;
  pos: Vec2;
  taken: boolean;
}

/** Something on sale at a weapon store. */
export type StoreItem =
  | { kind: 'weapon'; weapon: WeaponKind }
  | { kind: 'ammo'; weapon: GunKind }
  | { kind: 'upgrade'; weapon: WeaponKind; upgrade: UpgradeKind }
  | { kind: 'gear'; gear: GearKind }
  | { kind: 'medkit' }
  | { kind: 'bottles' }
  | { kind: 'jerrycan' };

export interface Store {
  id: number;
  name: string;
  pos: Vec2; // the door, on the street: walk in here
  front: Storefront;
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
  | { kind: 'store'; storeId: number }
  | { kind: 'house'; houseId: number }
  | { kind: 'talk'; survivorId: number }
  | { kind: 'refuel'; vehicleId: number }
  | { kind: 'alarm'; car: number };

/** `cleared`: through the door at the end of a chapter; the next district is loading. */
export type Phase = 'playing' | 'cleared' | 'won' | 'lost';
export type LossReason = 'time' | 'caught' | 'infected';

export type GameEvent =
  | { type: 'task-done'; id: TaskId }
  | { type: 'task-locked'; id: TaskId; needs: TaskId[] }
  | { type: 'safehouse-locked' }
  | { type: 'tier-up'; tier: number }
  | { type: 'time-penalty'; seconds: number }
  | { type: 'zombie-alert'; id: number }
  | { type: 'zombie-killed'; id: number }
  | { type: 'player-hit'; damage: number; by: number }
  | { type: 'shot'; weapon: GunKind; from: Vec2; to: Vec2; hit: number | null }
  | { type: 'zombie-hurt'; id: number }
  | { type: 'swing'; weapon: MeleeKind; hits: number }
  | { type: 'reload'; weapon: GunKind }
  | { type: 'empty'; weapon: GunKind }
  | { type: 'pickup'; kind: PickupKind; amount: number }
  | { type: 'purchase'; item: StoreItem }
  | { type: 'store-open'; id: number }
  | { type: 'equip'; weapon: WeaponKind }
  | { type: 'healed'; amount: number }
  | { type: 'task-started'; id: TaskId }
  | { type: 'crate-opened'; id: number; loot: Loot }
  | { type: 'vehicle-enter'; id: number }
  | { type: 'vehicle-exit'; id: number }
  | { type: 'vehicle-crash'; id: number; force: number }
  | { type: 'vehicle-wrecked'; id: number }
  /** One grabbed hold of the vehicle you are in (count: how many are on it now). */
  | { type: 'latched'; id: number; count: number }
  /** Shaken off at speed or thrown by a crash. */
  | { type: 'shaken'; id: number }
  /** The vehicle is so beaten that the ones on it can reach you inside. */
  | { type: 'vehicle-breached'; id: number }
  | { type: 'zombie-attack'; id: number }
  | { type: 'house-searched'; id: number; loot: Loot; ambush: boolean }
  | { type: 'survivor-asked'; id: number; first: boolean }
  | { type: 'survivor-ready'; id: number }
  | { type: 'survivor-done'; id: number; reward: SurvivorReward }
  | { type: 'fetched'; id: number }
  | { type: 'refueled'; id: number; from: 'can' | 'pump' }
  | { type: 'out-of-fuel'; id: number }
  | { type: 'throw'; to: Vec2 }
  | { type: 'bottle-smash'; pos: Vec2 }
  | { type: 'alarm-start'; car: number; pos: Vec2 }
  | { type: 'alarm-stop'; car: number }
  | { type: 'work-started'; kind: 'search' | 'talk' | 'refuel' }
  | { type: 'gear-hit'; gear: GearKind; absorbed: number }
  | { type: 'gear-broken'; gear: GearKind }
  | { type: 'chapter-cleared'; chapter: number }
  | { type: 'part-taken'; id: TaskId; got: number; of: number }
  | { type: 'escort-behind' }
  | { type: 'puzzle-open'; id: TaskId }
  | { type: 'puzzle-wrong'; id: TaskId }
  | { type: 'clear-start'; id: TaskId; count: number }
  | { type: 'flare-lit'; pos: Vec2 }
  | { type: 'horde'; pos: Vec2 }
  /** A pack is standing over the current objective. */
  | { type: 'guarded'; id: TaskId; count: number }
  /** The way out is shown and they are coming for you. */
  | { type: 'chase'; count: number }
  /** One of the infected is right on someone you are bringing in (once every few seconds). */
  | { type: 'escort-danger'; name: string }
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
  /** Throw a bottle was pressed this step (edge). */
  throw?: boolean;
}
