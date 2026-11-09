// Builds the vehicle and weapon models (our own, drawn here in code) into one GLB:
//   node tools/build-models.mjs public/assets/models/models.glb
//
// Every model is one vertex-coloured mesh (one draw call), plus `<name>.lights` for vehicles (unlit
// head and tail lights). Parts painted the "finish" colour (car paint, a gun's furniture) are written
// in a marker colour, magenta (r = b = shade, g = 0); the game swaps in the owner's colour at load,
// which is what makes a model personal: a paint job or a finish, with the same shape underneath.
// Nothing else in a model is pure magenta. Built along +x (a car's nose, a gun's muzzle), y up.
// Only three.js is used.
import fs from 'node:fs';
import path from 'node:path';
import {
  BoxGeometry, BufferAttribute, Color, CylinderGeometry, ExtrudeGeometry, LatheGeometry, Matrix4, Mesh, MeshLambertMaterial,
  Scene, Shape, ShapeGeometry, Vector2,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
};

const out = process.argv[2];
if (!out) { console.error('usage: build-models.mjs <out.glb>'); process.exit(1); }

// ---------------------------------------------------------------- building blocks

/** A finish (paint) colour: the marker, at a shade (1 = the colour itself, less = darker panels). */
const PAINT = (shade = 1) => ({ paint: shade });
const col = new Color();

/** Collects coloured parts into one geometry. */
class Model {
  parts = [];
  add(geo, color, m) {
    const g = (geo.index ? geo.toNonIndexed() : geo);
    g.deleteAttribute('uv');
    if (m) g.applyMatrix4(m);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    let r, gg, b;
    if (typeof color === 'object') { r = b = color.paint; gg = 0; } else { col.setHex(color); r = col.r; gg = col.g; b = col.b; }
    for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; }
    g.setAttribute('color', new BufferAttribute(c, 3));
    this.parts.push(g);
    return this;
  }
  /** Box centred at (x, y, z). */
  box(x, y, z, w, h, d, color, rot) {
    return this.add(new BoxGeometry(w, h, d), color, at(x, y, z, rot));
  }
  /** Cylinder along an axis ('x', 'y' or 'z'). */
  cyl(x, y, z, r0, r1, len, axis, color, seg = 12) {
    const g = new CylinderGeometry(r1, r0, len, seg);
    const m = new Matrix4();
    if (axis === 'x') m.makeRotationZ(-Math.PI / 2);
    else if (axis === 'z') m.makeRotationX(Math.PI / 2);
    return this.add(g.applyMatrix4(m), color, at(x, y, z));
  }
  /** A side profile (points in x, y) extruded `depth` across z, centred on z = cz, with rounded edges. */
  profile(pts, depth, color, { cz = 0, bevel = 0, holes = [], curve = 8 } = {}) {
    const s = shape(pts);
    for (const h of holes) s.holes.push(shape(h));
    const t = Math.min(bevel, depth / 2 - 0.001);
    const g = new ExtrudeGeometry(s, { depth: depth - 2 * t, bevelEnabled: t > 0, bevelThickness: t, bevelSize: t, bevelOffset: -t, bevelSegments: 1, curveSegments: curve });
    g.translate(0, 0, cz - (depth - 2 * t) / 2);
    return this.add(g, color);
  }
  /** A flat shape on a side of the model (z = side), facing outwards. */
  decal(pts, z, color) {
    const g = new ShapeGeometry(shape(pts));
    if (z < 0) flip(g);
    return this.add(g, color, at(0, 0, z));
  }
  build(name) {
    const g = mergeVertices(mergeGeometries(this.parts), 1e-4);
    const c = g.attributes.color.array; // bytes, not floats: a quarter of the size, the marker stays exact
    g.setAttribute('color', new BufferAttribute(Uint8Array.from(c, (v) => Math.round(v * 255)), 3, true));
    g.computeBoundingBox();
    const mesh = new Mesh(g, new MeshLambertMaterial({ vertexColors: true }));
    mesh.name = name;
    return mesh;
  }
}

function shape(pts) {
  const s = new Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}
