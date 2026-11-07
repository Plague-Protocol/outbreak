import {
  AdditiveBlending, BoxGeometry, type Material, CanvasTexture, Color, ConeGeometry, DoubleSide, Group, InstancedMesh, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry, PointLight, Scene, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace,
  Vector3,
} from 'three';
import { MeshBuilder } from './mesh';
import { weather } from './weather';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VEHICLES } from '../core/config';
import type { GearKind, GunKind, MeleeKind, PickupKind, Store, Vehicle, VehicleKind, WeaponKind } from '../core/types';

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
  const body = new Mesh(b.build(), weather(new MeshLambertMaterial({ vertexColors: true })));
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

// Gun colours: lit gunmetal (pure black vanishes at night), polymer, and wood furniture.
const STEEL = 0x4a4f57, STEEL_TOP = 0x6a7079, POLY = 0x2c2d30, WOOD = 0x7a4a26, WOOD_TOP = 0x8f5a2f;

/**
 * Guns in world units (about 1.3x real size so they read from the street camera), built with the
 * barrel along +x, the top along +y, and the middle of the grip at the origin so the hand holds it.
 * `userData.muzzle` is the muzzle point in the same space.
 */
export function gunMesh(kind: GunKind): Mesh {
  const b = new MeshBuilder();
  let muzzle: Vector3;
  let m: number;
  switch (kind) {
    case 'pistol':
      b.box(0.12, 0.13, 0, 0.36, 0.085, 0.055, STEEL, STEEL_TOP); // slide
      b.box(0.1, 0.075, 0, 0.3, 0.05, 0.05, POLY); // frame
      b.box(0.29, 0.13, 0, 0.02, 0.03, 0.03, 0x111111); // muzzle
      b.box(0.08, 0.025, 0, 0.09, 0.02, 0.04, POLY); // trigger guard
      m = b.mark();
      b.box(0, 0, 0, 0.085, 0.19, 0.06, POLY); // grip, raked back
      b.tiltZ(m, 0.28, 0, 0.06);
      muzzle = new Vector3(0.31, 0.13, 0);
      break;
    case 'shotgun':
      b.box(0.08, 0.1, 0, 0.36, 0.13, 0.075, STEEL, STEEL_TOP); // receiver
      b.box(0.68, 0.14, 0, 0.84, 0.055, 0.055, STEEL, STEEL_TOP); // barrel
      b.box(0.55, 0.075, 0, 0.6, 0.05, 0.05, STEEL); // magazine tube
      b.box(0.6, 0.075, 0, 0.32, 0.085, 0.085, WOOD, WOOD_TOP); // pump
      m = b.mark();
      b.box(-0.38, 0.03, 0, 0.62, 0.14, 0.07, WOOD, WOOD_TOP); // stock
      b.tiltZ(m, -0.12, -0.08, 0.06);
      m = b.mark();
      b.box(-0.02, 0, 0, 0.08, 0.16, 0.065, WOOD); // wrist
      b.tiltZ(m, 0.35, 0, 0.06);
      muzzle = new Vector3(1.1, 0.14, 0);
      break;
    case 'rifle':
      b.box(0.15, 0.1, 0, 0.62, 0.14, 0.08, STEEL, STEEL_TOP); // receiver
      b.box(0.6, 0.085, 0, 0.36, 0.11, 0.09, WOOD, WOOD_TOP); // handguard
      b.box(0.62, 0.17, 0, 0.4, 0.035, 0.035, STEEL); // gas tube
      b.box(0.92, 0.11, 0, 0.36, 0.04, 0.04, STEEL); // barrel
      b.box(1.06, 0.15, 0, 0.03, 0.08, 0.02, STEEL); // front sight
      b.box(0.3, 0.19, 0, 0.06, 0.04, 0.03, STEEL); // rear sight
      m = b.mark();
      b.box(0.3, -0.07, 0, 0.09, 0.26, 0.06, 0x2a2b2e); // curved magazine
      b.tiltZ(m, 0.38, 0.3, 0.05);
      m = b.mark();
      b.box(-0.42, 0.06, 0, 0.5, 0.13, 0.07, WOOD, WOOD_TOP); // stock
      b.tiltZ(m, -0.1, -0.16, 0.08);
      m = b.mark();
      b.box(0, 0, 0, 0.075, 0.17, 0.06, POLY); // pistol grip
      b.tiltZ(m, 0.3, 0, 0.05);
      muzzle = new Vector3(1.11, 0.11, 0);
      break;
  }
  const mesh = new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true, emissive: 0x0b0b0c }));
  mesh.userData.muzzle = muzzle;
  return mesh;
}

