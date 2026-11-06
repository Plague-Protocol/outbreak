# Outbreak (working name)

A browser game: a virus has emptied Port Halden, and the last evacuation helicopter leaves on
schedule. Find what you need, arm yourself, find a ride, and get to the evac point before it
lifts off. Separate from the live [Plague Protocol](../plague-celo) game, which this does not modify.

Status: phase 1 slice (one city, single player, no sign-in, no backend, no wallet).
Design: [docs/DESIGN.md](docs/DESIGN.md).

## Run

```sh
npm install        # scripts are disabled by .npmrc; versions are exact-pinned
npm run dev        # http://localhost:5173 (also on your LAN, for testing on a phone)
npm test           # unit tests
npm run build      # typecheck + production build into dist/
```

URL options: `?seed=123` fixed night, `?skipintro`, `?debug` perf overlay, `?dpr=1.5` cap the
pixel ratio, `?lights=0..6` number of real point lights, `?zoom=N` camera span.

## Playing

- **Move:** drag anywhere (floating stick) or WASD. A light push walks, a full push runs.
- **Fire / swing:** hold FIRE (or Space). Aim assist picks the zombie in front of you. Gunfire
  is loud: everything within earshot comes looking. With a melee weapon the button reads SWING.
- **Use:** the contextual button (or E): start an objective, search a supply crate, enter a
  weapon store, get in or out of a vehicle. **Reload** (R) and **swap weapon** (Q) buttons.
- **Objectives are safe:** while you work an objective or talk to someone (and for a second
  after), the zombies that were after you hold back and wait. Anything you take (keys, keycard,
  map, supplies) lies where you can see it and is gone once taken.
- **Drive:** push the stick where you want to go and the car steers there; push back against the
  nose to reverse. Run zombies down. Crashes and clawing zombies damage the vehicle until it dies.
- **Map:** the minimap (top right) is rotated to match the screen. Tap it or press M for the full
  city map (pauses the game).
- **Weapons:** you start with a pistol and a police baton. Baseball bats, a machete, shotguns and
  an assault rifle lie in the streets, with ammo cans. Melee is quiet and never runs dry: a bat
  can hit three at once, a machete drops a walker in one hit, but you have to be close.
- **Weapon stores:** three per night (Halden Arms and others), lit storefronts with a rooftop
  sign. Walk in through the door (or press ENTER) and the game pauses on the store's page:
  weapons with their stats, upgrades (damage, extended magazine, fast reload; two levels each),
  ammo, medkits. Buy, and equip what you want in hand. Money comes from supply crates, the
  survivor, and kills.
- **Health:** a lunge hurts and knocks you back; the third kills. Shoot a zombie during its
  wind-up to spoil the lunge. Medkits heal.

## The story

Told the way Eko Lockdown tells its story: a title card, a letterboxed intro, "Speaker|line"
dialogue, radio briefs as each step comes up, radio calls as the night gets worse, and endings
(EVACUATED, TAKEN, LEFT BEHIND). Each night picks its steps from a seeded pool (evac map, gate key,
generator and gate, keycard, radio frequency) with optional detours that cost time. Text lives in
`src/core/story.ts`. Setting and names are invented so the game reads anywhere.

## The city

8 x 8 blocks (about 200 m across) generated from the seed: downtown towers, residential streets
of houses and gardens, a park, docklands with warehouses and shipping containers on the harbour,
piers, and desolate outskirts with wrecks, dead trees and an abandoned gas station. Zombies rest
across the city (denser downtown); only those near you are simulated, and waves rise from just
out of sight as the clock runs down.

## Layout

- `src/core/` pure game logic: RNG, city, task chain, state/step (movement, vehicles, weapons,
  zombies), story text. No DOM, no three.js, no wall clock, no `Math.random` (a test enforces this)
  so it can move to a server in phase 2.
- `src/render/` three.js view; only reads `GameState`. `city.ts` builds the city in chunks
  (culled when off screen), `props.ts` vehicles, guns, the store, the evac helicopter and effects.
- `src/audio/` sound synthesised in code with Web Audio (wind, sirens, groans, gunshots, engine).
- `src/input/`, `src/ui/` controls, HUD, dialogue, store, minimap and city map (plain DOM/canvas).
- `src/seams/` empty interfaces for sign-in (`AuthSession`) and progress (`ProgressStore`).

## Characters and animation

Bodies and skins: Kenney "Animated Characters 3" (CC0). Animations: Quaternius "Universal
Animation Library" 1 and 2 (CC0): locomotion, death, hit, pistol aim/shoot/reload, interact,
kneel, two one-handed melee swings, and the zombie idle, shuffle, lunge and rise. `tools/convert-characters.mjs` retargets them
onto the Kenney skeleton and measures each walk/run cycle's ground speed so feet never slide. Gun
poses play on the upper body only, over whatever the legs are doing. Credits:
`public/assets/characters/CREDITS.md`. Preview clips at `/tools/preview.html` under `npm run dev`.

## Performance budget

| | Budget | Measured (worst case: 18 zombies around the player) |
|---|---|---|
| Draw calls | <= 40 | 27-36 (city chunks in view, 12 zombie characters, player, a store, props) |
| Triangles | <= 40,000 | ~29,500-36,500 |
| Real lights | small | hemisphere + moon + flashlight/headlights + fill + 3 pooled + muzzle flash |
| Zombie characters drawn | 12 nearest | the rest are simulated or dormant, not drawn |
| JS bundle (gzip) | <= 200 KB | 199.7 KB (at the limit) |
| Character assets (gzip) | <= 450 KB | ~426 KB (GLB 282 KB + 4 skins 144 KB) |

The worst case was measured at a store's door with 18 zombies around, on three nights; the
busiest downtown spot reached 36 calls. Measured with `?debug` (`renderer.info`) in headless desktop Chrome with software rendering, so
the frame rates it shows mean nothing for a phone. **Not yet measured on a real Android phone.**
The levers there: `?lights=0`, `?dpr=1`, fewer zombie characters drawn.
