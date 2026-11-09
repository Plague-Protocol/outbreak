import { createRng, chance, int, next, pick, range, shuffle, type Rng } from './rng';
import type { Block, Building, Decor, District, MapData, ObstacleKind, ParkingSpot, Storefront, Theme, Vec2 } from './types';
import { PILEUPS, STORE_COUNT } from './config';

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
  ambulance: [6.6, 3.0, 2.8],
};

function prop(kind: ObstacleKind, x: number, y: number, rotate: boolean, rng: Rng): Building {
  const [a, b, height] = PROP[kind]!;
  const [w, h] = rotate ? [b, a] : [a, b];
  return { kind, x, y, w, h, height, tone: range(rng, 0, 1) };
}

function overlaps(a: Building, b: Building, pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

/** The rail yard's row of blocks in the docks. */
const RAIL_ROW = 3;

function assignDistricts(rng: Rng, theme: Theme): District[][] {
  const d: District[][] = [];
  const rim = (i: number, j: number) => i === 0 || i === BLOCKS - 1 || j === 0;
  for (let i = 0; i < BLOCKS; i++) {
    d.push([]);
    for (let j = 0; j < BLOCKS; j++) {
      let k: District = 'residential';
      if (j === WATER_ROW) k = 'water';
      else if (theme === 'docks') k = j >= 2 ? 'industrial' : rim(i, j) && chance(rng, 0.5) ? 'outskirts' : 'residential'; // yards, sheds, rows of workers' houses
      else if (theme === 'edge') k = i >= 2 && i <= 5 && j >= 2 && j <= 3 ? 'residential' : 'outskirts'; // a last few streets, then open ground
      else if (j === WATER_ROW - 1) k = 'industrial';
      else if (i >= 2 && i <= 5 && j >= 2 && j <= 3) k = 'downtown';
      else if (rim(i, j)) k = chance(rng, 0.8) ? 'outskirts' : 'residential';
      d[i]!.push(k);
    }
  }
  // 2x2 parks (woods, at the edge of town) in what is left
  const host: District = theme === 'edge' ? 'outskirts' : 'residential';
  for (let n = theme === 'edge' ? 3 : theme === 'docks' ? 0 : 1; n > 0; n--) {
    const spots: Array<[number, number]> = [];
    for (let i = 1; i < BLOCKS - 2; i++) for (let j = 1; j < WATER_ROW - 2; j++) {
      if ([[0, 0], [1, 0], [0, 1], [1, 1]].every(([a, b]) => d[i + a!]![j + b!] === host)) spots.push([i, j]);
    }
    if (!spots.length) break;
    const [pi, pj] = pick(rng, spots);
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) d[pi + a!]![pj + b!] = 'park';
  }
  return d;
}

const STORE_W = 9; // frontage
const STORE_D = 6.5; // depth
const STORE_SETBACK = 0.6; // from the kerb
const DOOR_OUT = 1.3; // the door point, out from the facade

/**
 * Weapon stores: one building per chosen block, on the block's edge with its door to the street.
 * Chosen with their own random stream so the rest of the city does not shift. Blocks in town are
 * preferred, spread at least three blocks apart.
 */
