import {
  chapterBonus, clearLeft, createGame, currentTask, finalChapter, nextChapter, requiredDone, restartChapter, solvePuzzle, step,
  taskTarget, type GameState,
} from './core/state';
import {
  briefFor, chapterCard, chapterLines, doneFor, escortBehind, exitLabel, exitLocked, exitOpen, intro, lockedTask, objectiveFor,
  partsReady, shortName, survivorLines, tierLines, vehicleLines, type Line,
} from './core/story';
import type { GameEvent, Task, TaskId } from './core/types';
import { setContent, stepDef, type Content } from './core/content';
import { GameView } from './render/view';
import { loadCharacterAssets } from './render/characters';
import { loadModels } from './render/models';
import { Controls } from './input/controls';
import { Hud } from './ui/hud';
import { Dialogue } from './ui/dialogue';
import { Talk, type NextUp } from './ui/talk';
import { Sound } from './audio/sound';
import { CityMap } from './ui/map';
import { GEAR, SAFE_AFTER, WEAPON_NAMES } from './core/config';
import { StorePage } from './ui/store';
import { anonymousSession } from './seams/session';
import { noopProgress, type RunResult } from './seams/progress';

const SIM_DT = 1 / 60; // fixed timestep
const MAX_STEPS_PER_FRAME = 5;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

type Mode = 'title' | 'intro' | 'play' | 'ending';

const newSeed = () => (Math.random() * 0xffffffff) >>> 0; // randomness lives here, not in core/
// the task content (what each step is, says and looks like) comes as data, before the first night
setContent(await fetch('/content/tasks.json').then((r) => r.json() as Promise<Content>));
let state: GameState = createGame(params.has('seed') ? Number(params.get('seed')) >>> 0 : newSeed());
let mode: Mode = 'title';
let endTimer = -1;
let lastTaskId: TaskId | null = null;
let wasReady = false;

const $ = (id: string) => document.getElementById(id)!;
const startBtn = $('start') as HTMLButtonElement;
const [assets] = await Promise.all([loadCharacterAssets(), loadModels()]).catch((e) => { startBtn.textContent = `Failed to load: ${e}`; throw e; });

const view = new GameView($('game'), assets);
const controls = new Controls($('game'), $('stick'), $('knob'));
const dialogue = new Dialogue();
const talk = new Talk();
/** Story lines to show in the Talk panel at the end of this frame (the game waits while it is open). */
const convo: Line[] = [];
/** The engine warnings already given this night (once for a car, once for a bike). */
const warned = new Set<string>();
const sound = new Sound();
const hud = new Hud({
  retry: () => begin(restartChapter(state), false),
  newNight: () => begin(createGame(newSeed()), false),
});
view.cinematic = 0;
let paused = false; // store or full map open
const storePage = new StorePage((t) => hud.toast(t));
const cityMap = new CityMap((open) => { paused = open || storePage.open; controls.enabled = !paused; });

$('mute').addEventListener('click', () => {
  sound.setMuted(!sound.muted);
  $('mute').textContent = `Sound: ${sound.muted ? 'off' : 'on'}`;
});
// Battery saver: 30 frames a second and fewer pixels, for a phone that runs warm. Remembered.
let saver = localStorage.getItem('outbreak.saver') === '1';
const showSaver = () => { $('saver').textContent = `Saver: ${saver ? 'on' : 'off'}`; view.setSaver(saver); };
$('saver').addEventListener('click', () => { saver = !saver; localStorage.setItem('outbreak.saver', saver ? '1' : '0'); showSaver(); });
showSaver();

startBtn.disabled = false;
startBtn.textContent = 'Begin';
// Phones play in landscape. Where the browser allows it (Android, from a tap), go full screen and
// lock the orientation; everywhere else a "turn your phone" screen covers portrait and the game waits.
const touch = document.documentElement.classList.contains('mobile'); // set in index.html
const portrait = matchMedia('(orientation: portrait)');
const upright = () => touch && (portrait.matches || window.innerHeight > window.innerWidth);
async function goLandscape(): Promise<void> {
  if (!touch) return;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape');
  } catch { /* not allowed here (iPhone, desktop): the rotate screen covers it */ }
}
// no zooming: no pinch (iOS gesture events), no double-tap zoom, no long-press menu
for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

