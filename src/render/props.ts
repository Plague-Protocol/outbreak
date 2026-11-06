import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, ConeGeometry, DoubleSide, Group, InstancedMesh, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry, PointLight, Scene, Vector3,
} from 'three';
import { MeshBuilder } from './mesh';
import { VEHICLES } from '../core/config';
import type { PickupKind, Vehicle, VehicleKind, WeaponKind } from '../core/types';

const PAINT = [0xd9d4c7, 0x9aa1a8, 0x7a1f1f, 0x1f3a5c, 0x1b1d20, 0x2f4a33, 0xc9a227, 0x5a2a5a];

/** A drivable vehicle, built along +x (nose) and centred on its footprint. */
export function vehicleMesh(v: Vehicle): Group {
  const spec = VEHICLES[v.kind];
  const L = spec.length, W = spec.width;
  const paint = PAINT[Math.floor(v.tone * PAINT.length)]!;
  const roof = new Color(paint).offsetHSL(0, 0, 0.06).getHex();
  const glass = 0x0e1318;
  const b = new MeshBuilder();
  const g = new MeshBuilder();
  const shape: Record<VehicleKind, () => void> = {
    sedan: () => {
      b.box(0, 0.75, 0, L, 0.9, W, paint, roof);
      b.box(-L * 0.05, 1.5, 0, L * 0.48, 0.62, W * 0.88, glass, paint);
    },
    pickup: () => {
      b.box(0, 0.8, 0, L, 1.0, W, paint, roof);
      b.box(L * 0.12, 1.65, 0, L * 0.34, 0.75, W * 0.9, glass, paint);
      b.box(-L * 0.3, 1.35, W * 0.45, L * 0.38, 0.35, 0.1, paint); // bed sides
      b.box(-L * 0.3, 1.35, -W * 0.45, L * 0.38, 0.35, 0.1, paint);
    },
    van: () => {
      b.box(0, 1.35, 0, L, 2.1, W, paint, roof);
      b.facade('x+', L / 2 + 0.02, -W * 0.42, W * 0.42, 1.5, 2.2, glass);
      b.facade('z+', W / 2 + 0.02, L * 0.15, L * 0.42, 1.6, 2.2, glass);
      b.facade('z-', -W / 2 - 0.02, L * 0.15, L * 0.42, 1.6, 2.2, glass);
    },
  };
  shape[v.kind]();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * L * 0.32, 0.38, sz * W * 0.46, 0.8, 0.76, 0.28, 0x0b0b0c);
  g.facade('x+', L / 2 + 0.03, -W * 0.42, -W * 0.22, 0.7, 0.95, 0xfff3d0); // headlights
  g.facade('x+', L / 2 + 0.03, W * 0.22, W * 0.42, 0.7, 0.95, 0xfff3d0);
  g.facade('x-', -L / 2 - 0.03, -W * 0.42, -W * 0.25, 0.75, 0.95, 0xb01818); // tail lights
  g.facade('x-', -L / 2 - 0.03, W * 0.25, W * 0.42, 0.75, 0.95, 0xb01818);
  const group = new Group();
  const body = new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true }));
  body.name = 'body';
  const lights = new Mesh(g.build(), new MeshBasicMaterial({ vertexColors: true }));
  lights.name = 'lights';
  group.add(body, lights);
  return group;
}

export function wreckVehicle(group: Group): void {
  const body = group.getObjectByName('body') as Mesh;
  (body.material as MeshLambertMaterial).color.setHex(0x2a2522);
  group.getObjectByName('lights')!.visible = false;
}

/** Guns, built along +x, in world units. */
export function gunMesh(kind: WeaponKind | 'ammo'): Mesh {
  const b = new MeshBuilder();
  const metal = 0x22252a, wood = 0x4a3020;
  switch (kind) {
    case 'pistol': b.box(0.12, 0, 0, 0.34, 0.1, 0.06, metal).box(-0.02, -0.11, 0, 0.09, 0.2, 0.06, metal); break;
    case 'shotgun': b.box(0.35, 0, 0, 0.9, 0.08, 0.07, metal).box(0.3, -0.07, 0, 0.45, 0.07, 0.08, wood).box(-0.22, -0.05, 0, 0.35, 0.12, 0.07, wood); break;
    case 'rifle': b.box(0.25, 0, 0, 0.75, 0.11, 0.07, metal).box(0.14, -0.14, 0, 0.1, 0.22, 0.06, metal).box(-0.25, -0.04, 0, 0.3, 0.13, 0.06, metal).box(0.68, 0.02, 0, 0.25, 0.04, 0.04, metal); break;
    case 'ammo': b.box(0, 0.2, 0, 0.7, 0.4, 0.45, 0x3f4a2a, 0x4c5933).box(0, 0.41, 0, 0.3, 0.02, 0.2, 0xc9b35a); break;
  }
  return new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true }));
}