/**
 * Melee weapons, about 1.3x real size, built along +y (out of the thumb side of the fist) with the
 * grip at the origin: held by the same hand frame as the guns.
 */
export function meleeMesh(kind: MeleeKind): Mesh {
  const b = new MeshBuilder();
  switch (kind) {
    case 'baton': // a side-handle police baton
      b.box(0, 0.42, 0, 0.07, 1.08, 0.07, 0x3a3b3f, 0x4a4b50);
      b.box(0.11, 0.08, 0, 0.16, 0.06, 0.06, 0x3a3b3f);
      break;
    case 'bat': // tapered ash bat with a knob
      b.box(0, -0.13, 0, 0.09, 0.04, 0.09, 0xb08a58);
      b.box(0, 0.2, 0, 0.055, 0.62, 0.055, 0xc8a26a);
      b.box(0, 0.7, 0, 0.08, 0.4, 0.08, 0xc8a26a);
      b.box(0, 1.1, 0, 0.11, 0.42, 0.11, 0xd2ae78, 0xd8b682);
      break;
    case 'machete': // black grip, steel blade with a darker spine
      b.box(0, 0.04, 0, 0.065, 0.34, 0.06, 0x1d1d1f);
      b.box(0, 0.23, 0, 0.12, 0.03, 0.08, 0x2a2b2e);
      b.box(0.015, 0.66, 0, 0.13, 0.84, 0.018, 0xc3c7cd, 0xd5d9de);
      b.box(-0.045, 0.62, 0, 0.03, 0.76, 0.024, 0x6a6f76);
      break;
  }
  return new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true, emissive: 0x0b0b0c }));
}

/** Whatever weapon it is, ready to put in a hand. */
export function weaponMesh(kind: WeaponKind): Mesh {
  return kind === 'baton' || kind === 'bat' || kind === 'machete' ? meleeMesh(kind) : gunMesh(kind);
}

/** A green ammo can with a carry handle and a brass stencil. */
function ammoMesh(): Mesh {
  const b = new MeshBuilder()
    .box(0, 0.18, 0, 0.62, 0.36, 0.3, 0x4c5933, 0x5a693c)
    .box(0, 0.37, 0, 0.64, 0.03, 0.32, 0x3f4a2a)
    .box(0, 0.42, 0, 0.26, 0.03, 0.05, 0x2a2b2e)
    .box(0, 0.2, 0.152, 0.3, 0.08, 0.005, 0xc9b35a);
  return new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true }));
}

/** One glass bottle, standing, base at y = 0 (also what you throw). */
export function bottleMesh(): Mesh {
  const b = new MeshBuilder().prism(0, 0.15, 0, 0.08, 0.3, 6, 0x2f6a3a, 0x3a7a46).prism(0, 0.36, 0, 0.035, 0.14, 5, 0x2f6a3a);
  return new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true, emissive: 0x0a140c }));
}

/** Three bottles, to throw. */
function bottlesMesh(): Mesh {
  const b = new MeshBuilder();
  for (const [x, z, col] of [[0, 0, 0x2f6a3a], [0.2, 0.1, 0x6a4a22], [0.05, 0.22, 0x2f6a3a]] as const) {
    b.prism(x, 0.15, z, 0.08, 0.3, 6, col, new Color(col).offsetHSL(0, 0, 0.08).getHex()).prism(x, 0.36, z, 0.035, 0.14, 5, col);
  }
  return new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true, emissive: 0x0a140c }));
}

