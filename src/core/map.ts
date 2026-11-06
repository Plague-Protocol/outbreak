import { createRng, chance, int, pick, range, shuffle, type Rng } from './rng';
import type { Block, Building, Decor, District, MapData, ObstacleKind, ParkingSpot, Vec2 } from './types';

// World scale: a character is 2.8 units tall (about 1.75 m), so 1 unit is about 0.63 m.
export const BLOCKS = 8;
export const STREET = 9; // two lanes, about 5.7 m
export const BLOCK = 30; // about 19 m
export const PITCH = BLOCK + STREET; // 39
export const MAP_SIZE = BLOCKS * PITCH + STREET; // 321
const NAV_CLEARANCE = 1.0; // a nav cell is blocked if its center is this close to an obstacle
const GRID_CELL = 16;
export const UNREACHABLE = 32767;
export const WATER_ROW = BLOCKS - 1; // the harbour runs along the far edge

export const CITY_NAME = 'Port Halden';

/** Footprint (along x, along y) and height of props, in world units. */
const PROP: Partial<Record<ObstacleKind, [number, number, number]>> = {
  car: [2.9, 6.4, 2.3],
  wreck: [2.9, 6.4, 1.9],
  dumpster: [2.0, 3.4, 2.2],
  barrel: [0.9, 0.9, 1.4],
  barricade: [4.0, 0.6, 1.6],
  lamp: [0.4, 0.4, 7.5],
  tree: [0.9, 0.9, 6.5],
  deadtree: [0.7, 0.7, 5],
  bench: [2.2, 0.8, 1],
  pump: [1.2, 2.8, 2.2],
  container: [2.6, 6.2, 2.7],
};

function prop(kind: ObstacleKind, x: number, y: number, rotate: boolean, rng: Rng): Building {
  const [a, b, height] = PROP[kind]!;
  const [w, h] = rotate ? [b, a] : [a, b];
  return { kind, x, y, w, h, height, tone: range(rng, 0, 1) };
}

function overlaps(a: Building, b: Building, pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

function assignDistricts(rng: Rng): District[][] {
  const d: District[][] = [];
  for (let i = 0; i < BLOCKS; i++) {
    d.push([]);
    for (let j = 0; j < BLOCKS; j++) {
      let k: District = 'residential';
      if (j === WATER_ROW) k = 'water';
      else if (j === WATER_ROW - 1) k = 'industrial';
      else if (i >= 2 && i <= 5 && j >= 2 && j <= 3) k = 'downtown';
      else if (i === 0 || i === BLOCKS - 1 || j === 0) k = chance(rng, 0.8) ? 'outskirts' : 'residential';
      d[i]!.push(k);
    }
  }
  // a 2x2 park somewhere in the residential belt
  const spots: Array<[number, number]> = [];
  for (let i = 1; i < BLOCKS - 2; i++) for (let j = 1; j < WATER_ROW - 2; j++) {
    if ([[0, 0], [1, 0], [0, 1], [1, 1]].every(([a, b]) => d[i + a!]![j + b!] === 'residential')) spots.push([i, j]);
  }
  if (spots.length > 0) {
    const [pi, pj] = pick(rng, spots);
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) d[pi + a!]![pj + b!] = 'park';
  }
  return d;
}

/**
 * A port city on a street grid: downtown towers, residential streets, a park, docklands on the
 * harbour, and desolate outskirts. Obstacles only ever sit inside blocks (or the harbour), so the
 * street grid stays open and connected.
 */