function chooseStorefronts(seed: number, districts: District[][]): Map<number, Storefront> {
  const rng = createRng(seed ^ 0x5f0e57);
  const cands: Array<[number, number]> = [];
  for (let i = 0; i < BLOCKS; i++) for (let j = 0; j < BLOCKS; j++) cands.push([i, j]);
  const rank = (d: District) => (d === 'downtown' || d === 'residential' ? 0 : d === 'industrial' || d === 'outskirts' ? 1 : 2);
  const order = shuffle(rng, cands).sort((a, b) => rank(districts[a[0]]![a[1]]!) - rank(districts[b[0]]![b[1]]!));
  const out = new Map<number, Storefront>();
  const picked: Array<[number, number]> = [];
  for (const [i, j] of order) {
    if (out.size >= STORE_COUNT) break;
    if (rank(districts[i]![j]!) === 2) break;
    if (picked.some(([a, b]) => Math.max(Math.abs(a - i), Math.abs(b - j)) < 3)) continue;
    const bx = STREET + i * PITCH, by = STREET + j * PITCH, mid = BLOCK / 2;
    let f: Storefront;
    switch (int(rng, 0, 3)) {
      case 0: f = { x: bx + mid - STORE_W / 2, y: by + STORE_SETBACK, w: STORE_W, h: STORE_D, door: { x: bx + mid, y: by + STORE_SETBACK - DOOR_OUT }, facing: { x: 0, y: -1 } }; break;
      case 1: f = { x: bx + mid - STORE_W / 2, y: by + BLOCK - STORE_SETBACK - STORE_D, w: STORE_W, h: STORE_D, door: { x: bx + mid, y: by + BLOCK - STORE_SETBACK + DOOR_OUT }, facing: { x: 0, y: 1 } }; break;
      case 2: f = { x: bx + STORE_SETBACK, y: by + mid - STORE_W / 2, w: STORE_D, h: STORE_W, door: { x: bx + STORE_SETBACK - DOOR_OUT, y: by + mid }, facing: { x: -1, y: 0 } }; break;
      default: f = { x: bx + BLOCK - STORE_SETBACK - STORE_D, y: by + mid - STORE_W / 2, w: STORE_D, h: STORE_W, door: { x: bx + BLOCK - STORE_SETBACK + DOOR_OUT, y: by + mid }, facing: { x: 1, y: 0 } };
    }
    picked.push([i, j]);
    out.set(i * BLOCKS + j, f);
  }
  return out;
}

/** The hospital (a residential block) and the gas station (an outskirts block), chosen up front. */
function chooseSpecialBlocks(seed: number, districts: District[][], stores: Map<number, Storefront>): { hospital: number; gas: number } {
  const rng = createRng(seed ^ 0x40591);
  const cands = (d: District, ok: (i: number, j: number) => boolean) => {
    const out: number[] = [];
    for (let i = 0; i < BLOCKS; i++) for (let j = 0; j < BLOCKS; j++) if (districts[i]![j] === d && ok(i, j) && !stores.has(i * BLOCKS + j)) out.push(i * BLOCKS + j);
    return shuffle(rng, out);
  };
  const hospital = cands('residential', (i, j) => i > 0 && i < BLOCKS - 1 && j > 0)[0] ?? -1;
  const gas = cands('outskirts', (i) => i >= 2)[0] ?? cands('outskirts', () => true)[0] ?? -1;
  return { hospital, gas };
}

/** Plain 4-neighbour BFS over a blocked grid (for the connectivity check). */
function bfs(blocked: Uint8Array, cols: number, from: Vec2): Int16Array {
  const out = new Int16Array(cols * cols).fill(UNREACHABLE);
  const q = new Int32Array(cols * cols);
  const start = Math.floor(from.y) * cols + Math.floor(from.x);
  out[start] = 0;
  let h = 0, t = 0;
  q[t++] = start;
  while (h < t) {
    const c = q[h++]!;
    const x = c % cols, y = (c - x) / cols, d = out[c]! + 1;
    for (const n of [x > 0 ? c - 1 : -1, x < cols - 1 ? c + 1 : -1, y > 0 ? c - cols : -1, y < cols - 1 ? c + cols : -1]) {
      if (n < 0 || blocked[n] || out[n] !== UNREACHABLE) continue;
      out[n] = Math.min(d, UNREACHABLE - 1);
      q[t++] = n;
    }
  }
  return out;
}

/**
 * Damage in the streets, with its own random stream: pile-ups of crashed cars (and an overturned
 * bus) across a few street segments, an overrun military checkpoint, and debris everywhere.
 * Pile-ups span the roadway so cars cannot pass; segments never share an intersection, so the
 * grid stays connected.
 */
