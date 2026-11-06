import {
  AdditiveBlending, CanvasTexture, Color, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, InstancedMesh,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PerspectiveCamera, PlaneGeometry, PointLight, RingGeometry, Scene, SpotLight,
  Vector3, WebGLRenderer, type Material,
} from 'three';
import { Actor, type CharacterAssets, type ClipName } from './characters';
import { buildCity, type CityMeshes, type LightSource } from './city';
import { MeshBuilder } from './mesh';
import { Effects, Evac, gunMesh, pickupMesh, pulseGlint, storeMesh, storyItem, vehicleMesh, wreckVehicle } from './props';
import { currentTask, playerSpeed, playerVehicle, requiredDone, type GameState } from '../core/state';
import { ATTACK_WINDUP, SAFEHOUSE_RADIUS, TASK_RADIUS, WEAPONS } from '../core/config';
import type { GameEvent, TaskId, Vec2, WeaponKind, Zombie } from '../core/types';

const params = new URLSearchParams(location.search);
const VIEW_SPAN = Number(params.get('zoom')) || 24; // world units visible across the narrower screen axis
const FOV = 32;
const ELEVATION = (52 * Math.PI) / 180; // camera pitch: steeper than isometric so streets read
const YAW = Math.PI / 4; // fixed yaw (matches the control mapping)
const POOL_LIGHTS = Math.max(0, Math.min(6, Number(params.get('lights') ?? 3))); // real lights at nearby lamps/fires
const KNEEL_TASKS: TaskId[] = ['power', 'gate', 'fuel', 'medkit', 'rescue'];
const FOG = 0x06080c;
const MAX_VISIBLE_ZOMBIES = 12; // nearest ones get a skinned character; the rest are off screen anyway

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
  private camera = new PerspectiveCamera(FOV, 1, 1, 600);
  private city: CityMeshes | null = null;
  private lightSources: LightSource[] = [];
  private player: Actor;
  private gun: Mesh | null = null;
  private gunKind: WeaponKind | null = null;
  private zombies = new Map<number, Actor>();
  private actorPool: Actor[] = [];
  private extras: Array<{ actor: Actor; task: TaskId }> = [];
  /** Objective props that change with the task: items you take vanish, the gate swings open. */
  private taskItems: Array<{ group: Group; task: TaskId; whenDone: boolean }> = [];
  private level = new Group(); // everything rebuilt per night
  private vehicles = new Map<number, { group: Group; wrecked: boolean }>();
  private pickups = new Map<number, Group>();
  private crates: InstancedMesh | null = null;
  private evac = new Evac();
  private effects: Effects;
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
  private zoom = 1;
  private shakeAmt = 0;
  private time = 0;
  private wasCaught = false;
  private lastShot = -10;
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
    this.scene.add(new HemisphereLight(0x3a4a6c, 0x14100c, 1.9));
    const moon = new DirectionalLight(0x9fb4ff, 1.0);
    moon.position.set(-30, 60, 20);
    this.scene.add(moon);
    this.flashlight = new SpotLight(0xffe9c4, 70, 26, 0.5, 0.55, 1.4);
    this.scene.add(this.flashlight, this.flashlight.target, this.fill);
    for (let i = 0; i < POOL_LIGHTS; i++) {
      const l = new PointLight(0xffcf8a, 0, 18, 1.6);
      this.pool.push(l);
      this.scene.add(l);
    }

    this.player = new Actor(assets, 'humanMaleA', true);
    this.scene.add(this.player.root, this.level, this.evac.group);
    this.effects = new Effects(this.scene);

    // objective markers: a glowing ring on the ground and a faint shaft of light
    const ringMat = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.85 });
    this.rings = new InstancedMesh(new RingGeometry(0.82, 1, 32).rotateX(-Math.PI / 2), ringMat, 8);
    const beamMat = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.18 });
    this.beams = new InstancedMesh(new CylinderGeometry(0.5, 0.9, 14, 12, 1, true).translate(0, 7, 0), beamMat, 8);
    this.shadows = new InstancedMesh(
      new PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
      MAX_VISIBLE_ZOMBIES + 10,
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

  /** Kick the camera (attacks, crashes, gunfire). */
  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  private rebuild(s: GameState): void {
    if (this.city) {
      this.scene.remove(this.city.group, this.city.pools);
      this.city.group.traverse((o) => { if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose(); });
    }
    this.city = buildCity(s.map, s.seed);
    this.scene.add(this.city.group, this.city.pools);
    this.lightSources = this.city.lights.slice();
    this.lightSources.push({ pos: new Vector3(s.store.pos.x - 1.6, 5.3, s.store.pos.y), color: 0xff3b3b, kind: 'lamp', broken: false });

    for (const a of this.zombies.values()) { this.scene.remove(a.root); this.actorPool.push(a); }
    this.zombies.clear();
    for (const e of this.extras) { this.scene.remove(e.actor.root); e.actor.dispose(); }
    this.extras = [];
    this.taskItems = [];
    this.scene.remove(this.level);
    this.level = new Group();
    this.scene.add(this.level);
    this.vehicles.clear();
    this.pickups.clear();

    for (const v of s.vehicles) {
      const g = vehicleMesh(v);
      this.level.add(g);
      this.vehicles.set(v.id, { group: g, wrecked: false });
    }
    for (const p of s.pickups) {
      const g = pickupMesh(p.kind, p.id * 2.4);
      g.position.set(p.pos.x, this.groundAt(s, p.pos), p.pos.y);
      this.level.add(g);
      this.pickups.set(p.id, g);
    }
    const store = storeMesh();
    store.position.set(s.store.pos.x, 0.15, s.store.pos.y);
    this.level.add(store);
    // supply crates: olive boxes with a white stencil; opened ones sag open
    const cb = new MeshBuilder().box(0, 0.45, 0, 1.1, 0.9, 0.8, 0x4a5233, 0x56603c).box(0, 0.91, 0, 0.5, 0.02, 0.12, 0xd8d3c8).box(0, 0.91, 0, 0.12, 0.02, 0.5, 0xd8d3c8);
    this.crates = new InstancedMesh(cb.build(), this.city.group.children[0] ? ((this.city.group.children[0] as Mesh).material as Material) : new MeshBasicMaterial(), s.crates.length || 1);
    this.crates.frustumCulled = false;
    this.level.add(this.crates);
    this.level.add(this.buildTaskProps(s));
    this.evac.group.position.set(s.safehouse.x, 0.1, s.safehouse.y);
    this.evac.reset();
    this.wasCaught = false;
    this.player.play('Idle', { fade: 0 });
    this.player.setUpper(null);
  }

  /**
   * Story props at each objective. Things you take (keys, keycard, map, supplies) lie where you
   * can see them and vanish once taken; the fallen carry them; the generator and gate change state.
   */
  private buildTaskProps(s: GameState): Group {
    const out = new Group();
    const b = new MeshBuilder(); // static scenery, merged into one mesh
    const person = (task: TaskId, skin: 'humanMaleA' | 'humanFemaleA', clip: ClipName, at: Vec2, yaw: number, once: boolean) => {
      const a = new Actor(this.assets, skin);
      a.play(clip, { once, fade: 0, startAt: once ? 0.999 : 0 });
      a.update(at.x, at.y, Math.PI / 2 - yaw, 0.016, true);
      this.extras.push({ actor: a, task });
      this.scene.add(a.root);
    };
    const add = (task: TaskId, obj: Object3D, x: number, z: number, yaw: number, whenDone = false) => {
      const g = obj instanceof Group ? obj : new Group().add(obj);
      g.position.set(x, this.groundAt(s, { x, y: z }), z);
      g.rotation.y = yaw;
      out.add(g);
      this.taskItems.push({ group: g, task, whenDone });
    };
    const basic = (mb: MeshBuilder) => new Mesh(mb.build(), new MeshBasicMaterial({ vertexColors: true }));
    for (const t of s.tasks) {
      const x = t.pos.x + 1.4, z = t.pos.y + 1.4;
      const gy = this.groundAt(s, { x, y: z });
      switch (t.id) {
        case 'map':
          b.box(x, gy + 0.4, z, 0.9, 0.8, 0.9, 0x5a4630, 0x6a5238); // the crate the map lies on
          add('map', storyItem('map'), x, z, 0.4);
          break;
        case 'key': // the fallen woman, her keys dropped by her hand
          person('key', 'humanFemaleA', 'Death', { x, y: z }, 0.7, true);
          add('key', storyItem('key'), t.pos.x + 0.5, t.pos.y + 0.4, 1.1);
          break;
        case 'keycard': // the fallen soldier, his keycard on its lanyard beside him
          person('keycard', 'humanMaleA', 'Death', { x, y: z }, 2.3, true);
          add('keycard', storyItem('keycard'), t.pos.x + 0.5, t.pos.y + 0.3, -0.5);
          break;
        case 'power': { // generator; its lamp goes from dead red to running green
          b.box(x, gy + 0.55, z, 1.4, 1.1, 0.9, 0x6b6f3a, 0x585c30).box(x + 0.5, gy + 1.2, z, 0.15, 0.4, 0.15, 0x222222);
          b.box(x - 0.3, gy + 0.6, z + 0.46, 0.5, 0.35, 0.02, 0x2a2b2e);
          add('power', basic(new MeshBuilder().box(0, 0, 0, 0.12, 0.12, 0.12, 0x7a1010)), x - 0.45, z + 0.47, 0);
          this.taskItems[this.taskItems.length - 1]!.group.position.y = gy + 0.95;
          add('power', basic(new MeshBuilder().box(0, 0, 0, 0.14, 0.14, 0.14, 0x40ff80)), x - 0.45, z + 0.47, 0, true);
          this.taskItems[this.taskItems.length - 1]!.group.position.y = gy + 0.95;
          break;
        }
        case 'gate': { // posts stay; the bars are shut until it opens, then stand swung aside
          for (const o of [-1.4, 1.4]) b.box(x + o, gy + 1.3, z, 0.25, 2.6, 0.25, 0x40444a);
          const bars = (open: boolean) => {
            const mb = new MeshBuilder();
            for (let k = 0; k <= 6; k++) mb.box(open ? 0.05 : k * 0.2, 1.2, open ? k * 0.2 : 0, 0.05, 2.2, 0.05, 0x55595f);
            mb.box(open ? 0.05 : 0.6, 2.2, open ? 0.6 : 0, open ? 0.05 : 1.25, 0.08, open ? 1.25 : 0.05, 0x55595f);
            return new Mesh(mb.build(), new MeshLambertMaterial({ vertexColors: true }));
          };
          add('gate', bars(false), x - 1.25, z, 0);
          add('gate', bars(false), x + 1.25, z, Math.PI);
          add('gate', bars(true), x - 1.25, z, 0, true);
          add('gate', bars(true), x + 1.25, z, Math.PI, true);
          break;
        }
        case 'radio':
          b.box(x, gy + 0.5, z, 1.4, 1, 0.7, 0x3d2c22, 0x4a3628).box(x, gy + 1.12, z, 0.5, 0.25, 0.25, 0x1b1d20);
          b.box(x + 0.15, gy + 1.5, z, 0.03, 0.6, 0.03, 0x9a9da3); // aerial
          break;
        case 'fuel': add('fuel', storyItem('fuel'), x, z, 0.3); break;
        case 'medkit': add('medkit', storyItem('medkit'), x, z, -0.4); break;
        case 'rescue': person('rescue', 'humanFemaleA', 'Talk', { x, y: z }, -2.2, false); break;
      }
    }
    if (b.triangles) out.add(new Mesh(b.build(), (this.city!.group.children[0] as Mesh).material as Material));
    return out;
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

  /** Visual reactions to this frame's events (tracers, blood, crashes). */
  react(s: GameState, events: readonly GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'shot': {
          this.lastShot = this.time;
          this.effects.shot(this.muzzle(s), new Vector3(e.to.x, 1.3, e.to.y));
          this.shake(e.weapon === 'shotgun' ? 0.25 : 0.08);
          this.player.setUpper('ShootUpper', { restart: true, timeScale: 1.6 });
          break;
        }
        case 'zombie-hurt': case 'zombie-killed': {
          const z = s.zombies.find((q) => q.id === e.id);
          if (z) this.effects.burst(new Vector3(z.pos.x, 1.4, z.pos.y), 0x7a0a0a, e.type === 'zombie-killed' ? 12 : 6, 4);
          break;
        }
        case 'vehicle-crash': {
          const v = s.vehicles.find((q) => q.id === e.id);
          if (v && e.force > 4) { this.effects.burst(new Vector3(v.pos.x, 1, v.pos.y), 0xffb040, 10, 6); this.shake(Math.min(1, e.force / 12)); }
          break;
        }
        case 'reload': this.player.setUpper('ReloadUpper', { timeScale: 1.667 / WEAPONS[e.weapon].reload }); break;
        default: break;
      }
    }
  }

  render(s: GameState, dt: number): void {
    this.time += dt;
    if (s.seed !== this.seed) {
      this.seed = s.seed;
      this.rebuild(s);
      this.focus.set(s.player.pos.x, 0, s.player.pos.y);
    }
    const p = s.player.pos;
    const car = playerVehicle(s);

    // --- camera: follow with a lead in the direction of travel; pull back when driving
    const lead = car ? 0.9 : 0.35;
    this.target.set(p.x + s.player.vel.x * lead, 0, p.y + s.player.vel.y * lead);
    this.focus.lerp(this.target, 1 - Math.exp(-5 * dt));
    this.zoom += ((car ? 1.55 + Math.min(0.5, Math.abs(car.speed) / 30) : 1) - this.zoom) * (1 - Math.exp(-2 * dt));
    const c = this.cinematic;
    const dist = this.distance * this.zoom * (1 + (1 - c) * 1.6);
    const elev = ELEVATION + (1 - c) * 0.35;
    const yaw = YAW + (1 - c) * 0.5;
    const fog = this.scene.fog as Fog;
    fog.near = dist * 0.92;
    fog.far = dist * 1.75;
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

    // --- player (hidden inside a vehicle)
    const caught = s.phase === 'lost' && s.lossReason === 'caught';
    this.player.root.visible = !car;
    if (caught && !this.wasCaught) { this.wasCaught = true; this.player.setUpper(null); this.player.play('Death', { once: true, fade: 0.15 }); }
    else if (!caught && !car) {
      const hold = s.hold.taskId;
      if (hold && playerSpeed(s) < 0.6) this.player.play(KNEEL_TASKS.includes(hold) ? 'Kneel' : 'Interact', { fade: 0.25 });
      else if (s.phase === 'won') this.player.play('Idle', { fade: 0.3 });
      else this.player.locomote(playerSpeed(s));
      // gun up while shooting or reloading, lowered otherwise
      const a = s.arsenal;
      if (hold) this.player.setUpper(null);
      else if (a.reloadT > 0) this.player.setUpper('ReloadUpper', { timeScale: 1.667 / WEAPONS[a.weapon ?? 'pistol'].reload });
      else if (this.time - this.lastShot < 1.2) { if (this.time - this.lastShot > 0.35) this.player.setUpper('AimUpper'); }
      else this.player.setUpper(null);
    }
    this.player.update(p.x, p.y, s.player.heading, dt, true);
    this.updateGun(s, !car && !caught && !s.hold.taskId);

    // flashlight from the chest (or headlights from the car), pointing where you face
    const yawP = car ? Math.PI / 2 - car.heading : this.player.yawAngle;
    const fx = Math.sin(yawP), fz = Math.cos(yawP);
    if (car) {
      this.flashlight.position.set(p.x + fx * 3.2, 1.1, p.y + fz * 3.2);
      this.flashlight.target.position.set(p.x + fx * 16, 0, p.y + fz * 16);
      this.flashlight.angle = 0.6;
    } else {
      this.flashlight.position.set(p.x + fx * 0.4, 1.9, p.y + fz * 0.4);
      this.flashlight.target.position.set(p.x + fx * 9, 0, p.y + fz * 9);
      this.flashlight.angle = 0.5;
    }
    this.flashlight.intensity = caught ? 0 : (car ? 110 : 70) * (0.96 + Math.sin(this.time * 31) * 0.02);
    this.fill.position.set(p.x - fx * 0.8, 3, p.y - fz * 0.8);

    // --- vehicles, pickups, crates
    for (const v of s.vehicles) {
      const r = this.vehicles.get(v.id);
      if (!r) continue;
      r.group.position.set(v.pos.x, 0, v.pos.y);
      r.group.rotation.y = -v.heading;
      if (v.wrecked && !r.wrecked) { r.wrecked = true; wreckVehicle(r.group); }
      (r.group.getObjectByName('lights') as Mesh).visible = !v.wrecked && v.id === s.player.vehicleId;
    }
    for (const pk of s.pickups) {
      const g = this.pickups.get(pk.id);
      if (!g) continue;
      g.visible = !pk.taken;
      if (g.visible) pulseGlint(g.getObjectByName('glint')!, this.time, pk.id * 0.37);
    }
    for (const it of this.taskItems) {
      const done = !!s.tasks.find((t) => t.id === it.task)?.done;
      it.group.visible = it.whenDone ? done : !done;
      const gl = it.group.getObjectByName('glint');
      if (gl && it.group.visible) pulseGlint(gl, this.time, it.group.position.x * 0.13);
    }
    if (this.crates) {
      s.crates.forEach((cr, i) => {
        this.tmp.position.set(cr.pos.x, 0.15, cr.pos.y);
        this.tmp.rotation.set(0, cr.id, cr.opened ? 0.25 : 0);
        this.tmp.scale.set(1, cr.opened ? 0.45 : 1, 1);
        this.tmp.updateMatrix();
        this.crates!.setMatrixAt(i, this.tmp.matrix);
      });
      this.crates.count = s.crates.length;
      this.crates.instanceMatrix.needsUpdate = true;
    }
    this.evac.group.visible = s.safehouseKnown;
    this.evac.update(dt, this.time, s.phase === 'won');

    // --- zombies: the nearest ones get a character; corpses fall and stay a while
    let shadowN = 0;
    const shadowAt = (x: number, z: number, sc = 1) => {
      if (shadowN >= this.shadows.instanceMatrix.count) return;
      this.tmp.position.set(x, 0.2, z);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.scale.set(sc, 1, sc);
      this.tmp.updateMatrix();
      this.shadows.setMatrixAt(shadowN++, this.tmp.matrix);
    };
    if (!caught && !car) shadowAt(p.x, p.y);
    const reach = this.distance * this.zoom * 0.9;
    const visible = s.zombies
      .map((z) => ({ z, d: Math.abs(z.pos.x - this.focus.x) + Math.abs(z.pos.y - this.focus.z) }))
      .filter((q) => q.d < reach)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_VISIBLE_ZOMBIES);
    const keep = new Set(visible.map((q) => q.z.id));
    for (const [id, a] of this.zombies) {
      if (!keep.has(id)) { this.scene.remove(a.root); this.zombies.delete(id); this.actorPool.push(a); }
    }
    for (const { z } of visible) {
      let a = this.zombies.get(z.id);
      if (!a) {
        a = this.actorPool.pop() ?? new Actor(this.assets, 'zombieMaleA');
        a.setSkin(z.id % 2 === 0 ? 'zombieMaleA' : 'zombieFemaleA');
        a.reset();
        this.zombies.set(z.id, a);
        this.scene.add(a.root);
      }
      this.animateZombie(a, z);
      if (z.action !== 'dead') shadowAt(z.pos.x, z.pos.y);
      a.update(z.pos.x, z.pos.y, z.heading, dt, true);
    }
    for (const e of this.extras) {
      const t = s.tasks.find((x) => x.id === e.task);
      e.actor.root.visible = !(e.task === 'rescue' && t?.done); // the survivor locks herself in once helped
      e.actor.update(e.actor.root.position.x, e.actor.root.position.z, Math.PI / 2 - e.actor.root.rotation.y, dt, e.task === 'rescue');
    }
    this.shadows.count = shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;

    this.effects.update(dt);
    this.updateLights();
    this.updateMarkers(s);
    this.renderer.render(this.scene, this.camera);
  }

  /** The current gun sits in the right hand (parented to the hand bone, so it follows the arm). */
  private updateGun(s: GameState, show: boolean): void {
    const w = s.arsenal.weapon;
    if (w !== this.gunKind) {
      this.gun = w ? gunMesh(w) : null;
      this.gunKind = w;
      this.player.holdInRightHand(this.gun);
    }
    if (this.gun) this.gun.visible = show;
  }

  /** World position of the current gun's muzzle (falls back to in front of the hand). */
  private muzzle(s: GameState): Vector3 {
    if (this.gun?.visible) {
      this.gun.updateWorldMatrix(true, false);
      return this.gun.localToWorld((this.gun.userData.muzzle as Vector3).clone());
    }
    const hand = this.player.handPosition(new Vector3());
    return hand.add(new Vector3(Math.cos(s.player.heading) * 0.5, 0.05, Math.sin(s.player.heading) * 0.5));
  }

  /** Height of the ground at a point: raised pavement inside blocks, road between them. */
  private groundAt(s: GameState, p: Vec2): number {
    for (const b of s.map.blocks) {
      if (b.district !== 'water' && p.x >= b.x && p.x <= b.x + b.size && p.y >= b.y && p.y <= b.y + b.size) return 0.15;
    }
    return 0;
  }

  private animateZombie(a: Actor, z: Zombie): void {
    if (z.staggerT > 0 && z.action !== 'dead') { a.play('Hit', { once: true, fade: 0.05, restart: false }); return; }
    switch (z.action) {
      case 'rise': a.play('ZRise', { once: true, fade: 0 }); break;
      case 'idle': a.play('ZIdle', { fade: 0.3 }); break;
      case 'dead': a.play('Death', { once: true, fade: 0.1, timeScale: 1.4 }); break;
      case 'attack':
        // time the swing so it lands as the wind-up ends
        a.play('ZAttack', { once: true, fade: 0.08, timeScale: 0.75 / ATTACK_WINDUP[z.kind] });
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
    const f = this.focus;
    const near = this.lightSources
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
      light.intensity = (n.l.kind === 'fire' ? 30 : n.l.kind === 'flood' ? 70 : 45) * k;
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
      this.tmp.position.set(pos.x, 0.22, pos.y);
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

  get stats(): { cityTriangles: number; lights: number; zombieActors: number } {
    return { cityTriangles: this.city?.triangles ?? 0, lights: this.lightSources.length, zombieActors: this.zombies.size };
  }
}
