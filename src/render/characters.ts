import {
  AnimationAction, AnimationClip, Matrix4, Quaternion, Vector3, AnimationMixer, EqualStencilFunc, GreaterDepth, KeepStencilOp, LoopOnce, LoopRepeat,
  MeshBasicMaterial, MeshLambertMaterial, NearestFilter, Object3D, SkinnedMesh, SRGBColorSpace, TextureLoader, type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const SKINS = ['humanMaleA', 'humanFemaleA', 'zombieMaleA', 'zombieFemaleA'] as const;
export type SkinName = (typeof SKINS)[number];

export type ClipName =
  | 'Idle' | 'Walk' | 'Jog' | 'Sprint' | 'Death' | 'Hit' | 'Aim' | 'Shoot' | 'Reload' | 'Interact' | 'Kneel' | 'Talk'
  | 'Swing' | 'Swing2'
  | 'ZIdle' | 'ZWalk' | 'ZAttack' | 'ZRise'
  | UpperClip;
export type UpperClip = 'AimUpper' | 'ShootUpper' | 'ReloadUpper' | 'SwingUpper' | 'Swing2Upper';

const UPPER_BONES = /^(Spine|Chest|UpperChest|Neck|Head|Left(Shoulder|Arm|ForeArm|Hand)|Right(Shoulder|Arm|ForeArm|Hand))\./;

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
  // upper-body versions of the gun and melee clips, layered over locomotion
  for (const name of ['Aim', 'Shoot', 'Reload', 'Swing', 'Swing2'] as const) {
    const c = clips.get(name);
    if (c) clips.set(`${name}Upper`, new AnimationClip(`${name}Upper`, c.duration, c.tracks.filter((t) => UPPER_BONES.test(t.name))));
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
  private upper: UpperClip | null = null;
  private hand: Object3D | null = null;
  private held: Object3D | null = null;
  /** Where worn gear hangs: a frame on the bone, lined up with the body at rest, in world units. */
  private mounts = new Map<'chest' | 'head', Object3D>();

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
    this.hand = this.root.getObjectByName('RightHand') ?? null;
    // mounts for worn gear, measured in the rest pose (before any animation): a child of the bone
    // whose axes are the character's own (+z forward, +y up), unscaled, at the bone's position
    this.root.updateMatrixWorld(true);
    for (const [slot, names] of [['chest', ['UpperChest', 'Chest', 'Spine']], ['head', ['Head']]] as const) {
      const bone = names.map((n) => this.root.getObjectByName(n)).find((b) => b);
      if (!bone) continue;
      const at = new Vector3().setFromMatrixPosition(bone.matrixWorld);
      const rootQ = this.root.getWorldQuaternion(new Quaternion());
      const want = new Matrix4().compose(at, rootQ, new Vector3(1, 1, 1));
      const mount = new Object3D();
      mount.matrixAutoUpdate = false;
      mount.matrix.copy(bone.matrixWorld).invert().multiply(want);
      bone.add(mount);
      this.mounts.set(slot, mount);
    }
  }

  /** Wear something on the chest or head (null takes it off). Built in world units around the
   * middle of the chest or head, +z forward. */
  wear(slot: 'chest' | 'head', obj: Object3D | null, offset = new Vector3()): void {
    const mount = this.mounts.get(slot);
    if (!mount) return;
    mount.clear();
    if (!obj) return;
    obj.position.add(offset);
    mount.add(obj);
  }

  /**
   * Upper-body layer (aim, shoot, reload) over whatever the legs are doing. It runs at a high
   * weight so it dominates the arms and spine, while the legs (not in the clip) keep walking.
   */
  setUpper(name: UpperClip | null, opts: { timeScale?: number; restart?: boolean } = {}): void {
    if (name === this.upper && !opts.restart) {
      if (name && opts.timeScale) this.action(name).setEffectiveTimeScale(opts.timeScale);
      return;
    }
    if (this.upper && this.upper !== name) this.action(this.upper).fadeOut(0.15);
    this.upper = name;
    if (!name) return;
    const a = this.action(name);
    a.reset();
    a.setLoop(name === 'AimUpper' ? LoopRepeat : LoopOnce, Infinity);
    a.clampWhenFinished = true;
    a.setEffectiveTimeScale(opts.timeScale ?? 1);
    a.weight = 4;
    a.fadeIn(0.1);
    a.play();
  }

  /**
   * Put an object in the right hand, parented to the hand bone so it follows every animation.
   * The object's +x runs along the knuckles (a gun's barrel), +y toward the thumb (the top of the
   * gun), and its origin sits in the palm (the middle of the grip). Pass null to empty the hand.
   */
  holdInRightHand(obj: Object3D | null): void {
    if (this.held) this.held.removeFromParent();
    this.held = obj;
    if (!obj || !this.hand) return;
    const index = this.hand.getObjectByName('RightHandIndex1');
    const thumb = this.hand.getObjectByName('RightHandThumb1');
    if (!index || !thumb) { this.hand.add(obj); return; }
    // bone positions are in the hand's local space
    const along = index.position.clone().normalize();
    const up = thumb.position.clone().addScaledVector(along, -thumb.position.dot(along)).normalize();
    const side = new Vector3().crossVectors(along, up);
    obj.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(along, up, side));
    obj.position.copy(index.position).multiplyScalar(0.55).addScaledVector(up, -index.position.length() * 0.12);
    // undo the skeleton's scale so the object keeps its world size
    this.root.updateMatrixWorld(true);
    obj.scale.setScalar(1 / this.hand.getWorldScale(new Vector3()).x);
    this.hand.add(obj);
  }

  /** World position of the right hand (for the gun and the muzzle flash). */
  handPosition(out: Vector3): Vector3 {
    if (this.hand) return this.hand.getWorldPosition(out);
    return out.copy(this.root.position).setY(1.3);
  }

  get yawAngle(): number {
    return this.yaw;
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

  /** Swap the skin (pooled actors are reused for different zombies). */
  setSkin(skin: SkinName): void {
    const mat = this.assets.materials[skin];
    this.root.traverse((o) => {
      const m = o as SkinnedMesh;
      if (m.isSkinnedMesh && m.material !== this.assets.xray) m.material = mat;
    });
  }

  /** Forget the current animation and facing, ready for reuse. */
  reset(): void {
    this.mixer.stopAllAction();
    this.current = null;
    this.upper = null;
    this.placed = false;
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}
