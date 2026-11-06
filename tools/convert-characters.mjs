// One-off asset build: Kenney "Animated Characters 3" body (CC0) + Quaternius "Universal Animation
// Library" 1 and 2 clips (CC0), retargeted onto the Kenney skeleton, written as one GLB plus a JSON
// of measured locomotion speeds.
//
// Usage:
//   node tools/convert-characters.mjs <kenney-pack-dir> <UAL1.glb> <UAL2.glb> <out-dir>
//
// Retargeting: for each frame, every mapped bone on the target gets the same world-space rotation
// change (relative to its rest pose) as the matching source bone. Rest poses differ (T vs A pose,
// different bone axes), so each bone's rest is first aligned by the rotation that takes the source
// bone's direction onto the target's. Hip translation is scaled by the leg-length ratio.
// Only three.js is used (no extra dependencies).
import fs from 'node:fs';
import {
  AnimationClip, AnimationMixer, Box3, Matrix4, MeshBasicMaterial, Quaternion, QuaternionKeyframeTrack, Vector3,
  VectorKeyframeTrack,
} from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = `data:application/octet-stream;base64,${Buffer.from(b).toString('base64')}`; this.onloadend?.(); }); }
};

const [kenneyDir, ual1Path, ual2Path, outDir] = process.argv.slice(2);
if (!outDir) { console.error('usage: convert-characters.mjs <kenney-dir> <UAL1.glb> <UAL2.glb> <out-dir>'); process.exit(1); }
const FPS = 20; // keys are interpolated; 20/s is plenty at this camera distance

// target bone -> [UAL1 bone, UAL2 bone]. Order matters: parents before children.
const MAP = [
  ['Hips', 'DEF-hips', 'pelvis'],
  ['Spine', 'DEF-spine001', 'spine_01'],
  ['Chest', 'DEF-spine002', 'spine_02'],
  ['UpperChest', 'DEF-spine003', 'spine_03'],
  ['Neck', 'DEF-neck', 'neck_01'],
  ['Head', 'DEF-head', 'Head'],
  ...['Left', 'Right'].flatMap((side) => {
    const a = side === 'Left' ? 'L' : 'R', b = side === 'Left' ? 'l' : 'r';
    return [
      [`${side}Shoulder`, `DEF-shoulder${a}`, `clavicle_${b}`],
      [`${side}Arm`, `DEF-upper_arm${a}`, `upperarm_${b}`],
      [`${side}ForeArm`, `DEF-forearm${a}`, `lowerarm_${b}`],
      [`${side}Hand`, `DEF-hand${a}`, `hand_${b}`],
      [`${side}HandIndex1`, `DEF-f_index01${a}`, `index_01_${b}`],
      [`${side}HandIndex2`, `DEF-f_index02${a}`, `index_02_${b}`],
      [`${side}HandIndex3`, `DEF-f_index03${a}`, `index_03_${b}`],
      [`${side}HandThumb1`, `DEF-thumb01${a}`, `thumb_01_${b}`],
      [`${side}HandThumb2`, `DEF-thumb02${a}`, `thumb_02_${b}`],
      [`${side}UpLeg`, `DEF-thigh${a}`, `thigh_${b}`],
      [`${side}Leg`, `DEF-shin${a}`, `calf_${b}`],
      [`${side}Foot`, `DEF-foot${a}`, `foot_${b}`],
      [`${side}Toes`, `DEF-toe${a}`, `ball_${b}`],
    ];
  }),
];
// direction child used to align each bone's rest pose
const DIR_CHILD = {
  Hips: 'Spine', Spine: 'Chest', Chest: 'UpperChest', UpperChest: 'Neck', Neck: 'Head',
  LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', LeftHand: 'LeftHandIndex1',
  LeftHandIndex1: 'LeftHandIndex2', LeftHandIndex2: 'LeftHandIndex3', LeftHandThumb1: 'LeftHandThumb2',
  RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand', RightHand: 'RightHandIndex1',
  RightHandIndex1: 'RightHandIndex2', RightHandIndex2: 'RightHandIndex3', RightHandThumb1: 'RightHandThumb2',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToes',
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToes',
};

