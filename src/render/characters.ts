import {
  AnimationAction, AnimationClip, AnimationMixer, EqualStencilFunc, GreaterDepth, KeepStencilOp, LoopOnce, LoopRepeat,
  MeshBasicMaterial, MeshLambertMaterial, NearestFilter, Object3D, SkinnedMesh, SRGBColorSpace, TextureLoader, type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const SKINS = ['humanMaleA', 'humanFemaleA', 'zombieMaleA', 'zombieFemaleA'] as const;
export type SkinName = (typeof SKINS)[number];

export type ClipName =
  | 'Idle' | 'Walk' | 'Jog' | 'Sprint' | 'Death' | 'Interact' | 'Kneel' | 'Talk'
  | 'ZIdle' | 'ZWalk' | 'ZAttack' | 'ZRise';

export const HEIGHT = 2.8; // world units; must match the core's scale (about 1.75 m)
const TURN_RATE = 10; // rad/s: characters turn, they do not snap

interface ClipMeta { duration: number; loop: boolean; groundSpeed: number }

export interface CharacterAssets {
  template: Object3D;
  clips: Map<ClipName, AnimationClip>;
  /** World units per second covered by one cycle at 1x playback (for foot-locked playback rates). */
  groundSpeed: Map<ClipName, number>;
  materials: Record<SkinName, Material>;
  xray: Material;
  scale: number;
}

export async function loadCharacterAssets(): Promise<CharacterAssets> {
  const base = `${import.meta.env.BASE_URL}assets/characters/`;
  const [gltf, meta] = await Promise.all([
    new GLTFLoader().loadAsync(`${base}character.glb`),
    fetch(`${base}character.json`).then((r) => r.json() as Promise<{ height: number; clips: Record<string, ClipMeta> }>),
  ]);
  const scale = HEIGHT / meta.height;
  const clips = new Map<ClipName, AnimationClip>();
  const groundSpeed = new Map<ClipName, number>();
  for (const c of gltf.animations) {
    clips.set(c.name as ClipName, c);
    groundSpeed.set(c.name as ClipName, (meta.clips[c.name]?.groundSpeed ?? 0) * scale);
  }

  const textures = new TextureLoader();
  const materials = {} as Record<SkinName, Material>;
  await Promise.all(SKINS.map(async (name) => {
    const map = await textures.loadAsync(`${base}${name}.png`);
    map.colorSpace = SRGBColorSpace;
    map.flipY = true; // the converted UVs use three's convention (v=0 at bottom), not glTF's
    map.magFilter = NearestFilter;
    map.minFilter = NearestFilter;
    map.generateMipmaps = false;
    materials[name] = new MeshLambertMaterial({ map });
  }));
  // Silhouette only where a building or prop was drawn (stencil ref 1, written by the city), so a
  // character's own limbs never show through its own body.
  const xray = new MeshBasicMaterial({
    color: 0x7fb8ff, depthFunc: GreaterDepth, depthWrite: false, transparent: true, opacity: 0.5,
    stencilWrite: true, stencilRef: 1, stencilFunc: EqualStencilFunc,
    stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: KeepStencilOp,
  });
  return { template: gltf.scene, clips, groundSpeed, materials, xray, scale };
}

/** One animated character: own skeleton and mixer, shared geometry, clips and materials. */
export class Actor {
  readonly root: Object3D;
  private mixer: AnimationMixer;
  private actions = new Map<ClipName, AnimationAction>();
  private current: ClipName | null = null;
  private yaw = 0;
  private placed = false;

  constructor(private assets: CharacterAssets, skin: SkinName, withXray = false) {
    this.root = clone(assets.template);
    this.root.scale.setScalar(assets.scale);
    this.root.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.material = assets.materials[skin];
      if (withXray) {
        const x = new SkinnedMesh(m.geometry, assets.xray);
        x.bind(m.skeleton, m.bindMatrix);
        x.renderOrder = 2;
        x.frustumCulled = false;
        m.parent!.add(x);
      }
    });
    this.mixer = new AnimationMixer(this.root);
  }

  private action(name: ClipName): AnimationAction {
    let a = this.actions.get(name);
    if (!a) {
      const clip = this.assets.clips.get(name);
      if (!clip) throw new Error(`missing clip ${name}`);
      a = this.mixer.clipAction(clip);
      this.actions.set(name, a);
    }
    return a;
  }

  /**
   * Switch to a clip with a crossfade. `once` clips hold their last frame. `restart` replays a
   * clip that is already playing (a second lunge).
   */
  play(name: ClipName, opts: { once?: boolean; timeScale?: number; fade?: number; restart?: boolean; startAt?: number } = {}): void {
    const a = this.action(name);
    a.setEffectiveTimeScale(opts.timeScale ?? 1);
    if (this.current === name && !opts.restart) return;
    const fade = opts.fade ?? 0.2;
    a.reset();
    a.setLoop(opts.once ? LoopOnce : LoopRepeat, Infinity);
    a.clampWhenFinished = !!opts.once;
    if (opts.startAt) a.time = opts.startAt * a.getClip().duration;
    a.setEffectiveWeight(1);
    a.play();
    const prev = this.current ? this.actions.get(this.current) : undefined;
    if (prev && prev !== a) a.crossFadeFrom(prev, fade, false);
    else if (!prev) a.fadeIn(0.01);
    this.current = name;
  }

  /** Playback rate that makes a locomotion cycle cover exactly `speed` units/s (no foot sliding). */
  rateFor(name: ClipName, speed: number): number {
    const g = this.assets.groundSpeed.get(name) ?? 0;
    return g > 0 ? speed / g : 1;
  }

  /** Human locomotion chosen from real ground speed, with foot-locked playback rate. */
  locomote(speed: number): void {
    if (speed < 0.15) { this.play('Idle', { fade: 0.25 }); return; }
    const clip: ClipName = speed < 1.7 ? 'Walk' : speed < 3.7 ? 'Jog' : 'Sprint';
    this.play(clip, { timeScale: this.rateFor(clip, speed), fade: 0.18 });
  }

  /** Place, turn smoothly toward a heading (game radians), and advance the animation. */
  update(x: number, z: number, heading: number, dt: number, animate: boolean): void {
    const targetYaw = Math.PI / 2 - heading;
    if (!this.placed) { this.yaw = targetYaw; this.placed = true; }
    let d = targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const maxTurn = TURN_RATE * dt;
    this.yaw += Math.abs(d) <= maxTurn ? d : Math.sign(d) * maxTurn;
    this.root.position.set(x, 0, z);
    this.root.rotation.y = this.yaw;
    if (animate) this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}
