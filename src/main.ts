import { createGame, currentTask, requiredDone, step, type GameState } from './core/state';
import { briefFor, doneFor, INTRO, lockedTask, SAFEHOUSE_OPEN, safehouseLocked, shortName, tierLines } from './core/story';
import type { GameEvent, TaskId } from './core/types';
import { GameView } from './render/view';
import { loadCharacterAssets } from './render/characters';
import { Controls } from './input/controls';
import { Hud } from './ui/hud';
import { Dialogue } from './ui/dialogue';
import { Sound } from './audio/sound';
import { CityMap } from './ui/map';
import { WEAPON_NAMES } from './core/config';
import { StorePage } from './ui/store';
import { anonymousSession } from './seams/session';
import { noopProgress, type RunResult } from './seams/progress';

const SIM_DT = 1 / 60; // fixed timestep
const MAX_STEPS_PER_FRAME = 5;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

type Mode = 'title' | 'intro' | 'play' | 'ending';

const newSeed = () => (Math.random() * 0xffffffff) >>> 0; // randomness lives here, not in core/
let state: GameState = createGame(params.has('seed') ? Number(params.get('seed')) >>> 0 : newSeed());
let mode: Mode = 'title';
let endTimer = -1;
let lastTaskId: TaskId | null = null;
let wasReady = false;

const $ = (id: string) => document.getElementById(id)!;
const startBtn = $('start') as HTMLButtonElement;
const assets = await loadCharacterAssets().catch((e) => { startBtn.textContent = `Failed to load: ${e}`; throw e; });

const view = new GameView($('game'), assets);
const controls = new Controls($('game'), $('stick'), $('knob'));
const dialogue = new Dialogue();
const sound = new Sound();
const hud = new Hud({
  retry: () => begin(state.seed, false),
  newNight: () => begin(newSeed(), false),
});
view.cinematic = 0;
let paused = false; // store or full map open
const storePage = new StorePage((t) => hud.toast(t));
const cityMap = new CityMap((open) => { paused = open || storePage.open; controls.enabled = !paused; });

$('mute').addEventListener('click', () => {
  sound.setMuted(!sound.muted);
  $('mute').textContent = `Sound: ${sound.muted ? 'off' : 'on'}`;
});

startBtn.disabled = false;
startBtn.textContent = 'Begin';
startBtn.addEventListener('click', () => {
  sound.start();
  $('title').style.display = 'none';
  begin(state.seed, !params.has('skipintro'));
});
if (debug) Object.defineProperty(window, '__outbreak', { get: () => ({ state, mode, view }) }); // test hook

/** Start a night. The full intro plays once; retries go straight to the street. */
function begin(seed: number, withIntro: boolean): void {
  if (seed !== state.seed || state.phase !== 'playing' || state.elapsed > 0) state = createGame(seed);
  hud.reset();
  storePage.hide();
  paused = false;
  controls.enabled = true;
  if (cityMap.open) cityMap.toggle();
  dialogue.clear();
  endTimer = -1;
  lastTaskId = null;
  wasReady = false;
  if (withIntro) {
    mode = 'intro';
    hud.cinema(true);
    view.cinematic = 0;
    hud.showCard(INTRO.card, INTRO.sub, 3.2);
    window.setTimeout(() => dialogue.playCutscene(INTRO.lines, startPlay), 3400);
  } else {
    hud.showCard(INTRO.card, INTRO.sub, 1.6);
    startPlay();
  }
}

function startPlay(): void {
  mode = 'play';
  hud.cinema(false);
}

function finish(): void {
  mode = 'ending';
  hud.cinema(true);
  dialogue.clear();
  const result: RunResult = {
    seed: state.seed,
    outcome: state.phase === 'won' ? 'won' : 'lost',
    lossReason: state.lossReason,
    secondsLeft: state.remaining,
    timeLimit: state.timeLimit,
    optionalDone: state.tasks.filter((t) => !t.required && t.done).length,
  };
  void noopProgress.saveRun(anonymousSession, result);
  hud.showEnd(state);
}

