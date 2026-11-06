import {
  AdditiveBlending, AlwaysStencilFunc, CanvasTexture, Color, Group, InstancedMesh, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, Object3D, PlaneGeometry, ReplaceStencilOp, Vector3,
} from 'three';
import { MeshBuilder } from './mesh';
import { BLOCKS, PITCH, STREET } from '../core/map';
import { createRng, chance, int, next, pick, range } from '../core/rng';
import type { Building, MapData } from '../core/types';

export interface LightSource {
  pos: Vector3;
  color: number;
  kind: 'lamp' | 'fire' | 'flood';
  broken: boolean; // flickers
}

export interface CityMeshes {
  group: Group; // every chunk mesh; frustum culling skips the ones out of view
  pools: InstancedMesh; // additive light pools on the ground
  lights: LightSource[];
  triangles: number;
}

const BLOCK = PITCH - STREET;
const CHUNK = PITCH * 2; // two blocks per chunk side
const CAR_COLORS = [0xd9d4c7, 0x9aa1a8, 0x7a1f1f, 0x1f3a5c, 0x1b1d20, 0x2f4a33, 0xc9a227];
const CONTAINER_COLORS = [0x8a2e22, 0x24507a, 0x2f6b3a, 0xb0a99a, 0x9c6a1c];

/** Soft round light pool texture (generated, no image files). */
function poolTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export function buildCity(map: MapData, seed: number): CityMeshes {
  const rng = createRng(seed ^ 0x51ed);
  const n = Math.ceil(map.size / CHUNK);
  const solids = Array.from({ length: n * n }, () => new MeshBuilder());
  const glows = Array.from({ length: n * n }, () => new MeshBuilder());
  const chunkOf = (x: number, z: number) => {
    const i = Math.max(0, Math.min(n - 1, Math.floor(x / CHUNK))), j = Math.max(0, Math.min(n - 1, Math.floor(z / CHUNK)));
    return j * n + i;
  };
  const S = (x: number, z: number) => solids[chunkOf(x, z)]!;
  const G = (x: number, z: number) => glows[chunkOf(x, z)]!;
  const lights: LightSource[] = [];

  // --- ground: asphalt per chunk, a wasteland beyond, raised pavements, lane dashes, crossings
  S(0, 0).floor(-300, -300, map.size + 300, map.size + 300, -0.05, 0x0b0c0f);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x0 = i * CHUNK, z0 = j * CHUNK;
    S(x0 + 1, z0 + 1).floor(x0, z0, Math.min(map.size, x0 + CHUNK), Math.min(map.size, z0 + CHUNK), 0, 0x1b1e23);
  }
  for (const b of map.blocks) {
    if (b.district === 'water') continue;
    const top = b.district === 'park' ? 0x1d2a1b : b.district === 'outskirts' ? 0x2b2620 : b.district === 'industrial' ? 0x2a2b2d : 0x34363b;
    S(b.x + 1, b.y + 1).box(b.x + BLOCK / 2, 0.075, b.y + BLOCK / 2, BLOCK, 0.15, BLOCK, 0x2b2d31, top);
  }
  for (const d of map.decor) {
    const sb = S(d.x + d.w / 2, d.y + d.h / 2);
    switch (d.kind) {
      case 'grass': sb.floor(d.x, d.y, d.x + d.w, d.y + d.h, 0.16, 0x1e2b1c); break;
      case 'dirt': sb.floor(d.x + 0.5, d.y + 0.5, d.x + d.w - 0.5, d.y + d.h - 0.5, 0.16, 0x2e2821); break;
      case 'plaza': sb.floor(d.x, d.y, d.x + d.w, d.y + d.h, 0.16, 0x3d3c39); break;
      case 'lot': sb.floor(d.x + 0.5, d.y + 0.5, d.x + d.w - 0.5, d.y + d.h - 0.5, 0.16, 0x26272a); break;
      case 'pier': {
        sb.box(d.x + d.w / 2, -0.1, d.y + d.h / 2, d.w, 0.3, d.h, 0x2d2419, 0x3b2f22);
        for (let z = d.y + 1.5; z < d.y + d.h; z += 1.2) sb.floor(d.x + 0.1, z, d.x + d.w - 0.1, z + 0.08, 0.06, 0x241c13);
        break;
      }
      case 'canopy': {
        for (const [px, pz] of [[d.x + 1, d.y + 1], [d.x + d.w - 1, d.y + 1], [d.x + 1, d.y + d.h - 1], [d.x + d.w - 1, d.y + d.h - 1]]) {
          sb.box(px!, 2.4, pz!, 0.4, 4.8, 0.4, 0xb8b4ab);
        }
        sb.box(d.x + d.w / 2, 5, d.y + d.h / 2, d.w, 0.5, d.h, 0xd6d1c4, 0xc0bbb0);
        const gb = G(d.x + d.w / 2, d.y + d.h / 2);
        gb.facade('z+', d.y + d.h + 0.02, d.x, d.x + d.w, 4.78, 5.22, 0xc4302b); // the brand stripe
        gb.facade('x+', d.x + d.w + 0.02, d.y, d.y + d.h, 4.78, 5.22, 0xc4302b);
        lights.push({ pos: new Vector3(d.x + d.w / 2, 4.4, d.y + d.h / 2), color: 0xe8f0ff, kind: 'flood', broken: true });
        break;
      }
    }
  }
  for (let k = 0; k <= BLOCKS; k++) {
    const c = STREET / 2 + k * PITCH;
    for (let i = 0; i < BLOCKS; i++) {
      const a0 = STREET + i * PITCH;
      for (let d = a0 + 1.5; d < a0 + BLOCK - 1.5; d += 3.5) {
        S(d, c).floor(d, c - 0.1, d + 1.8, c + 0.1, 0.01, 0x6b6247);
        S(c, d).floor(c - 0.1, d, c + 0.1, d + 1.8, 0.01, 0x6b6247);
      }
      if (chance(rng, 0.45)) for (let s = 0; s < 8; s++) S(a0, c).floor(a0 + 0.3, c - 3.9 + s * 1.05, a0 + 2.1, c - 3.4 + s * 1.05, 0.012, 0x55575c);
    }
  }
  const stains = int(rng, 40, 60);
  for (let k = 0; k < stains; k++) {
    const p = pick(rng, map.points);
    const blood = chance(rng, 0.6);
    const x = p.x + range(rng, -3.5, 3.5), z = p.y + range(rng, -3.5, 3.5);
    S(x, z).disc(x, z, range(rng, 0.5, 1.8), 0.015, blood ? 0x3a0d0d : 0x15161a, 11, 0.5, int(rng, 1, 1e6));
  }

  // --- obstacles
  for (const b of map.buildings) {
    const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
    const s = S(cx, cz), g = G(cx, cz);
    switch (b.kind) {
      case 'water': {
        s.floor(b.x, b.y, b.x + b.w, b.y + b.h, -0.6, 0x0a1a24);
        // the quay edge
        s.box(cx, -0.2, b.y - 0.15, b.w, 0.7, 0.3, 0x3a3c40);
        break;
      }
      case 'tower': case 'building': tower(b, 0.2, 0.12); break;
      case 'shop': {
        tower(b, 0.08, 0.3);
        // awning and a lit window on the street side
        const awn = pick(rng, [0x7a2a24, 0x245a6a, 0x6a5a24, 0x3a3a44]);
        s.box(cx, 2.9, b.y + b.h + 0.6, b.w * 0.8, 0.15, 1.2, awn);
        if (chance(rng, 0.5)) g.facade('z+', b.y + b.h + 0.03, b.x + 1, b.x + b.w - 1, 0.6, 2.3, 0xd8c08a);
        break;
      }
      case 'house': house(b); break;
      case 'warehouse': {
        const base = new Color().setHSL(0.55 + b.tone * 0.1, 0.06, 0.2 + b.tone * 0.08);
        s.box(cx, b.height / 2, cz, b.w, b.height, b.h, base.getHex(), base.clone().offsetHSL(0, 0, -0.05).getHex());
        for (let x = b.x + 0.8; x < b.x + b.w - 0.5; x += 1.2) {
          s.facade('z+', b.y + b.h + 0.02, x, x + 0.12, 0.2, b.height - 0.2, 0x1a1c1f);
          s.facade('z-', b.y - 0.02, x, x + 0.12, 0.2, b.height - 0.2, 0x1a1c1f);
        }
        s.facade('z+', b.y + b.h + 0.03, cx - 2.5, cx + 2.5, 0.15, 4.2, 0x5a5048); // roller door
        if (chance(rng, 0.5)) g.facade('z+', b.y + b.h + 0.04, cx - 0.4, cx + 0.4, 4.6, 4.9, 0xffe6a0);
        break;
      }
      case 'container': {
        const col = CONTAINER_COLORS[Math.floor(b.tone * CONTAINER_COLORS.length)]!;
        const dark = new Color(col).multiplyScalar(0.55).getHex();
        const tiers = b.height > 3 ? 2 : 1;
        for (let t = 0; t < tiers; t++) {
          const c2 = t === 0 ? col : CONTAINER_COLORS[(Math.floor(b.tone * 7) + 2) % CONTAINER_COLORS.length]!;
          s.box(cx, t * 2.7 + 1.35, cz, b.w, 2.6, b.h, c2, new Color(c2).multiplyScalar(0.8).getHex());
        }
        for (let z = b.y + 0.6; z < b.y + b.h - 0.3; z += 0.9) s.facade('x+', b.x + b.w + 0.02, z, z + 0.15, 0.1, b.height - 0.1, dark);
        break;
      }
      case 'car': car(b, false); break;
      case 'wreck': car(b, true); break;
      case 'dumpster':
        s.box(cx, 0.95, cz, b.w, 1.6, b.h, 0x23402c, 0x1d3324);
        s.box(cx, 1.85, cz, b.w + 0.1, 0.12, b.h + 0.1, 0x1a2a1f);
        break;
      case 'barrel': {
        const fire = b.tone > 0.5;
        s.prism(cx, 0.65, cz, 0.45, 1.3, 8, fire ? 0x3a2a1e : 0x6e3b1e, 0x1a1410);
        if (fire) {
          g.prism(cx, 1.45, cz, 0.32, 0.5, 6, 0xff7a1a, 0xffb347);
          g.prism(cx + 0.05, 1.8, cz - 0.05, 0.16, 0.45, 5, 0xffc04d, 0xffe08a);
          lights.push({ pos: new Vector3(cx, 2.2, cz), color: 0xff7a2a, kind: 'fire', broken: true });
        }
        break;
      }
      case 'barricade': {
        const along = b.w > b.h;
        const len = along ? b.w : b.h;
        for (const t of [-0.4, 0.4]) s.box(along ? cx + t * len : cx, 0.55, along ? cz : cz + t * len, 0.15, 1.1, 0.15, 0x3b3b3b);
        for (let k = 0; k < 6; k++) {
          const o = -len / 2 + (k + 0.5) * (len / 6);
          s.box(along ? cx + o : cx, 1.15, along ? cz : cz + o, along ? len / 6 : 0.12, 0.35, along ? 0.12 : len / 6, k % 2 === 0 ? 0xb8402e : 0xd8d3c8);
        }
        break;
      }
      case 'tree': {
        s.prism(cx, 1.4, cz, 0.22, 2.8, 6, 0x3a2a1c);
        s.prism(cx, 3.6, cz, 1.9, 2.4, 8, 0x1c3320, 0x22402a);
        s.prism(cx, 5.3, cz, 1.25, 1.6, 8, 0x1f3a24, 0x274a2e);
        break;
      }
      case 'deadtree': {
        s.prism(cx, 2.4, cz, 0.2, 4.8, 5, 0x2a241e);
        s.box(cx + 0.6, 3.4, cz, 1.2, 0.12, 0.12, 0x2a241e);
        s.box(cx - 0.4, 4.1, cz + 0.2, 0.9, 0.12, 0.12, 0x2a241e);
        s.box(cx, 2.8, cz - 0.5, 0.12, 0.12, 1, 0x2a241e);
        break;
      }
      case 'fence': s.box(cx, b.height / 2, cz, b.w, b.height, b.h, 0x5d6066, 0x6a6d73); break;
      case 'pump': {
        s.box(cx, 0.15, cz, b.w + 0.6, 0.3, b.h + 0.6, 0x55575c);
        s.box(cx, 1.1, cz, b.w * 0.7, 1.7, b.h * 0.5, 0xd8d3c8, 0xc4302b);
        g.facade('x+', cx + b.w * 0.35 + 0.02, cz - 0.3, cz + 0.3, 1.3, 1.6, 0x9fd0ff);
        break;
      }
      case 'bench':
        s.box(cx, 0.5, cz, b.w, 0.12, b.h, 0x4a3524);
        s.box(cx, 0.25, cz, b.w * 0.9, 0.5, 0.1, 0x2a2a2a);
        break;
      case 'lamp': lamp(b); break;
    }
  }

  function tower(b: Building, satBoost: number, lit: number): void {
    const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
    const s = S(cx, cz), g = G(cx, cz);
    const base = new Color().setHSL(0.06 + b.tone * 0.5, 0.05 + satBoost * b.tone, 0.18 + b.tone * 0.12);
    s.box(cx, b.height / 2, cz, b.w, b.height, b.h, base.getHex(), base.clone().offsetHSL(0, -0.03, -0.06).getHex());
    const shutter = pick(rng, [0x5b2f22, 0x2f4f5b, 0x5b5b2f, 0x3d3d44]);
    const faces: Array<['x+' | 'x-' | 'z+' | 'z-', number, number, number]> = [
      ['z+', b.y + b.h + 0.02, b.x, b.x + b.w], ['z-', b.y - 0.02, b.x, b.x + b.w],
      ['x+', b.x + b.w + 0.02, b.y, b.y + b.h], ['x-', b.x - 0.02, b.y, b.y + b.h],
    ];
    const floors = Math.floor((b.height - 0.6) / 3);
    for (const [face, plane, a0, a1] of faces) {
      const span = a1 - a0;
      if (chance(rng, 0.6)) s.facade(face, plane, a0 + 0.6, a1 - 0.6, 0.15, 2.4, shutter);
      const cols = Math.max(1, Math.floor(span / 2.6));
      const step = span / cols;
      for (let f = 1; f <= floors; f++) {
        const y0 = f * 3 - 0.4;
        for (let c = 0; c < cols; c++) {
          const w0 = a0 + c * step + step * 0.25, w1 = w0 + step * 0.5;
          if (chance(rng, lit * 0.6)) g.facade(face, plane + (face[1] === '+' ? 0.01 : -0.01), w0, w1, y0, y0 + 1.5, pick(rng, [0xffd27a, 0xffc36a, 0xc9d9ff]));
          else s.facade(face, plane, w0, w1, y0, y0 + 1.5, chance(rng, 0.15) ? 0x070809 : 0x14171c);
        }
      }
    }
    if (b.height > 6 && chance(rng, 0.7)) s.prism(b.x + range(rng, 1.2, b.w - 1.2), b.height + 0.8, b.y + range(rng, 1.2, b.h - 1.2), 0.8, 1.6, 8, 0x111214, 0x18191c);
    if (chance(rng, 0.6)) s.box(b.x + range(rng, 1, b.w - 1), b.height + 0.4, b.y + range(rng, 1, b.h - 1), 1.2, 0.8, 0.9, 0x6d7075);
    if (b.height > 16 && chance(rng, 0.5)) g.box(cx, b.height + 2.2, cz, 0.25, 0.25, 0.25, 0xff2a2a); // aircraft warning light
    if (b.height > 16) s.box(cx, b.height + 1.1, cz, 0.12, 2.2, 0.12, 0x2a2a2a);
  }

  function house(b: Building): void {
    const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
    const s = S(cx, cz), g = G(cx, cz);
    const wall = new Color().setHSL(0.05 + b.tone * 0.12, 0.18, 0.32 + b.tone * 0.14);
    s.box(cx, b.height / 2, cz, b.w, b.height, b.h, wall.getHex());
    const roof = pick(rng, [0x3a2420, 0x2a2d33, 0x3d3226, 0x24302a]);
    s.gable(cx, cz, b.w + 0.6, b.h + 0.6, b.height, 2.2, b.w > b.h, roof, wall.clone().offsetHSL(0, 0, -0.05).getHex());
    // a door and two windows on the street side, maybe one lit
    s.facade('z+', b.y + b.h + 0.02, cx - 0.5, cx + 0.5, 0.15, 2.1, 0x2a1d14);
    for (const ox of [-b.w * 0.3, b.w * 0.3]) {
      if (chance(rng, 0.2)) g.facade('z+', b.y + b.h + 0.03, cx + ox - 0.55, cx + ox + 0.55, 1.2, 2.2, 0xffcf7a);
      else s.facade('z+', b.y + b.h + 0.02, cx + ox - 0.55, cx + ox + 0.55, 1.2, 2.2, 0x14171c);
    }
    s.facade('x+', b.x + b.w + 0.02, cz - 0.6, cz + 0.6, 1.2, 2.2, 0x14171c);
  }

  function car(b: Building, wreck: boolean): void {
    const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
    const s = S(cx, cz), g = G(cx, cz);
    const alongZ = b.h > b.w;
    const L = alongZ ? b.h : b.w, W = alongZ ? b.w : b.h;
    const body = wreck ? 0x2a221e : CAR_COLORS[Math.floor(b.tone * CAR_COLORS.length)]!;
    const bx = (l: number, w: number) => (alongZ ? [w, l] : [l, w]) as [number, number];
    const [w1, d1] = bx(L, W);
    s.box(cx, 0.75, cz, w1, 0.9, d1, body, wreck ? 0x1d1816 : new Color(body).offsetHSL(0, 0, 0.05).getHex());
    const [w2, d2] = bx(L * 0.5, W * 0.88);
    s.box(cx, 1.5, cz, w2, 0.6, d2, wreck ? 0x0e0c0b : 0x0f1418, wreck ? 0x15110f : body);
    if (!wreck) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const [ox, oz] = alongZ ? [sx * W * 0.42, sz * L * 0.3] : [sx * L * 0.3, sz * W * 0.42];
        s.box(cx + ox, 0.35, cz + oz, alongZ ? 0.3 : 0.7, 0.7, alongZ ? 0.7 : 0.3, 0x0b0b0c);
      }
    } else if (chance(rng, 0.4)) {
      g.prism(cx, 1.6, cz, 0.3, 0.6, 5, 0xff6a1a, 0xffa040); // still smouldering
      lights.push({ pos: new Vector3(cx, 2.2, cz), color: 0xff6020, kind: 'fire', broken: true });
    }
  }

  function lamp(b: Building): void {
    const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
    const s = S(cx, cz), g = G(cx, cz);
    const i = Math.floor((cx - STREET) / PITCH), j = Math.floor((cz - STREET) / PITCH);
    const bcx = STREET + i * PITCH + BLOCK / 2, bcz = STREET + j * PITCH + BLOCK / 2;
    const dx = Math.sign(cx - bcx) || 1, dz = Math.sign(cz - bcz) || 1;
    s.box(cx, b.height / 2, cz, 0.22, b.height, 0.22, 0x3a3d42);
    const ax = cx + dx * 1.2, az = cz + dz * 1.2;
    s.box((cx + ax) / 2, b.height - 0.1, (cz + az) / 2, Math.abs(ax - cx) + 0.15, 0.12, Math.abs(az - cz) + 0.15, 0x3a3d42);
    const broken = next(rng) < 0.3;
    const dead = next(rng) < 0.2;
    g.box(ax, b.height - 0.3, az, 0.45, 0.2, 0.45, dead ? 0x2a2a2a : 0xffe2a8);
    if (!dead) lights.push({ pos: new Vector3(ax, b.height - 0.5, az), color: 0xffcf8a, kind: 'lamp', broken });
  }

  const solidMat = new MeshLambertMaterial({
    vertexColors: true,
    // mark pixels for the player's x-ray silhouette (drawn only where the city hides them)
    stencilWrite: true, stencilRef: 1, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp,
  });
  const glowMat = new MeshBasicMaterial({ vertexColors: true });
  const group = new Group();
  let triangles = 0;
  for (let k = 0; k < n * n; k++) {
    if (solids[k]!.triangles > 0) { group.add(new Mesh(solids[k]!.build(), solidMat)); triangles += solids[k]!.triangles; }
    if (glows[k]!.triangles > 0) { group.add(new Mesh(glows[k]!.build(), glowMat)); triangles += glows[k]!.triangles; }
  }

  // light pools on the ground under every light (cheap fake lighting for lights without a real light)
  const pools = new InstancedMesh(
    new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ map: poolTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.5 }),
    Math.max(1, lights.length),
  );
  const o = new Object3D();
  const c = new Color();
  lights.forEach((l, k) => {
    const r = l.kind === 'fire' ? 6 : l.kind === 'flood' ? 16 : 9;
    o.position.set(l.pos.x, 0.2, l.pos.z);
    o.scale.set(r, 1, r);
    o.updateMatrix();
    pools.setMatrixAt(k, o.matrix);
    pools.setColorAt(k, c.setHex(l.color).multiplyScalar(l.kind === 'fire' ? 0.5 : 0.35));
  });
  pools.count = lights.length;
  pools.frustumCulled = false;
  pools.renderOrder = 1;

  return { group, pools, lights, triangles };
}