function flip(g) {
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setZ(i, -n.getZ(i));
}
const rz = (a) => ({ x: 0, y: 0, z: a, order: 'XYZ', isEuler: true });
function at(x, y, z, rot) {
  const m = new Matrix4();
  if (rot) m.makeRotationFromEuler(rot);
  return m.setPosition(x, y, z);
}
const arc = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + ((a1 - a0) * i) / n;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
});
/** Rounds the corners of a polygon (r per corner, or one r for all). */
function rounded(pts, r, n = 3) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const rr = Array.isArray(r) ? r[i] : r;
    const p = new Vector2(...pts[i]);
    if (!rr) { out.push([p.x, p.y]); continue; }
    const a = new Vector2(...pts[(i + pts.length - 1) % pts.length]).sub(p);
    const b = new Vector2(...pts[(i + 1) % pts.length]).sub(p);
    const k = Math.min(rr, a.length() / 2, b.length() / 2);
    const p0 = p.clone().add(a.normalize().multiplyScalar(k)), p1 = p.clone().add(b.normalize().multiplyScalar(k));
    for (let j = 0; j <= n; j++) { // quadratic curve through the corner
      const t = j / n, u = 1 - t;
      out.push([u * u * p0.x + 2 * u * t * p.x + t * t * p1.x, u * u * p0.y + 2 * u * t * p.y + t * t * p1.y]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- vehicles

const TRIM = 0x1d1f22, CHASSIS = 0x111214, TYRE = 0x18181a, RIM = 0xa9afb7, HUB = 0x5b6067, CHROME = 0xc7ccd2;
const GLASS = 0x1a2a36, GLASS_DARK = 0x0f1820, PLATE = 0xe6e2d2, PLATE_TEXT = 0x2a2f5a, SEAT = 0x2a2624;

/** A wheel at (x, z) on the ground: tyre with a rounded sidewall, five-spoke rim, hub, brake disc. */
function wheel(m, x, z, r, w, rimColor = RIM) {
  const side = Math.sign(z);
  const prof = [[r * 0.6, -w / 2], [r * 0.88, -w / 2], [r * 0.98, -w * 0.38], [r, 0], [r * 0.98, w * 0.38], [r * 0.88, w / 2], [r * 0.6, w / 2]];
  const tyre = new LatheGeometry(prof.map(([a, b]) => new Vector2(a, b)), 12).rotateX(Math.PI / 2);
  m.add(tyre, TYRE, at(x, r, z));
  const face = z + side * (w / 2 - 0.02);
  m.cyl(x, r, face - side * 0.04, r * 0.62, r * 0.62, 0.08, 'z', rimColor, 12); // rim lip
  m.cyl(x, r, face - side * 0.1, r * 0.5, r * 0.5, 0.06, 'z', 0x3a3d42, 14); // dark well behind the spokes
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    m.box(x + Math.cos(a) * r * 0.27, r + Math.sin(a) * r * 0.27, face - side * 0.02, r * 0.5, r * 0.13, 0.06, rimColor, rz(a));
  }
  m.cyl(x, r, face, r * 0.16, r * 0.16, 0.07, 'z', HUB, 10);
}

/**
 * A car from its side profile: the lower body (painted, wheel arches cut out), the glasshouse
 * (pillars painted, windows glass), and the details that make it read as a real car.
 */
function car(spec) {
  const { L, W, r, wheelX, body, cabin, wheelW = 0.46 } = spec;
  const m = new Model(), lights = new Model();
  const hl = L / 2;
  // lower body, arches cut out of its bottom edge
  const arch = r * 1.2, sill = spec.sill ?? r * 0.62;
  // front bumper -> along the top -> rear bumper, then back along the bottom through the arches
  const lower = [[hl - 0.12, sill], ...body, [-hl + 0.1, sill]];
  for (const wx of [...wheelX].sort((a, b) => a - b)) lower.push(...arc(wx, r * 0.95, arch, Math.PI, 0, 8).map(([x, y]) => [x, Math.max(y, sill)]));
  m.profile(lower, W, PAINT(1), { bevel: 0.14 });
  // a darker chassis under it, seen through the arches
  m.box(0, sill + 0.15, 0, L * 0.86, 0.5, W * 0.72, CHASSIS);
  m.box(0, sill - 0.05, 0, L * 0.9, 0.12, W * 0.9, TRIM); // rocker panels / skirts
  for (const wx of wheelX) m.box(wx, r * 1.1, 0, r * 2.1, r * 1.3, W * 0.7, CHASSIS); // wheel wells

  // glasshouse: a narrower painted shell, windows on its sides and ends
  if (cabin) {
    const cw = W * (spec.cabinW ?? 0.86);
    m.profile(cabin.pts, cw, PAINT(0.96), { bevel: 0.1 });
    for (const s of [-1, 1]) {
      for (const win of cabin.windows) m.decal(win, s * (cw / 2 + 0.005), GLASS);
    }
    // windscreen and rear window: quads just off the slanted faces
    const glass = (a, b, z0, color) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      const g = new BoxGeometry(len * 0.86, 0.02, cw - 0.3);
      const nx = dy / len, ny = -dx / len; // outward: our profiles run front to back over the top
      m.add(g, color, at((a[0] + b[0]) / 2 + nx * 0.025, (a[1] + b[1]) / 2 + ny * 0.025, 0, rz(Math.atan2(dy, dx))));
    };
    glass(cabin.screen[0], cabin.screen[1], 0, GLASS);
    if (cabin.rear) glass(cabin.rear[0], cabin.rear[1], 0, GLASS_DARK);
    // mirrors at the foot of the A pillars
    for (const s of [-1, 1]) {
      m.box(cabin.screen[0][0] - 0.12, cabin.screen[0][1] + 0.12, s * (W / 2 + 0.12), 0.2, 0.2, 0.3, PAINT(0.9));
      m.box(cabin.screen[0][0] - 0.2, cabin.screen[0][1] + 0.12, s * (W / 2 + 0.2), 0.04, 0.16, 0.24, GLASS);
    }
  }

  // doors: seams and handles
  for (const s of [-1, 1]) {
    const z = s * (W / 2 + 0.004);
    for (const sx of spec.seams ?? []) m.box(sx, spec.seamY[0] / 2 + spec.seamY[1] / 2, z, 0.03, spec.seamY[1] - spec.seamY[0], 0.02, TRIM);
    for (const hx of spec.handles ?? []) m.box(hx, spec.seamY[1] - 0.18, s * (W / 2 + 0.02), 0.28, 0.06, 0.05, CHROME);
    m.box(0, spec.beltY ?? spec.seamY[1], s * (W / 2 + 0.01), L * 0.6, 0.04, 0.02, TRIM); // belt moulding
  }

  // front: bumper, grille, plate, headlights; back: bumper, plate, tail lights
  const fb = spec.front, rb = spec.rear;
  m.box(hl - 0.04, fb.bumper, 0, 0.32, 0.36, W * 0.98, TRIM);
  m.box(hl + 0.06, fb.grille, 0, 0.06, fb.grilleH, W * 0.46, 0x0c0d0e);
  for (let i = 0; i < 3; i++) m.box(hl + 0.1, fb.grille - fb.grilleH / 2 + (fb.grilleH * (i + 0.5)) / 3, 0, 0.03, 0.04, W * 0.44, CHROME);
  m.box(hl + 0.13, fb.bumper, 0, 0.03, 0.22, 0.75, PLATE);
  m.box(-hl + 0.04, rb.bumper, 0, 0.32, 0.36, W * 0.98, TRIM);
  m.box(-hl - 0.13, rb.plate, 0, 0.03, 0.26, 0.8, PLATE);
  m.box(-hl - 0.15, rb.plate, 0, 0.02, 0.06, 0.55, PLATE_TEXT);
  for (const s of [-1, 1]) {
    lights.box(hl + 0.03 + (fb.lightX ?? 0), fb.light, s * W * 0.34, 0.12, fb.lightH, W * 0.22, 0xfff3d0);
    lights.box(hl + 0.05 + (fb.lightX ?? 0), fb.bumper + 0.05, s * W * 0.4, 0.06, 0.08, W * 0.12, 0xffb347); // indicators
    lights.box(-hl - 0.03 + (rb.lightX ?? 0), rb.light, s * W * 0.38, 0.12, rb.lightH, W * 0.18, 0xb01818);
  }
  for (const wx of wheelX) for (const s of [-1, 1]) wheel(m, wx, s * (W / 2 - wheelW / 2 + 0.02), r, wheelW, spec.rim);
  spec.extra?.(m, lights);
  return [m, lights];
}