export function generateMap(seed: number): MapData {
  const rng = createRng(seed);
  const districts = assignDistricts(rng);
  const obstacles: Building[] = [];
  const decor: Decor[] = [];
  const blocks: Block[] = [];
  let gasStation = false;

  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      const bx = STREET + i * PITCH;
      const by = STREET + j * PITCH;
      const district = districts[i]![j]!;
      const block: Block = { i, j, x: bx, y: by, size: BLOCK, district };
      blocks.push(block);
      const inBlock: Building[] = [];
      const tryAdd = (o: Building, pad = 1.8): boolean => {
        if (o.x < bx || o.y < by || o.x + o.w > bx + BLOCK || o.y + o.h > by + BLOCK) return false;
        if (inBlock.some((q) => overlaps(o, q, pad))) return false;
        inBlock.push(o);
        return true;
      };
      const lampCorners = () => {
        for (const [cx, cy] of [[bx + 0.3, by + 0.3], [bx + BLOCK - 0.7, by + BLOCK - 0.7], [bx + 0.3, by + BLOCK - 0.7], [bx + BLOCK - 0.7, by + 0.3]]) {
          if (chance(rng, 0.55)) tryAdd(prop('lamp', cx!, cy!, false, rng), 0.5);
        }
      };
      const scatter = (kinds: readonly ObstacleKind[], n: number) => {
        for (let k = 0; k < n; k++) {
          const kind = pick(rng, kinds);
          const [a, b] = PROP[kind]!;
          const rot = chance(rng, 0.5);
          tryAdd(prop(kind, bx + range(rng, 0.5, BLOCK - Math.max(a, b) - 0.5), by + range(rng, 0.5, BLOCK - Math.max(a, b) - 0.5), rot, rng));
        }
      };

      switch (district) {
        case 'downtown': {
          lampCorners();
          // four lots split by alleys; towers on most, a plaza on the rest
          for (const [lx, ly] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const x0 = bx + lx! * 15.5 + 0.8, y0 = by + ly! * 15.5 + 0.8;
            if (chance(rng, 0.82)) {
              const w = range(rng, 10, 12.8), h = range(rng, 10, 12.8);
              tryAdd({ kind: 'tower', x: x0 + range(rng, 0, 12.8 - w), y: y0 + range(rng, 0, 12.8 - h), w, h, height: range(rng, 12, 24), tone: range(rng, 0, 1) });
            } else {
              decor.push({ kind: 'plaza', x: x0, y: y0, w: 12.8, h: 12.8 });
              tryAdd(prop('bench', x0 + 3, y0 + 6, false, rng));
              tryAdd(prop('tree', x0 + 9, y0 + 3, false, rng));
            }
          }
          scatter(['dumpster', 'barricade', 'wreck'], int(rng, 0, 2));
          break;
        }
        case 'residential': {
          lampCorners();
          decor.push({ kind: 'grass', x: bx + 0.5, y: by + 0.5, w: BLOCK - 1, h: BLOCK - 1 });
          // a 3x3 grid of house lots, a few left empty or with a car in the drive
          for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
            if (a === 1 && b === 1) continue; // back gardens meet in the middle
            const lx = bx + a * 10, ly = by + b * 10;
            if (chance(rng, 0.8)) {
              const w = range(rng, 5.5, 7.2), h = range(rng, 5.5, 7.2);
              tryAdd({ kind: 'house', x: lx + range(rng, 1.2, 8.8 - w), y: ly + range(rng, 1.2, 8.8 - h), w, h, height: range(rng, 3.6, 6), tone: range(rng, 0, 1) });
            }
            if (chance(rng, 0.35)) tryAdd(prop('tree', lx + range(rng, 1, 8), ly + range(rng, 1, 8), false, rng), 0.8);
          }
          if (chance(rng, 0.5)) tryAdd(prop(chance(rng, 0.5) ? 'car' : 'wreck', bx + 11.5, by + 12, false, rng));
          // fences along part of the front, with gaps
          if (chance(rng, 0.6)) {
            const along = chance(rng, 0.5);
            for (let s = 0; s < 3; s++) {
              if (chance(rng, 0.45)) continue;
              const f: Building = along
                ? { kind: 'fence', x: bx + s * 10 + 1.5, y: by + 0.2, w: 6, h: 0.25, height: 1.3, tone: 0.5 }
                : { kind: 'fence', x: bx + 0.2, y: by + s * 10 + 1.5, w: 0.25, h: 6, height: 1.3, tone: 0.5 };
              tryAdd(f, 1.2);
            }
          }
          break;
        }
        case 'park': {
          decor.push({ kind: 'grass', x: bx, y: by, w: BLOCK, h: BLOCK });
          lampCorners();
          const n = int(rng, 6, 10);
          for (let k = 0; k < n; k++) tryAdd(prop('tree', bx + range(rng, 1, BLOCK - 2), by + range(rng, 1, BLOCK - 2), false, rng), 2.2);
          scatter(['bench', 'bench', 'barricade'], int(rng, 1, 3));
          block.landmark = 'Halden Park';
          break;
        }
        case 'industrial': {
          // a warehouse and rows of shipping containers
          const ww = range(rng, 14, 18), wh = range(rng, 11, 14);
          const left = chance(rng, 0.5);
          tryAdd({ kind: 'warehouse', x: left ? bx + 1 : bx + BLOCK - ww - 1, y: by + range(rng, 1, BLOCK - wh - 1), w: ww, h: wh, height: range(rng, 7, 9), tone: range(rng, 0, 1) });
          const cx0 = left ? bx + ww + 3.5 : bx + 1;
          for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
            if (chance(rng, 0.3)) continue;
            const o = prop('container', cx0 + c * 4.6, by + 1 + r * 9.4, false, rng);
            if (chance(rng, 0.35)) o.height = 5.4; // stacked two high
            tryAdd(o, 1.6);
          }
          decor.push({ kind: 'lot', x: bx, y: by, w: BLOCK, h: BLOCK });
          scatter(['barrel', 'barrel', 'dumpster'], int(rng, 1, 3));
          if (i === 3) block.landmark = 'Docklands';
          break;
        }
        case 'outskirts': {
          decor.push({ kind: 'dirt', x: bx, y: by, w: BLOCK, h: BLOCK });
          if (!gasStation && i >= 2 && chance(rng, 0.3)) {
            gasStation = true;
            block.landmark = 'Gas station';
            tryAdd({ kind: 'shop', x: bx + 2, y: by + 2, w: 10, h: 7, height: 4.2, tone: 0.3 });
            decor.push({ kind: 'canopy', x: bx + 8, y: by + 13, w: 16, h: 11 });
            for (const px of [12, 19]) tryAdd(prop('pump', bx + px, by + 17, false, rng), 1.5);
            scatter(['wreck', 'barrel'], 2);
          } else {
            if (chance(rng, 0.45)) {
              const w = range(rng, 5, 8), h = range(rng, 5, 7);
              tryAdd({ kind: 'shop', x: bx + range(rng, 1, BLOCK - w - 1), y: by + range(rng, 1, BLOCK - h - 1), w, h, height: range(rng, 3.2, 4.5), tone: range(rng, 0, 1) });
            }
            scatter(['deadtree', 'deadtree', 'wreck', 'barrel', 'barricade'], int(rng, 2, 5));
          }
          break;
        }
        case 'water':
          break;
      }
      obstacles.push(...inBlock);
    }
  }

  // The harbour: water from the top of the last block row to the map edge, with two piers.
  const waterY = STREET + WATER_ROW * PITCH;
  const pierStreets = shuffle(rng, [1, 2, 3, 4, 5, 6]).slice(0, 2).sort((a, b) => a - b);
  let x0 = 0;
  for (const k of [...pierStreets, BLOCKS + 1]) {
    const px = k * PITCH; // pier occupies this vertical street's width
    const x1 = k <= BLOCKS ? px : MAP_SIZE;
    if (x1 > x0) obstacles.push({ kind: 'water', x: x0, y: waterY, w: x1 - x0, h: MAP_SIZE - waterY, height: 0, tone: 0 });
    if (k <= BLOCKS) decor.push({ kind: 'pier', x: px, y: waterY, w: STREET, h: MAP_SIZE - waterY - 1 });
    x0 = px + STREET;
  }

  // Candidate street points: intersections plus points along every street segment.
  const pts: Vec2[] = [];
  for (let a = 0; a <= BLOCKS; a++) {
    for (let b = 0; b <= BLOCKS; b++) pts.push({ x: STREET / 2 + a * PITCH, y: STREET / 2 + b * PITCH });
    for (let b = 0; b < BLOCKS; b++) {
      for (const f of [0.25, 0.5, 0.75]) {
        const along = STREET + b * PITCH + f * BLOCK;
        pts.push({ x: along, y: STREET / 2 + a * PITCH });
        pts.push({ x: STREET / 2 + a * PITCH, y: along });
      }
    }
  }

  // Kerbside parking for drivable vehicles, between the candidate points.
  const parking: ParkingSpot[] = [];
  for (let a = 0; a <= BLOCKS; a++) for (let b = 0; b < BLOCKS; b++) {
    const along = STREET + b * PITCH + pick(rng, [0.12, 0.38, 0.62, 0.88]) * BLOCK;
    const kerb = STREET / 2 + a * PITCH + (chance(rng, 0.5) ? 1 : -1) * (STREET / 2 - 1.7);
    if (chance(rng, 0.5)) parking.push({ x: along, y: kerb, heading: chance(rng, 0.5) ? 0 : Math.PI });
    else parking.push({ x: kerb, y: along, heading: chance(rng, 0.5) ? Math.PI / 2 : -Math.PI / 2 });
  }

  // nav grid: mark cells near each obstacle (cheaper than testing every cell against everything)
  const cols = MAP_SIZE;
  const blocked = new Uint8Array(cols * cols);
  for (const b of obstacles) {
    const cx0 = Math.max(0, Math.floor(b.x - NAV_CLEARANCE)), cx1 = Math.min(cols - 1, Math.ceil(b.x + b.w + NAV_CLEARANCE));
    const cy0 = Math.max(0, Math.floor(b.y - NAV_CLEARANCE)), cy1 = Math.min(cols - 1, Math.ceil(b.y + b.h + NAV_CLEARANCE));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const px = cx + 0.5, py = cy + 0.5;
      const nx = Math.max(b.x, Math.min(px, b.x + b.w)), ny = Math.max(b.y, Math.min(py, b.y + b.h));
      if ((px - nx) ** 2 + (py - ny) ** 2 < NAV_CLEARANCE * NAV_CLEARANCE) blocked[cy * cols + cx] = 1;
    }
  }
  const points = pts.filter((p) => blocked[Math.floor(p.y) * cols + Math.floor(p.x)] === 0);
  const parkingFree = parking.filter((p) => blocked[Math.floor(p.y) * cols + Math.floor(p.x)] === 0);

  // spatial hash for collision queries
  const gridN = Math.ceil(MAP_SIZE / GRID_CELL);
  const grid: number[][] = Array.from({ length: gridN * gridN }, () => []);
  obstacles.forEach((b, idx) => {
    const gx0 = Math.max(0, Math.floor((b.x - 1) / GRID_CELL)), gx1 = Math.min(gridN - 1, Math.floor((b.x + b.w + 1) / GRID_CELL));
    const gy0 = Math.max(0, Math.floor((b.y - 1) / GRID_CELL)), gy1 = Math.min(gridN - 1, Math.floor((b.y + b.h + 1) / GRID_CELL));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) grid[gy * gridN + gx]!.push(idx);
  });

  return { size: MAP_SIZE, cols, buildings: obstacles, blocked, points, blocks, decor, parking: parkingFree, grid, gridCell: GRID_CELL, gridN };
}