/** A red jerrycan. */
function jerrycanMesh(): Mesh {
  const b = new MeshBuilder()
    .box(0, 0.32, 0, 0.46, 0.62, 0.22, 0xa52a1e, 0xb8352a)
    .box(-0.05, 0.67, 0, 0.26, 0.08, 0.06, 0x7d1f16)
    .box(0.17, 0.68, 0, 0.06, 0.1, 0.06, 0x2a2b2e);
  return new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true, emissive: 0x0a0a0a }));
}

/**
 * A tactical vest, built around the chest: origin at the middle of the torso, +z out of the front,
 * +y up. Plates front and back, pouches, shoulder straps.
 */
export function vestMesh(): Mesh {
  const body = 0x2f3a2c, plate = 0x39462f, strap = 0x22291f, pouch = 0x434f36;
  const b = new MeshBuilder()
    .box(0, 0, 0, 0.66, 0.62, 0.44, body, plate) // the shell
    .box(0, 0.02, 0.235, 0.5, 0.5, 0.04, plate) // front plate
    .box(0, 0.02, -0.235, 0.5, 0.5, 0.04, plate) // back plate
    .box(-0.2, 0.33, 0, 0.12, 0.06, 0.46, strap) // shoulder straps
    .box(0.2, 0.33, 0, 0.12, 0.06, 0.46, strap);
  for (const x of [-0.17, 0, 0.17]) b.box(x, -0.16, 0.27, 0.13, 0.16, 0.06, pouch); // magazine pouches
  b.box(0.15, 0.16, 0.265, 0.14, 0.1, 0.03, 0x1c201a); // radio pouch
  b.box(0, -0.06, 0.258, 0.22, 0.05, 0.005, 0xc8c8b8); // a name tape
  return new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true }));
}

/**
 * A riot helmet sized for the characters' big heads (about 0.8 wide): origin at the rim, a dome over
 * the top of the head, and a visor hanging down over the eyes in front (+z).
 */
export function helmetMesh(): Group {
  const g = new Group();
  const unit = new Group(); // built on a unit sphere, then squashed to the head's shape
  const shell = new Mesh(new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new MeshLambertMaterial({ color: 0x232b36 }));
  const rim = new Mesh(new MeshBuilder().prism(0, 0, 0, 1.04, 0.08, 16, 0x161b22).build(), new MeshLambertMaterial({ vertexColors: true }));
  const visor = new Mesh(new SphereGeometry(1.06, 14, 3, Math.PI / 2 - 1.05, 2.1, Math.PI / 2, 0.42),
    new MeshLambertMaterial({ color: 0x9cc0dc, transparent: true, opacity: 0.4, emissive: 0x10222e, depthWrite: false }));
  const stripe = new Mesh(new SphereGeometry(1.01, 4, 8, Math.PI / 2 - 0.12, 0.24, 0.05, Math.PI / 2 - 0.1), new MeshLambertMaterial({ color: 0xd8d2c4 }));
  unit.add(shell, rim, visor, stripe);
  unit.scale.set(0.47, 0.5, 0.42);
  g.add(unit);
  return g;
}

export function gearMesh(kind: GearKind): Object3D {
  return kind === 'vest' ? vestMesh() : helmetMesh();
}

/** A pickup lying where someone dropped it: a gun on its side, an ammo can, bottles, a jerrycan;
 * with a glint. */
export function pickupMesh(kind: PickupKind, yaw: number): Group {
  const g = new Group();
  const item: Object3D = kind === 'ammo' ? ammoMesh() : kind === 'bottles' ? bottlesMesh() : kind === 'jerrycan' ? jerrycanMesh()
    : kind === 'vest' || kind === 'helmet' ? gearMesh(kind) : weaponMesh(kind);
  if (kind === 'baton' || kind === 'bat' || kind === 'machete') {
    item.rotation.set(0, 0, Math.PI / 2); // lying along the ground
    item.position.y = 0.07;
  } else if (kind === 'pistol' || kind === 'shotgun' || kind === 'rifle') {
    item.rotation.set(Math.PI / 2, 0, 0); // on its side, flat on the ground
    item.position.y = 0.05;
  } else if (kind === 'vest') {
    item.rotation.set(-Math.PI / 2, 0, 0.3); // dropped flat on its back
    item.position.y = 0.24;
  } else if (kind === 'helmet') {
    item.rotation.set(0.25, 0, 0.15); // tipped on its rim
    item.position.y = 0.02;
  }
  const holder = new Group();
  holder.rotation.y = yaw;
  holder.add(item);
  g.add(holder, glint(kind === 'ammo' || kind === 'jerrycan' || kind === 'vest' ? 0.75 : kind === 'bottles' || kind === 'helmet' ? 0.6 : 0.3));
  return g;
}

