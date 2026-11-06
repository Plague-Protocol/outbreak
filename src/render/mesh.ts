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