const MODELS = [];
function vehicle(name, spec) {
  const [m, l] = car(spec);
  const body = m.build(name);
  const lit = l.build(`${name}.lights`);
  body.add(lit);
  body.userData = { kind: 'vehicle', length: spec.L, width: spec.W };
  MODELS.push(body);
}

// A four-door saloon: long bonnet, sloped screen, a boot. 6.4 x 2.9 world units.
vehicle('sedan', {
  L: 6.4, W: 2.9, r: 0.56, wheelX: [2.05, -2.0], sill: 0.42,
  body: rounded([[3.2, 0.62], [3.18, 1.02], [2.95, 1.16], [1.25, 1.3], [-2.25, 1.32], [-3.05, 1.24], [-3.2, 1.0], [-3.18, 0.62]], [0.12, 0.22, 0.2, 0.1, 0.2, 0.2, 0.12, 0]),
  cabin: {
    pts: rounded([[1.4, 1.2], [0.3, 2.0], [-1.25, 2.02], [-2.3, 1.25]], [0, 0.18, 0.22, 0]),
    screen: [[1.36, 1.25], [0.36, 1.93]],
    rear: [[-1.3, 1.96], [-2.2, 1.32]],
    windows: [
      [[1.18, 1.36], [0.28, 1.86], [-0.42, 1.86], [-0.42, 1.36]],
      [[-0.55, 1.36], [-0.55, 1.86], [-1.2, 1.86], [-1.95, 1.36]],
    ],
  },
  seams: [1.3, -0.48, -1.95], seamY: [0.52, 1.3], handles: [0.55, -1.1], beltY: 1.3,
  front: { bumper: 0.6, grille: 0.92, grilleH: 0.26, light: 1.0, lightH: 0.16, lightX: -0.08 },
  rear: { bumper: 0.6, plate: 0.88, light: 1.08, lightH: 0.2, lightX: 0.05 },
  extra: (m) => { // boot lip spoiler, aerial
    m.box(-2.95, 1.31, 0, 0.18, 0.05, 2.4, PAINT(0.9));
    m.box(-1.6, 2.2, 0.6, 0.02, 0.4, 0.02, TRIM);
  },
});

