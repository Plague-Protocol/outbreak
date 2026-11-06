export interface Vec2 {
  x: number;
  y: number;
}

export interface Building {
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
  buildings: Building[];
  blocked: Uint8Array; // 1 = not walkable for pathing
  points: Vec2[]; // candidate street points (all walkable)
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

export interface Zombie {
  id: number;
  pos: Vec2;
  heading: number; // radians, visual
  wanderT: number;
  wanderDir: Vec2;
}

export type Phase = 'playing' | 'won' | 'lost';
export type LossReason = 'time' | 'caught';

export type GameEvent =
  | { type: 'task-done'; id: TaskId }
  | { type: 'task-locked'; id: TaskId; needs: TaskId[] }
  | { type: 'safehouse-locked' }
  | { type: 'tier-up'; tier: number }
  | { type: 'time-penalty'; seconds: number }
  | { type: 'won' }
  | { type: 'lost'; reason: LossReason };

export interface Input {
  dx: number; // -1..1
  dy: number;
}