startBtn.addEventListener('click', () => {
  void goLandscape();
  sound.start();
  $('title').style.display = 'none';
  begin(state, !params.has('skipintro'));
});
if (debug) Object.defineProperty(window, '__outbreak', { get: () => ({ state, mode, view }) }); // test hook

/** Start a chapter (or a night). The full intro plays once; retries and new chapters go straight
 * to the street. */
function begin(fresh: GameState, withIntro: boolean): void {
  state = fresh;
  hud.reset();
  storePage.hide();
  if (talk.open) talk.close();
  convo.length = 0;
  if (fresh.chapter === 0) warned.clear();
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
    hud.showCard(intro().card, intro().sub, 3.2);
    window.setTimeout(() => dialogue.playCutscene(intro().lines, startPlay), 3400);
  } else {
    const c = chapterCard(state.chapter);
    hud.showCard(c.card, c.sub, 2.2);
    startPlay();
    if (state.chapter > 0) convo.push(...chapterLines(finalChapter(state)));
  }
}

/** The next thing to do, in full, with how far it is. */
function nextUp(): NextUp | null {
  const final = finalChapter(state);
  const cur = currentTask(state);
  const ready = requiredDone(state);
  const target = ready ? (state.safehouseKnown ? state.safehouse : null) : cur ? taskTarget(state, cur) : null;
  const title = ready ? exitLabel(final) : cur ? objectiveFor(cur, final, cur.kind === 'clear' ? clearLeft(state, cur) : null) : null;
  if (!title) return null;
  const m = target ? Math.round(Math.hypot(target.x - state.player.pos.x, target.y - state.player.pos.y) * 0.63) : null;
  return { title, detail: m !== null ? `${m} m away. Follow the yellow arrow and the ring on your map.` : 'Look around.' };
}

/** Open the Talk panel with what this frame had to say; the game holds until it is read. */
function openTalk(objectiveChanged: boolean): void {
  if (convo.length === 0 && !objectiveChanged) return;
  if (state.phase !== 'playing') { convo.length = 0; return; }
  const lines = convo.splice(0);
  dialogue.clear();
  controls.enabled = false;
  controls.reset();
  talk.show(lines, objectiveChanged ? nextUp() : null, () => {
    controls.reset();
    controls.enabled = !paused;
    state.safeT = Math.max(state.safeT, SAFE_AFTER); // a moment to get moving before they come on again
  });
}

/** Down the subway stairs and up into the next district. */
function advance(): void {
  const bonus = chapterBonus(state);
  begin(nextChapter(state), false);
  if (bonus > 0) hud.toast(`+$${bonus} for time to spare`);
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
    seed: state.night,
    chapter: state.chapter,
    outcome: state.phase === 'won' ? 'won' : 'lost',
    lossReason: state.lossReason,
    secondsLeft: state.remaining,
    timeLimit: state.timeLimit,
    optionalDone: state.tasks.filter((t) => !t.required && t.done).length,
  };
  void noopProgress.saveRun(anonymousSession, result);
  hud.showEnd(state);
}

const task = (id: TaskId): Task | undefined => state.tasks.find((t) => t.id === id);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A puzzle page (loaded the first time one is needed). The game waits while it is open; the answer is
 * checked by the core, and whatever that sets off is told like any other moment. */
async function openPuzzle(t: Task): Promise<void> {
  paused = true;
  controls.enabled = false;
  const { showPuzzle } = await import('./ui/puzzle');
  showPuzzle(t, {
    solve: (answer) => {
      const ok = solvePuzzle(state, t.id, answer);
      const happened = state.events.splice(0); // outside step(): pass them on by hand
      pending.push(...happened);
      if (ok) narrate(happened);
      else hud.toast('That is not it.');
      return ok;
    },
    close: () => { paused = cityMap.open || storePage.open; controls.reset(); controls.enabled = !paused && !talk.open; },
  });
}

