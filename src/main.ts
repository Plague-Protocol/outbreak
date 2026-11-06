import { createGame, step, type GameState } from './core/state';
import type { GameEvent } from './core/types';
import { GameView } from './render/view';
import { Controls } from './input/controls';
import { Hud } from './ui/hud';
import { anonymousSession } from './seams/session';
import { noopProgress, type RunResult } from './seams/progress';

const SIM_DT = 1 / 60; // fixed timestep
const MAX_STEPS_PER_FRAME = 5;
const params = new URLSearchParams(location.search);

const newSeed = () => (Math.random() * 0xffffffff) >>> 0; // randomness lives here, not in core/
let seed = params.has('seed') ? Number(params.get('seed')) >>> 0 : newSeed();
let state: GameState = createGame(seed);
let ended = false;

const view = new GameView(document.getElementById('game')!);
const controls = new Controls(document.getElementById('game')!, document.getElementById('stick')!, document.getElementById('knob')!);
const hud = new Hud(() => {
  seed = newSeed();
  state = createGame(seed);
  ended = false;
  hud.reset();
});
const debugEl = document.getElementById('debug')!;
const debug = params.has('debug');

function finish(): void {
  ended = true;
  const result: RunResult = {
    seed: state.seed,
    outcome: state.phase === 'won' ? 'won' : 'lost',
    lossReason: state.lossReason,
    secondsLeft: state.remaining,
    timeLimit: state.timeLimit,
    optionalDone: state.tasks.filter((t) => !t.required && t.done).length,
  };
  void noopProgress.saveRun(anonymousSession, result);
  hud.showEnd(state, result);
}

let last = performance.now();
let acc = 0;
const pending: GameEvent[] = [];
let frames = 0, fpsT = 0, fps = 0, stepMs = 0, renderMs = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;

  const t0 = performance.now();
  let n = 0;
  while (acc >= SIM_DT && n < MAX_STEPS_PER_FRAME) {
    step(state, controls.read(), SIM_DT);
    pending.push(...state.events); // step() clears events, so collect them across sub-steps
    acc -= SIM_DT;
    n++;
  }
  if (n === MAX_STEPS_PER_FRAME) acc = 0;
  stepMs = stepMs * 0.9 + (performance.now() - t0) * 0.1;

  hud.update(state, view, pending);
  pending.length = 0;
  if (state.phase !== 'playing' && !ended) finish();

  const t1 = performance.now();
  view.render(state, dt, now / 1000);
  renderMs = renderMs * 0.9 + (performance.now() - t1) * 0.1;

  if (debug) {
    frames++;
    fpsT += dt;
    if (fpsT >= 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
    const i = view.renderer.info;
    debugEl.textContent =
      `fps ${fps.toFixed(0)}  sim ${stepMs.toFixed(2)}ms  render(cpu) ${renderMs.toFixed(2)}ms\n` +
      `calls ${i.render.calls}  tris ${i.render.triangles}  geoms ${i.memory.geometries}  tex ${i.memory.textures}\n` +
      `seed ${state.seed}  tier ${state.tier}  zombies ${state.zombies.length}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
