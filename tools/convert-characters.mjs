// One-off asset conversion: Kenney "Animated Characters 3" (CC0) FBX -> one small GLB.
// Usage: node tools/convert-characters.mjs <unzipped-pack-dir> <out.glb>
// Uses only three's own FBXLoader/GLTFExporter (no extra dependencies). Keeps the Idle and Run
// clips; the skin textures are shipped separately as small PNGs and applied at runtime.
import fs from 'node:fs';
import { Box3, Vector3, MeshBasicMaterial } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// GLTFExporter's binary path wants FileReader, which Node lacks.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = `data:application/octet-stream;base64,${Buffer.from(b).toString('base64')}`; this.onloadend?.(); }); }
};

const [dir, out] = process.argv.slice(2);
const ab = (f) => { const b = fs.readFileSync(`${dir}/${f}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const loader = new FBXLoader();
const model = loader.parse(ab('Model/characterMedium.fbx'), '');
model.traverse((o) => { if (o.isMesh) o.material = new MeshBasicMaterial({ name: 'skin' }); });

const clips = [];
for (const [file, want, name] of [['idle', 'Root|Idle', 'Idle'], ['run', 'Root|Run', 'Run']]) {
  const c = loader.parse(ab(`Animations/${file}.fbx`), '').animations.find((a) => a.name === want);
  c.name = name;
  c.optimize?.();
  clips.push(c);
}
const box = new Box3().setFromObject(model);
console.log('bounds', box.min.toArray().map((n) => +n.toFixed(2)), box.max.toArray().map((n) => +n.toFixed(2)), 'size', box.getSize(new Vector3()).toArray().map((n) => +n.toFixed(2)));

new GLTFExporter().parse(model, (glb) => {
  fs.writeFileSync(out, Buffer.from(glb));
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
}, (e) => { console.error(e); process.exit(1); }, { binary: true, animations: clips, onlyVisible: false });
