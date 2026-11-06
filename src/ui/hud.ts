import { buy, currentTask, interactionFor, playerVehicle, requiredDone, type GameState } from '../core/state';
import { ending, objectiveFor, SAFEHOUSE_LABEL, shortName } from '../core/story';
import { PLAYER_HEALTH, STORE_PRICES, VEHICLES, WEAPONS } from '../core/config';
import type { Interaction, StoreItem, TaskId } from '../core/types';
import type { GameView } from '../render/view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fmt = (s: number) => {
  const t = Math.ceil(Math.max(0, s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const TASK_VERB: Record<TaskId, string> = {
  map: 'TAKE MAP', key: 'TAKE KEY', power: 'START', gate: 'OPEN', keycard: 'TAKE CARD', radio: 'TUNE IN',
  fuel: 'SIPHON', medkit: 'GATHER', rescue: 'HELP',
};

function useLabel(it: Interaction | null): string | null {
  if (!it) return null;
  switch (it.kind) {
    case 'exit': return 'GET OUT';
    case 'enter': return 'GET IN';
    case 'crate': return 'SEARCH';
    case 'store': return 'SHOP';
    case 'task': return TASK_VERB[it.taskId];
  }
}

const STORE_ITEMS: Array<{ item: StoreItem; name: string; note: string }> = [
  { item: 'pistol-ammo', name: 'Pistol ammo', note: `${WEAPONS.pistol.ammoPack} rounds` },
  { item: 'shotgun', name: 'Shotgun', note: 'Close range, wide spread' },
  { item: 'shotgun-ammo', name: 'Shotgun shells', note: `${WEAPONS.shotgun.ammoPack} shells` },
  { item: 'rifle', name: 'Assault rifle', note: 'Fully automatic, long range' },
  { item: 'rifle-ammo', name: 'Rifle ammo', note: `${WEAPONS.rifle.ammoPack} rounds` },
  { item: 'medkit', name: 'Medkit', note: 'Heals half your health' },
];

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
  private storeEl = $('store');
  private toastTimer = 0;
  private hurtTimer = 0;
  private lastTimer = '';
  private lastTask = '';
  private storeState: GameState | null = null;
  private onStoreClose: () => void = () => {};

  constructor(handlers: { retry: () => void; newNight: () => void }) {
    $('retry').addEventListener('click', handlers.retry);
    $('new-night').addEventListener('click', handlers.newNight);
    $('store-close').addEventListener('click', () => this.closeStore());
    window.addEventListener('keydown', (e) => {
      if (this.storeEl.style.display === 'flex' && (e.code === 'Escape' || e.code === 'KeyE')) { this.closeStore(); return; }
      if (this.endScreen.style.display !== 'flex') return;
      if (e.code === 'Enter' || e.code === 'Space') handlers.retry();
      if (e.code === 'KeyN') handlers.newNight();
    });
  }

  reset(): void {
    this.endScreen.style.display = 'none';
    this.storeEl.style.display = 'none';
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

  get storeOpen(): boolean {
    return this.storeEl.style.display === 'flex';
  }

  openStore(s: GameState, onClose: () => void): void {
    this.storeState = s;
    this.onStoreClose = onClose;
    this.renderStore();
    this.storeEl.style.display = 'flex';
  }

  private closeStore(): void {
    if (!this.storeOpen) return;
    this.storeEl.style.display = 'none';
    this.onStoreClose();
  }

  private renderStore(): void {
    const s = this.storeState;
    if (!s) return;
    $('store-cash').textContent = `You have $${s.funds}`;
    const list = $('store-items');
    list.innerHTML = '';
    for (const { item, name, note } of STORE_ITEMS) {
      const owned = (item === 'shotgun' || item === 'rifle') && s.arsenal.owned.includes(item);
      const price = STORE_PRICES[item];
      const li = document.createElement('li');
      li.innerHTML = `<span>${name}<small>${owned ? 'Owned' : note}</small></span>`;
      const b = document.createElement('button');
      b.textContent = `$${price}`;
      b.disabled = owned || s.funds < price;
      b.addEventListener('click', () => {
        if (buy(s, item)) { this.toast(`Bought: ${name}`); this.renderStore(); }
      });
      li.appendChild(b);
      list.appendChild(li);
    }
  }

  update(s: GameState, view: GameView): void {
    const t = fmt(s.remaining);
    if (t !== this.lastTimer) {
      this.lastTimer = t;
      this.timer.textContent = t;
      this.timer.classList.toggle('low', s.remaining <= 20);
    }

    const cur = currentTask(s);
    const ready = requiredDone(s);
    const label = ready ? SAFEHOUSE_LABEL : cur ? objectiveFor(cur.id) : 'Find another way through';
    const optional = s.tasks.filter((x) => !x.required && !x.done);
    const html = `${label}${!ready && optional.length ? `<small>Optional, costs time: ${optional.map((o) => shortName(o.id)).join(', ')}</small>` : ''}`;
    if (html !== this.lastTask) {
      this.lastTask = html;
      this.task.innerHTML = html;
    }

    // vitals
    this.healthBar.style.width = `${(s.player.health / PLAYER_HEALTH) * 100}%`;
    this.funds.textContent = `$${s.funds}`;
    const car = playerVehicle(s);
    this.carHealth.style.display = car ? 'block' : 'none';
    if (car) this.carHealth.textContent = `Vehicle ${Math.round((car.health / VEHICLES[car.kind].health) * 100)}%`;

    // weapon and contextual Use button
    const a = s.arsenal;
    if (a.weapon) {
      this.ammo.textContent = a.reloadT > 0 ? '...' : `${a.mag[a.weapon]}/${a.ammo[a.weapon]}`;
      this.weaponName.textContent = WEAPONS[a.weapon].name;
    }
    const use = useLabel(interactionFor(s));
    this.useBtn.style.display = use ? 'flex' : 'none';
    if (use && this.useBtn.textContent !== use) this.useBtn.textContent = use;

    // compass arrow to the current objective when it is off screen
    const target = ready ? (s.safehouseKnown ? s.safehouse : null) : cur?.pos ?? null;
    if (target && s.phase === 'playing' && !view.onScreen(target)) {
      const ang = view.screenAngle(s.player.pos, target);
      this.arrow.style.display = 'block';
      this.arrowIcon.style.transform = `rotate(${ang + Math.PI / 2}rad)`;
      this.arrowDist.textContent = `${Math.round(Math.hypot(target.x - s.player.pos.x, target.y - s.player.pos.y) * 0.63)} m`;
    } else {
      this.arrow.style.display = 'none';
    }

    this.hold.style.display = s.hold.taskId ? 'block' : 'none';
    this.holdBar.style.width = `${Math.min(1, s.hold.progress) * 100}%`;
  }

  showEnd(s: GameState): void {
    const outcome = s.phase === 'won' ? 'won' : s.lossReason ?? 'caught';
    const e = ending(outcome);
    const title = $('end-title');
    title.textContent = e.title;
    title.className = s.phase === 'won' ? 'won' : 'lost';
    $('end-text').textContent = s.phase === 'won' ? `${e.text} (${fmt(s.remaining)} to spare, ${s.kills} infected down.)` : e.text;
    $('end-seed').textContent = `Night ${s.seed}`;
    this.arrow.style.display = 'none';
    this.hold.style.display = 'none';
    this.endScreen.style.display = 'flex';
  }
}