let glintTex: CanvasTexture | null = null;
/** A four-point star with a soft core: the glint that says "this can be picked up". */
function glintTexture(): CanvasTexture {
  if (glintTex) return glintTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const core = x.createRadialGradient(32, 32, 0, 32, 32, 14);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = core;
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = 'rgba(255,255,255,0.9)';
  for (const [w, h] of [[30, 2.2], [2.2, 30]] as const) {
    x.beginPath();
    x.ellipse(32, 32, w, h, 0, 0, Math.PI * 2);
    x.fill();
  }
  return (glintTex = new CanvasTexture(c));
}

/** The glint sprite, named so the view can pulse it. */
export function glint(height: number, color = 0xfff1c4): Sprite {
  const s = new Sprite(new SpriteMaterial({ map: glintTexture(), color, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  s.position.y = height;
  s.scale.setScalar(0.9);
  s.name = 'glint';
  return s;
}

/** Pulse a glint: mostly a soft shimmer, with a sharp sparkle every couple of seconds. */
export function pulseGlint(s: Object3D, time: number, phase: number): void {
  const t = (time * 0.6 + phase) % 1;
  const flash = t < 0.12 ? Math.sin((t / 0.12) * Math.PI) : 0;
  s.scale.setScalar(0.55 + flash * 0.9);
  ((s as Sprite).material as SpriteMaterial).opacity = 0.35 + flash * 0.65;
  (s as Sprite).material.rotation = time * 0.4 + phase;
}

/** The story items you take at an objective (keys, keycard, map, supplies). Base at y = 0. */
export function storyItem(kind: 'key' | 'keycard' | 'map' | 'medkit' | 'fuel'): Group {
  const g = new Group();
  const b = new MeshBuilder();
  let glintH = 0.3;
  switch (kind) {
    case 'key': // a key ring: brass and steel keys and a red fob
      b.box(0, 0.02, 0, 0.16, 0.025, 0.16, 0x9a9da3);
      b.box(0.2, 0.02, 0.03, 0.26, 0.02, 0.05, 0xc9a64a).box(0.31, 0.02, 0.06, 0.04, 0.02, 0.05, 0xc9a64a);
      b.box(0.05, 0.02, -0.2, 0.05, 0.02, 0.24, 0xb8bcc2);
      b.box(-0.17, 0.03, -0.05, 0.2, 0.04, 0.12, 0xb02020, 0xc8302a);
      break;
    case 'keycard': // a security card on a lanyard
      b.box(0, 0.015, 0, 0.42, 0.012, 0.27, 0xe8e8e2, 0xeeeeea);
      b.floor(-0.2, -0.12, 0.2, -0.05, 0.022, 0x2f6ea8);
      b.floor(0.06, 0, 0.17, 0.09, 0.022, 0xd8b44a);
      b.box(-0.35, 0.01, 0.05, 0.3, 0.01, 0.035, 0x2f6ea8).box(-0.5, 0.01, 0.2, 0.035, 0.01, 0.32, 0x2f6ea8);
      break;
    case 'map': { // a city map, open on top of a crate (the crate is scenery and stays)
      const paper = new Mesh(new PlaneGeometry(0.8, 0.58).rotateX(-Math.PI / 2), new MeshLambertMaterial({ map: mapTexture() }));
      paper.position.set(0, 0.81, 0);
      paper.rotation.y = 0.25;
      g.add(paper);
      glintH = 1.05;
      break;
    }
    case 'medkit': // a first-aid bag with a carry strap
      b.box(0, 0.2, 0, 0.75, 0.4, 0.45, 0xb3201f, 0xc42a26);
      b.box(0, 0.405, 0, 0.36, 0.012, 0.1, 0xf2f2ee).box(0, 0.405, 0, 0.1, 0.012, 0.32, 0xf2f2ee);
      b.box(0, 0.46, 0, 0.32, 0.06, 0.05, 0x1d1d1f);
      glintH = 0.6;
      break;
    case 'fuel': // jerrycans
      for (const [x, z] of [[0, 0], [0.62, 0.15]] as const) {
        b.box(x, 0.32, z, 0.46, 0.62, 0.22, 0xa52a1e, 0xb8352a); // body
        b.box(x - 0.05, 0.67, z, 0.26, 0.08, 0.06, 0x7d1f16); // handle
        b.box(x + 0.17, 0.68, z, 0.06, 0.1, 0.06, 0x2a2b2e); // spout cap
      }
      glintH = 0.95;
      break;
  }
  g.add(new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true, emissive: 0x0a0a0a })));
  g.add(glint(glintH));
  return g;
}

