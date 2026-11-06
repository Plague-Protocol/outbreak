import { currentTask, requiredDone, type GameState } from '../core/state';
import { ending, objectiveFor, shortName } from '../core/story';
import type { GameView } from '../render/view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fmt = (s: number) => {
  const t = Math.ceil(Math.max(0, s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

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

    const cur = currentTask(s);
    const ready = requiredDone(s);
    const label = ready ? 'Get to St. Agnes Clinic' : cur ? objectiveFor(cur.id) : 'Find another way in';
    const optional = s.tasks.filter((x) => !x.required && !x.done);
    const html = `${label}${!ready && optional.length ? `<small>Optional, costs time: ${optional.map((o) => shortName(o.id)).join(', ')}</small>` : ''}`;
    if (html !== this.lastTask) {
      this.lastTask = html;
      this.task.innerHTML = html;
    }

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
    $('end-text').textContent = s.phase === 'won' ? `${e.text} (${fmt(s.remaining)} to spare.)` : e.text;
    $('end-seed').textContent = `Night ${s.seed}`;
    this.arrow.style.display = 'none';
    this.hold.style.display = 'none';
    this.endScreen.style.display = 'flex';
  }
}