// A crew-cab pickup: tall, square, an open load bed with a roll bar. 6.8 x 3.0.
vehicle('pickup', {
  L: 6.8, W: 3.0, r: 0.66, wheelX: [2.2, -2.15], sill: 0.6, wheelW: 0.56, rim: 0x8e9399,
  body: rounded([[3.4, 0.82], [3.38, 1.46], [3.2, 1.56], [1.25, 1.62], [0.95, 1.62], [-0.9, 1.62], [-0.9, 1.1], [-3.4, 1.1], [-3.4, 0.82]], [0.1, 0.2, 0.15, 0, 0, 0, 0, 0, 0]),
  cabin: {
    pts: rounded([[1.25, 1.5], [0.55, 2.5], [-0.85, 2.52], [-0.95, 1.5]], [0, 0.12, 0.14, 0]),
    screen: [[1.22, 1.58], [0.6, 2.42]],
    windows: [
      [[1.05, 1.72], [0.52, 2.38], [0.0, 2.38], [0.0, 1.72]],
      [[-0.12, 1.72], [-0.12, 2.38], [-0.74, 2.38], [-0.74, 1.72]],
    ],
  },
  cabinW: 0.9,
  seams: [1.3, -0.06, -0.9], seamY: [0.7, 1.62], handles: [0.7, -0.45], beltY: 1.62,
  front: { bumper: 0.82, grille: 1.22, grilleH: 0.42, light: 1.36, lightH: 0.2, lightX: -0.02 },
  rear: { bumper: 0.82, plate: 1.08, light: 1.4, lightH: 0.36 },
  extra: (m, lights) => {
    const W = 3.0;
    for (const s of [-1, 1]) m.box(-2.15, 1.38, s * (W / 2 - 0.08), 2.5, 0.56, 0.16, PAINT(1)); // bed sides
    m.box(-3.32, 1.38, 0, 0.16, 0.56, W - 0.05, PAINT(0.92)); // tailgate
    m.box(-2.15, 1.12, 0, 2.5, 0.06, W - 0.3, 0x2b2d30); // bed floor (liner)
    for (let i = 0; i < 5; i++) m.box(-2.15, 1.16, -1.0 + i * 0.5, 2.4, 0.04, 0.08, 0x232528); // liner ribs
    m.box(-0.98, 1.38, 0, 0.12, 0.56, W - 0.2, PAINT(0.92)); // front of the bed
    for (const s of [-1, 1]) m.box(-1.2, 2.0, s * 1.25, 0.1, 0.9, 0.1, TRIM); // roll bar
    m.box(-1.2, 2.45, 0, 0.12, 0.1, 2.6, TRIM);
    for (const s of [-1, 1]) m.box(-1.15, 2.5, s * 0.6, 0.18, 0.16, 0.36, TRIM); // lamps on the bar
    for (const s of [-1, 1]) lights.box(-1.05, 2.5, s * 0.6, 0.04, 0.12, 0.3, 0xfff3d0);
    for (const s of [-1, 1]) m.box(2.2, 1.36, s * 1.52, 1.7, 0.14, 0.12, 0x202224); // flared arches
    for (const s of [-1, 1]) m.box(-2.15, 1.32, s * 1.56, 1.7, 0.14, 0.12, 0x202224);
    for (const s of [-1, 1]) m.box(0.15, 0.62, s * 1.62, 2.2, 0.08, 0.3, 0x2a2c2f); // side steps
  },
});

// A panel van: short bonnet, steep screen, a tall box with a sliding door and two back doors. 7.4 x 3.1.
vehicle('van', {
  L: 7.4, W: 3.1, r: 0.58, wheelX: [2.55, -2.45], sill: 0.48,
  body: rounded([[3.7, 0.62], [3.68, 1.2], [3.45, 1.42], [2.7, 1.62], [1.9, 2.78], [-3.62, 2.86], [-3.7, 2.6], [-3.7, 0.62]], [0.1, 0.2, 0.25, 0.15, 0.3, 0.2, 0.08, 0]),
  seams: [1.95, 0.0, -1.95, -3.62], seamY: [0.55, 2.7], handles: [1.55, -0.3], beltY: 1.65,
  front: { bumper: 0.6, grille: 1.08, grilleH: 0.34, light: 1.28, lightH: 0.2, lightX: -0.12 },
  rear: { bumper: 0.6, plate: 0.96, light: 1.5, lightH: 0.55 },
  extra: (m) => {
    const W = 3.1;
    // windscreen and cab side windows on the box itself
    const sx0 = 2.62, sy0 = 1.66, sx1 = 1.98, sy1 = 2.66;
    const len = Math.hypot(sx1 - sx0, sy1 - sy0);
    m.add(new BoxGeometry(len * 0.86, 0.03, W - 0.36), GLASS, at((sx0 + sx1) / 2 + 0.03, (sy0 + sy1) / 2 + 0.02, 0, rz(Math.atan2(sy1 - sy0, sx1 - sx0))));
    for (const s of [-1, 1]) {
      m.decal([[2.45, 1.72], [1.95, 2.55], [1.2, 2.55], [1.2, 1.72]], s * (W / 2 + 0.006), GLASS);
      m.box(-0.95, 2.62, s * (W / 2 + 0.005), 3.6, 0.04, 0.02, TRIM); // sliding door track
      m.box(2.1, 1.85, s * (W / 2 + 0.12), 0.18, 0.3, 0.3, TRIM); // big mirrors
      m.box(2.04, 1.85, s * (W / 2 + 0.2), 0.04, 0.26, 0.24, GLASS);
    }
    // back doors: a centre seam and two windows
    m.box(-3.73, 1.65, 0, 0.03, 2.0, 0.03, TRIM);
    for (const s of [-1, 1]) m.box(-3.73, 2.15, s * 0.68, 0.03, 0.55, 1.05, GLASS_DARK);
    m.box(-3.75, 1.5, 0.3, 0.05, 0.08, 0.3, CHROME);
    // roof rack
    for (const x of [-2.8, -1.2, 0.4]) m.box(x, 2.98, 0, 0.1, 0.08, W - 0.2, TRIM);
    for (const s of [-1, 1]) m.box(-1.2, 3.04, s * (W / 2 - 0.15), 3.8, 0.07, 0.07, TRIM);
    m.box(-3.62, 1.5, -1.2, 0.08, 1.8, 0.08, TRIM); // ladder rail by the back door
  },
});

