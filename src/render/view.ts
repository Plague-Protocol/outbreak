import {
  AdditiveBlending, CanvasTexture, Color, CylinderGeometry, DirectionalLight, Fog, HemisphereLight, InstancedMesh,
  Mesh, MeshBasicMaterial, Object3D, type Material, PerspectiveCamera, PlaneGeometry, PointLight, RingGeometry, Scene, SpotLight,
  Vector3, WebGLRenderer,
} from 'three';
import { Actor, type CharacterAssets, type ClipName } from './characters';
import { buildCity, type CityMeshes } from './city';
import { MeshBuilder } from './mesh';
import { currentTask, playerSpeed, requiredDone, type GameState } from '../core/state';
import { ATTACK_WINDUP, SAFEHOUSE_RADIUS, TASK_RADIUS, ZOMBIE_CAP } from '../core/config';
import type { TaskId, Vec2, Zombie } from '../core/types';

const params = new URLSearchParams(location.search);
const VIEW_SPAN = Number(params.get('zoom')) || 24; // world units visible across the narrower screen axis
const FOV = 32;
const ELEVATION = (52 * Math.PI) / 180; // camera pitch: steeper than isometric so streets read
const YAW = Math.PI / 4; // fixed yaw (matches the control mapping)
const POOL_LIGHTS = Math.max(0, Math.min(6, Number(params.get('lights') ?? 3))); // real lights at nearby lamps/fires
const KNEEL_TASKS: TaskId[] = ['power', 'gate', 'fuel', 'medkit', 'rescue'];
const FOG = 0x06080c;

/** Soft dark blob for contact shadows (generated). */
function blobTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

