import { BufferAttribute, BufferGeometry, Color } from 'three';

/** Accumulates flat-shaded, vertex-coloured boxes into one non-indexed geometry (one draw call). */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];

  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, side: number, top: number = side): this {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    // each face: 4 corners (CCW seen from outside), normal, color
    this.quad([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], [0, 1, 0], top);
    this.quad([x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], [0, -1, 0], side);
    this.quad([x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], [0, 0, 1], side);
    this.quad([x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0], [0, 0, -1], side);
    this.quad([x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1], [1, 0, 0], side);
    this.quad([x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], [-1, 0, 0], side);
    return this;
  }

  /** Flat horizontal quad on the ground plane. */
  floor(x0: number, z0: number, x1: number, z1: number, y: number, color: number): this {
    this.quad([x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0], [0, 1, 0], color);
    return this;
  }

  /** Upright n-sided prism (barrels, poles, water tanks). */
  prism(cx: number, cy: number, cz: number, r: number, h: number, sides: number, side: number, top: number = side): this {
    const y0 = cy - h / 2, y1 = cy + h / 2;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2, am = (a0 + a1) / 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      this.quad([x1, y0, z1, x0, y0, z0, x0, y1, z0, x1, y1, z1], [Math.cos(am), 0, Math.sin(am)], side);
      this.tri([cx, y1, cz, x1, y1, z1, x0, y1, z0], [0, 1, 0], top);
    }
    return this;
  }

  /** Flat irregular disc on the ground (blood, oil, rubble). `jitter` 0..1 roughens the edge. */
  disc(cx: number, cz: number, r: number, y: number, color: number, sides = 9, jitter = 0, seed = 1): this {
    let s = seed;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const pts: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2, rr = r * (1 - jitter * rnd());
      pts.push(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr);
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.tri([cx, y, cz, pts[j * 2]!, y, pts[j * 2 + 1]!, pts[i * 2]!, y, pts[i * 2 + 1]!], [0, 1, 0], color);
    }
    return this;
  }

  /** Vertical rectangle on a building face (windows, shutters, signs), facing +/-x or +/-z. */
  facade(face: 'x+' | 'x-' | 'z+' | 'z-', plane: number, a0: number, a1: number, y0: number, y1: number, color: number): this {
    switch (face) {
      case 'z+': this.quad([a0, y0, plane, a1, y0, plane, a1, y1, plane, a0, y1, plane], [0, 0, 1], color); break;
      case 'z-': this.quad([a1, y0, plane, a0, y0, plane, a0, y1, plane, a1, y1, plane], [0, 0, -1], color); break;
      case 'x+': this.quad([plane, y0, a1, plane, y0, a0, plane, y1, a0, plane, y1, a1], [1, 0, 0], color); break;
      case 'x-': this.quad([plane, y0, a0, plane, y0, a1, plane, y1, a1, plane, y1, a0], [-1, 0, 0], color); break;
    }
    return this;
  }

  /** Pitched roof sitting on a w x d footprint at height y0, ridge `h` above, ridge running along x or z. */
  gable(cx: number, cz: number, w: number, d: number, y0: number, h: number, alongX: boolean, roof: number, end: number): this {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    if (alongX) {
      const zm = cz;
      this.quad([x0, y0, z1, x1, y0, z1, x1, y1, zm, x0, y1, zm], [0, d / 2, h].map((v) => v / Math.hypot(d / 2, h)), roof);
      this.quad([x1, y0, z0, x0, y0, z0, x0, y1, zm, x1, y1, zm], [0, d / 2, -h].map((v) => v / Math.hypot(d / 2, h)), roof);
      this.tri([x1, y0, z1, x1, y0, z0, x1, y1, zm], [1, 0, 0], end);
      this.tri([x0, y0, z0, x0, y0, z1, x0, y1, zm], [-1, 0, 0], end);
    } else {
      const xm = cx;
      this.quad([x1, y0, z1, x1, y0, z0, xm, y1, z0, xm, y1, z1], [w / 2, h, 0].map((v) => v / Math.hypot(w / 2, h)), roof);
      this.quad([x0, y0, z0, x0, y0, z1, xm, y1, z1, xm, y1, z0], [-w / 2, h, 0].map((v) => v / Math.hypot(w / 2, h)), roof);
      this.tri([x0, y0, z1, x1, y0, z1, xm, y1, z1], [0, 0, 1], end);
      this.tri([x1, y0, z0, x0, y0, z0, xm, y1, z0], [0, 0, -1], end);
    }
    return this;
  }

  /** Vertex count so far; pass it to `tiltZ` to tilt everything added after it. */
  mark(): number {
    return this.pos.length / 3;
  }

  /** Rotate the vertices added since `from` about the z axis through (px, py) (gun grips, magazines). */
  tiltZ(from: number, angle: number, px: number, py: number): this {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let i = from * 3; i < this.pos.length; i += 3) {
      const x = this.pos[i]! - px, y = this.pos[i + 1]! - py;
      this.pos[i] = px + x * c - y * s;
      this.pos[i + 1] = py + x * s + y * c;
      const nx = this.nor[i]!, ny = this.nor[i + 1]!;
      this.nor[i] = nx * c - ny * s;
      this.nor[i + 1] = nx * s + ny * c;
    }
    return this;
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  private tri(v: number[], n: number[], color: number): void {
    const c = new Color(color);
    for (let i = 0; i < 3; i++) {
      this.pos.push(v[i * 3]!, v[i * 3 + 1]!, v[i * 3 + 2]!);
      this.nor.push(n[0]!, n[1]!, n[2]!);
      this.col.push(c.r, c.g, c.b);
    }
  }

  private quad(v: number[], n: number[], color: number): void {
    const c = new Color(color);
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(v[i * 3]!, v[i * 3 + 1]!, v[i * 3 + 2]!);
      this.nor.push(n[0]!, n[1]!, n[2]!);
      this.col.push(c.r, c.g, c.b);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.computeBoundingSphere();
    return g;
  }
}
