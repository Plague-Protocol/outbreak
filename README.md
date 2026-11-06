# Outbreak (working name)

A browser game: survivors in a zombie-overrun city race a countdown to a safehouse.
Separate from the live [Plague Protocol](../plague-celo) game, which this does not modify.

Status: phase 1 first slice (one city, one level, no sign-in, no backend, no wallet).
Design: [docs/DESIGN.md](docs/DESIGN.md).

## Run

```sh
npm install        # scripts are disabled by .npmrc; versions are exact-pinned
npm run dev        # http://localhost:5173 (also on your LAN, for testing on a phone)
npm test           # unit tests
npm run build      # typecheck + production build into dist/
```

URL options: `?seed=123` fixed layout, `?debug` perf overlay (fps, draw calls, triangles),
`?dpr=1.5` cap the pixel ratio.

Controls: WASD / arrows, or drag anywhere on the screen (floating stick) on touch devices.
Stand on a task marker for one second to complete it. Yellow = required, blue = optional
(completing it costs clock time and gives a small perk). The arrow shows where the current
objective is. Reach the green safehouse with every required task done.

## Layout

- `src/core/` pure game logic: seeded RNG, map, task chain, state/step. No DOM, no three.js, no
  wall clock, no `Math.random` (a test enforces this) so it can move to a server in phase 2.
- `src/render/` three.js view; only reads `GameState`.
- `src/input/`, `src/ui/` controls and HUD (plain DOM).
- `src/seams/` empty interfaces for sign-in (`AuthSession`) and progress (`ProgressStore`).

## Characters

Player and zombies are rigged, animated low-poly people (Kenney "Animated Characters 3", CC0;
see `public/assets/characters/CREDITS.md`). `tools/convert-characters.mjs` turned the FBX into one
GLB (Idle + Run clips); skins are four 256x256 PNGs. Zombies use the zombie skins, the player a
human skin. Style is stylized (large head), not realistic proportions.

## Performance budget

| | Budget | Measured |
|---|---|---|
| Draw calls (worst: player + 14 zombies + city in view) | <= 25 | 19 |
| Triangles (same worst case) | <= 30,000 | ~26,400 (about 1,600 per character) |
| Textures | small | 4 skins at 256x256 plus one tiny bone texture per character |
| JS bundle (gzip) | <= 200 KB | 166 KB |
| Character assets (download) | <= 400 KB | ~270 KB (GLB 123 KB gzip + 4 PNGs ~144 KB) |

Measured with `?debug` (`renderer.info`) in headless desktop Chrome, using a stress hook that
puts 14 zombies on screen. Not yet measured on a real Android phone; that is the remaining risk
(skinned animation cost for 15 characters). Zombies far off screen skip animation.