let mapTex: CanvasTexture | null = null;
/** A paper street map: blocks, a park, the harbour, a red route, fold lines. */
function mapTexture(): CanvasTexture {
  if (mapTex) return mapTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 92;
  const x = c.getContext('2d')!;
  x.fillStyle = '#e9e1c8';
  x.fillRect(0, 0, 128, 92);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
    x.fillStyle = i === 2 && j === 1 ? '#9cc28a' : '#cfc6aa';
    x.fillRect(4 + i * 20, 4 + j * 18, 15, 13);
  }
  x.fillStyle = '#8fb4d0';
  x.fillRect(0, 76, 128, 16);
  x.strokeStyle = '#c0262b';
  x.lineWidth = 2.5;
  x.beginPath();
  x.moveTo(12, 70);
  x.lineTo(12, 37);
  x.lineTo(78, 37);
  x.lineTo(78, 18);
  x.lineTo(118, 18);
  x.stroke();
  x.strokeStyle = 'rgba(0,0,0,0.18)';
  x.lineWidth = 1;
  for (const fx of [43, 86]) { x.beginPath(); x.moveTo(fx, 0); x.lineTo(fx, 92); x.stroke(); }
  x.beginPath(); x.moveTo(0, 46); x.lineTo(128, 46); x.stroke();
  mapTex = new CanvasTexture(c);
  mapTex.colorSpace = SRGBColorSpace;
  return mapTex;
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

/**
 * A weapon store: a brick shop with barred, lit display windows full of guns, a glass door, an
 * awning and a neon WEAPONS sign. Built facing +z, centred on its footprint, base at y = 0.
 * Walls use `solid` (the city's material) so the player's x-ray silhouette works behind it.
 */