// [output name, source lib (1|2), source clip, loop, measure ground speed]
const CLIPS = [
  ['Idle', 1, 'Idle_Loop', true, false],
  ['Walk', 1, 'Walk_Loop', true, true],
  ['Jog', 1, 'Jog_Fwd_Loop', true, true],
  ['Sprint', 1, 'Sprint_Loop', true, true],
  ['Death', 1, 'Death01', false, false],
  ['Hit', 1, 'Hit_Chest', false, false],
  ['Aim', 1, 'Pistol_Idle_Loop', true, false],
  ['Shoot', 1, 'Pistol_Shoot', false, false],
  ['Reload', 1, 'Pistol_Reload', false, false],
  ['Interact', 1, 'Interact', false, false],
  ['Kneel', 1, 'Fixing_Kneeling', true, false],
  ['Talk', 1, 'Idle_Talking_Loop', true, false],
  ['ZIdle', 2, 'Zombie_Idle_Loop', true, false],
  ['ZWalk', 2, 'Zombie_Walk_Fwd_Loop', true, true],
  ['ZAttack', 2, 'Zombie_Scratch', false, false],
  ['ZRise', 2, 'LayToIdle', false, false],
];

const ab = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const loadGlb = (p) => new Promise((res, rej) => new GLTFLoader().parse(ab(p), '', res, rej));

const fbx = new FBXLoader();
const target = fbx.parse(ab(`${kenneyDir}/Model/characterMedium.fbx`), '');
target.traverse((o) => { if (o.isMesh) o.material = new MeshBasicMaterial({ name: 'skin' }); });
const sources = { 1: await loadGlb(ual1Path), 2: await loadGlb(ual2Path) };

const tBone = (n) => { const b = target.getObjectByName(n); if (!b) throw new Error(`target bone ${n} missing`); return b; };
const worldQ = (o) => o.getWorldQuaternion(new Quaternion());
const worldP = (o) => o.getWorldPosition(new Vector3());

// target rest pose
target.updateMatrixWorld(true);
const tRest = new Map(MAP.map(([t]) => [t, { q: worldQ(tBone(t)), p: worldP(tBone(t)) }]));
const tLocalRest = new Map(MAP.map(([t]) => [t, tBone(t).quaternion.clone()]));
const tHipsLocalPos = tBone('Hips').position.clone();

function basis(get) {
  const hips = get('Hips'), head = get('Head'), l = get('LeftUpLeg'), r = get('RightUpLeg');
  const up = head.clone().sub(hips).normalize();
  const right = r.clone().sub(l); right.addScaledVector(up, -right.dot(up)).normalize();
  const fwd = new Vector3().crossVectors(right, up).normalize();
  return new Matrix4().makeBasis(right, up, fwd);
}
const tBasis = basis((n) => tRest.get(n).p);
const legLen = (get) => get('LeftUpLeg').distanceTo(get('LeftLeg')) + get('LeftLeg').distanceTo(get('LeftFoot'));

