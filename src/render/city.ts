import {
  AdditiveBlending, AlwaysStencilFunc, CanvasTexture, Color, InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  Object3D, PlaneGeometry, ReplaceStencilOp, Vector3,
} from 'three';
import { MeshBuilder } from './mesh';
import { BLOCKS, PITCH, STREET } from '../core/map';
import { createRng, chance, int, next, pick, range } from '../core/rng';
import type { Building, MapData } from '../core/types';

export interface LightSource {
  pos: Vector3;
  color: number;
  kind: 'lamp' | 'fire';
  broken: boolean; // flickers
}

export interface CityMeshes {
  solid: Mesh; // lit, writes stencil for the x-ray pass
  glow: Mesh; // unlit: lit windows, bulbs, flames
  pools: InstancedMesh; // additive light pools on the ground
  lights: LightSource[];
  triangles: number;
}

const BLOCK = PITCH - STREET;
const CAR_COLORS = [0xd9d4c7, 0x9aa1a8, 0x7a1f1f, 0x1f3a5c, 0x1b1d20, 0x2f4a33];
const DANFO = 0xe2b21c;

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
  const solid = new MeshBuilder();
  const glow = new MeshBuilder();
  const lights: LightSource[] = [];

  // --- ground: asphalt, raised sidewalks per block, lane dashes, crossings, stains
  solid.floor(-200, -200, map.size + 200, map.size + 200, -0.02, 0x0c0d10); // wasteland beyond the district
  solid.floor(0, 0, map.size, map.size, 0, 0x1c1f24);
  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      const bx = STREET + i * PITCH, by = STREET + j * PITCH;
      solid.box(bx + BLOCK / 2, 0.075, by + BLOCK / 2, BLOCK, 0.15, BLOCK, 0x2b2d31, 0x34363b);
    }
  }
  for (let k = 0; k <= BLOCKS; k++) {
    const c = STREET / 2 + k * PITCH;
    for (let i = 0; i < BLOCKS; i++) {
      const a0 = STREET + i * PITCH;
      for (let d = a0 + 1.2; d < a0 + BLOCK - 1.2; d += 3) {
        solid.floor(d, c - 0.08, d + 1.4, c + 0.08, 0.01, 0x6b6247); // faded dashes along x
        solid.floor(c - 0.08, d, c + 0.08, d + 1.4, 0.01, 0x6b6247); // and along z
      }
      // zebra crossing on one approach of each intersection
      if (chance(rng, 0.5)) {
        for (let s = 0; s < 6; s++) solid.floor(a0 - 0.2 + 0, c - 2.6 + s * 0.95, a0 + 1.2, c - 2.2 + s * 0.95, 0.012, 0x55575c);
      }
    }
  }
  // blood and oil stains on the streets
  const stains = int(rng, 14, 22);
  for (let k = 0; k < stains; k++) {
    const p = pick(rng, map.points);
    const blood = chance(rng, 0.6);
    solid.disc(p.x + range(rng, -2.5, 2.5), p.y + range(rng, -2.5, 2.5), range(rng, 0.5, 1.6), 0.015,
      blood ? 0x3a0d0d : 0x15161a, 11, 0.5, int(rng, 1, 1e6));
  }

  // --- obstacles
  for (const b of map.buildings) {
    const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
    switch (b.kind) {
      case 'building': building(b); break;
      case 'car': car(b, false); break;
      case 'wreck': car(b, true); break;
      case 'dumpster':
        solid.box(cx, 0.95, cz, b.w, 1.6, b.h, 0x23402c, 0x1d3324);
        solid.box(cx, 1.85, cz, b.w + 0.1, 0.12, b.h + 0.1, 0x1a2a1f);
        break;
      case 'barrel': {
        const fire = b.tone > 0.45;
        solid.prism(cx, 0.65, cz, 0.45, 1.3, 8, fire ? 0x3a2a1e : 0x6e3b1e, 0x1a1410);
        if (fire) {
          glow.prism(cx, 1.45, cz, 0.32, 0.5, 6, 0xff7a1a, 0xffb347);
          glow.prism(cx + 0.05, 1.8, cz - 0.05, 0.16, 0.45, 5, 0xffc04d, 0xffe08a);
          lights.push({ pos: new Vector3(cx, 2.2, cz), color: 0xff7a2a, kind: 'fire', broken: true });
        }
        break;
      }
      case 'barricade': {
        const along = b.w > b.h;
        const len = along ? b.w : b.h;
        for (const t of [-0.4, 0.4]) {
          const lx = along ? cx + t * len : cx, lz = along ? cz : cz + t * len;
          solid.box(lx, 0.55, lz, 0.15, 1.1, 0.15, 0x3b3b3b);
        }
        const n = 6;
        for (let s = 0; s < n; s++) {
          const o = -len / 2 + (s + 0.5) * (len / n);
          const color = s % 2 === 0 ? 0xb8402e : 0xd8d3c8;
          solid.box(along ? cx + o : cx, 1.15, along ? cz : cz + o, along ? len / n : 0.12, 0.35, along ? 0.12 : len / n, color);
        }
        break;
      }
      case 'lamp': lamp(b); break;
    }
  }

  function building(b: Building): void {
    const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
    const base = new Color().setHSL(0.06 + b.tone * 0.08, 0.1 + b.tone * 0.12, 0.2 + b.tone * 0.12);
    const roof = base.clone().offsetHSL(0, -0.05, -0.06);
    solid.box(cx, b.height / 2, cz, b.w, b.height, b.h, base.getHex(), roof.getHex());
    // ground-floor shop shutters on two faces, windows above
    const shutter = pick(rng, [0x5b2f22, 0x2f4f5b, 0x5b5b2f, 0x3d3d44]);
    const faces: Array<['x+' | 'x-' | 'z+' | 'z-', number, number, number]> = [
      ['z+', b.y + b.h + 0.02, b.x, b.x + b.w],
      ['z-', b.y - 0.02, b.x, b.x + b.w],
      ['x+', b.x + b.w + 0.02, b.y, b.y + b.h],
      ['x-', b.x - 0.02, b.y, b.y + b.h],
    ];
    const floors = Math.floor((b.height - 0.6) / 3);
    for (const [face, plane, a0, a1] of faces) {
      const span = a1 - a0;
      if (chance(rng, 0.6)) solid.facade(face, plane, a0 + 0.6, a1 - 0.6, 0.15, 2.4, shutter);
      const cols = Math.max(1, Math.floor(span / 2.6));
      const step = span / cols;
      for (let f = 1; f <= floors; f++) {
        const y0 = f * 3 - 0.4;
        for (let c = 0; c < cols; c++) {
          const w0 = a0 + c * step + step * 0.25, w1 = w0 + step * 0.5;
          if (chance(rng, 0.09)) glow.facade(face, plane + (face[1] === '+' ? 0.01 : -0.01), w0, w1, y0, y0 + 1.5, pick(rng, [0xffd27a, 0xffc36a, 0xc9d9ff]));
          else solid.facade(face, plane, w0, w1, y0, y0 + 1.5, chance(rng, 0.15) ? 0x070809 : 0x14171c);
        }
      }
    }
    // roof clutter: a black plastic water tank, an AC unit
    if (chance(rng, 0.7)) solid.prism(b.x + range(rng, 1.2, b.w - 1.2), b.height + 0.8, b.y + range(rng, 1.2, b.h - 1.2), 0.8, 1.6, 8, 0x111214, 0x18191c);
    if (chance(rng, 0.6)) solid.box(b.x + range(rng, 1, b.w - 1), b.height + 0.4, b.y + range(rng, 1, b.h - 1), 1.2, 0.8, 0.9, 0x6d7075);
  }

  function car(b: Building, wreck: boolean): void {
    const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
    const alongZ = b.h > b.w;
    const L = alongZ ? b.h : b.w, W = alongZ ? b.w : b.h;
    const danfo = !wreck && b.tone > 0.75;
    const body = wreck ? 0x2a221e : danfo ? DANFO : CAR_COLORS[Math.floor(b.tone * CAR_COLORS.length)]!;
    const bx = (l: number, w: number) => (alongZ ? [w, l] : [l, w]) as [number, number];
    const [w1, d1] = bx(L, W);
    solid.box(cx, 0.75, cz, w1, 0.9, d1, body, wreck ? 0x1d1816 : new Color(body).offsetHSL(0, 0, 0.05).getHex());
    if (danfo) {
      // a danfo is a tall minibus: one long cabin with black stripes
      const [w2, d2] = bx(L * 0.92, W * 0.96);
      solid.box(cx, 1.75, cz, w2, 1.1, d2, DANFO, 0xd8a915);
      const [w3, d3] = bx(L * 0.93, W * 0.97);
      solid.box(cx, 1.15, cz, w3, 0.14, d3, 0x111111);
      const [w4, d4] = bx(L * 0.8, W * 0.98);
      solid.box(cx, 1.85, cz, w4, 0.6, d4, 0x101418);
    } else {
      const off = (wreck ? 0 : 0.3) * (alongZ ? 1 : 1);
      const [w2, d2] = bx(L * 0.5, W * 0.88);
      solid.box(alongZ ? cx : cx - off, 1.5, alongZ ? cz - off : cz, w2, 0.6, d2, wreck ? 0x0e0c0b : 0x0f1418, wreck ? 0x15110f : body);
    }
    if (!wreck) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const [ox, oz] = alongZ ? [sx * W * 0.42, sz * L * 0.3] : [sx * L * 0.3, sz * W * 0.42];
        solid.box(cx + ox, 0.35, cz + oz, alongZ ? 0.3 : 0.7, 0.7, alongZ ? 0.7 : 0.3, 0x0b0b0c);
      }
    } else if (chance(rng, 0.5)) {
      glow.prism(cx, 1.6, cz, 0.3, 0.6, 5, 0xff6a1a, 0xffa040); // still smouldering
      lights.push({ pos: new Vector3(cx, 2.2, cz), color: 0xff6020, kind: 'fire', broken: true });
    }
  }

  function lamp(b: Building): void {
    const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
    // arm points out over the street (away from the block centre)
    const i = Math.floor((cx - STREET) / PITCH), j = Math.floor((cz - STREET) / PITCH);
    const bcx = STREET + i * PITCH + BLOCK / 2, bcz = STREET + j * PITCH + BLOCK / 2;
    const dx = Math.sign(cx - bcx) || 1, dz = Math.sign(cz - bcz) || 1;
    solid.box(cx, b.height / 2, cz, 0.22, b.height, 0.22, 0x3a3d42);
    const ax = cx + dx * 0.9, az = cz + dz * 0.9;
    solid.box((cx + ax) / 2, b.height - 0.1, (cz + az) / 2, Math.abs(ax - cx) + 0.15, 0.12, Math.abs(az - cz) + 0.15, 0x3a3d42);
    const broken = next(rng) < 0.3;
    const dead = next(rng) < 0.15;
    glow.box(ax, b.height - 0.3, az, 0.45, 0.2, 0.45, dead ? 0x2a2a2a : 0xffe2a8);
    if (!dead) lights.push({ pos: new Vector3(ax, b.height - 0.5, az), color: 0xffcf8a, kind: 'lamp', broken });
  }

  const solidMesh = new Mesh(solid.build(), new MeshLambertMaterial({
    vertexColors: true,
    // mark pixels for the player's x-ray silhouette (drawn only where the city hides them)
    stencilWrite: true, stencilRef: 1, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp,
  }));
  const glowMesh = new Mesh(glow.build(), new MeshBasicMaterial({ vertexColors: true }));

  // light pools on the ground under every light (cheap fake lighting for lights without a real light)
  const pools = new InstancedMesh(
    new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ map: poolTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.5 }),
    Math.max(1, lights.length),
  );
  const o = new Object3D();
  const c = new Color();
  lights.forEach((l, k) => {
    const r = l.kind === 'lamp' ? 9 : 6;
    o.position.set(l.pos.x, 0.03, l.pos.z);
    o.scale.set(r, 1, r);
    o.updateMatrix();
    pools.setMatrixAt(k, o.matrix);
    pools.setColorAt(k, c.setHex(l.color).multiplyScalar(l.kind === 'lamp' ? 0.35 : 0.5));
  });
  pools.count = lights.length;
  pools.frustumCulled = false;
  pools.renderOrder = 1;

  return { solid: solidMesh, glow: glowMesh, pools, lights, triangles: solid.triangles + glow.triangles };
}
