import {
  AmbientLight, BoxGeometry, Color, CylinderGeometry, DirectionalLight, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, Object3D, OrthographicCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { MeshBuilder } from './mesh';
import { currentTask, requiredDone, type GameState } from '../core/state';
import { TASK_RADIUS, SAFEHOUSE_RADIUS, ZOMBIE_CAP } from '../core/config';
import type { Vec2 } from '../core/types';

const VIEW_MIN_UNITS = 20; // visible world width/height on the shorter screen axis
const CAM_DIST = 40;
const CAM_DIR = new Vector3(1, 1, 1).normalize();

export class GameView {
  readonly renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 1, 200);
  private city!: Mesh;
  private player: Mesh;
  private zombies: InstancedMesh;
  private pads: InstancedMesh;
  private beams: InstancedMesh;
  private target = new Vector3();
  private focus = new Vector3();
  private tmp = new Object3D();
  private colorTmp = new Color();
  private seed = -1;

  constructor(private container: HTMLElement) {
    const dprCap = Number(new URLSearchParams(location.search).get('dpr')) || 2;
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
    this.renderer.setClearColor(0x111418);
    container.appendChild(this.renderer.domElement);

    this.scene.add(new AmbientLight(0xaab4c8, 1.6));
    const sun = new DirectionalLight(0xfff0dd, 2.2);
    sun.position.set(-6, 14, 9);
    this.scene.add(sun);

    // Player: body + head + visor, one merged mesh
    const pg = new MeshBuilder()
      .box(0, 0.55, 0, 0.7, 1.1, 0.5, 0x3d7bd9)
      .box(0, 1.35, 0, 0.5, 0.5, 0.5, 0xe8c9a0)
      .box(0, 1.4, 0.26, 0.4, 0.18, 0.04, 0x1b1f27)
      .build();
    this.player = new Mesh(pg, new MeshLambertMaterial({ vertexColors: true }));
    this.scene.add(this.player);

    // Zombies: instanced, one draw call. Arms out front (+z is forward).
    const zg = new MeshBuilder()
      .box(0, 0.55, 0, 0.7, 1.1, 0.5, 0x59703a)
      .box(0, 1.3, 0.04, 0.5, 0.5, 0.5, 0x8aa35a)
      .box(-0.45, 0.95, 0.4, 0.18, 0.18, 0.8, 0x8aa35a)
      .box(0.45, 0.95, 0.4, 0.18, 0.18, 0.8, 0x8aa35a)
      .build();
    this.zombies = new InstancedMesh(zg, new MeshLambertMaterial({ vertexColors: true }), ZOMBIE_CAP);
    this.zombies.frustumCulled = false;
    this.zombies.count = 0;
    this.scene.add(this.zombies);

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
    this.city = new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true }));
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
      this.buildCity(s);
      this.focus.set(s.player.pos.x, 0, s.player.pos.y);
    }

    // camera follows the player
    this.target.set(s.player.pos.x, 0, s.player.pos.y);
    this.focus.lerp(this.target, 1 - Math.exp(-8 * dt));
    this.camera.position.copy(this.focus).addScaledVector(CAM_DIR, CAM_DIST);
    this.camera.lookAt(this.focus);

    // player (bob while running)
    const p = s.player.pos;
    this.player.position.set(p.x, Math.abs(Math.sin(time * 12)) * 0.05, p.y);
    this.player.rotation.y = Math.PI / 2 - s.player.heading;
    this.player.visible = s.phase !== 'lost' || s.lossReason !== 'caught';

    // zombies
    const zs = s.zombies;
    this.zombies.count = zs.length;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i]!;
      this.tmp.position.set(z.pos.x, Math.abs(Math.sin(time * 7 + z.id)) * 0.08, z.pos.y);
      this.tmp.rotation.set(0.12, Math.PI / 2 - z.heading, 0);
      this.tmp.updateMatrix();
      this.zombies.setMatrixAt(i, this.tmp.matrix);
    }
    this.zombies.instanceMatrix.needsUpdate = true;

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