export function storefrontMesh(store: Store, solid: Material): Group {
  const f = store.front;
  const alongX = f.facing.y !== 0; // frontage runs along world x
  const W = alongX ? f.w : f.h, D = alongX ? f.h : f.w, H = 5;
  const zf = D / 2; // the facade plane
  const g = new Group();
  const walls = new MeshBuilder()
    .box(0, H / 2, 0, W, H, D, 0x4a352c, 0x2a2b2e) // brick
    .box(0, H + 0.15, 0, W + 0.2, 0.3, D + 0.2, 0x26272a) // parapet
    .box(0, 3.55, zf + 0.6, W - 0.3, 0.14, 1.2, 0x7a1c1c, 0x8c2422) // awning
    .box(0, 4.35, zf + 0.12, W - 1.2, 1.1, 0.2, 0x1b1c1f) // sign board
    .box(0, 0.08, zf + 0.7, 2.2, 0.03, 1.2, 0x3a2a22); // door mat
  for (const side of [-1, 1]) { // security bars over the windows
    for (let k = 0; k < 7; k++) walls.box(side * (1.45 + k * 0.42), 1.9, zf + 0.09, 0.05, 2.3, 0.05, 0x2a2b2e);
    walls.box(side * (1.45 + 1.26), 3.05, zf + 0.09, 2.7, 0.06, 0.05, 0x2a2b2e);
  }
  walls.box(-1.05, 1.6, zf + 0.05, 0.12, 3.2, 0.12, 0x2a2b2e).box(1.05, 1.6, zf + 0.05, 0.12, 3.2, 0.12, 0x2a2b2e); // door frame
  const yaw = Math.atan2(f.facing.x, f.facing.y);
  // a rooftop sign turned toward the (fixed-yaw) street camera, so every store reads from afar
  const roofYaw = Math.PI / 4 - yaw;
  for (const o of [-2.2, 2.2]) walls.box(o * Math.cos(roofYaw), H + 0.6, -o * Math.sin(roofYaw), 0.12, 1.2, 0.12, 0x2a2b2e); // its posts
  g.add(new Mesh(walls.build(), solid));
  // everything lit (the windows with the glass door between them, the front sign, the rooftop
  // sign) shares one texture atlas, so it is one draw: signs in the top band, windows below
  const windows = vBand(new PlaneGeometry(W - 1.2, 2.8), 0, ATLAS_SPLIT).translate(0, 1.75, zf + 0.03);
  const front = vBand(new PlaneGeometry(W - 1.4, 1.0), ATLAS_SPLIT, 1).translate(0, 4.35, zf + 0.23);
  const roof = vBand(new PlaneGeometry(6, 1.3), ATLAS_SPLIT, 1).rotateY(roofYaw).translate(0, H + 1.5, 0);
  g.add(new Mesh(mergeGeometries([windows, front, roof])!, new MeshBasicMaterial({ map: storeAtlas(store.name), transparent: true })));
  g.position.set(f.x + f.w / 2, 0.15, f.y + f.h / 2);
  g.rotation.y = yaw;
  return g;
}

const ATLAS_SPLIT = 176 / 272; // v below this is the window display, above it the sign

/** Squeeze a plane's v coordinates into [v0, v1] of the atlas. */
function vBand<T extends PlaneGeometry>(geo: T, v0: number, v1: number): T {
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  return geo;
}

/** One texture for a store: the neon sign (top 96 px) over the window display (176 px). */
function storeAtlas(name: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 272;
  const x = c.getContext('2d')!;
  x.drawImage(signCanvas(name), 0, 0);
  x.drawImage(displayCanvas(), 0, 96);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The display windows: a warm-lit pegboard of rifles, shotguns, pistols and price tags, with a
 * dark gap where the door goes. */
function displayCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 176;
  const x = c.getContext('2d')!;
  // the brick wall below the sills, then the lit windows
  x.fillStyle = '#3a2a22';
  x.fillRect(0, 0, 512, 176);
  const grd = x.createLinearGradient(0, 0, 0, 132);
  grd.addColorStop(0, '#ffe2a8');
  grd.addColorStop(1, '#c48a4a');
  x.fillStyle = grd;
  x.fillRect(8, 6, 192, 126);
  x.fillRect(312, 6, 192, 126);
  x.fillStyle = '#ffd9a0';
  x.fillRect(208, 6, 96, 154); // the glass door, lit from inside
  x.fillStyle = '#8a6a44';
  x.fillRect(252, 6, 8, 154); // its two leaves
  x.fillRect(270, 80, 14, 4); // handle
  const gun = (gx: number, gy: number, len: number, kind: number) => {
    x.fillStyle = '#2a211c';
    x.fillRect(gx, gy, len, 7); // barrel and body
    x.fillRect(gx + len * 0.55, gy + 7, 7, 14); // grip / magazine
    if (kind > 0) x.fillRect(gx - len * 0.28, gy + 2, len * 0.3, 11); // stock
    x.fillStyle = '#f4f0e6';
    x.fillRect(gx + len * 0.2, gy + 26, 18, 9); // price tag
  };
  for (const ox of [0, 304]) {
    for (let r = 0; r < 3; r++) for (let k = 0; k < 2; k++) gun(ox + 40 + k * 100, 18 + r * 46, r === 2 ? 34 : 64, r === 2 ? 0 : 1);
  }
  return c;
}

