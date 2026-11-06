import {
  AnimationAction, AnimationClip, AnimationMixer, Box3, EqualStencilFunc, GreaterDepth, KeepStencilOp, LoopRepeat, MeshBasicMaterial, MeshLambertMaterial,
  NearestFilter, Object3D, SkinnedMesh, SRGBColorSpace, TextureLoader, Vector3, type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const SKINS = ['humanMaleA', 'humanFemaleA', 'zombieMaleA', 'zombieFemaleA'] as const;
export type SkinName = (typeof SKINS)[number];

const HEIGHT = 2.2; // world units for a standing character
const RUN_REF_SPEED = 5.5; // units/s at which the run clip plays at 1x

export interface CharacterAssets {
  template: Object3D;
  clips: { idle: AnimationClip; run: AnimationClip };
  materials: Record<SkinName, Material>;
  xray: Material;
  scale: number;
}

export async function loadCharacterAssets(): Promise<CharacterAssets> {
  const base = `${import.meta.env.BASE_URL}assets/characters/`;
  const gltf = await new GLTFLoader().loadAsync(`${base}character.glb`);
  const idle = gltf.animations.find((a) => a.name === 'Idle');
  const run = gltf.animations.find((a) => a.name === 'Run');
  if (!idle || !run) throw new Error('character.glb is missing Idle/Run clips');

  gltf.scene.updateMatrixWorld(true);
  const size = new Box3().setFromObject(gltf.scene).getSize(new Vector3());

  const textures = new TextureLoader();
  const materials = {} as Record<SkinName, Material>;
  await Promise.all(SKINS.map(async (name) => {
    const map = await textures.loadAsync(`${base}${name}.png`);
    map.colorSpace = SRGBColorSpace;
    map.flipY = true; // the converted UVs use three's convention (v=0 at bottom), not glTF's
    map.magFilter = NearestFilter;
    map.generateMipmaps = false;
    map.minFilter = NearestFilter;
    materials[name] = new MeshLambertMaterial({ map });
  }));
  // Silhouette only where a building was drawn (stencil ref 1, written by the city material), so a
  // character's own limbs never show through its own body.
  const xray = new MeshBasicMaterial({
    color: 0x7fb8ff, depthFunc: GreaterDepth, depthWrite: false, transparent: true, opacity: 0.55,
    stencilWrite: true, stencilRef: 1, stencilFunc: EqualStencilFunc,
    stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: KeepStencilOp,
  });
  return { template: gltf.scene, clips: { idle, run }, materials, xray, scale: HEIGHT / size.y };
}

/** One animated character: own skeleton and mixer, shared geometry and materials. */
export class Actor {
  readonly root: Object3D;
  private mixer: AnimationMixer;
  private idle: AnimationAction;
  private run: AnimationAction;
  private moving = false;
  private lastX = NaN;
  private lastZ = NaN;

  constructor(assets: CharacterAssets, skin: SkinName, withXray = false) {
    this.root = clone(assets.template);
    this.root.scale.setScalar(assets.scale);
    this.root.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.material = assets.materials[skin];
      m.frustumCulled = true;
      if (withXray) {
        const x = new SkinnedMesh(m.geometry, assets.xray);
        x.bind(m.skeleton, m.bindMatrix);
        x.renderOrder = 2;
        x.frustumCulled = false;
        m.parent!.add(x);
      }
    });
    this.mixer = new AnimationMixer(this.root);
    this.idle = this.mixer.clipAction(assets.clips.idle).setLoop(LoopRepeat, Infinity);
    this.run = this.mixer.clipAction(assets.clips.run).setLoop(LoopRepeat, Infinity);
    this.idle.play();
    this.run.play();
    this.run.setEffectiveWeight(0);
    this.mixer.update(Math.random() * 0.5); // desync crowds (render-only randomness)
  }

  /** Place and animate. Speed is measured from frame-to-frame movement, so the sim stays render-free. */
  update(x: number, z: number, headingY: number, dt: number, animate: boolean): void {
    const speed = Number.isNaN(this.lastX) || dt <= 0 ? 0 : Math.hypot(x - this.lastX, z - this.lastZ) / dt;
    this.lastX = x;
    this.lastZ = z;
    this.root.position.set(x, 0, z);
    this.root.rotation.y = headingY;
    if (!animate) return;
    const moving = speed > 0.3;
    if (moving !== this.moving) {
      this.moving = moving;
      const [from, to] = moving ? [this.idle, this.run] : [this.run, this.idle];
      to.reset().play();
      to.crossFadeFrom(from, 0.15, false);
    }
    if (moving) this.run.setEffectiveTimeScale(Math.max(0.35, speed / RUN_REF_SPEED));
    this.mixer.update(dt);
  }
}