// A motorbike (not ridden in the game yet): steel frame, tank, seat, forks, exhausts. 3.2 long.
{
  const m = new Model(), lights = new Model();
  const r = 0.52;
  for (const x of [1.15, -1.1]) {
    const prof = [[r * 0.72, -0.13], [r * 0.95, -0.12], [r, 0], [r * 0.95, 0.12], [r * 0.72, 0.13]];
    m.add(new LatheGeometry(prof.map(([a, b]) => new Vector2(a, b)), 20).rotateX(Math.PI / 2), TYRE, at(x, r, 0));
    m.cyl(x, r, 0, r * 0.7, r * 0.7, 0.08, 'z', 0x2a2b2e, 18);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI; m.box(x, r, 0, r * 1.36, 0.05, 0.05, RIM, rz(a)); }
    m.cyl(x, r, 0, 0.1, 0.1, 0.2, 'z', HUB, 10);
  }
  m.cyl(1.15, r, 0, 0.32, 0.32, 0.03, 'z', 0x8a8f96, 16); // brake disc (front)
  // frame
  m.box(0.0, 0.95, 0, 1.8, 0.12, 0.12, 0x2b2c2f, rz(0.28));
  m.box(-0.55, 0.78, 0, 1.3, 0.1, 0.1, 0x2b2c2f, rz(-0.12));
  for (const s of [-1, 1]) m.box(-0.6, 0.7, s * 0.14, 1.1, 0.08, 0.05, 0x2b2c2f, rz(0.3)); // swing arm
  // engine block
  m.box(0.1, 0.72, 0, 0.7, 0.52, 0.42, 0x4a4d52);
  for (let i = 0; i < 4; i++) m.box(0.15, 0.9 + i * 0.07, 0, 0.6, 0.03, 0.46, 0x5d6066);
  // tank, seat, tail
  m.profile(rounded([[0.75, 1.25], [0.55, 1.58], [-0.05, 1.6], [-0.35, 1.36], [-0.25, 1.2]], 0.12), 0.56, PAINT(1), { bevel: 0.12 });
  m.profile(rounded([[-0.3, 1.36], [-0.32, 1.48], [-1.1, 1.5], [-1.3, 1.38], [-1.2, 1.3]], 0.08), 0.42, SEAT, { bevel: 0.08 });
  m.profile([[-1.0, 1.32], [-1.6, 1.52], [-1.68, 1.44], [-1.1, 1.22]], 0.3, PAINT(0.9), { bevel: 0.05 });
  // forks, bars, headlight
  for (const s of [-1, 1]) m.box(1.0, 1.0, s * 0.16, 0.07, 1.1, 0.07, CHROME, rz(0.42));
  m.box(0.82, 1.62, 0, 0.06, 0.06, 0.9, 0x1b1c1e);
  for (const s of [-1, 1]) m.box(0.8, 1.64, s * 0.48, 0.1, 0.1, 0.14, 0x1b1c1e);
  m.profile(rounded([[0.9, 1.25], [1.2, 1.3], [1.15, 1.6], [0.86, 1.55]], 0.06), 0.4, PAINT(0.92), { bevel: 0.06 }); // fairing
  m.cyl(1.17, 1.42, 0, 0.13, 0.13, 0.06, 'x', CHROME, 14);
  lights.cyl(1.21, 1.42, 0, 0.11, 0.11, 0.03, 'x', 0xfff3d0, 14);
  lights.box(-1.7, 1.46, 0, 0.04, 0.08, 0.2, 0xb01818);
  // exhausts
  for (const s of [-1, 1]) m.cyl(-0.85, 0.66, s * 0.3, 0.09, 0.07, 1.0, 'x', CHROME, 10);
  m.box(-0.25, 0.42, 0, 0.5, 0.06, 0.06, CHROME);
  const body = m.build('bike');
  body.add(lights.build('bike.lights'));
  body.userData = { kind: 'vehicle', length: 3.2, width: 1.0 };
  MODELS.push(body);
}