export function districtAt(map: MapData, p: Vec2): Block | null {
  const i = Math.floor((p.x - STREET / 2) / PITCH), j = Math.floor((p.y - STREET / 2) / PITCH);
  return map.blocks.find((b) => b.i === i && b.j === j) ?? null;
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
  const blocked = map.blocked;
  while (head < tail) {
    const c = queue[head++] as number;
    const d = (dist[c] as number) + 1;
    const x = c % cols;
    if (x > 0 && blocked[c - 1] === 0 && dist[c - 1] === UNREACHABLE) { dist[c - 1] = d; queue[tail++] = c - 1; }
    if (x < cols - 1 && blocked[c + 1] === 0 && dist[c + 1] === UNREACHABLE) { dist[c + 1] = d; queue[tail++] = c + 1; }
    if (c >= cols && blocked[c - cols] === 0 && dist[c - cols] === UNREACHABLE) { dist[c - cols] = d; queue[tail++] = c - cols; }
    if (c < n - cols && blocked[c + cols] === 0 && dist[c + cols] === UNREACHABLE) { dist[c + cols] = d; queue[tail++] = c + cols; }
  }
  return dist;
}

export function reachable(map: MapData, from: Vec2, to: Vec2): boolean {
  return (distanceField(map, from)[cellOf(map, to)] as number) !== UNREACHABLE;
}
