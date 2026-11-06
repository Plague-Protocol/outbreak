import { createRng, chance, range } from './rng';
import type { Building, MapData, Vec2 } from './types';

export const BLOCKS = 5;
export const PITCH = 12; // block + street
export const STREET = 4;
export const MAP_SIZE = BLOCKS * PITCH + STREET; // 64
const BLOCK = PITCH - STREET; // 8
const NAV_CLEARANCE = 1.0; // a nav cell is blocked if its center is this close to a building
export const UNREACHABLE = 32767;

export function generateMap(seed: number): MapData {
  const rng = createRng(seed);
  const buildings: Building[] = [];
  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      if (!chance(rng, 0.82)) continue; // open lot
      const w = range(rng, 5, BLOCK);
      const h = range(rng, 5, BLOCK);
      const bx = STREET + i * PITCH;
      const by = STREET + j * PITCH;
      buildings.push({
        x: bx + range(rng, 0, BLOCK - w),
        y: by + range(rng, 0, BLOCK - h),
        w, h,
        height: range(rng, 1.6, 3.4),
        tone: range(rng, 0, 1),
      });
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
      for (const b of buildings) {
        const nx = Math.max(b.x, Math.min(px, b.x + b.w));
        const ny = Math.max(b.y, Math.min(py, b.y + b.h));
        if (Math.hypot(px - nx, py - ny) < NAV_CLEARANCE) { blocked[cy * cols + cx] = 1; break; }
      }
    }
  }
  return { size: MAP_SIZE, cols, buildings, blocked, points };
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