// An army transport helicopter (rotors are separate: the game spins them). Nose along +x, 13 long.
{
  const m = new Model(), lights = new Model();
  const OLIVE = PAINT(1), DOOR = 0x0b0d10, SKID = 0x24272b;
  // fuselage from the side: a rounded nose, the cabin, tapering into the boom
  m.profile(rounded([[3.2, 1.05], [3.0, 1.9], [1.8, 2.55], [-1.6, 2.65], [-2.6, 2.3], [-2.9, 1.6], [-2.4, 0.75], [-1.5, 0.5], [2.4, 0.5]],
    [0.3, 0.4, 0.4, 0.3, 0.3, 0.2, 0.3, 0.2, 0.4]), 2.6, OLIVE, { bevel: 0.4 });
  m.profile(rounded([[-0.6, 2.62], [-0.4, 3.05], [-2.0, 3.0], [-2.3, 2.55]], 0.15), 1.5, PAINT(0.88), { bevel: 0.2 }); // engine housing
  m.cyl(-1.2, 3.2, 0, 0.16, 0.16, 0.5, 'y', 0x2a2c30, 10); // rotor mast
  m.cyl(-1.2, 3.45, 0, 0.4, 0.4, 0.14, 'y', 0x2a2c30, 12); // hub
  // tail boom, fin, tail rotor hub
  m.cyl(-5.4, 2.05, 0, 0.5, 0.22, 5.4, 'x', OLIVE, 12);
  m.profile(rounded([[-7.4, 1.9], [-7.8, 3.6], [-8.4, 3.7], [-8.3, 1.9]], 0.12), 0.18, PAINT(0.9), { bevel: 0.05 });
  m.profile([[-7.0, 2.0], [-8.3, 2.0], [-8.3, 2.25], [-7.2, 2.2]], 1.6, PAINT(0.9)); // stabiliser
  m.cyl(-8.0, 3.1, 0.2, 0.12, 0.12, 0.3, 'z', 0x2a2c30, 8);
  // glass: windscreen and the cockpit's side windows
  for (const sd of [-1, 1]) {
    m.decal([[2.95, 1.25], [2.85, 1.85], [1.85, 2.42], [1.4, 2.42], [1.4, 1.3]], sd * 1.301, GLASS);
    m.decal([[-1.9, 1.0], [-1.9, 2.3], [-0.2, 2.3], [-0.2, 1.0]], sd * 1.302, DOOR); // the open side door
    m.box(-1.05, 2.38, sd * 1.32, 1.9, 0.06, 0.06, 0x3a3d40); // door rail
    for (const x of [-1.6, -1.05, -0.5]) m.box(x, 1.55, sd * 0.9, 0.4, 0.5, 0.5, 0x3a3f33); // seats, seen through the door
  }
  m.add(new BoxGeometry(0.9, 0.03, 2.0), GLASS, at(2.55, 2.2, 0, rz(-0.55)));
  m.box(1.0, 0.45, 0, 1.0, 0.08, 1.6, 0x1c1e21); // belly antenna plate
  // skids
  for (const sd of [-1, 1]) {
    m.cyl(0.1, 0.12, sd * 1.5, 0.08, 0.08, 5.0, 'x', SKID, 8);
    m.cyl(2.65, 0.25, sd * 1.5, 0.08, 0.08, 0.4, 'x', SKID, 8);
    for (const x of [-1.4, 1.4]) m.box(x, 0.38, sd * 1.32, 0.12, 0.6, 0.12, SKID, { x: sd * 0.5, y: 0, z: 0, order: 'XYZ', isEuler: true });
  }
  // markings: a white star in a roundel on the boom, an ID number
  for (const sd of [-1, 1]) m.box(-4.4, 2.05, sd * 0.42, 0.7, 0.5, 0.02, 0xe8e6dc);
  lights.box(-8.35, 3.75, 0, 0.16, 0.16, 0.16, 0xff2a2a); // the blinking tail light
  lights.box(3.18, 0.85, 0, 0.1, 0.18, 0.5, 0xfff3d0); // landing light
  const body = m.build('heli');
  body.add(lights.build('heli_lights'));
  body.userData = { kind: 'vehicle', finish: 0x46523f };
  MODELS.push(body);
}

// ---------------------------------------------------------------- weapons
// About 1.3x real size (so they read from the street camera), barrel along +x, the middle of the grip
// at the origin so the hand holds it. `muzzle` is where shots come out; `finish` the default finish.

const STEEL = 0x3e434a, STEEL_HI = 0x5d636c, BLUED = 0x24272c, POLY = 0x26272a, WOOD = 0x7a4a26, WOOD_DARK = 0x5e381b, BRASS = 0xb08d3c;

function weapon(name, m, extras) {
  const mesh = m.build(name);
  mesh.userData = { kind: 'weapon', ...extras };
  MODELS.push(mesh);
}

{ // pistol: a polymer-frame service pistol (finish: the frame and grip)
  const m = new Model();
  m.profile(rounded([[0.33, 0.1], [0.33, 0.175], [-0.07, 0.175], [-0.09, 0.15], [-0.08, 0.1]], [0.008, 0.012, 0.01, 0.01, 0]), 0.06, BLUED, { bevel: 0.008 }); // slide
  for (let i = 0; i < 6; i++) m.box(-0.045 + i * 0.012, 0.14, 0, 0.005, 0.06, 0.064, 0x15171a); // serrations
  m.box(0.21, 0.16, 0, 0.11, 0.024, 0.065, 0x15171a); // ejection port
  m.box(0.31, 0.185, 0, 0.012, 0.016, 0.012, 0x101010); // front sight
  m.box(-0.06, 0.185, 0, 0.016, 0.018, 0.04, 0x101010); // rear sight
  m.cyl(0.335, 0.135, 0, 0.012, 0.012, 0.01, 'x', 0x050505, 8); // muzzle bore
  const frame = rounded([[0.3, 0.1], [0.3, 0.07], [0.13, 0.065], [0.11, 0.02], [0.05, -0.015], [0.0, 0.02], [0.03, 0.06],
    [0.02, 0.065], [-0.03, -0.17], [-0.12, -0.17], [-0.08, 0.06], [-0.08, 0.1]], [0, 0.01, 0.01, 0.03, 0.03, 0.02, 0, 0.01, 0.012, 0.015, 0.02, 0]);
  m.profile(frame, 0.054, PAINT(1), { bevel: 0.01, holes: [rounded([[0.1, 0.055], [0.085, 0.02], [0.045, 0.005], [0.03, 0.045]], 0.008)] }); // frame, guard, grip
  for (let i = 0; i < 5; i++) m.box(-0.06 - i * 0.004, -0.03 - i * 0.026, 0, 0.07, 0.006, 0.058, PAINT(0.75), rz(0.25)); // grip texture
  m.box(0.065, 0.035, 0, 0.012, 0.035, 0.012, 0x101010, rz(0.3)); // trigger
  m.box(-0.085, -0.17, 0, 0.1, 0.016, 0.05, 0x101010); // magazine base
  weapon('pistol', m, { muzzle: [0.34, 0.135, 0], finish: POLY });
}

