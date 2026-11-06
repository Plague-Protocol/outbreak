import {
  AlwaysStencilFunc, ReplaceStencilOp, AmbientLight, BoxGeometry, Color, CylinderGeometry, DirectionalLight, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, Object3D, OrthographicCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { MeshBuilder } from './mesh';
import { Actor, type CharacterAssets } from './characters';
import { currentTask, requiredDone, type GameState } from '../core/state';
import { TASK_RADIUS, SAFEHOUSE_RADIUS } from '../core/config';
import type { Vec2 } from '../core/types';

const VIEW_MIN_UNITS = Number(new URLSearchParams(location.search).get('zoom')) || 20; // visible world width/height on the shorter screen axis (?zoom= for debugging)
const CAM_DIST = 40;
const CAM_DIR = new Vector3(1, 1, 1).normalize();

export class GameView {
  readonly renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 1, 200);
  private city!: Mesh;
  private player: Actor;
  private zombies = new Map<number, Actor>();
  private pads: InstancedMesh;
  private beams: InstancedMesh;
  private target = new Vector3();
  private focus = new Vector3();
  private tmp = new Object3D();
  private colorTmp = new Color();
  private seed = -1;

  constructor(private container: HTMLElement, private assets: CharacterAssets) {
    const dprCap = Number(new URLSearchParams(location.search).get('dpr')) || 2;
    this.renderer = new WebGLRenderer({ antialias: false, stencil: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
    this.renderer.setClearColor(0x111418);
    container.appendChild(this.renderer.domElement);

    this.scene.add(new AmbientLight(0xaab4c8, 1.6));
    const sun = new DirectionalLight(0xfff0dd, 2.2);
    sun.position.set(-6, 14, 9);
    this.scene.add(sun);

    this.player = new Actor(assets, 'humanMaleA', true);
    this.scene.add(this.player.root);

    // Task + safehouse markers: ground pad and tall beacon, instanced (max 6 tasks + safehouse)
    const markerMat = new MeshBasicMaterial();
    this.pads = new InstancedMesh(new CylinderGeometry(1, 1, 0.08, 14), markerMat, 8);
    this.beams = new InstancedMesh(new BoxGeometry(0.3, 9, 0.3), markerMat.clone(), 8);
    for (const m of [this.pads, this.beams]) { m.frustumCulled = false; m.count = 0; this.scene.add(m); }

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    const halfH = aspect >= 1 ? VIEW_MIN_UNITS / 2 : VIEW_MIN_UNITS / 2 / aspect;
    const halfW = halfH * aspect;
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    this.camera.updateProjectionMatrix();
  }

  private buildCity(s: GameState): void {
    if (this.city) {
      this.scene.remove(this.city);
      this.city.geometry.dispose();
    }
    const m = s.map;
    const b = new MeshBuilder().floor(0, 0, m.size, m.size, 0, 0x2a2e35);
    // sidewalk lots under each block
    for (const bl of m.buildings) {
      b.floor(bl.x - 0.6, bl.y - 0.6, bl.x + bl.w + 0.6, bl.y + bl.h + 0.6, 0.02, 0x3c424b);
    }
    for (const bl of m.buildings) {
      const base = new Color().setHSL(0.08 + bl.tone * 0.1, 0.12 + bl.tone * 0.1, 0.3 + bl.tone * 0.14);
      const roof = base.clone().offsetHSL(0, 0, 0.08);
      b.box(bl.x + bl.w / 2, bl.height / 2, bl.y + bl.h / 2, bl.w, bl.height, bl.h, base.getHex(), roof.getHex());
    }
    this.city = new Mesh(b.build(), new MeshLambertMaterial({
      vertexColors: true,
      stencilWrite: true, stencilRef: 1, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp, // mark building pixels for the x-ray pass
    }));
    this.scene.add(this.city);
  }

  /** Angle in screen space (radians, 0 = right, clockwise positive like CSS) from one world point to another. */
  screenAngle(from: Vec2, to: Vec2): number {
    const a = new Vector3(from.x, 0, from.y).project(this.camera);
    const b = new Vector3(to.x, 0, to.y).project(this.camera);
    return Math.atan2(-(b.y - a.y), b.x - a.x);
  }

  /** True if a world point is inside the current view (with margin in NDC units). */
  onScreen(p: Vec2, margin = 0.85): boolean {
    const v = new Vector3(p.x, 0, p.y).project(this.camera);
    return Math.abs(v.x) < margin && Math.abs(v.y) < margin;
  }

  render(s: GameState, dt: number, time: number): void {
    if (s.seed !== this.seed) {
      this.seed = s.seed;
      for (const a of this.zombies.values()) this.scene.remove(a.root);
      this.zombies.clear();
      this.buildCity(s);
      this.focus.set(s.player.pos.x, 0, s.player.pos.y);
    }

    // camera follows the player
    this.target.set(s.player.pos.x, 0, s.player.pos.y);
    this.focus.lerp(this.target, 1 - Math.exp(-8 * dt));
    this.camera.position.copy(this.focus).addScaledVector(CAM_DIR, CAM_DIST);
    this.camera.lookAt(this.focus);

    // characters (skinned, animated). Far-away zombies skip animation work.
    const p = s.player.pos;
    this.player.root.visible = s.phase !== 'lost' || s.lossReason !== 'caught';
    this.player.update(p.x, p.y, Math.PI / 2 - s.player.heading, dt, true);
    const alive = new Set<number>();
    for (const z of s.zombies) {
      alive.add(z.id);
      let a = this.zombies.get(z.id);
      if (!a) {
        a = new Actor(this.assets, z.id % 2 === 0 ? 'zombieMaleA' : 'zombieFemaleA');
        this.zombies.set(z.id, a);
        this.scene.add(a.root);
      }
      const near = Math.abs(z.pos.x - this.focus.x) + Math.abs(z.pos.y - this.focus.z) < 26;
      a.root.visible = near;
      a.update(z.pos.x, z.pos.y, Math.PI / 2 - z.heading, dt, near);
    }
    for (const [id, a] of this.zombies) {
      if (!alive.has(id)) { this.scene.remove(a.root); this.zombies.delete(id); }
    }

    this.updateMarkers(s, time);
    this.renderer.render(this.scene, this.camera);
  }

  private updateMarkers(s: GameState, time: number): void {
    const cur = currentTask(s);
    const n = s.tasks.length + 1;
    this.pads.count = n;
    this.beams.count = n;
    const m = new Matrix4();
    const set = (i: number, pos: Vec2, radius: number, color: number, beam: boolean, visible: boolean) => {
      const pulse = 1 + Math.sin(time * 4 + i) * 0.04;
      this.tmp.position.set(pos.x, 0.05, pos.y);
      this.tmp.scale.set(visible ? radius * pulse : 0, 1, visible ? radius * pulse : 0);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.updateMatrix();
      this.pads.setMatrixAt(i, this.tmp.matrix);
      this.colorTmp.setHex(color);
      this.pads.setColorAt(i, this.colorTmp);
      this.tmp.position.set(pos.x, 4.5, pos.y);
      this.tmp.scale.set(beam && visible ? 1 : 0, 1, beam && visible ? 1 : 0);
      this.tmp.updateMatrix();
      m.copy(this.tmp.matrix);
      this.beams.setMatrixAt(i, m);
      this.beams.setColorAt(i, this.colorTmp);
    };
    s.tasks.forEach((t, i) => {
      const isCur = cur === t;
      const color = t.done ? 0x555a63 : t.required ? 0xf2c230 : 0x4aa8f0;
      set(i, t.pos, TASK_RADIUS * 0.8, color, isCur, true);
    });
    const open = requiredDone(s);
    set(s.tasks.length, s.safehouse, SAFEHOUSE_RADIUS * 0.9, open ? 0x3ddc84 : 0xd9534f, s.safehouseKnown, s.safehouseKnown);
    this.tmp.scale.set(1, 1, 1);
    for (const mesh of [this.pads, this.beams]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