/** Pickups lying in the street: a slowly turning gun or ammo box on a glowing ring. */
export function pickupMesh(kind: PickupKind): Group {
  const g = new Group();
  const m = gunMesh(kind);
  if (kind !== 'ammo') m.scale.setScalar(1.6);
  m.position.y = kind === 'ammo' ? 0 : 0.7;
  m.name = 'item';
  const ring = new Mesh(
    new PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ map: ringTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, color: kind === 'ammo' ? 0x7fd38a : 0xf2b630 }),
  );
  ring.position.y = 0.2;
  g.add(m, ring);
  return g;
}

let ringTex: CanvasTexture | null = null;
function ringTexture(): CanvasTexture {
  if (ringTex) return ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const grd = x.createRadialGradient(32, 32, 14, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = grd;
  x.fillRect(0, 0, 64, 64);
  return (ringTex = new CanvasTexture(c));
}

function textTexture(text: string, color: string, w = 256, h = 96, font = 'bold 64px system-ui, sans-serif', glow = true): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  x.font = font;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  if (glow) { x.shadowColor = color; x.shadowBlur = 18; }
  x.fillStyle = color;
  x.fillText(text, w / 2, h / 2);
  return new CanvasTexture(c);
}

/** The gun store: a counter, a back wall, and a neon sign on a pole. */
export function storeMesh(): Group {
  const g = new Group();
  const b = new MeshBuilder()
    .box(0, 0.55, 0, 2.4, 1.1, 0.8, 0x2c2622, 0x3a322b)
    .box(0, 1.6, -0.9, 3, 3.2, 0.2, 0x1e1b19)
    .box(-1.6, 2.6, -0.6, 0.15, 5.2, 0.15, 0x333333)
    .box(-0.6, 1.25, 0.1, 0.5, 0.15, 0.25, 0x22252a)
    .box(0.5, 1.22, 0.1, 0.7, 0.1, 0.2, 0x22252a);
  g.add(new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true })));
  const sign = new Mesh(new PlaneGeometry(3.2, 1.2), new MeshBasicMaterial({ map: textTexture('GUNS', '#ff3b3b'), transparent: true, side: DoubleSide }));
  sign.position.set(-1.6, 5.3, -0.45);
  g.add(sign);
  return g;
}

/** The evac point: a helipad ringed with sandbags and floodlights, and the helicopter overhead. */
export class Evac {
  readonly group = new Group();
  private heli = new Group();
  private rotor: Mesh;
  private tail: Mesh;
  private beam: Mesh;
  private lift = 0;

  constructor() {
    const pad = new MeshBuilder().prism(0, 0.08, 0, 4.2, 0.16, 16, 0x3a3c40, 0x4a4c50);
    for (let k = 0; k < 10; k++) {
      if (k === 2 || k === 7) continue; // ways in
      const a = (k / 10) * Math.PI * 2;
      pad.box(Math.cos(a) * 5.4, 0.4, Math.sin(a) * 5.4, 1.6, 0.8, 0.7, 0x5b5340, 0x6a6150);
    }
    for (const [x, z] of [[-5.8, -5.8], [5.8, 5.8]]) pad.box(x!, 3, z!, 0.25, 6, 0.25, 0x2c2e31);
    this.group.add(new Mesh(pad.build(), new MeshLambertMaterial({ vertexColors: true })));
    const h = new Mesh(new PlaneGeometry(4.4, 4.4).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: textTexture('H', '#e8e2d0', 128, 128, 'bold 110px system-ui, sans-serif', false), transparent: true }));
    h.position.y = 0.18;
    this.group.add(h);
    const lamps = new MeshBuilder();
    for (const [x, z] of [[-5.8, -5.8], [5.8, 5.8]]) lamps.box(x!, 6.1, z!, 0.7, 0.45, 0.7, 0xf4f7ff);
    this.group.add(new Mesh(lamps.build(), new MeshBasicMaterial({ vertexColors: true })));

    // the helicopter, built along +x
    const body = new MeshBuilder()
      .box(0, 1.1, 0, 5.2, 2.0, 2.2, 0x3b4636, 0x46523f)
      .box(1.9, 1.0, 0, 1.6, 1.4, 1.9, 0x0e1318, 0x3b4636)
      .box(-4.2, 1.5, 0, 4, 0.5, 0.5, 0x3b4636)
      .box(-6.1, 2.1, 0, 0.6, 1.4, 0.2, 0x3b4636)
      .box(0, 0, 0.9, 4, 0.12, 0.15, 0x1a1a1a)
      .box(0, 0, -0.9, 4, 0.12, 0.15, 0x1a1a1a)
      .box(0, 2.3, 0, 0.5, 0.5, 0.5, 0x222222);
    this.heli.add(new Mesh(body.build(), new MeshLambertMaterial({ vertexColors: true })));
    this.rotor = new Mesh(new BoxGeometry(11, 0.06, 0.4), new MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55 }));
    this.rotor.position.y = 2.6;
    const rotor2 = this.rotor.clone();
    rotor2.rotation.y = Math.PI / 2;
    this.rotor.add(rotor2);
    rotor2.position.set(0, 0, 0);
    this.tail = new Mesh(new BoxGeometry(0.1, 1.6, 0.2), new MeshBasicMaterial({ color: 0x111111 }));
    this.tail.position.set(-6.1, 2.1, 0.2);
    const blink = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial({ color: 0xff2a2a }));
    blink.position.set(-6.1, 2.9, 0);
    blink.name = 'blink';
    // searchlight: an additive cone down onto the pad
    this.beam = new Mesh(
      new ConeGeometry(4.5, 12, 20, 1, true).translate(0, -6, 0),
      new MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.08, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    );
    this.beam.position.set(1.5, 0.4, 0);
    this.heli.add(this.rotor, this.tail, blink, this.beam);
    this.heli.position.set(0, 13, 0);
    this.heli.rotation.y = 0.6;
    this.group.add(this.heli);
  }

  update(dt: number, time: number, leaving: boolean): void {
    this.rotor.rotation.y += dt * 22;
    this.tail.rotation.x += dt * 30;
    if (leaving) this.lift += dt;
    this.heli.position.y = 13 + Math.sin(time * 1.3) * 0.3 + this.lift * this.lift * 2.5;
    this.heli.position.x = this.lift * this.lift * 3;
    this.heli.rotation.z = -Math.min(0.25, this.lift * 0.08);
    (this.heli.getObjectByName('blink') as Mesh).visible = Math.sin(time * 6) > 0.4;
    this.beam.visible = !leaving;
  }

  reset(): void {
    this.lift = 0;
  }
}