{ // shotgun: a pump action, wood furniture (finish: stock and pump)
  const m = new Model();
  m.profile(rounded([[0.28, 0.2], [0.28, 0.04], [0.06, 0.03], [-0.13, 0.04], [-0.13, 0.17], [-0.05, 0.2]], [0.01, 0.01, 0, 0.01, 0.02, 0.01]), 0.072, BLUED, { bevel: 0.008 }); // receiver
  m.box(0.12, 0.14, 0.037, 0.12, 0.05, 0.004, 0x0d0e10); // ejection port
  m.cyl(0.79, 0.16, 0, 0.032, 0.032, 1.04, 'x', STEEL, 12); // barrel
  m.cyl(0.66, 0.085, 0, 0.03, 0.03, 0.78, 'x', STEEL, 12); // magazine tube
  m.cyl(1.05, 0.085, 0, 0.034, 0.034, 0.04, 'x', STEEL_HI, 12); // tube cap
  m.box(1.25, 0.2, 0, 0.02, 0.02, 0.02, BRASS); // bead sight
  m.box(1.0, 0.125, 0, 0.04, 0.05, 0.03, STEEL); // barrel clamp
  m.cyl(0.6, 0.095, 0, 0.055, 0.055, 0.34, 'x', PAINT(1), 12); // pump
  for (let i = 0; i < 7; i++) m.cyl(0.47 + i * 0.044, 0.095, 0, 0.058, 0.058, 0.014, 'x', PAINT(0.72), 12);
  m.profile(rounded([[0.08, 0.04], [0.06, -0.01], [0.0, -0.02], [-0.02, 0.03]], 0.008), 0.03, BLUED, { holes: [[[0.055, 0.03], [0.045, 0.0], [0.01, -0.005], [0.005, 0.03]]] }); // trigger guard
  // stock with a grip wrist and a rubber butt pad
  m.profile(rounded([[-0.12, 0.17], [-0.12, 0.04], [-0.06, -0.05], [-0.08, -0.12], [-0.17, -0.04], [-0.6, -0.04], [-0.72, -0.08], [-0.74, 0.16], [-0.42, 0.15]],
    [0, 0.01, 0.03, 0.03, 0.06, 0.05, 0.01, 0.01, 0.06]), 0.078, PAINT(1), { bevel: 0.016 });
  m.box(-0.76, 0.04, 0, 0.04, 0.25, 0.078, 0x111111, rz(0.08));
  weapon('shotgun', m, { muzzle: [1.31, 0.16, 0], finish: WOOD });
}

{ // rifle: a wood-furniture assault rifle with a curved magazine (finish: handguard, grip, stock)
  const m = new Model();
  m.profile(rounded([[0.48, 0.2], [0.48, 0.03], [-0.15, 0.03], [-0.16, 0.18], [-0.08, 0.21]], [0.01, 0.01, 0.01, 0.02, 0.01]), 0.08, STEEL, { bevel: 0.008 }); // receiver
  m.profile(rounded([[0.46, 0.22], [0.46, 0.2], [-0.12, 0.2], [-0.14, 0.22], [-0.08, 0.235]], 0.01), 0.066, STEEL_HI, { bevel: 0.006 }); // dust cover
  m.box(0.3, 0.17, 0.041, 0.1, 0.03, 0.004, 0x0d0e10); // ejection port
  m.box(0.34, 0.14, 0.045, 0.14, 0.022, 0.01, STEEL_HI); // charging handle
  m.profile(rounded([[0.86, 0.17], [0.86, 0.04], [0.47, 0.02], [0.47, 0.18]], 0.02), 0.094, PAINT(1), { bevel: 0.014 }); // handguard
  m.cyl(0.67, 0.215, 0, 0.026, 0.026, 0.4, 'x', PAINT(0.9), 10); // upper handguard over the gas tube
  m.cyl(1.12, 0.12, 0, 0.022, 0.022, 0.56, 'x', BLUED, 10); // barrel
  m.cyl(1.38, 0.12, 0, 0.032, 0.03, 0.08, 'x', BLUED, 10); // muzzle brake
  m.box(1.25, 0.18, 0, 0.03, 0.1, 0.02, BLUED); // front sight post
  m.cyl(0.98, 0.2, 0, 0.018, 0.018, 0.25, 'x', BLUED, 8); // gas block
  m.box(0.38, 0.235, 0, 0.06, 0.03, 0.03, BLUED); // rear sight
  // curved magazine
  const mag = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8, a = 0.25 + t * 0.55; mag.push([0.2 + Math.sin(a) * 0.05 + t * 0.12, 0.03 - t * 0.34]); }
  const back = mag.map(([x, y]) => [x - 0.1, y + 0.012]).reverse();
  m.profile([...mag, ...back], 0.06, 0x2a2b2e, { bevel: 0.006 });
  for (let i = 1; i < 7; i++) { const [x, y] = mag[i]; m.box(x - 0.05, y, 0, 0.11, 0.008, 0.064, 0x1d1e20, rz(-0.35)); }
  m.profile(rounded([[0.06, 0.03], [0.04, -0.02], [-0.02, -0.03], [-0.04, 0.03]], 0.01), 0.03, BLUED, { holes: [[[0.035, 0.02], [0.025, -0.005], [-0.012, -0.012], [-0.025, 0.02]]] });
  m.profile(rounded([[0.0, 0.04], [0.02, 0.03], [-0.04, -0.2], [-0.12, -0.2], [-0.08, 0.04]], [0, 0.01, 0.015, 0.02, 0]), 0.066, PAINT(0.92), { bevel: 0.012 }); // pistol grip
  m.profile(rounded([[-0.15, 0.19], [-0.15, 0.04], [-0.3, 0.01], [-0.66, -0.06], [-0.68, 0.18], [-0.36, 0.19]], [0, 0.02, 0.06, 0.02, 0.02, 0.03]), 0.074, PAINT(1), { bevel: 0.016 }); // stock
  m.box(-0.69, 0.06, 0, 0.03, 0.25, 0.076, STEEL, rz(0.05)); // butt plate
  weapon('rifle', m, { muzzle: [1.43, 0.12, 0], finish: WOOD });
}