function retarget(lib, srcName, outName, loop) {
  const src = sources[lib];
  const clip = src.animations.find((a) => a.name === srcName);
  if (!clip) throw new Error(`clip ${srcName} not found in UAL${lib}`);
  const scene = src.scene;
  const col = lib === 1 ? 1 : 2;
  const sBone = (t) => { const m = MAP.find((x) => x[0] === t); const b = scene.getObjectByName(m[col]); if (!b) throw new Error(`source bone ${m[col]} missing`); return b; };

  // source rest = its bind pose (initial node transforms)
  const mixer = new AnimationMixer(scene);
  mixer.stopAllAction();
  scene.traverse((o) => { if (o.userData.__rest) { o.quaternion.copy(o.userData.__rest.q); o.position.copy(o.userData.__rest.p); } else o.userData.__rest = { q: o.quaternion.clone(), p: o.position.clone() }; });
  scene.updateMatrixWorld(true);
  const sRestP = (t) => worldP(sBone(t));
  const sB = basis(sRestP);
  // G rotates the source frame onto the target frame (facing + up)
  const G = new Quaternion().setFromRotationMatrix(tBasis.clone().multiply(sB.clone().invert()));
  const ratio = legLen((n) => tRest.get(n).p) / legLen(sRestP);

  const sRestQ = new Map(), A = new Map();
  for (const [t] of MAP) {
    const qs = G.clone().multiply(worldQ(sBone(t)));
    sRestQ.set(t, qs);
    const c = DIR_CHILD[t];
    if (c) {
      const dS = sRestP(c).sub(sRestP(t)).applyQuaternion(G).normalize();
      const dT = tRest.get(c).p.clone().sub(tRest.get(t).p).normalize();
      A.set(t, new Quaternion().setFromUnitVectors(dS, dT));
    } else {
      A.set(t, A.get(MAP.find((m) => DIR_CHILD[m[0]] === t)?.[0]) ?? new Quaternion());
    }
  }
  const sHipsRest = sRestP('Hips');

  const action = mixer.clipAction(clip); action.play();
  const n = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const times = new Float32Array(n);
  const qv = new Map(MAP.map(([t]) => [t, new Float32Array(n * 4)]));
  const pv = new Float32Array(n * 3);
  const hipsParentInv = new Matrix4().copy(tBone('Hips').parent.matrixWorld).invert();

  for (let i = 0; i < n; i++) {
    const time = Math.min(clip.duration, (i / (n - 1)) * clip.duration);
    times[i] = time;
    // a looping action wraps exactly at its duration back to frame 0, which would make one-shot
    // clips (Death, Hit, ZRise) snap back to their first pose on the last key: sample just before
    mixer.setTime(Math.min(time, clip.duration - 1e-4));
    scene.updateMatrixWorld(true);
    const newWorld = new Map();
    for (const [t] of MAP) {
      const qs = G.clone().multiply(worldQ(sBone(t)));
      const delta = qs.multiply(sRestQ.get(t).clone().invert()).multiply(A.get(t).clone().invert());
      const qt = delta.multiply(tRest.get(t).q);
      newWorld.set(t, qt);
      const parent = tBone(t).parent;
      const parentW = newWorld.get(parent.name) ?? worldQ(parent);
      const local = parentW.clone().invert().multiply(qt);
      local.toArray(qv.get(t), i * 4);
    }
    const d = worldP(sBone('Hips')).sub(sHipsRest).applyQuaternion(G).multiplyScalar(ratio);
    const hp = tRest.get('Hips').p.clone().add(d).applyMatrix4(hipsParentInv);
    hp.toArray(pv, i * 3);
  }
  mixer.stopAllAction();
  // fingers are not visible at the game's camera distance: skip their tracks to keep the file small
  const tracks = MAP.filter(([t]) => !/Hand(Index|Thumb)/.test(t))
    .map(([t]) => new QuaternionKeyframeTrack(`${t}.quaternion`, times, qv.get(t)));
  tracks.push(new VectorKeyframeTrack('Hips.position', times, pv));
  const out = new AnimationClip(outName, clip.duration, tracks);
  out.userData = { loop };
  return out;
}

/** Ground speed of an in-place cycle: horizontal speed of whichever foot is lower (planted). */
function groundSpeed(clip) {
  const mixer = new AnimationMixer(target);
  mixer.clipAction(clip).play();
  const lf = tBone('LeftFoot'), rf = tBone('RightFoot');
  const steps = 60, dt = clip.duration / steps;
  let sum = 0, cnt = 0, prev = null;
  for (let i = 0; i <= steps; i++) {
    mixer.setTime(i * dt);
    target.updateMatrixWorld(true);
    const l = worldP(lf), r = worldP(rf);
    const low = l.y < r.y ? 'l' : 'r';
    const cur = { l, r, low };
    if (prev && prev.low === low) {
      const a = prev[low], b = cur[low];
      sum += Math.hypot(b.x - a.x, b.z - a.z) / dt; cnt++;
    }
    prev = cur;
  }
  mixer.stopAllAction();
  target.traverse((o) => { if (o.isBone && tLocalRest.has(o.name)) o.quaternion.copy(tLocalRest.get(o.name)); });
  tBone('Hips').position.copy(tHipsLocalPos);
  return cnt ? sum / cnt : 0;
}

const clips = [];
const meta = { height: 0, clips: {} };
for (const [name, lib, src, loop, measure] of CLIPS) {
  const c = retarget(lib, src, name, loop);
  clips.push(c);
  meta.clips[name] = { duration: +c.duration.toFixed(3), loop, groundSpeed: measure ? +groundSpeed(c).toFixed(3) : 0 };
}
target.updateMatrixWorld(true);
meta.height = +new Box3().setFromObject(target).getSize(new Vector3()).y.toFixed(3);
for (const [k, v] of Object.entries(meta.clips)) console.log(k.padEnd(9), JSON.stringify(v));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/character.json`, `${JSON.stringify(meta, null, 2)}\n`);
new GLTFExporter().parse(target, (glb) => {
  fs.writeFileSync(`${outDir}/character.glb`, Buffer.from(glb));
  console.log('wrote', `${outDir}/character.glb`, fs.statSync(`${outDir}/character.glb`).size, 'bytes');
}, (e) => { console.error(e); process.exit(1); }, { binary: true, animations: clips, onlyVisible: false });