/** Short-lived combat effects from pools: tracers, muzzle flashes, blood and sparks. */
export class Effects {
  private tracers: InstancedMesh;
  private tracerLife: number[] = [];
  private flash: PointLight;
  private flashLife = 0;
  private particles: InstancedMesh;
  private parts: Array<{ p: Vector3; v: Vector3; life: number; color: number }> = [];
  private tmp = new Object3D();
  private nextTracer = 0;
  private col = new Color();

  constructor(scene: Scene) {
    this.tracers = new InstancedMesh(
      new BoxGeometry(1, 0.05, 0.05).translate(0.5, 0, 0),
      new MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false }),
      12,
    );
    this.tracers.frustumCulled = false;
    this.tracers.count = 12;
    for (let i = 0; i < 12; i++) { this.tracerLife.push(0); this.hide(this.tracers, i); }
    this.particles = new InstancedMesh(new BoxGeometry(0.14, 0.14, 0.14), new MeshBasicMaterial(), 48);
    this.particles.frustumCulled = false;
    this.particles.count = 0;
    this.flash = new PointLight(0xffc870, 0, 10, 1.5);
    scene.add(this.tracers, this.particles, this.flash);
  }

  private hide(m: InstancedMesh, i: number): void {
    this.tmp.scale.set(0, 0, 0);
    this.tmp.updateMatrix();
    m.setMatrixAt(i, this.tmp.matrix);
  }

  shot(from: Vector3, to: Vector3): void {
    const i = this.nextTracer++ % 12;
    const d = to.clone().sub(from);
    this.tmp.position.copy(from);
    this.tmp.scale.set(d.length(), 1, 1);
    this.tmp.rotation.set(0, Math.atan2(-d.z, d.x), Math.atan2(d.y, Math.hypot(d.x, d.z)));
    this.tmp.updateMatrix();
    this.tracers.setMatrixAt(i, this.tmp.matrix);
    this.tracers.instanceMatrix.needsUpdate = true;
    this.tracerLife[i] = 0.06;
    this.flash.position.copy(from);
    this.flash.intensity = 30;
    this.flashLife = 0.05;
  }

  burst(at: Vector3, color: number, count: number, speed: number): void {
    for (let k = 0; k < count; k++) {
      if (this.parts.length >= 48) this.parts.shift();
      this.parts.push({
        p: at.clone(),
        v: new Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed),
        life: 0.35 + Math.random() * 0.3,
        color,
      });
    }
  }

  update(dt: number): void {
    for (let i = 0; i < 12; i++) {
      if (this.tracerLife[i]! <= 0) continue;
      this.tracerLife[i]! -= dt;
      if (this.tracerLife[i]! <= 0) { this.hide(this.tracers, i); this.tracers.instanceMatrix.needsUpdate = true; }
    }
    if (this.flashLife > 0) { this.flashLife -= dt; if (this.flashLife <= 0) this.flash.intensity = 0; }
    this.parts = this.parts.filter((q) => (q.life -= dt) > 0);
    this.parts.forEach((q, i) => {
      q.v.y -= 14 * dt;
      q.p.addScaledVector(q.v, dt);
      if (q.p.y < 0.05) { q.p.y = 0.05; q.v.set(0, 0, 0); }
      this.tmp.position.copy(q.p);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.scale.setScalar(Math.min(1, q.life * 3));
      this.tmp.updateMatrix();
      this.particles.setMatrixAt(i, this.tmp.matrix);
      this.particles.setColorAt(i, this.col.setHex(q.color));
    });
    this.particles.count = this.parts.length;
    this.particles.instanceMatrix.needsUpdate = true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }
}