// Melee weapons are built along +y (out of the thumb side of the fist) with the grip at the origin.
{ // baton: a side-handle police baton (finish: the shaft)
  const m = new Model();
  m.cyl(0, 0.42, 0, 0.038, 0.038, 1.08, 'y', PAINT(1), 12);
  m.cyl(0, 0.97, 0, 0.042, 0.042, 0.03, 'y', 0x111111, 12);
  m.cyl(0, -0.12, 0, 0.044, 0.044, 0.04, 'y', 0x111111, 12);
  for (let i = 0; i < 10; i++) m.cyl(0, -0.08 + i * 0.022, 0, 0.041, 0.041, 0.008, 'y', 0x111111, 12); // grip rings
  m.cyl(0.1, 0.1, 0, 0.032, 0.032, 0.18, 'x', PAINT(0.9), 10);
  m.cyl(0.2, 0.1, 0, 0.036, 0.036, 0.02, 'x', 0x111111, 10);
  weapon('baton', m, { finish: 0x2c2d31 });
}

{ // bat: a turned ash bat (finish: the wood)
  const m = new Model();
  const prof = [[0, -0.17], [0.06, -0.17], [0.065, -0.15], [0.04, -0.13], [0.032, 0.0], [0.034, 0.3], [0.048, 0.6], [0.07, 0.9], [0.074, 1.2], [0.07, 1.3], [0.04, 1.33], [0, 1.335]];
  m.add(new LatheGeometry(prof.map(([a, b]) => new Vector2(a, b)), 14), PAINT(1));
  for (let i = 0; i < 6; i++) m.cyl(0, -0.1 + i * 0.03, 0, 0.037, 0.037, 0.018, 'y', 0x23211f, 12); // grip tape
  weapon('bat', m, { finish: 0xc8a26a });
}

{ // machete: a long steel blade with a darker spine, riveted grip (finish: the grip)
  const m = new Model();
  m.profile(rounded([[0.06, 0.24], [0.1, 0.6], [0.11, 0.95], [0.06, 1.12], [-0.035, 1.06], [-0.04, 0.24]], [0, 0.02, 0.06, 0.04, 0.02, 0]), 0.018, 0xc3c7cd, { bevel: 0.006 });
  m.profile([[-0.04, 0.26], [-0.035, 1.04], [-0.06, 1.04], [-0.065, 0.26]], 0.024, 0x6a6f76);
  m.box(0.04, 0.65, 0, 0.015, 0.7, 0.019, 0xe6e9ed); // the edge, polished
  m.box(0, 0.23, 0, 0.16, 0.035, 0.08, 0x2a2b2e); // guard
  m.profile(rounded([[0.04, 0.22], [0.045, -0.12], [0.02, -0.16], [-0.045, -0.15], [-0.04, 0.22]], 0.015), 0.06, PAINT(1), { bevel: 0.012 });
  for (const y of [-0.06, 0.06, 0.16]) m.cyl(0, y, 0, 0.012, 0.012, 0.066, 'z', BRASS, 8);
  weapon('machete', m, { finish: 0x1d1d1f });
}

// ---------------------------------------------------------------- write

const scene = new Scene();
for (const m of MODELS) {
  scene.add(m);
  const b = m.geometry.boundingBox;
  console.log(`${m.name.padEnd(8)} ${String(m.geometry.attributes.position.count).padStart(5)} verts  ${(b.max.x - b.min.x).toFixed(2)} x ${(b.max.y - b.min.y).toFixed(2)} x ${(b.max.z - b.min.z).toFixed(2)}`);
}
const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(glb));
console.log(`${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
