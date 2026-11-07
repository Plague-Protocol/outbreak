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

- **Chapters:** a night crosses three districts, each a freshly generated part of the city with
  its own clock. Steps come up one at a time (only the current one is on the street and the map);
  the district map is always the last, and it shows the way out: a subway entrance into the next
  district. Weapons, ammo, gear, cash and kills carry over; seconds left on the clock pay $0.50
  each, and you catch your breath (+25 health). Later districts have runners in the crowd and
  bigger waves. The third chapter ends at the helicopter. A retry restarts the chapter with what
  you came into it with.
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
- **Distractions:** THROW (G) lobs a bottle; whatever is near where it smashes goes to look.
  Press ALARM by a parked car (or fire a gun right beside one) and its alarm draws everything
  within a long way for ten seconds. Bottles lie in the streets, in crates and in stores.
- **Houses:** some front doors glint: SEARCH takes two seconds standing still and turns up cash,
  ammo, first aid or bottles. Sometimes one of them was inside.
- **Survivors:** two per night, holed up on the street (green rings on the map). TALK: some want
  their bag fetched from a couple of blocks away, some are cornered and want the infected around
  them cleared. Help them for cash, ammo, a weapon, or where the evac point is.
- **Fuel:** every car has some fuel, rarely much (shown while driving). An empty tank coasts to a
  stop. Jerrycans (in the streets and stores) fill a tank by 60% (REFUEL beside the car); stopping
  at the gas station's pumps fills it.
- **Health:** a lunge hurts and knocks you back; the third kills. Shoot a zombie during its
  wind-up to spoil the lunge. Medkits heal.
- **Protective gear:** a Kevlar vest takes half of every hit, a riot helmet a quarter; each wears
  down by what it takes and shows on the character while it lasts. One lies somewhere in each
  district, houses sometimes have one, and the store's Gear tab sells them (a worn piece is swapped
  for new at the price of the wear). Damage goes through one function, so it will protect against
  other players too when there are any.

## The story

Told the way Eko Lockdown tells its story: a title card, a letterboxed intro, "Speaker|line"
dialogue, radio briefs as each step comes up, radio calls as the night gets worse, and endings
(EVACUATED, TAKEN, LEFT BEHIND). Each chapter picks its steps from a seeded pool (gate key, generator
and gate, keycard, radio frequency), always ending with the map, with optional detours that cost time. Text lives in
`src/core/story.ts`. Setting and names are invented so the game reads anywhere.

## The city

8 x 8 blocks (about 200 m across) generated from the seed: downtown towers, residential streets
of houses and gardens, a park, docklands with warehouses and shipping containers on the harbour,
piers, and desolate outskirts with wrecks, dead trees and an abandoned gas station.

It looks like the night after: pile-ups of crashed cars and an overturned bus choke a few streets
(cars cannot get through), an overrun military checkpoint with sandbags and an army truck, Mercy
Hospital with ambulances at the doors, boarded-up and burned-out houses, gutted towers, shop
windows boarded or smashed, street lights knocked down, dead or flickering, overgrown lots, and
rubble, litter, suitcases and scorch marks in the streets. Zombies rest across the city (denser
downtown); only those near you are simulated, and waves rise from just out of sight as the clock
runs down.

## Deploying

It is a static site: no backend is needed to play. `deploy/` has an nginx config (compression,
long caching of the hashed build) and the steps for a Linux server such as a Lighthouse VPS.
Nothing is deployed until you choose to.

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
| Draw calls | <= 40 | 30-34 (city chunks in view, 12 zombie characters, player, a store, props) |
| Triangles | <= 50,000 | ~34,500-41,700 (the debris of the abandoned city adds a few thousand) |
| Real lights | small | hemisphere + moon + flashlight/headlights + fill + 3 pooled + muzzle flash |
| Zombie characters drawn | 12 nearest | the rest are simulated or dormant, not drawn |
| JS bundle (gzip) | <= 220 KB | 207.8 KB |
| Character assets (gzip) | <= 450 KB | ~426 KB (GLB 282 KB + 4 skins 144 KB) |

The worst case was measured at a store's door with 18 zombies around, on three nights; the
busiest downtown spot reached 36 calls. Measured with `?debug` (`renderer.info`) in headless desktop Chrome with software rendering, so
the frame rates it shows mean nothing for a phone. **Not yet measured on a real Android phone.**
The levers there: `?lights=0`, `?dpr=1`, fewer zombie characters drawn.
