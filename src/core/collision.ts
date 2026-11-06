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

/** Resolve a circle against buildings and world bounds (slides along walls). */
export function resolve(map: MapData, pos: Vec2, r: number): void {
  for (let pass = 0; pass < 2; pass++) {
    for (const b of map.buildings) pushOut(pos, r, b);
  }
  pos.x = Math.max(r, Math.min(map.size - r, pos.x));
  pos.y = Math.max(r, Math.min(map.size - r, pos.y));
}

/** True if a straight segment stays clear of every building (inflated by r). */
export function lineClear(map: MapData, a: Vec2, b: Vec2, r: number): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / 0.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = a.x + dx * t, py = a.y + dy * t;
    for (const bl of map.buildings) {
      if (px > bl.x - r && px < bl.x + bl.w + r && py > bl.y - r && py < bl.y + bl.h + r) return false;
    }
  }
  return true;
}
