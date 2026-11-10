import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, InstancedMesh,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PerspectiveCamera, PlaneGeometry, PointLight, RingGeometry, Scene, SpotLight,
  Vector3, WebGLRenderer, type Material,
} from 'three';
import { Actor, type CharacterAssets, type ClipName } from './characters';
import { buildCity, type CityMeshes, type LightSource } from './city';
import { MeshBuilder } from './mesh';
import { ArmyGate, barricadeMesh, barricadeRubble, bottleMesh, burningFlare, Effects, Evac, gearMesh, glint, SubwayExit, type StoryItem, pickupMesh, pulseGlint, storefrontMesh, storyItem, vehicleMesh, weaponMesh, wreckVehicle } from './props';
import { currentTask, escortGroup, finalChapter, gunStats, isGun, isRevealed, playerSpeed, playerVehicle, requiredDone, type GameState } from '../core/state';
import { ATTACK_WINDUP, MELEE, SAFEHOUSE_RADIUS, TASK_RADIUS } from '../core/config';
import type { GameEvent, Task, TaskId, Vec2, WeaponKind, Zombie } from '../core/types';
import { chapterInfo, stepDef } from '../core/content';

const params = new URLSearchParams(location.search);
const VIEW_SPAN = Number(params.get('zoom')) || 24; // world units visible across the narrower screen axis
const FOV = 32;
const ELEVATION = (52 * Math.PI) / 180; // camera pitch: steeper than isometric so streets read
const YAW = Math.PI / 4; // fixed yaw (matches the control mapping)
const POOL_LIGHTS = Math.max(0, Math.min(6, Number(params.get('lights') ?? 3))); // real lights at nearby lamps/fires
/** Scenes where you crouch to work (the rest, you stand). */
const KNEEL_SCENES = ['generator', 'gate', 'chained-gate', 'jerrycans', 'medkit', 'survivor-talk', 'fuse-box', 'junction-box', 'gas-valve', 'crossroads', 'fallen-guard', 'fallen-woman', 'fallen-soldier', 'crashed-bus', 'phone-booth'];
const FOG = 0x0a0e16; // a dark night blue, not black: the far streets fade into it
const MAX_VISIBLE_ZOMBIES = 20; // nearest ones get a skinned character; the rest are off screen anyway
const MAX_VISIBLE_CORPSES = 12; // the nearest bodies are drawn (posed once, never animated again)

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
  /** People at the steps: `alive` ones move (the fallen do not); `leaves` ones are gone once it is done. */
  private extras: Array<{ actor: Actor; task: TaskId; alive: boolean; leaves: boolean; door?: Vector3 }> = [];
  /** Bodies in the street, by zombie id. */
  private corpses = new Map<number, Actor>();
  /** People walking in through a door (handed over), then gone. */
  private walkers: Array<{ actor: Actor; to: Vector3 }> = [];
  /** Objective props that change with the task: items you take vanish, the gate swings open. */
  /** Things at each step. `scenery` stays whether or not the step is up yet; `part` is a fuse to find; `burning`
   * is the lit flare (only while it burns). */
  private taskItems: Array<{ group: Group; task: TaskId; whenDone: boolean; scenery?: boolean; always?: boolean; part?: number; burning?: boolean }> = [];
  /** The people following you to safety (one, or a group). */
  private escorts: Actor[] = [];
  private noraKey = '';
  /** Searchable house doors (a glint until searched). */
  private houseGlints = new Map<number, Object3D>();
  /** Survivors: their character, the glint over them, and the bag they want back. */
  private survivors = new Map<number, { actor: Actor; glint: Object3D; bag: Group }>();
  /** A car alarm: hazard lights blinking on the parked car. */
  private alarmLights = new Map<number, Mesh>();
  private bottle: Mesh = (() => { // the bottle in flight: oversized and catching the light, so you can follow it
    const m = bottleMesh();
    m.scale.setScalar(2.2);
    (m.material as MeshLambertMaterial).emissive.setHex(0x3a6a48);
    return m;
  })();
  private level = new Group(); // everything rebuilt per night
  private vehicles = new Map<number, { group: Group; wrecked: boolean }>();
  private pickups = new Map<number, Group>();
  private crates: InstancedMesh | null = null;
  private evac = new Evac();
  private exitDoor = new SubwayExit();
  private gate = new ArmyGate();
  private hemi = new HemisphereLight(0x5a6c94, 0x262018, 3.8);
  private moon = new DirectionalLight(0xa8bcff, 2.3);
  private haze = 1;
  /** Soldiers waiting by the helicopter: two keep watch, one checks you over before you board. */
  private soldiers: Actor[] = [];
  /** The end of a chapter, played out: walking down into the subway, or boarding the helicopter. */
  private outro: { kind: 'stairs' | 'heli'; t: number; from: Vector3 } | null = null;
  /** How this chapter is left: down into the subway, through the army gate, or the helicopter. */
  private exitKind: 'subway' | 'gate' | 'heli' = 'subway';
  private wornGear = { vest: false, helmet: false };
  private effects: Effects;
  private rings: InstancedMesh;
  private beams: InstancedMesh;
  private shadows: InstancedMesh;
  private flashlight: SpotLight;
  private pool: PointLight[] = [];
  private fill = new PointLight(0x9fb6ff, 9, 9, 1.5);
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
  private lastSwing = -10;
  /** 0 = wide establishing shot, 1 = gameplay camera. Driven by the intro. */
  cinematic = 1;

  constructor(private container: HTMLElement, private assets: CharacterAssets) {
    this.renderer = new WebGLRenderer({ antialias: false, stencil: true, powerPreference: 'high-performance' });
    this.setSaver(false);
    this.renderer.setClearColor(FOG);
    container.appendChild(this.renderer.domElement);
    this.scene.fog = new Fog(FOG, 30, 80);

    // night: a cold sky fill and a moon bright enough to make out the street, the flashlight does the rest
    this.scene.add(this.hemi);
    const moon = this.moon;
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
    const fatigues = (assets.materials.humanMaleA as MeshLambertMaterial).clone();
    fatigues.color.setHex(0x8f9a6c); // the same body in olive drab
    for (let i = 0; i < 3; i++) {
      const a = new Actor(assets, 'humanMaleA');
      a.root.traverse((o) => { if ((o as Mesh).isMesh && (o as Mesh).material !== assets.xray) (o as Mesh).material = fatigues; });
      a.holdInRightHand(weaponMesh('rifle'));
      a.root.visible = false;
      this.soldiers.push(a);
      this.scene.add(a.root);
    }
    this.scene.add(this.player.root, this.level, this.evac.group, this.exitDoor.group, this.gate.group);
    this.effects = new Effects(this.scene);

    // objective markers: a glowing ring on the ground and a faint shaft of light
    const ringMat = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.85 });
    this.rings = new InstancedMesh(new RingGeometry(0.82, 1, 32).rotateX(-Math.PI / 2), ringMat, 16);
    const beamMat = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.18 });
    this.beams = new InstancedMesh(new CylinderGeometry(0.5, 0.9, 14, 12, 1, true).translate(0, 7, 0), beamMat, 16);
    this.shadows = new InstancedMesh(
      new PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
      MAX_VISIBLE_ZOMBIES + 10,
    );
    for (const m of [this.rings, this.beams, this.shadows]) { m.frustumCulled = false; m.count = 0; this.scene.add(m); }
    this.shadows.renderOrder = 1;

    // Phones report a rotation's new size late (iOS Safari fires `resize` before layout settles), so
    // watch the container itself, and re-measure once more after an orientation change.
    const again = () => { this.resize(); setTimeout(() => this.resize(), 350); };
    window.addEventListener('resize', again);
    window.addEventListener('orientationchange', again);
    window.visualViewport?.addEventListener('resize', again);
    if ('ResizeObserver' in window) new ResizeObserver(() => this.resize()).observe(this.container);
    this.resize();
  }

  /**
   * Pixels drawn: phones (3x screens) at 1.5x rather than 2x is about half the fill work for a
   * small difference at arm's length; battery saver goes to 1.25x. `?dpr=` overrides.
   */
  setSaver(saver: boolean): void {
    const phone = window.matchMedia?.('(pointer: coarse)').matches;
    const cap = Number(params.get('dpr')) || (saver ? 1.25 : phone ? 1.5 : 2);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
    if (this.size.w) { this.size = { w: 0, h: 0 }; this.resize(); }
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    // the canvas keeps its CSS size (100% of the container); only the drawing buffer follows
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // distance so the narrower axis shows VIEW_SPAN units at the focus point; a short phone screen
    // in landscape comes in closer so the people are not specks
    const span = Math.min(w, h) < 500 && !params.get('zoom') ? VIEW_SPAN * 0.8 : VIEW_SPAN;
    const tanV = Math.tan(((FOV / 2) * Math.PI) / 180);
    this.distance = aspect < 1 ? span / (2 * tanV * aspect) : span / (2 * tanV);
  }
  private size = { w: 0, h: 0 };

  /** Kick the camera (attacks, crashes, gunfire). */
  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  private rebuild(s: GameState): void {
    if (this.city) {
      this.scene.remove(this.city.group, this.city.pools);
      this.city.group.traverse((o) => { if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose(); });
    }
    // each chapter's own night: the docks under orange sodium lamps, the edge of town in cold fog
    const ch = chapterInfo(s.chapter), L = ch.light, hex = (c: string | undefined, d: number) => (c ? parseInt(c.slice(1), 16) : d);
    const fog = hex(L?.fog, FOG);
    (this.scene.fog as Fog).color.setHex(fog);
    this.renderer.setClearColor(fog);
    this.hemi.color.setHex(hex(L?.sky, 0x5a6c94));
    this.hemi.groundColor.setHex(hex(L?.ground, 0x262018));
    this.moon.color.setHex(hex(L?.moon, 0xa8bcff));
    this.haze = L?.haze ?? 1;
    this.exitKind = finalChapter(s) ? 'heli' : ch.exit ?? 'subway';
    this.city = buildCity(s.map, s.seed, hex(L?.lamp, 0xffcf8a));
    this.scene.add(this.city.group, this.city.pools);
    this.lightSources = this.city.lights.slice();
    for (const st of s.stores) { // the neon sign over each weapon store
      this.lightSources.push({ pos: new Vector3(st.pos.x, 4.2, st.pos.y), color: 0xff5040, kind: 'lamp', broken: false });
    }

    for (const a of this.zombies.values()) { this.scene.remove(a.root); this.actorPool.push(a); }
    this.zombies.clear();
    for (const e of this.extras) { this.scene.remove(e.actor.root); e.actor.dispose(); }
    this.extras = [];
    for (const a of this.corpses.values()) { this.scene.remove(a.root); this.actorPool.push(a); }
    this.corpses.clear();
    for (const w of this.walkers) { this.scene.remove(w.actor.root); w.actor.dispose(); }
    this.walkers = [];
    this.taskItems = [];
    for (const v of this.survivors.values()) { this.scene.remove(v.actor.root); v.actor.dispose(); }
    this.survivors.clear();
    this.houseGlints.clear();
    for (const m of this.alarmLights.values()) this.scene.remove(m);
    this.alarmLights.clear();
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
    const solid = (this.city.group.children[0] as Mesh).material as Material;
    for (const st of s.stores) this.level.add(storefrontMesh(st, solid));
    // supply crates: olive boxes with a white stencil; opened ones sag open
    const cb = new MeshBuilder().box(0, 0.45, 0, 1.1, 0.9, 0.8, 0x4a5233, 0x56603c).box(0, 0.91, 0, 0.5, 0.02, 0.12, 0xd8d3c8).box(0, 0.91, 0, 0.12, 0.02, 0.5, 0xd8d3c8);
    this.crates = new InstancedMesh(cb.build(), this.city.group.children[0] ? ((this.city.group.children[0] as Mesh).material as Material) : new MeshBasicMaterial(), s.crates.length || 1);
    this.crates.frustumCulled = false;
    this.level.add(this.crates);
    this.level.add(this.buildTaskProps(s));
    for (const h of s.houses) {
      const g = glint(1.1, 0xdde8ff);
      g.position.set(h.pos.x, this.groundAt(s, h.pos) + 1.1, h.pos.y - 0.6);
      this.level.add(g);
      this.houseGlints.set(h.id, g);
    }
    for (const v of s.survivors) {
      const actor = new Actor(this.assets, v.skin ? 'humanFemaleA' : 'humanMaleA');
      actor.play('Idle', { fade: 0 });
      actor.update(v.pos.x, v.pos.y, Math.atan2(s.player.pos.y - v.pos.y, s.player.pos.x - v.pos.x), 0.016, true);
      this.scene.add(actor.root);
      const gl = glint(3.4, 0x9effa8);
      gl.position.set(v.pos.x, 3.4, v.pos.y);
      const bag = storyItem('medkit');
      bag.position.set(v.fetchPos.x, this.groundAt(s, v.fetchPos), v.fetchPos.y);
      this.level.add(gl, bag);
      this.survivors.set(v.id, { actor, glint: gl, bag });
    }
    this.bottle.visible = false;
    this.scene.add(this.bottle);
    this.evac.group.position.set(s.safehouse.x, 0.1, s.safehouse.y);
    this.evac.reset();
    this.outro = null;
    for (const g of [this.exitDoor.group, this.gate.group]) {
      g.position.set(s.safehouse.x, 0, s.safehouse.y);
      g.rotation.y = (s.seed % 4) * (Math.PI / 2);
    }
    this.wasCaught = false;
    this.player.play('Idle', { fade: 0 });
    this.player.setUpper(null);
  }

  /**
   * Story props at each step, from the scene preset its content names. Things you take lie where you
   * can see them once the step is up and vanish once taken; scenery is there all along; people kneel,
   * talk, or lie where they fell.
   */
  private buildTaskProps(s: GameState): Group {
    const out = new Group();
    const b = new MeshBuilder(); // static scenery, merged into one mesh
    const person = (task: TaskId, skin: 'humanMaleA' | 'humanFemaleA', clip: ClipName, at: Vec2, yaw: number,
      opts: { once?: boolean; leaves?: boolean; scale?: number } = {}) => {
      const a = new Actor(this.assets, skin);
      a.play(clip, { once: opts.once, fade: 0, startAt: opts.once ? 0.999 : 0 });
      a.update(at.x, at.y, Math.PI / 2 - yaw, 0.016, true);
      if (opts.scale) a.root.scale.multiplyScalar(opts.scale);
      this.extras.push({ actor: a, task, alive: !opts.once, leaves: !!opts.leaves });
      this.scene.add(a.root);
      return a;
    };
    const add = (task: TaskId, obj: Object3D, x: number, z: number, yaw: number, whenDone = false,
      extra: { scenery?: boolean; always?: boolean; part?: number; burning?: boolean; y?: number } = {}) => {
      const g = obj instanceof Group ? obj : new Group().add(obj);
      g.position.set(x, extra.y ?? this.groundAt(s, { x, y: z }), z);
      g.rotation.y = yaw;
      out.add(g);
      this.taskItems.push({ group: g, task, whenDone, scenery: extra.scenery, always: extra.always, part: extra.part, burning: extra.burning });
    };
    const basic = (mb: MeshBuilder) => new Mesh(mb.build(), new MeshBasicMaterial({ vertexColors: true }));
    const lamp = (hex: number) => basic(new MeshBuilder().box(0, 0, 0, 0.14, 0.14, 0.14, hex));
    /** A status lamp: red until the step is done, then green. */
    const lamps = (id: TaskId, x: number, z: number, y: number) => {
      add(id, lamp(0x7a1010), x, z, 0, false, { scenery: true, y });
      add(id, lamp(0x40ff80), x, z, 0, true, { scenery: true, y });
    };
    const bars = (open: boolean) => {
      const mb = new MeshBuilder();
      for (let k = 0; k <= 6; k++) mb.box(open ? 0.05 : k * 0.2, 1.2, open ? k * 0.2 : 0, 0.05, 2.2, 0.05, 0x55595f);
      mb.box(open ? 0.05 : 0.6, 2.2, open ? 0.6 : 0, open ? 0.05 : 1.25, 0.08, open ? 1.25 : 0.05, 0x55595f);
      return new Mesh(mb.build(), new MeshLambertMaterial({ vertexColors: true }));
    };
    const gate = (id: TaskId, x: number, z: number, gy: number) => {
      for (const o of [-1.4, 1.4]) b.box(x + o, gy + 1.3, z, 0.25, 2.6, 0.25, 0x40444a);
      add(id, bars(false), x - 1.25, z, 0, false, { scenery: true });
      add(id, bars(false), x + 1.25, z, Math.PI, false, { scenery: true });
      add(id, bars(true), x - 1.25, z, 0, true, { scenery: true });
      add(id, bars(true), x + 1.25, z, Math.PI, true, { scenery: true });
    };

    /**
     * A doorway in the wall of the building the step stands against: a lit door, its frame, and the
     * person who lives there in it (they go back inside, with whoever you brought, once it is done).
     */
    const doorway = (t: Task, lit: number, frame: number, who: 'humanMaleA' | 'humanFemaleA' | null, extra?: (d: MeshBuilder) => void) => {
      const D = t.door ?? { x: t.pos.x, y: t.pos.y - 1.8 };
      const nx = (t.pos.x - D.x) / 1.8, nz = (t.pos.y - D.y) / 1.8;
      const gy = this.groundAt(s, t.pos);
      const d = new MeshBuilder();
      for (const u of [-1.05, 1.05]) d.box(u, 1.5, 0.12, 0.3, 3, 0.25, frame);
      d.box(0, 3.0, 0.12, 2.4, 0.3, 0.25, frame).box(0, 0.05, 0.5, 2.2, 0.1, 0.8, 0x5a5c60);
      extra?.(d);
      const g = new Group().add(new Mesh(d.build(), new MeshLambertMaterial({ vertexColors: true })));
      g.add(basic(new MeshBuilder().box(0, 1.4, 0.04, 1.8, 2.7, 0.04, lit)));
      add(t.id, g, D.x, D.y, Math.atan2(nx, nz), false, { scenery: true, always: true, y: gy });
      if (who) {
        const a = person(t.id, who, 'Talk', { x: D.x + nx * 0.8, y: D.y + nz * 0.8 }, Math.PI / 2 - Math.atan2(nz, nx));
        this.extras[this.extras.length - 1]!.door = new Vector3(D.x, 0, D.y);
        void a;
      }
    };

    for (const t of s.tasks) {
      const def = stepDef(t.id);
      const id = t.id;
      const x = t.pos.x + 1.4, z = t.pos.y + 1.4;
      const gy = this.groundAt(s, { x, y: z });
      let itemAt: { x: number; z: number; y?: number; yaw?: number } | null = { x, z, yaw: 0.4 }; // where the thing you take lies
      switch (def.scene) {
        case 'map-crate': b.box(x, gy + 0.4, z, 0.9, 0.8, 0.9, 0x5a4630, 0x6a5238); break; // the map lies on a crate
        case 'fallen-woman': // her keys dropped by her hand
          person(id, 'humanFemaleA', 'Death', { x, y: z }, 0.7, { once: true });
          itemAt = { x: t.pos.x + 0.5, z: t.pos.y + 0.4, yaw: 1.1 };
          break;
        case 'fallen-soldier':
          person(id, 'humanMaleA', 'Death', { x, y: z }, 2.3, { once: true });
          itemAt = { x: t.pos.x + 0.5, z: t.pos.y + 0.3, yaw: -0.5 };
          break;
        case 'fallen-guard':
          person(id, 'humanMaleA', 'Death', { x, y: z }, 1.2, { once: true });
          itemAt = { x: t.pos.x + 0.6, z: t.pos.y + 0.2, yaw: 0.2 };
          break;
        case 'generator': // its lamp goes from dead red to running green
          b.box(x, gy + 0.55, z, 1.4, 1.1, 0.9, 0x6b6f3a, 0x585c30).box(x + 0.5, gy + 1.2, z, 0.15, 0.4, 0.15, 0x222222);
          b.box(x - 0.3, gy + 0.6, z + 0.46, 0.5, 0.35, 0.02, 0x2a2b2e);
          lamps(id, x - 0.45, z + 0.47, gy + 0.95);
          break;
        case 'gate': gate(id, x, z, gy); break;
        case 'chained-gate': // a chain and padlock on the gate until you cut it
          gate(id, x, z, gy);
          add(id, new Mesh(new MeshBuilder().box(0, 0, 0, 0.5, 0.1, 0.1, 0x8a8d92).box(0, -0.12, 0.02, 0.16, 0.18, 0.08, 0x6a5a20).build(),
            new MeshLambertMaterial({ vertexColors: true })), x, z + 0.06, 0, false, { scenery: true, y: gy + 1.1 });
          break;
        case 'radio-shop':
          b.box(x, gy + 0.5, z, 1.4, 1, 0.7, 0x3d2c22, 0x4a3628).box(x, gy + 1.12, z, 0.5, 0.25, 0.25, 0x1b1d20);
          b.box(x + 0.15, gy + 1.5, z, 0.03, 0.6, 0.03, 0x9a9da3);
          break;
        case 'pharmacy': // a fridge with a glass front; what you take is on the counter beside it
          b.box(x, gy + 1.0, z, 1.0, 2.0, 0.8, 0xd8dcd8, 0xe4e8e4).box(x, gy + 1.1, z + 0.41, 0.8, 1.5, 0.02, 0x5f7f98);
          b.box(x + 1.05, gy + 0.45, z, 1.0, 0.9, 0.7, 0x6a5a48, 0x7a6a58);
          itemAt = { x: x + 1.05, z, y: gy + 0.9, yaw: 0.3 };
          break;
        case 'butcher': // a cold room: white walls, a steel door, a block on the counter
          b.box(x, gy + 1.1, z, 2.2, 2.2, 1.2, 0xe6e6e0, 0xd8d8d2).box(x, gy + 1.0, z + 0.61, 0.9, 1.9, 0.02, 0x9aa0a6);
          b.box(x + 1.6, gy + 0.45, z, 1.0, 0.9, 0.7, 0x8a7a68, 0x9a8a78);
          itemAt = { x: x + 1.6, z, y: gy + 0.9, yaw: 0.2 };
          break;
        case 'crossroads': // the bait lies where you dropped it, once you have
          add(id, storyItem('bait'), x, z, 0.6, true, { scenery: true });
          add(id, burningFlare(), x, z, 0.6, true, { burning: true });
          itemAt = null;
          break;
        case 'laundromat': // machines in a row; a father kneels by his daughter
          for (let k = 0; k < 4; k++) {
            b.box(x - 1.6 + k * 1.0, gy + 0.45, z - 1.1, 0.9, 0.9, 0.8, 0xe8e8e2, 0xf0f0ea).box(x - 1.6 + k * 1.0, gy + 0.5, z - 0.69, 0.5, 0.5, 0.02, 0x30343a);
          }
          person(id, 'humanMaleA', 'Kneel', { x, y: z }, 0.5);
          person(id, 'humanFemaleA', 'Idle', { x: x + 0.9, y: z + 0.2 }, -0.4, { scale: 0.7 });
          itemAt = null;
          break;
        case 'fuse-box': // red lamp until the pieces are in, then green
          b.box(x, gy + 0.8, z, 0.9, 1.6, 0.45, 0x5a6066, 0x666c72).box(x, gy + 0.95, z + 0.235, 0.7, 1.0, 0.02, 0x40454a);
          lamps(id, x, z + 0.26, gy + 1.5);
          break;
        case 'junction-box': // a street cabinet, door hanging open, cut wires
          b.box(x, gy + 0.7, z, 1.2, 1.4, 0.5, 0x4f5a50, 0x5a665b).box(x + 0.75, gy + 0.75, z + 0.4, 0.05, 1.2, 0.7, 0x4f5a50);
          for (const [k, c] of [[0, 0xe8443a], [1, 0x3f8fe8], [2, 0xf2c230], [3, 0x4cc46a]] as const) b.box(x - 0.36 + k * 0.24, gy + 0.6, z + 0.27, 0.05, 0.5, 0.05, c);
          lamps(id, x, z + 0.27, gy + 1.25);
          break;
        case 'radio-mast': // a lattice tower with a lamp on top
          for (const [ox, oz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const) b.box(x + ox, gy + 3, z + oz, 0.1, 6, 0.1, 0x7a7e84);
          for (let k = 1; k < 6; k++) b.box(x, gy + k, z - 0.5, 1.0, 0.06, 0.06, 0x7a7e84).box(x, gy + k, z + 0.5, 1.0, 0.06, 0.06, 0x7a7e84);
          b.box(x, gy + 0.4, z + 0.9, 0.8, 0.8, 0.5, 0x3a3e44, 0x44484e); // the battery cabinet
          lamps(id, x, z, gy + 6.15);
          break;
        case 'office-desk': // the station office desk under a lamp
          b.box(x, gy + 0.75, z, 1.8, 0.08, 0.9, 0x6a4e32).box(x - 0.8, gy + 0.37, z, 0.08, 0.74, 0.8, 0x5a4028).box(x + 0.8, gy + 0.37, z, 0.08, 0.74, 0.8, 0x5a4028);
          b.box(x + 0.1, gy + 0.45, z - 0.8, 0.5, 0.9, 0.5, 0x2a2b2e);
          add(id, basic(new MeshBuilder().box(0.6, 0.18, 0, 0.18, 0.12, 0.18, 0xffe2a8)), x, z, 0, false, { scenery: true, y: gy + 0.8 });
          itemAt = null;
          break;
        case 'security-door': // a steel door in the building's wall, a keypad beside it
          doorway(t, 0x3a4048, 0x5a5c60, null, (d) => { d.box(1.1, 1.3, 0.06, 0.25, 0.35, 0.05, 0x222428); });
          lamps(id, t.door ? t.door.x + (t.pos.y - t.door.y) / 1.8 * 1.1 : x, t.door ? t.door.y - (t.pos.x - t.door.x) / 1.8 * 1.1 : z, gy + 1.55);
          itemAt = null;
          break;
        case 'ambulance': // abandoned, back doors open; what you take sits on the step
          b.box(x, gy + 1.2, z, 2.4, 2.4, 5.5, 0xe8e8e2, 0xf0f0ea).box(x + 1.21, gy + 1.0, z, 0.02, 0.4, 5.3, 0xc8282a);
          b.box(x, gy + 2.45, z + 1.6, 0.8, 0.15, 0.3, 0x3a6ad8);
          itemAt = { x: x, z: z + 3.0, yaw: 0.2 };
          break;
        case 'field-medic': // a medic kneels over a soldier lying on a stretcher
          b.box(x, gy + 0.2, z, 0.9, 0.06, 2.3, 0x4a5a3a);
          person(id, 'humanMaleA', 'Death', { x, y: z }, 0, { once: true });
          person(id, 'humanFemaleA', 'Kneel', { x: x + 1.0, y: z + 0.2 }, -1.6);
          itemAt = null;
          break;
        case 'phone-booth': // a phone booth; someone may be hiding in it
          for (const [ox, oz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) b.box(x + ox, gy + 1.25, z + oz, 0.08, 2.5, 0.08, 0xb02a20);
          b.box(x, gy + 2.55, z, 1.3, 0.12, 1.3, 0xb02a20, 0xc0342a).box(x, gy + 1.4, z - 0.58, 0.4, 0.5, 0.12, 0x222428);
          add(id, new Mesh(new BoxGeometry(1.2, 2.3, 1.2), new MeshBasicMaterial({ color: 0x9fc0d8, transparent: true, opacity: 0.12, depthWrite: false })),
            x, z, 0, false, { scenery: true, y: gy + 1.2 });
          if (t.escort) person(id, t.escort.skin, 'Kneel', { x, y: z }, 2.5, { leaves: true, scale: t.escort.scale });
          itemAt = null;
          break;
        case 'mother': // the bakery's doorway, lit; his mother at it
          doorway(t, 0xffd090, 0x8a6a48, 'humanFemaleA', (d) => { d.box(0, 3.1, 0.45, 2.8, 0.12, 0.9, 0xa0342a); }); // an awning
          itemAt = null;
          break;
        case 'shelter-door': // the shelter's door, lit, someone at it
          doorway(t, 0xffc070, 0x8a8478, 'humanFemaleA');
          itemAt = null;
          break;
        case 'loading-dock': // pallets, crates and a container
          b.box(x - 1.5, gy + 1.3, z - 1.5, 2.4, 2.6, 6, 0x5a3a2a, 0x6a4a34);
          for (const [ox, oz, h] of [[1.2, -0.5, 0.9], [1.9, 0.6, 0.6], [1.0, 1.4, 1.2]] as const) b.box(x + ox, gy + h / 2, z + oz, 1.0, h, 1.0, 0x7a6040, 0x8a7050);
          itemAt = null;
          break;
        case 'hardware-van': // a van, back open, tools spilling out
          b.box(x, gy + 1.15, z, 2.3, 2.3, 5.0, 0x6a7a8a, 0x7a8a9a).box(x + 1.16, gy + 1.4, z, 0.02, 0.5, 3.0, 0xd8b030);
          itemAt = { x, z: z + 2.8, yaw: 0.5 };
          break;
        case 'gas-valve': // a pipe out of the pavement with a red wheel
          b.box(x, gy + 0.5, z, 0.3, 1.0, 0.3, 0xc8a83a).box(x, gy + 0.9, z, 1.4, 0.25, 0.25, 0xc8a83a);
          b.box(x, gy + 1.2, z, 0.7, 0.7, 0.08, 0xb02020);
          itemAt = null;
          break;
        case 'flare':
          add(id, burningFlare(), x, z, 0.5, true, { burning: true });
          break;
        case 'barricade': // across the street; once pulled apart, the junk lies pushed aside
          add(id, barricadeMesh(), x, z, Math.PI / 4, false, { scenery: true });
          add(id, barricadeRubble(), x, z, Math.PI / 4, true, { scenery: true });
          itemAt = null;
          break;
        case 'crashed-bus': // a minibus on its side; someone crouched in its shadow
          b.box(x + 1.2, gy + 1.1, z + 0.6, 2.2, 2.2, 5.4, 0xc8a83a, 0xb8982f).box(x + 2.31, gy + 1.3, z + 0.6, 0.02, 0.7, 4.6, 0x15181c);
          b.box(x + 1.2, gy + 0.2, z + 3.4, 1.6, 0.4, 0.3, 0x2a2b2e);
          if (t.escort) person(id, t.escort.skin, 'Kneel', { x: t.pos.x + 0.4, y: t.pos.y + 0.4 }, 2.4, { leaves: true, scale: t.escort.scale });
          itemAt = null;
          break;
        case 'church': // a stone doorway, warm light, a white cross above; the priest waiting
          doorway(t, 0xffc070, 0x8a8478, 'humanMaleA', (d) => { d.box(0, 4.0, 0.1, 0.18, 1.1, 0.12, 0xf4f0e6).box(0, 4.2, 0.1, 0.7, 0.18, 0.12, 0xf4f0e6); });
          itemAt = null;
          break;
        case 'survivor-talk': person(id, 'humanFemaleA', 'Talk', { x, y: z }, -2.2, { leaves: true }); itemAt = null; break;
        default: break; // jerrycans, medkit: just the thing itself
      }
      if (def.item && itemAt) add(id, storyItem(def.item as StoryItem), itemAt.x, itemAt.z, itemAt.yaw ?? 0.4, false, itemAt.y !== undefined ? { y: itemAt.y } : {});
      const piece = def.parts?.item as StoryItem | undefined;
      if (piece) t.parts?.forEach((q, i) => add(id, storyItem(piece), q.x + 1.2, q.y + 1.2, i * 1.3, false, { part: i }));
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
        case 'reload': this.player.setUpper('ReloadUpper', { timeScale: 1.667 / gunStats(s.arsenal, e.weapon).reload }); break;
        case 'throw': this.lastSwing = this.time; this.player.setUpper('Swing2Upper', { restart: true, timeScale: 1.4 }); break;
        case 'bottle-smash': this.effects.burst(new Vector3(e.pos.x, 0.4, e.pos.y), 0x9fd8b0, 12, 3); break;
        case 'alarm-start': {
          const b = s.map.buildings[e.car];
          if (!b) break;
          const lights = new MeshBuilder();
          for (const [x, z] of [[b.x - 0.05, b.y + 0.3], [b.x + b.w + 0.05, b.y + 0.3], [b.x - 0.05, b.y + b.h - 0.3], [b.x + b.w + 0.05, b.y + b.h - 0.3]]) {
            lights.box(x!, 0.95, z!, 0.25, 0.18, 0.25, 0xffa020);
          }
          const m = new Mesh(lights.build(), new MeshBasicMaterial({ vertexColors: true }));
          this.scene.add(m);
          this.alarmLights.set(e.car, m);
          this.lightSources.push({ pos: new Vector3(b.x + b.w / 2, 1.6, b.y + b.h / 2), color: 0xffa020, kind: 'lamp', broken: true });
          break;
        }
        case 'alarm-stop': {
          const m = this.alarmLights.get(e.car);
          if (m) { this.scene.remove(m); this.alarmLights.delete(e.car); }
          const b = s.map.buildings[e.car];
          if (b) this.lightSources = this.lightSources.filter((l) => !(l.color === 0xffa020 && Math.abs(l.pos.x - (b.x + b.w / 2)) < 0.01 && Math.abs(l.pos.z - (b.y + b.h / 2)) < 0.01));
          break;
        }
        case 'swing': {
          // alternate forehand and backhand; speed the clip up to fit the weapon's swing time
          this.lastSwing = this.time;
          const clip = s.arsenal.swing % 2 ? 'SwingUpper' : 'Swing2Upper';
          this.player.setUpper(clip, { restart: true, timeScale: Math.max(1, (clip === 'SwingUpper' ? 0.433 : 0.533) / MELEE[e.weapon].interval) });
          if (e.hits > 0) this.shake(e.weapon === 'bat' ? 0.18 : 0.12);
          break;
        }
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
    if (!this.outro && (s.phase === 'cleared' || s.phase === 'won')) this.outro = { kind: s.phase === 'won' ? 'heli' : 'stairs', t: 0, from: new Vector3(p.x, 0, p.y) };
    if (this.outro && s.phase === 'playing') this.outro = null; // a retry
    if (this.outro) this.target.set(this.player.root.position.x, 0, this.player.root.position.z);
    else this.target.set(p.x + s.player.vel.x * lead, 0, p.y + s.player.vel.y * lead);
    this.focus.lerp(this.target, 1 - Math.exp(-5 * dt));
    this.zoom += ((this.outro ? (this.outro.kind === 'heli' ? 1.3 : 1.15) : car ? 1.55 + Math.min(0.5, Math.abs(car.speed) / 30) : 1) - this.zoom) * (1 - Math.exp(-2 * dt));
    const c = this.cinematic;
    const dist = this.distance * this.zoom * (1 + (1 - c) * 1.6);
    const elev = ELEVATION + (1 - c) * 0.35;
    const yaw = YAW + (1 - c) * 0.5;
    const fog = this.scene.fog as Fog;
    fog.near = dist * 0.95;
    fog.far = dist * 2.1 * this.haze;
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

    // --- player (hidden inside a car; astride a bike)
    const caught = s.phase === 'lost' && s.lossReason === 'caught';
    const bike = car?.kind === 'bike' ? car : null;
    this.player.root.visible = !car || !!bike || !!this.outro;
    if (this.outro) this.playOutro(s, dt);
    else {
    if (bike && !caught) { this.player.setUpper(null); this.player.play('Idle', { fade: 0.2 }); }
    if (caught && !this.wasCaught) { this.wasCaught = true; this.player.setUpper(null); this.player.play('Death', { once: true, fade: 0.15 }); }
    else if (!caught && !car) {
      const hold = s.hold.taskId;
      const work = s.work;
      if (hold && playerSpeed(s) < 0.6) this.player.play(KNEEL_SCENES.includes(stepDef(hold).scene) ? 'Kneel' : 'Interact', { fade: 0.25 });
      else if (work && playerSpeed(s) < 0.6) this.player.play(work.kind === 'refuel' ? 'Kneel' : work.kind === 'talk' ? 'Talk' : 'Interact', { fade: 0.25 });
      else if (s.phase === 'won') this.player.play('Idle', { fade: 0.3 });
      else this.player.locomote(playerSpeed(s));
      // gun up while shooting or reloading, lowered otherwise
      const a = s.arsenal;
      if (hold || work) this.player.setUpper(null);
      else if (a.weapon && !isGun(a.weapon)) { if (this.time - this.lastSwing > 0.6) this.player.setUpper(null); }
      else if (a.reloadT > 0 && a.weapon) this.player.setUpper('ReloadUpper', { timeScale: 1.667 / gunStats(a, a.weapon).reload });
      else if (this.time - this.lastShot < 1.2) { if (this.time - this.lastShot > 0.35) this.player.setUpper('AimUpper'); }
      else this.player.setUpper(null);
    }
    this.player.update(p.x, p.y, s.player.heading, dt, true);
    if (bike) { // on the seat, behind the tank
      this.player.root.position.x -= Math.cos(bike.heading) * 0.45;
      this.player.root.position.z -= Math.sin(bike.heading) * 0.45;
    }
    this.updateGun(s, !car && !caught && !s.hold.taskId && !s.work);
    }

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
    for (const h of s.houses) {
      const g = this.houseGlints.get(h.id);
      if (!g) continue;
      g.visible = !h.searched;
      if (g.visible) pulseGlint(g, this.time, h.id * 0.29);
    }
    for (const v of s.survivors) {
      const r = this.survivors.get(v.id);
      if (!r) continue;
      const near = Math.hypot(s.player.pos.x - v.pos.x, s.player.pos.y - v.pos.y);
      // they turn to you when you come close, and talk while you are with them
      const talking = s.work?.kind === 'talk' && s.work.id === v.id;
      r.actor.play(talking ? 'Talk' : 'Idle', { fade: 0.3 });
      const face = near < 10 ? Math.atan2(s.player.pos.y - v.pos.y, s.player.pos.x - v.pos.x) : Math.PI / 2 - r.actor.yawAngle;
      r.actor.update(v.pos.x, v.pos.y, face, dt, near < 40);
      const something = v.status === 'waiting' || v.status === 'ready' || (v.status === 'asked' && v.carrying);
      r.glint.visible = something;
      if (something) pulseGlint(r.glint, this.time, v.id);
      r.bag.visible = v.request === 'fetch' && v.status === 'asked' && !v.carrying;
      const bg = r.bag.getObjectByName('glint');
      if (bg && r.bag.visible) pulseGlint(bg, this.time, v.id + 0.5);
    }
    for (const m of this.alarmLights.values()) m.visible = Math.sin(this.time * 9) > 0;
    const tb = s.thrown[0];
    this.bottle.visible = !!tb;
    if (tb) {
      const k = Math.min(1, tb.t / tb.dur);
      this.bottle.position.set(tb.from.x + (tb.to.x - tb.from.x) * k, 1.5 + Math.sin(k * Math.PI) * 2.6 - k * 1.2, tb.from.y + (tb.to.y - tb.from.y) * k);
      this.bottle.rotation.set(this.time * 14, 0, this.time * 9);
    }
    for (const it of this.taskItems) {
      const t = s.tasks.find((x) => x.id === it.task);
      const done = !!t?.done;
      // things to take only turn up once they are the objective; scenery is always there
      if (it.part !== undefined) it.group.visible = !!t && !done && isRevealed(s, t) && !t.got?.[it.part];
      else if (it.burning) {
        it.group.visible = done && !!s.flare;
        if (it.group.visible) {
          const k = 0.75 + Math.sin(this.time * 23) * 0.12 + Math.sin(this.time * 7.3) * 0.13;
          it.group.getObjectByName('pool')!.scale.setScalar(k);
          it.group.getObjectByName('flame')!.scale.setScalar(1.3 + k * 0.5);
        }
      } else if (it.always) it.group.visible = true;
      else if (it.scenery) it.group.visible = it.whenDone ? done : !done;
      else it.group.visible = it.whenDone ? done : !done && !!t && isRevealed(s, t);
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
    const final = finalChapter(s);
    this.evac.group.visible = s.safehouseKnown && final;
    this.exitDoor.group.visible = s.safehouseKnown && this.exitKind === 'subway';
    this.gate.group.visible = s.safehouseKnown && this.exitKind === 'gate';
    if (final) { this.evac.update(dt, this.time, this.liftT()); this.updateSoldiers(s, dt); }
    else {
      for (const a of this.soldiers) a.root.visible = false;
      if (this.exitKind === 'gate') this.gate.update(this.time, requiredDone(s));
      else this.exitDoor.update(this.time, requiredDone(s));
    }
    this.updateGear(s);

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
    if (this.outro) { const r = this.player.root; if (r.visible && r.position.y > -0.2) shadowAt(r.position.x, r.position.z); }
    else if (!caught && !car) shadowAt(p.x, p.y);
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
      // someone at their door goes back inside; someone found comes out of hiding and follows you
      if (e.door && t?.done) { if (e.actor.root.visible) this.walkIn(e.actor, e.door, dt); continue; }
      e.actor.root.visible = !(e.leaves && t?.done);
      e.actor.update(e.actor.root.position.x, e.actor.root.position.z, Math.PI / 2 - e.actor.root.rotation.y, dt, e.alive);
    }
    this.updateNora(s, dt);
    this.walkers = this.walkers.filter((w) => {
      this.walkIn(w.actor, w.to, dt);
      if (w.actor.root.visible) return true;
      this.scene.remove(w.actor.root);
      w.actor.dispose();
      return false;
    });
    // the dead stay where they fell: the nearest are drawn, posed at the end of their fall
    const nearBodies = s.corpses
      .map((c) => ({ c, d: Math.abs(c.pos.x - this.focus.x) + Math.abs(c.pos.y - this.focus.z) }))
      .filter((q) => q.d < reach)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_VISIBLE_CORPSES);
    const bodies = new Set(nearBodies.map((q) => q.c.id));
    for (const [id, a] of this.corpses) if (!bodies.has(id)) { this.scene.remove(a.root); this.corpses.delete(id); this.actorPool.push(a); }
    for (const { c } of nearBodies) {
      if (this.corpses.has(c.id)) continue;
      const a = this.actorPool.pop() ?? new Actor(this.assets, 'zombieMaleA');
      a.setSkin(c.id % 2 === 0 ? 'zombieMaleA' : 'zombieFemaleA');
      a.reset();
      a.play('Death', { once: true, fade: 0, startAt: 0.999 });
      a.update(c.pos.x, c.pos.y, c.heading, 0.016, true);
      this.corpses.set(c.id, a);
      this.scene.add(a.root);
    }
    this.shadows.count = shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;

    this.effects.update(dt);
    this.updateLights();
    this.updateMarkers(s);
    this.renderer.render(this.scene, this.camera);
  }

  /** The people you are bringing in, following you (out of sight while they ride in your car). */
  private updateNora(s: GameState, dt: number): void {
    const group = escortGroup(s);
    if (!group.length && this.escorts.length) {
      // handed over: they go in through the door they were brought to
      const home = s.tasks.filter((t) => t.effect === 'escort-end' && t.done && t.door)
        .sort((a, b) => Math.hypot(a.door!.x - this.escorts[0]!.root.position.x, a.door!.y - this.escorts[0]!.root.position.z) - Math.hypot(b.door!.x - this.escorts[0]!.root.position.x, b.door!.y - this.escorts[0]!.root.position.z))[0];
      for (const a of this.escorts) {
        if (home && a.root.visible) this.walkers.push({ actor: a, to: new Vector3(home.door!.x, 0, home.door!.y) });
        else { this.scene.remove(a.root); a.dispose(); }
      }
      this.escorts = [];
      this.noraKey = '';
      return;
    }
    const key = group.map((e) => `${e.name}:${e.skin}:${e.scale}`).join();
    if (this.noraKey !== key) { // whoever is following you this time
      for (const a of this.escorts) { this.scene.remove(a.root); a.dispose(); }
      this.escorts = group.map((e) => {
        const a = new Actor(this.assets, e.skin);
        a.root.scale.multiplyScalar(e.scale);
        a.play('Idle', { fade: 0 });
        this.scene.add(a.root);
        return a;
      });
      this.noraKey = key;
    }
    const ride = playerVehicle(s);
    group.forEach((e, i) => {
      const a = this.escorts[i]!;
      if (e.riding && ride?.kind === 'bike') { // pillion: behind you on the seat
        a.root.visible = true;
        a.play('Idle', { fade: 0.2 });
        const back = 1.05 + i * 0.5;
        a.update(ride.pos.x - Math.cos(ride.heading) * back, ride.pos.y - Math.sin(ride.heading) * back, ride.heading, dt, true);
        return;
      }
      a.root.visible = !e.riding;
      if (e.riding) return;
      if (e.speed > 3.2) a.play('Jog', { timeScale: a.rateFor('Jog', e.speed), fade: 0.2 });
      else if (e.speed > 0.2) a.play('Walk', { timeScale: a.rateFor('Walk', e.speed), fade: 0.2 });
      else a.play('Idle', { fade: 0.3 });
      a.update(e.pos.x, e.pos.y, e.heading, dt, true);
    });
  }

  /** Walk someone to a door and in (hidden once there). */
  private walkIn(a: Actor, to: Vector3, dt: number): void {
    const p = a.root.position, dx = to.x - p.x, dz = to.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.35) { a.root.visible = false; return; }
    const step = Math.min(d, 2.6 * dt);
    a.locomote(2.6);
    a.update(p.x + (dx / d) * step, p.z + (dz / d) * step, Math.atan2(dz, dx), dt, true);
  }

  /** Protective gear shows on the player while it lasts. */
  private updateGear(s: GameState): void {
    for (const g of ['vest', 'helmet'] as const) {
      const on = s.arsenal.gear[g] > 0;
      if (on === this.wornGear[g]) continue;
      this.wornGear[g] = on;
      // the helmet's rim sits around the middle of the head (its bone is at the neck)
      this.player.wear(g === 'vest' ? 'chest' : 'head', on ? gearMesh(g) : null, new Vector3(0, g === 'vest' ? 0 : 0.36, 0));
    }
  }

  /** When the helicopter lifts off in the boarding scene (seconds after you are in). */
  private static readonly BOARD = { walk: 1.6, check: 1.8, board: 1.6 };
  private liftT(): number | null {
    const o = this.outro;
    if (o?.kind !== 'heli') return null;
    const B = GameView.BOARD;
    const t = o.t - (B.walk + B.check + B.board);
    return t > 0 ? t : null;
  }

  /** Where each soldier stands by the helicopter (world), and which way they face. */
  private soldierPost(i: number): { pos: Vector3; heading: number } {
    const g = this.evac.group.position;
    const spots = [[-1.0, 4.2, 0.3], [2.6, 3.4, 0.9], [-4.2, 3.0, -0.6]] as const; // in the helicopter's frame, door side
    const [x, z, turn] = spots[i]!;
    const at = this.evac.local(x, z).add(g);
    const out = this.evac.local(x, z + 1);
    const heading = Math.atan2(out.z - this.evac.local(x, z).z, out.x - this.evac.local(x, z).x) + turn;
    return { pos: new Vector3(at.x, 0, at.z), heading };
  }

  /** The door they climb in by (world). */
  private doorPoint(): Vector3 {
    return this.evac.local(-1.0, 1.6).add(this.evac.group.position).setY(0);
  }

  private updateSoldiers(s: GameState, dt: number): void {
    const show = s.safehouseKnown;
    const o = this.outro?.kind === 'heli' ? this.outro : null;
    const B = GameView.BOARD;
    this.soldiers.forEach((a, i) => {
      const post = this.soldierPost(i);
      if (!show || (o && o.t > B.walk + B.check + B.board)) { a.root.visible = false; return; }
      a.root.visible = true;
      let pos = post.pos, heading = post.heading;
      if (!o || o.t < B.walk) { // waiting: two keep watch, rifles up; the third waves you in
        if (i === 0) { a.setUpper(null); a.play('Idle', { fade: 0.3 }); }
        else { a.play('Idle', { fade: 0.3 }); a.setUpper('AimUpper'); }
      } else if (o.t < B.walk + B.check) { // checking you over
        const me = this.player.root.position;
        if (i === 0) { heading = Math.atan2(me.z - pos.z, me.x - pos.x); a.setUpper(null); a.play('Interact', { fade: 0.2 }); }
      } else { // everyone in
        const k = Math.min(1, (o.t - B.walk - B.check) / (B.board * 0.8));
        const door = this.doorPoint();
        pos = pos.clone().lerp(door, k);
        heading = Math.atan2(door.z - post.pos.z, door.x - post.pos.x);
        a.setUpper(null);
        a.locomote(k < 1 ? 3 : 0);
        if (k >= 1) { a.root.visible = false; return; }
      }
      a.update(pos.x, pos.z, heading, dt, true);
    });
  }

  /** The player walks themself out of the chapter: down the subway stairs, or up into the helicopter. */
  /** The end-of-chapter scene has played to its end (the game can move on). */
  outroDone(): boolean {
    return !!this.outro && this.outro.t >= this.outroLen;
  }
  private outroLen = 99;

  private playOutro(s: GameState, dt: number): void {
    const o = this.outro!;
    o.t += dt;
    this.player.setUpper(null);
    this.updateGun(s, false);
    let pos: Vector3, heading: number, speed = 2.4, y = 0;
    const toward = (a: Vector3, b: Vector3) => Math.atan2(b.z - a.z, b.x - a.x);
    if (o.kind === 'stairs') {
      const g = this.exitDoor.group, r = g.rotation.y;
      const W = (x: number, z: number) => new Vector3(g.position.x + x * Math.cos(r) + z * Math.sin(r), 0, g.position.z - x * Math.sin(r) + z * Math.cos(r));
      const gate = this.exitKind === 'gate';
      const top = W(0, gate ? 4 : 3.3), bottom = W(0, gate ? -7 : -2.3);
      const tA = Math.min(1.4, Math.max(0.4, o.from.distanceTo(top) / 4));
      this.outroLen = tA + 2.2;
      if (o.t < tA) { pos = o.from.clone().lerp(top, o.t / tA); heading = toward(o.from, top); speed = Math.min(3.5, o.from.distanceTo(top) / tA); }
      else { // down the steps, sinking into the dark
        const k = Math.min(1, (o.t - tA) / 2.2);
        pos = top.clone().lerp(bottom, k);
        heading = toward(top, bottom);
        if (!gate) y = -Math.max(0, k - 0.12) * 3.4;
        else speed = 4.5; // through the gate and away up the road
        if (k >= 1) speed = 0;
      }
    } else {
      const B = GameView.BOARD;
      this.outroLen = B.walk + B.check + B.board + 2.8; // and it is well up and away
      const checker = this.soldierPost(0).pos;
      const meet = checker.clone().add(o.from.clone().sub(checker).setY(0).normalize().multiplyScalar(1.5));
      const door = this.doorPoint();
      if (o.t < B.walk) { pos = o.from.clone().lerp(meet, o.t / B.walk); heading = toward(o.from, meet); speed = Math.min(3.5, o.from.distanceTo(meet) / B.walk); }
      else if (o.t < B.walk + B.check) { pos = meet; heading = toward(meet, checker); speed = 0; }
      else {
        const k = Math.min(1, (o.t - B.walk - B.check) / (B.board * 0.7));
        pos = meet.clone().lerp(door, k);
        heading = toward(meet, door);
        if (k >= 1) { this.player.root.visible = false; speed = 0; }
      }
    }
    this.player.locomote(speed);
    this.player.update(pos.x, pos.z, heading, dt, true);
    this.player.root.position.y = y;
  }

  /** The current gun sits in the right hand (parented to the hand bone, so it follows the arm). */
  private updateGun(s: GameState, show: boolean): void {
    const w = s.arsenal.weapon;
    if (w !== this.gunKind) {
      this.gun = w ? weaponMesh(w) : null;
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
      case 'cling': a.play('ZAttack', { fade: 0.15, timeScale: 1.1 }); break; // clawing at the car
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
    const parts = cur?.parts ?? [];
    const n = Math.min(this.rings.instanceMatrix.count, s.tasks.length + 1 + parts.length);
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
      set(i, t.pos, TASK_RADIUS, color, cur === t, !t.done && isRevealed(s, t) && (!t.got || t.got.every(Boolean)));
    });
    const open = requiredDone(s);
    set(s.tasks.length, s.safehouse, SAFEHOUSE_RADIUS, open ? 0x3ddc84 : 0xd9534f, s.safehouseKnown, s.safehouseKnown);
    parts.forEach((q, i) => { // each fuse still to find
      if (s.tasks.length + 1 + i < n) set(s.tasks.length + 1 + i, { x: q.x + 1.2, y: q.y + 1.2 }, 1.3, 0xf2b630, true, !cur!.got![i]);
    });
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