function streetDamage(seed: number, obstacles: Building[], decor: Decor[], labels: Array<{ name: string; x: number; y: number }>, keepClear: Vec2[]): void {
  const rng = createRng(seed ^ 0xc4a5);
  // interior segments: [vertical?, street line k, segment b]
  const segs: Array<[boolean, number, number]> = [];
  for (let k = 1; k < BLOCKS; k++) for (let b = 0; b < WATER_ROW - 1; b++) segs.push([true, k, b]);
  for (let k = 1; k < WATER_ROW; k++) for (let b = 0; b < BLOCKS; b++) segs.push([false, k, b]);
  const used = new Set<string>();
  const ends = ([v, k, b]: [boolean, number, number]) => (v ? [`${k},${b}`, `${k},${b + 1}`] : [`${b},${k}`, `${b + 1},${k}`]);
  const take = (n: number) => {
    const out: Array<[boolean, number, number]> = [];
    for (const sg of shuffle(rng, segs)) {
      if (out.length >= n) break;
      const e = ends(sg);
      if (e.some((x) => used.has(x))) continue;
      // never in front of a store's door
      const [v, k, b] = sg, c = STREET / 2 + k * PITCH, m = STREET + b * PITCH + BLOCK / 2;
      const mid = v ? { x: c, y: m } : { x: m, y: c };
      if (keepClear.some((d) => Math.hypot(d.x - mid.x, d.y - mid.y) < 20)) continue;
      e.forEach((x) => used.add(x));
      out.push(sg);
    }
    return out;
  };
  // a box in street-local coords (u across the street from its centre line, v along it from the
  // segment's middle), turned into a world obstacle
  const place = (vert: boolean, c: number, m: number) => (kind: ObstacleKind, u0: number, u1: number, v0: number, v1: number, height: number, tone = range(rng, 0, 1)): Building =>
    vert ? { kind, x: c + u0, y: m + v0, w: u1 - u0, h: v1 - v0, height, tone } : { kind, x: m + v0, y: c + u0, w: v1 - v0, h: u1 - u0, height, tone };
  const deco = (vert: boolean, c: number, m: number) => (kind: Decor['kind'], u: number, v: number, w: number, h: number): Decor =>
    vert ? { kind, x: c + u, y: m + v, w, h } : { kind, x: m + v, y: c + u, w: h, h: w };

  const segsChosen = take(PILEUPS + 1);
  segsChosen.forEach(([vert, k, b], n) => {
    const c = STREET / 2 + k * PITCH, m = STREET + b * PITCH + BLOCK / 2;
    const P = place(vert, c, m), D = deco(vert, c, m);
    const flip = chance(rng, 0.5) ? 1 : -1;
    if (n < PILEUPS) {
      // two cars crashed across the road, a bus on its side behind them, glass and luggage
      obstacles.push(P('wreck', -5.5, 1.5, -1.6, 1.4, 1.9));
      obstacles.push(P('wreck', -1, 5.5, 0.6, 3.5, 1.9));
      obstacles.push(flip > 0 ? P('bus', 1.6, 4.6, -12, -2, 3) : P('bus', -4.6, -1.6, 4, 14, 3));
      decor.push(D('scorch', -3, -3, 5, 4), D('luggage', -2, 4.5, 1.6, 1.2), D('rubble', 2, -1, 2, 2.5), D('litter', -4, -6, 3, 4));
    } else {
      // the checkpoint: sandbag walls from both kerbs, an army truck, a barricade, a floodlight
      obstacles.push(P('sandbag', -5, -1.9, -0.5, 0.6, 1.1), P('sandbag', 1.9, 5, -0.5, 0.6, 1.1));
      obstacles.push(P('truck', -4.3, -1.3, 2.5, 10.5, 3.2));
      obstacles.push(P('barricade', 0.6, 4.6, -4, -3.4, 1.6, 0.5));
      decor.push(D('checkpoint', 3.6, 1.8, 0.4, 0.4), D('luggage', 1, 3.5, 1.5, 1.2), D('litter', -1, -7, 3, 3));
      labels.push({ name: 'Checkpoint', x: vert ? c : m, y: vert ? m : c });
    }
  });
  // debris along the streets: paper and trash, a few abandoned suitcases, scorch marks, rubble
  for (let k = 0; k < 110; k++) {
    const vert = chance(rng, 0.5), line = STREET / 2 + int(rng, 0, BLOCKS) * PITCH, along = range(rng, 2, MAP_SIZE - 2);
    const off = range(rng, -4.2, 4.2);
    const r = next(rng);
    const kind: Decor['kind'] = r < 0.62 ? 'litter' : r < 0.74 ? 'luggage' : r < 0.88 ? 'scorch' : 'rubble';
    const size = kind === 'luggage' ? 1.2 : kind === 'litter' ? range(rng, 1.5, 3.5) : range(rng, 1.5, 3);
    const x = vert ? line + off : along, y = vert ? along : line + off;
    if (y > STREET + WATER_ROW * PITCH - 1) continue; // not in the harbour
    decor.push({ kind, x: x - size / 2, y: y - size / 2, w: size, h: size * (kind === 'luggage' ? 0.7 : 1) });
  }
}