function signCanvas(name: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const x = c.getContext('2d')!;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.shadowColor = '#ff3b3b';
  x.shadowBlur = 16;
  x.fillStyle = '#ff4b3b';
  x.font = 'bold 50px system-ui, sans-serif';
  x.fillText('WEAPONS', 256, 38);
  x.shadowBlur = 0;
  x.fillStyle = '#ffd9a0';
  x.font = '20px system-ui, sans-serif';
  x.fillText(name.toUpperCase(), 256, 78);
  return c;
}

/** The evac point: a helipad ringed with sandbags and floodlights, and the helicopter overhead. */
/**
 * The way into the next district: a subway entrance. Stairs going down into the dark between
 * railings, a lit sign on a post, and a shutter that stays down until you have everything.
 */
export class SubwayExit {
  readonly group = new Group();
  private shutter: Mesh;
  private sign: MeshBasicMaterial;
  private glow: Mesh;

  constructor() {
    const b = new MeshBuilder();
    // the stairwell, drawn on the street: a black pit with steps catching less light the deeper they go
    b.box(0, 0.02, 0, 3.2, 0.04, 5, 0x050607);
    for (let k = 0; k < 7; k++) {
      const shade = new Color(0x4a4c50).multiplyScalar(1 - k * 0.13).getHex();
      b.box(0, 0.045, -2.1 + k * 0.5, 2.9, 0.01, 0.22, shade);
    }
    // railings on three sides (the open end, +z, is the way in... the stairs lead down toward -z)
    const rail = 0x2f5a3c;
    for (const x of [-1.7, 1.7]) {
      b.box(x, 0.55, 0, 0.12, 1.1, 5.2, 0x3a3c40, 0x44474c); // low wall
      b.box(x, 1.25, 0, 0.07, 0.07, 5.2, rail);
      for (const z of [-2.5, -0.8, 0.9, 2.5]) b.box(x, 1.0, z, 0.07, 0.5, 0.07, rail);
    }
    b.box(0, 0.55, -2.6, 3.5, 1.1, 0.12, 0x3a3c40, 0x44474c);
    b.box(0, 1.25, -2.6, 3.5, 0.07, 0.07, rail);
    // the sign post
    b.box(2.3, 1.6, 2.3, 0.14, 3.2, 0.14, 0x2a2c30);
    this.group.add(new Mesh(b.build(), weather(new MeshLambertMaterial({ vertexColors: true }))));
    this.sign = new MeshBasicMaterial({ map: textTexture('SUBWAY', '#e8f6ea', 256, 96, 'bold 52px system-ui, sans-serif', false), color: 0xff6a5a });
    const sign = new Mesh(new BoxGeometry(1.9, 0.6, 0.12), this.sign);
    sign.position.set(2.3, 3.35, 2.3);
    sign.rotation.y = Math.PI / 4; // faces the camera
    // the shutter, rolled down across the top of the stairs
    const sh = new MeshBuilder();
    for (let k = 0; k < 6; k++) sh.box(0, 0.12 + k * 0.17, 0, 3.2, 0.15, 0.06, k % 2 ? 0x6a6c70 : 0x5a5c60);
    this.shutter = new Mesh(sh.build(), weather(new MeshLambertMaterial({ vertexColors: true })));
    this.shutter.position.set(0, 0, 2.45);
    // light coming up out of the stairwell once it is open
    this.glow = new Mesh(
      new PlaneGeometry(2.8, 4.4).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0x7dffa8, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
    );
    this.glow.position.y = 0.06;
    this.group.add(sign, this.shutter, this.glow);
  }

  update(time: number, open: boolean): void {
    this.shutter.visible = !open;
    this.sign.color.setHex(open ? 0x7dffa8 : 0xff6a5a);
    (this.glow.material as MeshBasicMaterial).opacity = open ? 0.16 + Math.sin(time * 3) * 0.05 : 0;
  }
}

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
    this.tracers.visible = this.tracerLife.some((l) => l > 0); // nothing flying: no draw
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
    this.particles.visible = this.parts.length > 0;
    this.particles.instanceMatrix.needsUpdate = true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }
}
