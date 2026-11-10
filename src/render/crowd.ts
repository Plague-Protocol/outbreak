// The infected, drawn as a crowd: every zombie and every body in two draw calls (one per skin).
//
// Their animations are baked once at load into a texture of bone matrices (one row per frame at
// BAKE_FPS), so the graphics chip poses each one by reading its row, and the CPU only works out
// which row each one is on. Individually animated characters (an animation mixer, a skeleton and a
// draw call each) cost far more per zombie; this is what lets the town be crowded on a phone.
// No blending between clips: at this distance a switch reads fine, and it halves the texture reads.
import {
  AnimationMixer, DataTexture, FloatType, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, type Material, MeshLambertMaterial,
  Quaternion, RGBAFormat, type SkinnedMesh, Vector3,
} from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterAssets, ClipName } from './characters';

export type CrowdClip = 'ZIdle' | 'ZWalk' | 'Sprint' | 'ZAttack' | 'Hit' | 'Death' | 'ZRise';
const CLIPS: CrowdClip[] = ['ZIdle', 'ZWalk', 'Sprint', 'ZAttack', 'Hit', 'Death', 'ZRise'];
const BAKE_FPS = 30;
const TURN_RATE = 10; // rad/s, as the characters turn

interface Baked { start: number; rows: number }
interface Track { clip: CrowdClip; t0: number; rate: number; yaw: number; seen: number }

export class Crowd {
  readonly group = new Group();
  private meshes: InstancedMesh[] = [];
  private rows: InstancedBufferAttribute[] = [];
  private counts = [0, 0];
  private baked = new Map<CrowdClip, Baked>();
  private tracks = new Map<number, Track>();
  private time = 0;
  private frame = 0;
  private m = new Matrix4();
  private q = new Quaternion();
  private up = new Vector3(0, 1, 0);
  private s: Vector3;
  private at = new Vector3();

