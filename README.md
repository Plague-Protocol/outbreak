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

## Performance budget

| | Budget | Measured |
|---|---|---|
| Draw calls | ≤ 25 | 7 |
| Triangles | ≤ 10,000 | ~1,050 at start, ~2,200 with the 14-zombie cap |
| Textures | 0 | 0 (vertex colours) |
| JS bundle (gzip) | ≤ 200 KB | 140 KB (three.js is most of it) |
| Sim step, 14 zombies | n/a | avg 0.007 ms, worst 0.9 ms (path refresh) on a laptop |

Measured by `?debug` (`renderer.info`) in headless desktop Chrome and a Node timing run.
Not yet measured on a real Android phone.
