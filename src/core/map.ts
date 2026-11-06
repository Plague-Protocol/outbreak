import { createRng, chance, int, pick, range, type Rng } from './rng';
import type { Building, MapData, ObstacleKind, Vec2 } from './types';

// World scale: a character is 2.8 units tall (about 1.75 m), so 1 unit is about 0.63 m.
export const BLOCKS = 5;
export const STREET = 6; // about 3.8 m
export const PITCH = 18; // block + street
export const MAP_SIZE = BLOCKS * PITCH + STREET; // 96
const BLOCK = PITCH - STREET; // 12
const NAV_CLEARANCE = 1.0; // a nav cell is blocked if its center is this close to an obstacle
export const UNREACHABLE = 32767;

/** Sizes (w x h footprint, height) of street props, in world units. */
const PROP: Record<Exclude<ObstacleKind, 'building'>, [number, number, number]> = {
  car: [2.9, 6.4, 2.3],
  wreck: [2.9, 6.4, 1.9],
  dumpster: [2.0, 3.4, 2.2],
  barrel: [0.9, 0.9, 1.4],
  barricade: [4.0, 0.6, 1.6],
  lamp: [0.4, 0.4, 7.5],
};

function prop(kind: Exclude<ObstacleKind, 'building'>, x: number, y: number, rotate: boolean, rng: Rng): Building {
  const [a, b, height] = PROP[kind];
  const [w, h] = rotate ? [b, a] : [a, b];
  return { kind, x, y, w, h, height, tone: range(rng, 0, 1) };
}

function overlaps(a: Building, b: Building, pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

/**
 * City blocks on a street grid. Obstacles (buildings and props) only ever sit inside blocks, so
 * the streets between them are always open and the whole street grid stays connected.
 */
export function generateMap(seed: number): MapData {
  const rng = createRng(seed);
  const obstacles: Building[] = [];
  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      const bx = STREET + i * PITCH;
      const by = STREET + j * PITCH;
      const inBlock: Building[] = [];
      const tryAdd = (o: Building) => {
        if (o.x < bx || o.y < by || o.x + o.w > bx + BLOCK || o.y + o.h > by + BLOCK) return;
        if (inBlock.some((q) => overlaps(o, q, 1.6))) return; // keep a walkable gap
        inBlock.push(o);
      };

      // a lamp post on one corner of most blocks
      if (chance(rng, 0.7)) {
        const cx = chance(rng, 0.5) ? bx + 0.3 : bx + BLOCK - 0.7;
        const cy = chance(rng, 0.5) ? by + 0.3 : by + BLOCK - 0.7;
        tryAdd(prop('lamp', cx, cy, false, rng));
      }

      if (chance(rng, 0.8)) {
        const w = range(rng, 7, 10);
        const h = range(rng, 7, 10);
        tryAdd({
          kind: 'building',
          x: bx + range(rng, 0.8, BLOCK - w - 0.8),
          y: by + range(rng, 0.8, BLOCK - h - 0.8),
          w, h,
          height: range(rng, 5, 12),
          tone: range(rng, 0, 1),
        });
        // clutter in the margins
        const n = int(rng, 0, 2);
        for (let k = 0; k < n; k++) {
          const kind = pick(rng, ['barrel', 'dumpster', 'barricade', 'barrel'] as const);
          tryAdd(prop(kind, bx + range(rng, 0, BLOCK - 4), by + range(rng, 0, BLOCK - 4), chance(rng, 0.5), rng));
        }
      } else {
        // open lot: a car park of abandoned and burnt-out cars, a fire barrel
        const n = int(rng, 1, 3);
        for (let k = 0; k < n; k++) {
          const kind = chance(rng, 0.45) ? 'wreck' : 'car';
          const rot = chance(rng, 0.5);
          tryAdd(prop(kind, bx + range(rng, 0.5, BLOCK - (rot ? 6.9 : 3.4)), by + range(rng, 0.5, BLOCK - (rot ? 3.4 : 6.9)), rot, rng));
        }
        tryAdd(prop('barrel', bx + range(rng, 1, BLOCK - 2), by + range(rng, 1, BLOCK - 2), false, rng));
      }
      obstacles.push(...inBlock);
    }
  }

  // Candidate street points: intersections and mid-street points. Free by construction.
  const points: Vec2[] = [];
  for (let i = 0; i <= BLOCKS; i++) {
    for (let j = 0; j <= BLOCKS; j++) {
      points.push({ x: STREET / 2 + i * PITCH, y: STREET / 2 + j * PITCH });
    }
  }
  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j <= BLOCKS; j++) {
      const mid = STREET + i * PITCH + BLOCK / 2;
      points.push({ x: mid, y: STREET / 2 + j * PITCH });
      points.push({ x: STREET / 2 + j * PITCH, y: mid });
    }
  }

  const cols = MAP_SIZE;
  const blocked = new Uint8Array(cols * cols);
  for (let cy = 0; cy < cols; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const px = cx + 0.5, py = cy + 0.5;
      for (const b of obstacles) {
        const nx = Math.max(b.x, Math.min(px, b.x + b.w));
        const ny = Math.max(b.y, Math.min(py, b.y + b.h));
        if (Math.hypot(px - nx, py - ny) < NAV_CLEARANCE) { blocked[cy * cols + cx] = 1; break; }
      }
    }
  }
  return { size: MAP_SIZE, cols, buildings: obstacles, blocked, points };
}

export function cellOf(map: MapData, p: Vec2): number {
  const cx = Math.max(0, Math.min(map.cols - 1, Math.floor(p.x)));
  const cy = Math.max(0, Math.min(map.cols - 1, Math.floor(p.y)));
  return cy * map.cols + cx;
}

/**
 * 4-neighbour BFS distance (in cells) from a point over walkable cells.
 * The source cell may itself be blocked (player hugging a wall).
 */
export function distanceField(map: MapData, from: Vec2, out?: Int16Array): Int16Array {
  const n = map.cols * map.cols;
  const dist = out ?? new Int16Array(n);
  dist.fill(UNREACHABLE);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  const src = cellOf(map, from);
  dist[src] = 0;
  queue[tail++] = src;
  const cols = map.cols;
  while (head < tail) {
    const c = queue[head++] as number;
    const d = (dist[c] as number) + 1;
    const x = c % cols;
    const y = (c - x) / cols;
    if (x > 0) visit(c - 1, d);
    if (x < cols - 1) visit(c + 1, d);
    if (y > 0) visit(c - cols, d);
    if (y < cols - 1) visit(c + cols, d);
  }
  return dist;

  function visit(c: number, d: number): void {
    if (map.blocked[c] === 1 || (dist[c] as number) !== UNREACHABLE) return;
    dist[c] = d;
    queue[tail++] = c;
  }
}

export function reachable(map: MapData, from: Vec2, to: Vec2): boolean {
  return (distanceField(map, from)[cellOf(map, to)] as number) !== UNREACHABLE;
}