/** Story beats driven by what happened this frame. */
function narrate(events: readonly GameEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case 'task-done': dialogue.say(doneFor(e.id)); break;
      case 'tier-up': dialogue.say(tierLines(e.tier)); view.shake(0.5); break;
      case 'safehouse-locked':
        dialogue.say(safehouseLocked(state.tasks.filter((t) => t.required && !t.done).map((t) => shortName(t.id))));
        break;
      case 'task-locked':
        dialogue.say(lockedTask(e.needs.map((id) => shortName(id))));
        break;
      case 'zombie-attack': {
        const z = state.zombies.find((q) => q.id === e.id);
        if (z && Math.hypot(z.pos.x - state.player.pos.x, z.pos.y - state.player.pos.y) < 3) { view.shake(0.35); hud.hurt(); }
        break;
      }
      case 'lost':
        if (e.reason === 'caught') { view.shake(1.2); hud.hurt(); }
        break;
      case 'player-hit': hud.hurt(); view.shake(0.4); break;
      case 'pickup':
        hud.toast(e.kind === 'ammo' ? `+${e.amount} ammo` : `Picked up: ${WEAPON_NAMES[e.kind]}`);
        break;
      case 'crate-opened':
        hud.toast(e.loot === 'medkit' ? 'Medkit: +health' : e.loot === 'supplies' ? 'Supplies: +$25' : e.loot === 'ammo' ? 'Ammo' : 'Empty');
        break;
      case 'vehicle-enter': hud.toast('Drive with the stick. Run them down.'); break;
      case 'vehicle-wrecked': hud.toast('The engine dies. Get out!'); view.shake(0.8); break;
      case 'empty': hud.toast('Out of ammo. Swap to your baton (Q), or buy rounds at a weapon store.'); break;
      case 'store-open': {
        const st = state.stores.find((x) => x.id === e.id);
        if (!st) break;
        paused = true;
        controls.enabled = false;
        storePage.show(state, st, () => { paused = cityMap.open; controls.enabled = !paused; });
        break;
      }
      default: break;
    }
  }
  const cur = currentTask(state)?.id ?? null;
  if (cur !== lastTaskId) {
    lastTaskId = cur;
    if (cur) dialogue.say(briefFor(cur));
  }
  const ready = requiredDone(state);
  if (ready && !wasReady) dialogue.say(SAFEHOUSE_OPEN);
  wasReady = ready;
}

let last = performance.now();
let acc = 0;
const pending: GameEvent[] = [];
let frames = 0, fpsT = 0, fps = 0, stepMs = 0, renderMs = 0;
const debugEl = $('debug');

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const t0 = performance.now();
  if (mode === 'play' && !paused) {
    acc += dt;
    let n = 0;
    while (acc >= SIM_DT && n < MAX_STEPS_PER_FRAME) {
      step(state, controls.read(), SIM_DT);
      pending.push(...state.events); // step() clears events, so collect them across sub-steps
      acc -= SIM_DT;
      n++;
    }
    if (n === MAX_STEPS_PER_FRAME) acc = 0;
    narrate(pending);
    if (state.phase !== 'playing' && endTimer < 0) {
      // let the moment play out before the ending card
      endTimer = state.phase === 'won' ? 1.4 : state.lossReason === 'caught' ? 2.6 : 1.2;
    }
  } else {
    acc = 0;
  }
  if (endTimer >= 0 && mode === 'play') {
    endTimer -= dt;
    if (endTimer < 0) finish();
  }
  stepMs = stepMs * 0.9 + (performance.now() - t0) * 0.1;

  // the camera eases from the wide establishing shot to gameplay
  const wantCine = mode === 'title' ? 0 : mode === 'intro' ? 0.35 : 1;
  view.cinematic += (wantCine - view.cinematic) * (1 - Math.exp(-(mode === 'intro' ? 0.25 : 1.2) * dt));

  dialogue.update(dt);
  hud.update(state, view);
  sound.update(state, pending, dt, (x, y) => view.screenX({ x, y }));
  view.react(state, pending);
  pending.length = 0;
  if (mode === 'play') cityMap.drawMini(state);
  cityMap.drawFull(state);

  const t1 = performance.now();
  view.render(state, dt);
  renderMs = renderMs * 0.9 + (performance.now() - t1) * 0.1;

  if (debug) {
    frames++;
    fpsT += dt;
    if (fpsT >= 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
    const i = view.renderer.info;
    debugEl.textContent =
      `fps ${fps.toFixed(0)}  sim ${stepMs.toFixed(2)}ms  render(cpu) ${renderMs.toFixed(2)}ms\n` +
      `calls ${i.render.calls}  tris ${i.render.triangles}  geoms ${i.memory.geometries}  tex ${i.memory.textures}\n` +
      `seed ${state.seed}  tier ${state.tier}  zombies ${state.zombies.length}  mode ${mode}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