/**
 * A port city on a street grid: downtown towers, residential streets, a park, docklands on the
 * harbour, and desolate outskirts. Obstacles only ever sit inside blocks (or the harbour), so the
 * street grid stays open and connected.
 */
export function generateMap(seed: number, theme: Theme = 'downtown'): MapData {
  const rng = createRng(seed);
  const districts = assignDistricts(rng, theme);
  const storeBlocks = chooseStorefronts(seed, districts);
  const special = chooseSpecialBlocks(seed, districts, storeBlocks);
  const labels: Array<{ name: string; x: number; y: number }> = [];
  const obstacles: Building[] = [];
  const decor: Decor[] = [];
  const blocks: Block[] = [];

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
      const front = storeBlocks.get(i * BLOCKS + j);
      if (front) tryAdd({ kind: 'store', x: front.x, y: front.y, w: front.w, h: front.h, height: 5, tone: 0.5 });
      const edge = i === 1 || i === BLOCKS - 2 || j === 1; // the town thins out toward the outskirts


      const lampCorners = () => {
        for (const [cx, cy] of [[bx + 0.3, by + 0.3], [bx + BLOCK - 0.7, by + BLOCK - 0.7], [bx + 0.3, by + BLOCK - 0.7], [bx + BLOCK - 0.7, by + 0.3]]) {
          if (!chance(rng, 0.55)) continue;
          if (chance(rng, 0.18)) {
            // knocked down: the pole lies along the kerb (no collision, you step over it)
            const alongX = chance(rng, 0.5), dir = cx! < bx + BLOCK / 2 ? 1 : -1, dirY = cy! < by + BLOCK / 2 ? 1 : -1;
            decor.push(alongX
              ? { kind: 'fallenlamp', x: dir > 0 ? cx! : cx! - 7, y: cy!, w: 7, h: 0.3 }
              : { kind: 'fallenlamp', x: cx!, y: dirY > 0 ? cy! : cy! - 7, w: 0.3, h: 7 });
          } else tryAdd(prop('lamp', cx!, cy!, false, rng), 0.5);
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

      if (special.hospital === i * BLOCKS + j) {
        // Mercy Hospital: a pale block of wards, ambulances abandoned at the doors
        block.landmark = 'Mercy Hospital';
        decor.push({ kind: 'plaza', x: bx + 0.5, y: by + 0.5, w: BLOCK - 1, h: BLOCK - 1 });
        lampCorners();
        tryAdd({ kind: 'hospital', x: bx + 3, y: by + 2.5, w: 22, h: 14, height: 10, tone: 0.5 });
        tryAdd({ ...prop('ambulance', bx + 4, by + 20, false, rng) }, 1);
        tryAdd({ ...prop('ambulance', bx + 14, by + 21.5, false, rng) }, 1);
        tryAdd(prop('barricade', bx + 23, by + 25, false, rng));
        decor.push({ kind: 'luggage', x: bx + 11, y: by + 24, w: 2, h: 1.5 }, { kind: 'litter', x: bx + 6, y: by + 25, w: 5, h: 3 });
        obstacles.push(...inBlock);
        continue;
      }

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
          if (chance(rng, 0.5)) decor.push({ kind: 'rubble', x: bx + range(rng, 1, 24), y: by + range(rng, 1, 24), w: range(rng, 2, 4), h: range(rng, 2, 4) });
          break;
        }
        case 'residential': {
          lampCorners();
          decor.push({ kind: 'grass', x: bx + 0.5, y: by + 0.5, w: BLOCK - 1, h: BLOCK - 1 });
          if (edge) decor.push({ kind: 'dirt', x: bx + range(rng, 1, 12), y: by + range(rng, 1, 12), w: range(rng, 8, 16), h: range(rng, 8, 16) });
          // a 3x3 grid of house lots, a few left empty or with a car in the drive
          for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
            if (a === 1 && b === 1) continue; // back gardens meet in the middle
            const lx = bx + a * 10, ly = by + b * 10;
            if (chance(rng, 0.8)) {
              const w = range(rng, 5.5, 7.2), h = range(rng, 5.5, 7.2);
              tryAdd({ kind: 'house', x: lx + range(rng, 1.2, 8.8 - w), y: ly + range(rng, 1.2, 8.8 - h), w, h, height: range(rng, 3.6, 6), tone: range(rng, 0, 1) });
            } else {
              decor.push({ kind: 'weeds', x: lx + 0.8, y: ly + 0.8, w: 8.4, h: 8.4 }); // an overgrown empty lot
            }
            if (chance(rng, 0.35)) tryAdd(prop(edge && chance(rng, 0.6) ? 'deadtree' : 'tree', lx + range(rng, 1, 8), ly + range(rng, 1, 8), false, rng), 0.8);
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
          const woods = theme === 'edge'; // no lamps out here: thick trees, half of them dead
          if (!woods) lampCorners();
          const n = woods ? int(rng, 12, 18) : int(rng, 6, 10);
          for (let k = 0; k < n; k++) tryAdd(prop(woods && chance(rng, 0.45) ? 'deadtree' : 'tree', bx + range(rng, 1, BLOCK - 2), by + range(rng, 1, BLOCK - 2), false, rng), woods ? 1.6 : 2.2);
          if (!woods) scatter(['bench', 'bench', 'barricade'], int(rng, 1, 3));
          block.landmark = woods ? 'Halden Woods' : 'Halden Park';
          break;
        }
        case 'industrial': {
          if (theme === 'docks') lampCorners();
          if (theme === 'docks' && j === RAIL_ROW) {
            // the rail yard: two tracks across the block, freight wagons standing on them
            for (const ty of [8, 21]) {
              decor.push({ kind: 'rails', x: bx, y: by + ty - 1, w: BLOCK, h: 2 });
              for (let k = 0; k < 3; k++) if (chance(rng, 0.6)) tryAdd(prop('container', bx + 1 + k * 9.6, by + ty - 1.3, true, rng), 1.2);
            }
            scatter(['barrel', 'barrel'], int(rng, 0, 2));
            if (i === 3 || i === 4) block.landmark = 'Rail yard';
            break;
          }
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
          if (i === 3 || i === 4) block.landmark = 'Docklands';
          break;
        }
        case 'outskirts': {
          decor.push({ kind: 'dirt', x: bx, y: by, w: BLOCK, h: BLOCK });
          if (special.gas === i * BLOCKS + j) {
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

  // The streets after the outbreak: pile-ups, an overrun checkpoint, debris.
  streetDamage(seed, obstacles, decor, labels, [...storeBlocks.values()].map((f) => f.door));

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
  // walkable points, all on one connected street network (a pile-up must never cut part of it off)
  const open = pts.filter((p) => blocked[Math.floor(p.y) * cols + Math.floor(p.x)] === 0);
  const centre = open.reduce((a, b) => (Math.hypot(b.x - MAP_SIZE / 2, b.y - MAP_SIZE / 2) < Math.hypot(a.x - MAP_SIZE / 2, a.y - MAP_SIZE / 2) ? b : a));
  const field = bfs(blocked, cols, centre);
  const points = open.filter((p) => field[Math.floor(p.y) * cols + Math.floor(p.x)]! !== UNREACHABLE);
  const storefronts = [...storeBlocks.values()];
  // keep store doors clear of parked cars
  const parkingFree = parking.filter((p) => blocked[Math.floor(p.y) * cols + Math.floor(p.x)] === 0 && field[Math.floor(p.y) * cols + Math.floor(p.x)]! !== UNREACHABLE && storefronts.every((f) => Math.hypot(p.x - f.door.x, p.y - f.door.y) > 7));

  // spatial hash for collision queries
  const gridN = Math.ceil(MAP_SIZE / GRID_CELL);
  const grid: number[][] = Array.from({ length: gridN * gridN }, () => []);
  obstacles.forEach((b, idx) => {
    const gx0 = Math.max(0, Math.floor((b.x - 1) / GRID_CELL)), gx1 = Math.min(gridN - 1, Math.floor((b.x + b.w + 1) / GRID_CELL));
    const gy0 = Math.max(0, Math.floor((b.y - 1) / GRID_CELL)), gy1 = Math.min(gridN - 1, Math.floor((b.y + b.h + 1) / GRID_CELL));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) grid[gy * gridN + gx]!.push(idx);
  });

  return { size: MAP_SIZE, cols, buildings: obstacles, blocked, points, blocks, decor, parking: parkingFree, storefronts, labels, grid, gridCell: GRID_CELL, gridN };
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
