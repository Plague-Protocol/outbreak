# Outbreak (working name)

A browser game: survivors in a zombie-overrun city race a countdown to a safehouse.
Separate from the live [Plague Protocol](../plague-celo) game, which this does not modify.

Status: phase 1 first slice (one city, one level, no sign-in, no backend, no wallet).
Design: [docs/DESIGN.md](docs/DESIGN.md).

## The story

Night one, Ebute Gardens, Lagos mainland. For six weeks they called it Eko Fever; tonight the
fevered got up and walked out into the city. You are Tolu. Ronke on Lockdown News 90.5 says St.
Agnes Clinic is still taking survivors, until its doors seal. Each run picks its steps from a seeded
pool (find the evacuation map, take the orderly's key, restart the street generator and open the
gate, take the fallen guard's keycard, get the clinic frequency from the radio), with optional
detours that cost time (fuel, medical supplies, a survivor hiding in a shop).

It is told the way Eko Lockdown tells its story: a title card, a letterboxed intro, "Speaker|line"
dialogue, radio briefs as each step comes up, radio calls as the night gets worse, and endings
(SAFE, TAKEN, DOORS SEALED). The text lives in `src/core/story.ts`.

## Run

```sh
npm install        # scripts are disabled by .npmrc; versions are exact-pinned
npm run dev        # http://localhost:5173 (also on your LAN, for testing on a phone)
npm test           # unit tests
npm run build      # typecheck + production build into dist/
```

URL options: `?seed=123` fixed layout, `?debug` perf overlay (fps, draw calls, triangles),
`?dpr=1.5` cap the pixel ratio.

Controls: WASD / arrows, or drag anywhere on the screen (floating stick) on touch devices. A light
push walks, a full push runs. Stand in a ring to use it (yellow = required, blue = optional and
costs time). The arrow points at the current objective. Zombies lunge when they reach you: keep
running and the lunge misses. Walkers shuffle; later in the night, runners come.
`?skipintro` skips the intro.

## Layout

- `src/core/` pure game logic: seeded RNG, map, task chain, state/step, story text. No DOM, no
  three.js, no wall clock, no `Math.random` (a test enforces this) so it can move to a server in
  phase 2. Zombie actions (rise, chase, lunge, feed) are decided here; the renderer only shows them.
- `src/render/` three.js view; only reads `GameState`. `city.ts` builds the night city in code
  (streets, windows, water tanks, cars and danfos, barricades, fire barrels, street lamps).
- `src/audio/` sound synthesised in code with Web Audio (wind, sirens, groans, footsteps, heartbeat).
- `src/input/`, `src/ui/` controls, HUD, dialogue (plain DOM).
- `src/seams/` empty interfaces for sign-in (`AuthSession`) and progress (`ProgressStore`).

## Characters and animation

Bodies and skins: Kenney "Animated Characters 3" (CC0). Animations: Quaternius "Universal
Animation Library" 1 and 2 (CC0): idle, walk, jog, sprint, death, interact, kneel, talk, and the
zombie idle, shuffle, lunge and rise. `tools/convert-characters.mjs` retargets them onto the Kenney
skeleton and measures how fast each walk/run cycle moves over the ground, so the game plays every
cycle at exactly the speed the character is moving (no foot sliding). Credits:
`public/assets/characters/CREDITS.md`. Preview every clip at `/tools/preview.html` while `npm run dev`
is running.

## Performance budget

| | Budget | Measured (worst case: player + 14 zombies on screen) |
|---|---|---|
| Draw calls | <= 25 | 23 |
| Triangles | <= 30,000 | ~30,600 (characters are ~1,600 each; the city in view is ~4,000) |
| Real lights | small | hemisphere + moon + flashlight + player fill + 3 pooled lamp/fire lights (`?lights=N`) |
| Textures | small | 4 skins at 256x256, 2 tiny generated gradients, one bone texture per character |
| JS bundle (gzip) | <= 200 KB | 177 KB |
| Character assets (gzip) | <= 400 KB | ~386 KB (GLB 242 KB + 4 PNGs 144 KB) |

Measured with `?debug` (`renderer.info`) in headless desktop Chrome using software rendering, with
a stress hook that puts 14 zombies around the player, so the frame rates it shows mean nothing for
a phone. **Not yet measured on a real Android phone.** The risks there are skinned animation for 15
characters and the per-pixel lights; `?lights=0`, `?dpr=1` and a lower zombie cap are the levers.