  constructor(assets: CharacterAssets, readonly max = 160) {
    this.s = new Vector3().setScalar(assets.scale);
    // bake: pose a copy of the character frame by frame and keep each bone's skinning matrix
    const root = clone(assets.template);
    let mesh: SkinnedMesh | null = null;
    root.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as SkinnedMesh; });
    const sm = mesh! as SkinnedMesh;
    const bones = sm.skeleton.bones.length;
    const mixer = new AnimationMixer(root);
    let total = 0;
    for (const c of CLIPS) { const clip = assets.clips.get(c as ClipName)!; const rows = Math.ceil(clip.duration * BAKE_FPS) + 1; this.baked.set(c, { start: total, rows }); total += rows; }
    const data = new Float32Array(bones * 4 * 4 * total);
    const k = new Matrix4();
    for (const c of CLIPS) {
      const clip = assets.clips.get(c as ClipName)!;
      const b = this.baked.get(c)!;
      mixer.stopAllAction();
      mixer.clipAction(clip).reset().play();
      for (let f = 0; f < b.rows; f++) {
        mixer.setTime(Math.min(f / BAKE_FPS, clip.duration - 1e-4));
        root.updateMatrixWorld(true);
        sm.skeleton.bones.forEach((bone, i) => {
          k.multiplyMatrices(bone.matrixWorld, sm.skeleton.boneInverses[i]!).multiply(sm.bindMatrix);
          data.set(k.elements, ((b.start + f) * bones + i) * 16);
        });
      }
    }
    const tex = new DataTexture(data, bones * 4, total, RGBAFormat, FloatType);
    tex.needsUpdate = true;

    for (const skin of ['zombieMaleA', 'zombieFemaleA'] as const) {
      const mat = new MeshLambertMaterial({ map: (assets.materials[skin] as MeshLambertMaterial).map });
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.boneTex = { value: tex };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute float animRow;
uniform highp sampler2D boneTex;
mat4 crowdBone(float b) {
  ivec2 p = ivec2(int(b) * 4, int(animRow));
  return mat4(texelFetch(boneTex, p, 0), texelFetch(boneTex, p + ivec2(1, 0), 0), texelFetch(boneTex, p + ivec2(2, 0), 0), texelFetch(boneTex, p + ivec2(3, 0), 0));
}`)
          .replace('#include <beginnormal_vertex>', `mat4 skinM = skinWeight.x * crowdBone(skinIndex.x) + skinWeight.y * crowdBone(skinIndex.y)
  + skinWeight.z * crowdBone(skinIndex.z) + skinWeight.w * crowdBone(skinIndex.w);
vec3 objectNormal = normalize(mat3(skinM) * normal);`)
          .replace('#include <begin_vertex>', 'vec3 transformed = (skinM * vec4(position, 1.0)).xyz;');
      };
      const geo = sm.geometry.clone();
      const row = new InstancedBufferAttribute(new Float32Array(max), 1);
      geo.setAttribute('animRow', row);
      const im = new InstancedMesh(geo, mat as Material, max);
      im.frustumCulled = false; // spread over the street: the bounds of one would cull the rest
      im.count = 0;
      this.meshes.push(im);
      this.rows.push(row);
      this.group.add(im);
    }
  }

  /** Start a frame: nothing drawn yet. */
  begin(dt: number): void {
    this.time += dt;
    this.frame++;
    this.counts = [0, 0];
  }

  /**
   * One of them, this frame. `rate` scales the clip (foot-locked walking); `once` clips hold their
   * last frame; `restart` plays a once clip again from the top; `end` shows it already finished.
   */
  draw(id: number, x: number, z: number, heading: number, clip: CrowdClip, dt: number, o: { rate?: number; once?: boolean; restart?: boolean; end?: boolean; y?: number } = {}): void {
    const skin = id % 2;
    const n = this.counts[skin]!;
    if (n >= this.max) return;
    const rate = o.rate ?? 1;
    const want = Math.PI / 2 - heading;
    let t = this.tracks.get(id);
    if (!t) { t = { clip, t0: o.end ? -1e6 : this.time, rate, yaw: want, seen: this.frame }; this.tracks.set(id, t); }
    else if (t.clip !== clip || o.restart) { t.clip = clip; t.t0 = o.end ? -1e6 : this.time; t.rate = rate; }
    else if (t.rate !== rate) { t.t0 = this.time - ((this.time - t.t0) * t.rate) / rate; t.rate = rate; } // same place in the cycle
    t.seen = this.frame;
    let d = want - t.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    t.yaw += Math.abs(d) <= TURN_RATE * dt ? d : Math.sign(d) * TURN_RATE * dt;

    const b = this.baked.get(clip)!;
    const f = Math.floor((this.time - t.t0) * t.rate * BAKE_FPS);
    const row = b.start + (o.once || o.end ? Math.min(f, b.rows - 1) : ((f % (b.rows - 1)) + (b.rows - 1)) % (b.rows - 1));
    this.rows[skin]!.setX(n, row);
    this.q.setFromAxisAngle(this.up, t.yaw);
    this.m.compose(this.at.set(x, o.y ?? 0, z), this.q, this.s);
    this.meshes[skin]!.setMatrixAt(n, this.m);
    this.counts[skin] = n + 1;
  }

  /** Finish the frame: upload what was drawn, forget the ones no longer in view. */
  end(): void {
    this.meshes.forEach((im, i) => {
      im.count = this.counts[i]!;
      im.instanceMatrix.needsUpdate = true;
      this.rows[i]!.needsUpdate = true;
    });
    if (this.frame % 60 === 0) for (const [id, t] of this.tracks) if (this.frame - t.seen > 30) this.tracks.delete(id);
  }

  /** How many were drawn this frame. */
  get drawn(): number { return this.counts[0]! + this.counts[1]!; }

  /** Forget everyone (a new district). */
  reset(): void { this.tracks.clear(); }
}

