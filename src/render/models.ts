// Vehicle and weapon models (built by tools/build-models.mjs into one GLB). Each is one vertex-coloured
// mesh; parts in the marker colour (magenta: r = b, g = 0) take the owner's finish, a car's paint or a
// gun's furniture. That is the hook for personal assets: same model, own finish.
import { type BufferGeometry, Color, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type ModelName = 'sedan' | 'pickup' | 'van' | 'bike' | 'heli' | 'pistol' | 'shotgun' | 'rifle' | 'baton' | 'bat' | 'machete';

interface Def { geo: BufferGeometry; lights?: BufferGeometry; finish: number; muzzle?: Vector3 }
const defs = new Map<string, Def>();
const painted = new Map<string, BufferGeometry>();
const tint = new Color();

export async function loadModels(url = `${import.meta.env.BASE_URL}assets/models/models.glb`): Promise<void> {
  const gltf = await new GLTFLoader().loadAsync(url);
  for (const o of gltf.scene.children) {
    if (!(o instanceof Mesh)) continue;
    const lights = o.children.find((c): c is Mesh => c instanceof Mesh);
    const d = o.userData as { finish?: number; muzzle?: number[] };
    defs.set(o.name, { geo: o.geometry as BufferGeometry, lights: lights?.geometry as BufferGeometry | undefined, finish: d.finish ?? 0x888888, muzzle: d.muzzle && new Vector3(...d.muzzle) });
  }
}

function def(name: ModelName): Def {
  const d = defs.get(name);
  if (!d) throw new Error(`model ${name} not loaded`);
  return d;
}

/** A model's geometry with a finish painted in (its default finish if none); shared, do not dispose. */
export function modelGeometry(name: ModelName, finish?: number): BufferGeometry {
  const d = def(name);
  const hex = finish ?? d.finish;
  const key = `${name}:${hex}`;
  let g = painted.get(key);
  if (g) return g;
  g = d.geo.clone();
  const c = g.getAttribute('color');
  tint.setHex(hex);
  for (let i = 0; i < c.count; i++) {
    const r = c.getX(i);
    if (r > 0 && c.getY(i) === 0 && c.getZ(i) === r) c.setXYZ(i, tint.r * r, tint.g * r, tint.b * r);
  }
  painted.set(key, g);
  return g;
}

export const modelLights = (name: ModelName): BufferGeometry | undefined => def(name).lights;
export const modelMuzzle = (name: ModelName): Vector3 => def(name).muzzle?.clone() ?? new Vector3(0.5, 0, 0);
