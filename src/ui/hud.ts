import { clearLeft, currentTask, finalChapter, interactionFor, isGun, playerVehicle, requiredDone, taskTarget, type GameState } from '../core/state';
import { ending, exitLabel, objectiveFor, shortName, verbFor } from '../core/story';
import { CHAPTERS, GEAR, PLAYER_HEALTH, VEHICLES, WEAPON_NAMES } from '../core/config';
import type { Interaction } from '../core/types';
import type { GameView } from '../render/view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fmt = (s: number) => {
  const t = Math.ceil(Math.max(0, s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

function useLabel(s: GameState, it: Interaction | null): string | null {
  if (!it) return null;
  switch (it.kind) {
    case 'exit': return 'GET OUT';
    case 'enter': return 'GET IN';
    case 'crate': return 'SEARCH';
    case 'store': return 'ENTER';
    case 'house': return 'SEARCH';
    case 'talk': return 'TALK';
    case 'refuel': return 'REFUEL';
    case 'alarm': return 'ALARM';
    case 'task': { const t = s.tasks.find((x) => x.id === it.taskId); return t ? verbFor(t) : 'USE'; }
  }
}

export class Hud {
  private timer = $('timer');
  private task = $('task');
  private toastEl = $('toast');
  private arrow = $('arrow');
  private arrowIcon = $('arrow-icon');
  private arrowDist = $('arrow-dist');
  private hold = $('hold');
  private holdBar = $('hold-bar');
  private hurtEl = $('hurt');
  private card = $('card');
  private endScreen = $('ending');
  private healthBar = $('health-bar');
  private funds = $('funds');
  private carHealth = $('car-health');
  private useBtn = $('btn-use');
  private ammo = $('ammo');
  private weaponName = $('weapon-name');
  private fireBtn = $('btn-fire');
  private throwBtn = $('btn-throw');
  private bottles = $('bottles');
  private reloadBtn = $('btn-reload');
  private clockLabel = document.querySelector('#clock small') as HTMLElement;
  private gear = $('gear');
  private lastClock = '';
  private toastTimer = 0;
  private hurtTimer = 0;
  private lastTimer = '';
  private lastTask = '';

  constructor(handlers: { retry: () => void; newNight: () => void }) {
    $('retry').addEventListener('click', handlers.retry);
    $('new-night').addEventListener('click', handlers.newNight);
    window.addEventListener('keydown', (e) => {
      if (this.endScreen.style.display !== 'flex') return;
      if (e.code === 'Enter' || e.code === 'Space') handlers.retry();
      if (e.code === 'KeyN') handlers.newNight();
    });
  }

  reset(): void {
    this.endScreen.style.display = 'none';
    this.lastTimer = this.lastTask = '';
  }

  cinema(on: boolean): void {
    document.body.classList.toggle('cinema', on);
  }

  /** Chapter title card, faded in and out. */
  showCard(title: string, sub: string, seconds: number): void {
    $('card-title').textContent = title;
    $('card-sub').textContent = sub;
    this.card.classList.add('on');
    window.setTimeout(() => this.card.classList.remove('on'), seconds * 1000);
  }

  hurt(): void {
    this.hurtEl.style.opacity = '1';
    clearTimeout(this.hurtTimer);
    this.hurtTimer = window.setTimeout(() => { this.hurtEl.style.opacity = '0'; }, 350);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 1800);
  }

  update(s: GameState, view: GameView): void {
    const t = fmt(s.remaining);
    if (t !== this.lastTimer) {
      this.lastTimer = t;
      this.timer.textContent = t;
      this.timer.classList.toggle('low', s.remaining <= 20);
    }

    const final = finalChapter(s);
    const clock = `CHAPTER ${s.chapter + 1}/${CHAPTERS} · ${final ? 'LAST EVAC IN' : 'TUNNELS SEAL IN'}`;
    if (clock !== this.lastClock) { this.lastClock = clock; this.clockLabel.textContent = clock; }
    const cur = currentTask(s);
    const ready = requiredDone(s);
    const label = ready ? exitLabel(final) : cur ? objectiveFor(cur, final, cur.kind === 'clear' ? clearLeft(s, cur) : null) : 'Find another way through';
    const optional = s.tasks.filter((x) => !x.required && !x.done);
    const html = `${label}${!ready && optional.length ? `<small>Optional, costs time: ${optional.map((o) => shortName(o)).join(', ')}</small>` : ''}`;
    if (html !== this.lastTask) {
      this.lastTask = html;
      this.task.innerHTML = html;
    }

    // vitals
    this.healthBar.style.width = `${(s.player.health / PLAYER_HEALTH) * 100}%`;
    this.funds.textContent = `$${s.funds}${s.arsenal.cans ? `  ·  Fuel can x${s.arsenal.cans}` : ''}`;
    // protective gear, as what is left of each piece
    const worn = (['vest', 'helmet'] as const).filter((g) => s.arsenal.gear[g] > 0);
    this.gear.style.display = worn.length ? 'block' : 'none';
    if (worn.length) this.gear.textContent = worn.map((g) => `${g === 'vest' ? 'Vest' : 'Helmet'} ${Math.ceil((s.arsenal.gear[g] / GEAR[g].durability) * 100)}%`).join('  ·  ');
    const car = playerVehicle(s);
    this.carHealth.style.display = car ? 'block' : 'none';
    if (car) {
      const fuel = Math.round(car.fuel * 100);
      this.carHealth.textContent = `Vehicle ${Math.round((car.health / VEHICLES[car.kind].health) * 100)}%  ·  Fuel ${fuel}%${s.pumping ? ' (filling)' : fuel === 0 ? ' (empty)' : ''}`;
      this.carHealth.style.color = fuel < 15 ? '#ff8a6a' : '';
    }
    const throwable = !car && s.arsenal.bottles > 0;
    this.throwBtn.style.display = throwable ? 'flex' : 'none';
    if (throwable) this.bottles.textContent = String(s.arsenal.bottles);

    // weapon and contextual Use button
    const a = s.arsenal;
    if (a.weapon) {
      const gun = isGun(a.weapon) ? a.weapon : null;
      this.ammo.textContent = !gun ? 'MELEE' : a.reloadT > 0 ? '...' : `${a.mag[gun]}/${a.ammo[gun]}`;
      this.weaponName.textContent = WEAPON_NAMES[a.weapon];
      const fire = gun ? 'FIRE' : 'SWING';
      if (this.fireBtn.textContent !== fire) this.fireBtn.textContent = fire;
      this.reloadBtn.style.visibility = gun ? 'visible' : 'hidden';
    }
    const use = useLabel(s, interactionFor(s));
    this.useBtn.style.display = use ? 'flex' : 'none';
    if (use && this.useBtn.textContent !== use) this.useBtn.textContent = use;

    // compass arrow to the current objective when it is off screen
    const target = ready ? (s.safehouseKnown ? s.safehouse : null) : cur ? taskTarget(s, cur) : null;
    if (target && s.phase === 'playing' && !view.onScreen(target)) {
      const ang = view.screenAngle(s.player.pos, target);
      this.arrow.style.display = 'block';
      this.arrowIcon.style.transform = `rotate(${ang + Math.PI / 2}rad)`;
      this.arrowDist.textContent = `${Math.round(Math.hypot(target.x - s.player.pos.x, target.y - s.player.pos.y) * 0.63)} m`;
    } else {
      this.arrow.style.display = 'none';
    }

    const progress = s.hold.taskId ? s.hold.progress : s.work ? s.work.progress : -1;
    this.hold.style.display = progress >= 0 ? 'block' : 'none';
    this.holdBar.style.width = `${Math.min(1, Math.max(0, progress)) * 100}%`;
  }

  showEnd(s: GameState): void {
    const outcome = s.phase === 'won' ? 'won' : s.lossReason ?? 'caught';
    const e = ending(outcome, finalChapter(s));
    const title = $('end-title');
    title.textContent = e.title;
    title.className = s.phase === 'won' ? 'won' : 'lost';
    $('end-text').textContent = s.phase === 'won'
      ? `${e.text} (${fmt(s.remaining)} to spare, ${s.kills} infected down.)`
      : `${e.text} (Chapter ${s.chapter + 1} of ${CHAPTERS}.)`;
    $('retry').textContent = s.chapter > 0 && s.phase !== 'won' ? 'Retry chapter' : 'Try again';
    $('end-seed').textContent = `Night ${s.night}${s.chapter > 0 ? ` · chapter ${s.chapter + 1}` : ''}`;
    this.arrow.style.display = 'none';
    this.hold.style.display = 'none';
    this.endScreen.style.display = 'flex';
  }
}