export class GameView {
  readonly renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 1, 400);
  private city: CityMeshes | null = null;
  private player: Actor;
  private zombies = new Map<number, Actor>();
  private extras: Array<{ actor: Actor; task: TaskId }> = [];
  private taskProps: Mesh | null = null;
  private rings: InstancedMesh;
  private beams: InstancedMesh;
  private shadows: InstancedMesh;
  private flashlight: SpotLight;
  private pool: PointLight[] = [];
  private fill = new PointLight(0x9fb6ff, 6, 7, 1.5);
  private focus = new Vector3();
  private target = new Vector3();
  private tmp = new Object3D();
  private colorTmp = new Color();
  private seed = -1;
  private distance = 40;
  private shakeAmt = 0;
  private time = 0;
  private wasCaught = false;
  /** 0 = wide establishing shot, 1 = gameplay camera. Driven by the intro. */
  cinematic = 1;

  constructor(private container: HTMLElement, private assets: CharacterAssets) {
    const dprCap = Number(params.get('dpr')) || 2;
    this.renderer = new WebGLRenderer({ antialias: false, stencil: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
    this.renderer.setClearColor(FOG);
    container.appendChild(this.renderer.domElement);
    this.scene.fog = new Fog(FOG, 30, 80);

    // night: cold sky fill, a weak moon, the flashlight does the real work
    this.scene.add(new HemisphereLight(0x2c3a58, 0x0b0907, 1.1));
    const moon = new DirectionalLight(0x8ea6ff, 0.55);
    moon.position.set(-30, 60, 20);
    this.scene.add(moon);
    this.flashlight = new SpotLight(0xffe9c4, 70, 26, 0.5, 0.55, 1.4);
    this.scene.add(this.flashlight, this.flashlight.target, this.fill);
    for (let i = 0; i < POOL_LIGHTS; i++) {
      const l = new PointLight(0xffcf8a, 0, 16, 1.6);
      this.pool.push(l);
      this.scene.add(l);
    }

    this.player = new Actor(assets, 'humanMaleA', true);
    this.scene.add(this.player.root);

    // objective markers: a glowing ring on the ground and a faint shaft of light
    const ringMat = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.85 });
    this.rings = new InstancedMesh(new RingGeometry(0.82, 1, 32).rotateX(-Math.PI / 2), ringMat, 8);
    const beamMat = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.18 });
    this.beams = new InstancedMesh(new CylinderGeometry(0.5, 0.9, 14, 12, 1, true).translate(0, 7, 0), beamMat, 8);
    this.shadows = new InstancedMesh(
      new PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
      ZOMBIE_CAP + 8,
    );
    for (const m of [this.rings, this.beams, this.shadows]) { m.frustumCulled = false; m.count = 0; this.scene.add(m); }
    this.shadows.renderOrder = 1;

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // distance so the narrower axis shows VIEW_SPAN units at the focus point
    const tanV = Math.tan(((FOV / 2) * Math.PI) / 180);
    this.distance = aspect < 1 ? VIEW_SPAN / (2 * tanV * aspect) : VIEW_SPAN / (2 * tanV);
  }

  /** Kick the camera (attacks, gate slams). */
  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  private rebuild(s: GameState): void {
    if (this.city) {
      for (const m of [this.city.solid, this.city.glow, this.city.pools]) { this.scene.remove(m); m.geometry.dispose(); }
    }
    this.city = buildCity(s.map, s.seed);
    this.scene.add(this.city.solid, this.city.glow, this.city.pools);
    for (const a of this.zombies.values()) { this.scene.remove(a.root); a.dispose(); }
    this.zombies.clear();
    for (const e of this.extras) { this.scene.remove(e.actor.root); e.actor.dispose(); }
    this.extras = [];
    if (this.taskProps) { this.scene.remove(this.taskProps); this.taskProps.geometry.dispose(); }
    this.taskProps = this.buildTaskProps(s);
    this.scene.add(this.taskProps);
    this.wasCaught = false;
    this.player.play('Idle', { fade: 0 });
  }

  /** Small story props at each objective, plus people: the dead orderly, the guard, the survivor. */
  private buildTaskProps(s: GameState): Mesh {
    const b = new MeshBuilder();
    const person = (task: TaskId, skin: 'humanMaleA' | 'humanFemaleA', clip: ClipName, at: Vec2, yaw: number, once: boolean) => {
      const a = new Actor(this.assets, skin);
      a.play(clip, { once, fade: 0, startAt: once ? 0.999 : 0 });
      a.update(at.x, at.y, Math.PI / 2 - yaw, 0.016, true);
      this.extras.push({ actor: a, task });
      this.scene.add(a.root);
    };
    for (const t of s.tasks) {
      const x = t.pos.x + 1.2, z = t.pos.y + 1.2;
      switch (t.id) {
        case 'map': // a crate with the map and a police beacon still flashing
          b.box(x, 0.4, z, 0.9, 0.8, 0.9, 0x5a4630).box(x, 0.82, z, 0.6, 0.04, 0.45, 0xd8d2bf);
          break;
        case 'key': person('key', 'humanFemaleA', 'Death', { x, y: z }, 0.7, true); break;
        case 'keycard': person('keycard', 'humanMaleA', 'Death', { x, y: z }, 2.3, true); break;
        case 'power':
          b.box(x, 0.55, z, 1.4, 1.1, 0.9, 0x6b6f3a, 0x585c30).box(x + 0.5, 1.2, z, 0.15, 0.4, 0.15, 0x222222);
          break;
        case 'gate':
          for (const o of [-1.4, 1.4]) b.box(x + o, 1.3, z, 0.25, 2.6, 0.25, 0x40444a);
          for (let k = -6; k <= 6; k++) b.box(x + k * 0.2, 1.2, z, 0.05, 2.2, 0.05, 0x55595f);
          break;
        case 'radio':
          b.box(x, 0.5, z, 1.4, 1, 0.7, 0x3d2c22, 0x4a3628).box(x, 1.12, z, 0.5, 0.25, 0.25, 0x1b1d20);
          break;
        case 'fuel':
          b.box(x, 0.3, z, 0.45, 0.6, 0.25, 0xa52a1e).box(x + 0.6, 0.3, z + 0.1, 0.45, 0.6, 0.25, 0xa52a1e);
          break;
        case 'medkit':
          b.box(x, 0.2, z, 0.8, 0.4, 0.55, 0xe6e6e0).box(x, 0.41, z, 0.5, 0.02, 0.15, 0xc0262b).box(x, 0.41, z, 0.15, 0.02, 0.4, 0xc0262b);
          break;
        case 'rescue': person('rescue', 'humanFemaleA', 'Talk', { x, y: z }, -2.2, false); break;
      }
    }
    return new Mesh(b.build(), this.city!.solid.material as Material);
  }

  private screenPoint(p: Vec2): Vector3 {
    return new Vector3(p.x, 0, p.y).project(this.camera);
  }

  /** Angle in screen space (radians, 0 = right, clockwise positive like CSS) from one world point to another. */
  screenAngle(from: Vec2, to: Vec2): number {
    const a = this.screenPoint(from), b = this.screenPoint(to);
    return Math.atan2(-(b.y - a.y), b.x - a.x);
  }

  /** Horizontal screen position of a world point, -1 (left) to 1 (right). Used for stereo panning. */
  screenX(p: Vec2): number {
    return Math.max(-1, Math.min(1, this.screenPoint(p).x));
  }

  /** True if a world point is inside the current view (with margin in NDC units). */
  onScreen(p: Vec2, margin = 0.8): boolean {
    const v = this.screenPoint(p);
    return v.z < 1 && Math.abs(v.x) < margin && Math.abs(v.y) < margin;
  }

  render(s: GameState, dt: number): void {
    this.time += dt;
    if (s.seed !== this.seed) {
      this.seed = s.seed;
      this.rebuild(s);
      this.focus.set(s.player.pos.x, 0, s.player.pos.y);
    }
    const p = s.player.pos;

    // --- camera: follow with a little lead in the direction of travel, ease in from the intro shot
    const lead = 0.35;
    this.target.set(p.x + s.player.vel.x * lead, 0, p.y + s.player.vel.y * lead);
    this.focus.lerp(this.target, 1 - Math.exp(-5 * dt));
    const c = this.cinematic;
    const dist = this.distance * (1 + (1 - c) * 1.6);
    const elev = ELEVATION + (1 - c) * 0.35;
    const fog = this.scene.fog as Fog;
    fog.near = dist * 0.92;
    fog.far = dist * 1.75;
    const yaw = YAW + (1 - c) * 0.5;
    this.camera.position.set(
      this.focus.x + Math.cos(elev) * Math.cos(yaw) * dist,
      Math.sin(elev) * dist,
      this.focus.z + Math.cos(elev) * Math.sin(yaw) * dist,
    );
    if (this.shakeAmt > 0.001) {
      const k = this.shakeAmt;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
      this.shakeAmt *= Math.exp(-6 * dt);
    }
    this.camera.lookAt(this.focus.x, 1, this.focus.z);

    // --- player
    const caught = s.phase === 'lost' && s.lossReason === 'caught';
    if (caught && !this.wasCaught) { this.wasCaught = true; this.player.play('Death', { once: true, fade: 0.15 }); }
    else if (!caught) {
      const hold = s.hold.taskId;
      if (hold && playerSpeed(s) < 0.6) this.player.play(KNEEL_TASKS.includes(hold) ? 'Kneel' : 'Interact', { fade: 0.25 });
      else if (s.phase === 'won') this.player.play('Idle', { fade: 0.3 });
      else this.player.locomote(playerSpeed(s));
    }
    this.player.update(p.x, p.y, s.player.heading, dt, true);

    // flashlight from the chest, pointing where the player faces
    const yawP = this.player.root.rotation.y;
    const fx = Math.sin(yawP), fz = Math.cos(yawP);
    this.flashlight.position.set(p.x + fx * 0.4, 1.9, p.y + fz * 0.4);
    this.flashlight.target.position.set(p.x + fx * 9, 0, p.y + fz * 9);
    this.flashlight.intensity = caught ? 0 : 70 * (0.96 + Math.sin(this.time * 31) * 0.02);
    this.fill.position.set(p.x - fx * 0.8, 3, p.y - fz * 0.8);

    // --- zombies
    const alive = new Set<number>();
    let shadowN = 0;
    const shadowAt = (x: number, z: number, sc = 1) => {
      this.tmp.position.set(x, 0.04, z);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.scale.set(sc, 1, sc);
      this.tmp.updateMatrix();
      this.shadows.setMatrixAt(shadowN++, this.tmp.matrix);
    };
    if (!caught) shadowAt(p.x, p.y);
    for (const z of s.zombies) {
      alive.add(z.id);
      let a = this.zombies.get(z.id);
      if (!a) {
        a = new Actor(this.assets, z.id % 2 === 0 ? 'zombieMaleA' : 'zombieFemaleA');
        this.zombies.set(z.id, a);
        this.scene.add(a.root);
      }
      const near = Math.abs(z.pos.x - this.focus.x) + Math.abs(z.pos.y - this.focus.z) < this.distance * 0.9;
      a.root.visible = near;
      if (near) {
        this.animateZombie(a, z);
        shadowAt(z.pos.x, z.pos.y);
      }
      a.update(z.pos.x, z.pos.y, z.heading, dt, near);
    }
    for (const [id, a] of this.zombies) {
      if (!alive.has(id)) { this.scene.remove(a.root); a.dispose(); this.zombies.delete(id); }
    }
    for (const e of this.extras) {
      const t = s.tasks.find((x) => x.id === e.task);
      // the survivor locks herself in once helped
      e.actor.root.visible = !(e.task === 'rescue' && t?.done);
      if (e.actor.root.visible) shadowAt(e.actor.root.position.x, e.actor.root.position.z, e.task === 'rescue' ? 1 : 1.5);
      e.actor.update(e.actor.root.position.x, e.actor.root.position.z, Math.PI / 2 - e.actor.root.rotation.y, dt, e.task === 'rescue');
    }
    this.shadows.count = shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;

    this.updateLights();
    this.updateMarkers(s);
    this.renderer.render(this.scene, this.camera);
  }

  private animateZombie(a: Actor, z: Zombie): void {
    switch (z.action) {
      case 'rise': a.play('ZRise', { once: true, fade: 0 }); break;
      case 'idle': a.play('ZIdle', { fade: 0.3 }); break;
      case 'attack':
        // time the swing so it lands as the wind-up ends
        a.play('ZAttack', { once: true, fade: 0.08, timeScale: 0.75 / ATTACK_WINDUP[z.kind], restart: false });
        break;
      case 'feed': a.play('ZAttack', { fade: 0.2, timeScale: 0.8 }); break;
      default:
        if (z.kind === 'runner' && z.speed > 2) a.play('Sprint', { timeScale: a.rateFor('Sprint', z.speed), fade: 0.2 });
        else if (z.speed > 0.1) a.play('ZWalk', { timeScale: a.rateFor('ZWalk', z.speed), fade: 0.25 });
        else a.play('ZIdle', { fade: 0.3 });
    }
  }

  /** Move the few real lights to the light sources nearest the camera focus; flicker the broken ones. */
  private updateLights(): void {
    if (!this.city) return;
    const f = this.focus;
    const near = this.city.lights
      .map((l) => ({ l, d: (l.pos.x - f.x) ** 2 + (l.pos.z - f.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.pool.length);
    this.pool.forEach((light, i) => {
      const n = near[i];
      if (!n) { light.intensity = 0; return; }
      light.position.copy(n.l.pos);
      light.color.setHex(n.l.color);
      const t = this.time;
      let k = 1;
      if (n.l.kind === 'fire') k = 0.75 + Math.sin(t * 13 + i) * 0.12 + Math.sin(t * 29 + i * 3) * 0.1;
      else if (n.l.broken) k = Math.sin(t * 2.3 + i * 5) > 0.75 && Math.sin(t * 37) > 0 ? 0.1 : 1;
      light.intensity = (n.l.kind === 'fire' ? 30 : 45) * k;
    });
  }

  private updateMarkers(s: GameState): void {
    const cur = currentTask(s);
    const n = s.tasks.length + 1;
    this.rings.count = n;
    this.beams.count = n;
    const set = (i: number, pos: Vec2, radius: number, color: number, beam: boolean, visible: boolean) => {
      const pulse = 1 + Math.sin(this.time * 3 + i) * 0.06;
      const r = visible ? radius * pulse : 0;
      this.tmp.position.set(pos.x, 0.06, pos.y);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.scale.set(r, 1, r);
      this.tmp.updateMatrix();
      this.rings.setMatrixAt(i, this.tmp.matrix);
      this.rings.setColorAt(i, this.colorTmp.setHex(color));
      const bs = beam && visible ? radius * 0.6 : 0;
      this.tmp.scale.set(bs, 1, bs);
      this.tmp.updateMatrix();
      this.beams.setMatrixAt(i, this.tmp.matrix);
      this.beams.setColorAt(i, this.colorTmp);
    };
    s.tasks.forEach((t, i) => {
      const color = t.done ? 0x000000 : t.required ? 0xf2b630 : 0x3f9be6;
      set(i, t.pos, TASK_RADIUS, color, cur === t, !t.done);
    });
    const open = requiredDone(s);
    set(s.tasks.length, s.safehouse, SAFEHOUSE_RADIUS, open ? 0x3ddc84 : 0xd9534f, s.safehouseKnown, s.safehouseKnown);
    this.tmp.scale.set(1, 1, 1);
    for (const mesh of [this.rings, this.beams]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  get stats(): { cityTriangles: number; lights: number } {
    return { cityTriangles: this.city?.triangles ?? 0, lights: this.city?.lights.length ?? 0 };
  }
}

