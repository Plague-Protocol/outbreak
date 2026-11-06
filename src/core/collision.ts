import type { Building, MapData, Vec2 } from './types';

/** Push a circle out of an axis-aligned box. Mutates pos. Returns true if it moved. */
function pushOut(pos: Vec2, r: number, b: Building): boolean {
  const cx = Math.max(b.x, Math.min(pos.x, b.x + b.w));
  const cy = Math.max(b.y, Math.min(pos.y, b.y + b.h));
  const dx = pos.x - cx;
  const dy = pos.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    pos.x = cx + (dx / d) * r;
    pos.y = cy + (dy / d) * r;
  } else {
    // center inside the box: exit via the nearest face
    const left = pos.x - b.x, right = b.x + b.w - pos.x;
    const top = pos.y - b.y, bottom = b.y + b.h - pos.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) pos.x = b.x - r;
    else if (m === right) pos.x = b.x + b.w + r;
    else if (m === top) pos.y = b.y - r;
    else pos.y = b.y + b.h + r;
  }
  return true;
}

/** Obstacle indices whose grid cells touch a circle's bounding box. */
export function nearbyObstacles(map: MapData, pos: Vec2, r: number, out: number[] = []): number[] {
  out.length = 0;
  const c = map.gridCell, n = map.gridN;
  const gx0 = Math.max(0, Math.floor((pos.x - r) / c)), gx1 = Math.min(n - 1, Math.floor((pos.x + r) / c));
  const gy0 = Math.max(0, Math.floor((pos.y - r) / c)), gy1 = Math.min(n - 1, Math.floor((pos.y + r) / c));
  for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
    for (const idx of map.grid[gy * n + gx]!) if (!out.includes(idx)) out.push(idx);
  }
  return out;
}

const scratch: number[] = [];

/** Resolve a circle against obstacles and world bounds (slides along walls). Returns true on contact. */
export function resolve(map: MapData, pos: Vec2, r: number): boolean {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const idx of nearbyObstacles(map, pos, r + 0.5, scratch)) hit = pushOut(pos, r, map.buildings[idx]!) || hit;
  }
  const x = Math.max(r, Math.min(map.size - r, pos.x));
  const y = Math.max(r, Math.min(map.size - r, pos.y));
  if (x !== pos.x || y !== pos.y) hit = true;
  pos.x = x;
  pos.y = y;
  return hit;
}

/** True if a straight segment stays on walkable nav cells (cells already include clearance). */
export function lineClear(map: MapData, a: Vec2, b: Vec2, _r: number): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / 0.5));
  const cols = map.cols;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = Math.floor(a.x + dx * t), cy = Math.floor(a.y + dy * t);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= cols) return false;
    if (map.blocked[cy * cols + cx] === 1) return false;
  }
  return true;
}