/** Story beats driven by what happened this frame. */
function narrate(events: readonly GameEvent[]): void {
  let forceNext = false;
  for (const e of events) {
    switch (e.type) {
      case 'part-taken':
        hud.toast(`${cap(stepDef(e.id).parts?.name ?? 'piece')} ${e.got} of ${e.of}`);
        if (e.got === e.of) { const t = task(e.id); if (t) convo.push(...partsReady(t)); forceNext = true; }
        break;
      case 'escort-behind': dialogue.say(escortBehind(currentTask(state))); break;
      case 'puzzle-open': { const t = task(e.id); if (t) openPuzzle(t); break; }
      case 'puzzle-wrong': hud.toast('That is not it.'); break;
      case 'clear-start': hud.toast(`${e.count} of them, and they've seen you. Fight!`); view.shake(0.4); break;
      case 'flare-lit': hud.toast('The flare is pulling them in. Keep away from it.'); break;
      case 'horde': hud.toast('They heard that. Here they come!'); view.shake(0.6); break;
      case 'task-done': { const t = task(e.id); if (t) convo.push(...doneFor(t, finalChapter(state))); break; }
      case 'tier-up': dialogue.say(tierLines(e.tier)); view.shake(0.5); break;
      case 'safehouse-locked':
        dialogue.say(exitLocked(state.tasks.filter((t) => t.required && !t.done).map((t) => shortName(t)), finalChapter(state)));
        break;
      case 'task-locked':
        dialogue.say(lockedTask(e.needs.flatMap((id) => { const t = task(id); return t ? [shortName(t)] : []; })));
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
        hud.toast(e.kind === 'ammo' ? `+${e.amount} ammo`
          : e.kind === 'bottles' ? `+${e.amount} bottles: throw one (G) to draw them away`
            : e.kind === 'jerrycan' ? 'Jerrycan: fill up a car (stand by it, REFUEL)'
              : e.kind === 'vest' || e.kind === 'helmet' ? `${GEAR[e.kind].name}: takes part of every hit`
                : `Picked up: ${WEAPON_NAMES[e.kind]}`);
        break;
      case 'crate-opened':
        hud.toast(e.loot === 'medkit' ? 'Medkit: +health' : e.loot === 'supplies' ? 'Supplies: +$25' : e.loot === 'ammo' ? 'Ammo' : 'Empty');
        break;
      case 'vehicle-enter': {
        const v = state.vehicles.find((x) => x.id === e.id);
        const bike = v?.kind === 'bike';
        if (v && !warned.has(bike ? 'bike' : 'car')) { warned.add(bike ? 'bike' : 'car'); convo.push(...vehicleLines(bike)); }
        hud.toast(v && v.fuel < 0.15 ? 'Almost no fuel. Find a jerrycan or the gas station.' : 'Drive with the stick. The engine draws them in.');
        break;
      }
      case 'latched': hud.toast(e.count > 1 ? `${e.count} hanging on! Speed up to shake them off.` : 'One grabbed hold! Speed up to shake it off.'); view.shake(0.3); break;
      case 'guarded': hud.toast(`${e.count} of them are standing over it. Thin them out or slip past.`); break;
      case 'chase': hud.toast(finalChapter(state) ? 'They have your scent. Run for the helicopter!' : 'They have your scent. Run for the tunnel!'); view.shake(0.5); break;
      case 'vehicle-breached': hud.toast('The glass is gone. They can reach you! Shake them off or get out.'); view.shake(0.6); break;
      case 'out-of-fuel': hud.toast('Out of fuel. It rolls to a stop.'); break;
      case 'refueled': hud.toast(e.from === 'pump' ? 'Filling up at the pump...' : 'Refuelled.'); break;
      case 'house-searched':
        hud.toast(`${e.loot === 'medkit' ? 'First aid: +health' : e.loot === 'supplies' ? 'Cash in a drawer: +$25' : e.loot === 'ammo' ? 'A box of rounds' : e.loot === 'bottles' ? 'Empty bottles' : e.loot === 'vest' || e.loot === 'helmet' ? `A ${GEAR[e.loot].name.toLowerCase()}, still good` : 'Nothing worth taking'}${e.ambush ? '. Something moves inside!' : ''}`);
        if (e.ambush) view.shake(0.4);
        break;
      case 'alarm-start': hud.toast('Car alarm! Everything nearby is heading for it.'); break;
      case 'survivor-asked': {
        const v = state.survivors.find((x) => x.id === e.id);
        if (v) { if (e.first) convo.push(...survivorLines(v, 'asked')); else dialogue.say(survivorLines(v, 'reminder')); }
        break;
      }
      case 'survivor-ready': { const v = state.survivors.find((x) => x.id === e.id); if (v) dialogue.say(survivorLines(v, 'ready')); break; }
      case 'fetched': { const v = state.survivors.find((x) => x.id === e.id); if (v) dialogue.say(survivorLines(v, 'fetched')); break; }
      case 'survivor-done': { const v = state.survivors.find((x) => x.id === e.id); if (v) convo.push(...survivorLines(v, 'done', e.reward)); break; }
      case 'gear-broken': hud.toast(`Your ${e.gear} is torn apart. Buy another at a weapon store.`); break;
      case 'chapter-cleared': hud.toast('Down the stairs, into the dark...'); break;
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
  let changed = forceNext;
  const curTask = currentTask(state);
  const cur = curTask?.id ?? null;
  if (cur !== lastTaskId) {
    lastTaskId = cur;
    changed = true;
    if (curTask) convo.push(...briefFor(curTask, finalChapter(state)));
  }
  const ready = requiredDone(state);
  if (ready && !wasReady) { convo.push(...exitOpen(finalChapter(state))); changed = true; }
  wasReady = ready;
  openTalk(changed);
}

let last = performance.now();
let acc = 0;
const pending: GameEvent[] = [];
let frames = 0, fpsT = 0, fps = 0, stepMs = 0, renderMs = 0;
const debugEl = $('debug');

let miniTick = 0;

function frame(now: number): void {
  // Draw only as often as it is worth: a held story moment or the store is still (20/s), the title
  // and battery saver are fine at 30/s; play runs at the screen's rate. The sim's fixed step does
  // not care: it catches up on the time between frames.
  const still = (paused && !cityMap.open) || talk.open;
  const gap = still ? 48 : saver || mode === 'title' ? 31 : 0;
  if (gap && now - last < gap) { requestAnimationFrame(frame); return; }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const t0 = performance.now();
  if (mode === 'play' && !paused && !talk.open && !upright()) {
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
      endTimer = state.phase === 'won' ? 1.4 : state.phase === 'cleared' ? 1.3 : state.lossReason === 'caught' ? 2.6 : 1.2;
      if (state.phase === 'cleared') hud.cinema(true); // the bars close in as you go down the stairs
    }
  } else {
    acc = 0;
  }
  if (endTimer >= 0 && mode === 'play') {
    endTimer -= dt;
    if (endTimer < 0) { if (state.phase === 'cleared') advance(); else finish(); }
  }
  stepMs = stepMs * 0.9 + (performance.now() - t0) * 0.1;

  // the camera eases from the wide establishing shot to gameplay
  const wantCine = mode === 'title' ? 0 : mode === 'intro' ? 0.35 : 1;
  view.cinematic += (wantCine - view.cinematic) * (1 - Math.exp(-(mode === 'intro' ? 0.25 : 1.2) * dt));

  dialogue.update(dt);
  talk.update(dt);
  hud.update(state, view);
  sound.update(state, pending, dt, (x, y) => view.screenX({ x, y }));
  view.react(state, pending);
  pending.length = 0;
  if (mode === 'play' && (still || miniTick++ % 3 === 0)) cityMap.drawMini(state); // the minimap at 20/s is plenty
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
