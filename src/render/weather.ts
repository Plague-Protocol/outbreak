import type { Material } from 'three';

// Weathering: makes flat, clean vertex colours look like a city that has been abandoned. Added to
// a Lambert material's shader, computed from world position, so it costs no geometry, no textures
// and no extra draw calls:
// - walls: rain streaks running down, blotchy grime, dirt splashed up from the street
// - ground and roofs: cracks, patched and stained asphalt
// - every colour pulled toward a dull, dirty grey-brown
// `?grime=0` turns it off (a lever for weak phones).

const ON = new URLSearchParams(location.search).get('grime') !== '0';

const NOISE = /* glsl */ `
varying vec3 vWorldP;
varying vec3 vWorldN;
float wHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = wHash(i), b = wHash(i + vec2(1.0, 0.0)), c = wHash(i + vec2(0.0, 1.0)), d = wHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// distance to the nearest edge between random cells: a network of cracks between broken slabs
float wCracks(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + vec2(wHash(n + g), wHash(n + g + 17.3)) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(d2) - sqrt(d1);
}
`;

const GRIME = /* glsl */ `
{
  vec3 N = normalize(vWorldN);
  float grime;
  if (N.y > 0.6) {
    // ground and roofs: broad stains and darker patched squares
    vec2 h = vWorldP.xz;
    float n = wNoise(h * 0.22) * 0.6 + wNoise(h * 1.3) * 0.4;
    float patchy = step(0.72, wNoise(floor(h * 0.35) + 3.0));
    grime = mix(0.7, 1.08, n) * mix(1.0, 0.8, patchy);
    if (vWorldP.y < 0.4) {
      // streets and pavements: cracked into slabs, worst in patches; weeds of moss in the cracks
      vec2 w = h + vec2(wNoise(h * 0.9), wNoise(h * 0.9 + 5.0)) * 0.6; // wobble the crack lines
      float edge = wCracks(w * 0.55);
      float fine = wCracks(w * 1.6 + 3.0);
      float worn = smoothstep(0.35, 0.7, wNoise(h * 0.07 + 11.0));
      float crack = (1.0 - smoothstep(0.0, 0.06, edge)) * mix(0.35, 1.0, worn) + (1.0 - smoothstep(0.0, 0.04, fine)) * worn * 0.5;
      grime *= 1.0 - min(crack, 1.0) * 0.6;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.16, 0.08), (1.0 - smoothstep(0.0, 0.03, edge)) * worn * 0.35);
    }
  } else {
    // walls: rain streaks running down, blotches, dirt and damp rising from the street
    float along = dot(vWorldP.xz, vec2(N.z, -N.x));
    float streak = wNoise(vec2(along * 2.2, vWorldP.y * 0.12));
    float streak2 = wNoise(vec2(along * 5.0 + 3.0, vWorldP.y * 0.3));
    float blotch = wNoise(vec2(along, vWorldP.y) * 0.45);
    float base = smoothstep(0.1, 2.2, vWorldP.y);
    grime = mix(0.42, 1.0, pow(streak, 1.4)) * mix(0.8, 1.0, streak2) * mix(0.75, 1.06, blotch) * mix(0.45, 1.0, base);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.15, 0.1), (1.0 - base) * 0.35); // damp, mossy base
  }
  diffuseColor.rgb *= grime;
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, lum * vec3(1.06, 0.98, 0.84), 0.38);
}
`;

/** Weather a Lambert material in place (and return it). */
export function weather<T extends Material>(m: T): T {
  if (!ON) return m;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldP;\nvarying vec3 vWorldN;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 wp = vec4(transformed, 1.0);
    vec3 wn = objectNormal;
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
      wn = mat3(instanceMatrix) * wn;
    #endif
    vWorldP = (modelMatrix * wp).xyz;
    vWorldN = mat3(modelMatrix) * wn;
  }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GRIME}`);
  };
  m.customProgramCacheKey = () => 'weathered';
  return m;
}
