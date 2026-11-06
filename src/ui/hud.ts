import { currentTask, requiredDone, type GameState } from '../core/state';
import type { GameEvent, TaskId } from '../core/types';
import type { GameView } from '../render/view';
import type { RunResult } from '../seams/progress';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fmt = (s: number) => {
  const t = Math.ceil(Math.max(0, s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export class Hud {
  private timer = $('timer');
  private task = $('task');
  private toast = $('toast');
  private arrow = $('arrow');
  private arrowIcon = $('arrow-icon');
  private arrowDist = $('arrow-dist');
  private hold = $('hold');
  private holdBar = $('hold-bar');
  private overlay = $('overlay');
  private toastTimer = 0;
  private lastTimer = '';
  private lastTask = '';

  constructor(private onPlayAgain: () => void) {
    $('ov-btn').addEventListener('click', () => this.onPlayAgain());
    window.addEventListener('keydown', (e) => {
      if ((e.code === 'Enter' || e.code === 'Space') && this.overlay.style.display === 'flex') this.onPlayAgain();
    });
  }

  reset(): void {
    this.overlay.style.display = 'none';
    this.lastTimer = this.lastTask = '';
  }

  update(s: GameState, view: GameView, events: readonly GameEvent[]): void {
    const t = fmt(s.remaining);
    if (t !== this.lastTimer) {
      this.lastTimer = t;
      this.timer.textContent = t;
      this.timer.classList.toggle('low', s.remaining <= 15);
    }

    const cur = currentTask(s);
    const ready = requiredDone(s);
    const label = ready ? 'Reach the safehouse!' : cur ? cur.label : 'Find another way...';
    const hint = ready ? '' : cur?.hint ?? '';
    const optional = s.tasks.filter((x) => !x.required && !x.done).length;
    const html = `${label}${hint ? `<small>${hint}</small>` : ''}${!ready && optional ? `<small>${optional} optional task${optional > 1 ? 's' : ''} (cost time)</small>` : ''}`;
    if (html !== this.lastTask) {
      this.lastTask = html;
      this.task.innerHTML = html;
    }

    // compass arrow to the current objective
    const target = ready ? (s.safehouseKnown ? s.safehouse : null) : cur?.pos ?? null;
    if (target && s.phase === 'playing' && !view.onScreen(target)) {
      const ang = view.screenAngle(s.player.pos, target);
      this.arrow.style.display = 'block';
      this.arrowIcon.style.transform = `rotate(${ang + Math.PI / 2}rad)`;
      this.arrowDist.textContent = `${Math.round(Math.hypot(target.x - s.player.pos.x, target.y - s.player.pos.y))} m`;
    } else {
      this.arrow.style.display = 'none';
    }

    this.hold.style.display = s.hold.taskId ? 'block' : 'none';
    this.holdBar.style.width = `${Math.min(1, s.hold.progress) * 100}%`;

    for (const e of events) this.onEvent(e, s);
  }

  private name(s: GameState, id: TaskId): string {
    return s.tasks.find((t) => t.id === id)?.label.toLowerCase() ?? id;
  }

  private onEvent(e: GameEvent, s: GameState): void {
    switch (e.type) {
      case 'task-done': this.say(`${s.tasks.find((t) => t.id === e.id)?.label ?? e.id} - done`); break;
      case 'task-locked': this.say(`Locked. First: ${e.needs.map((n) => this.name(s, n)).join(', ')}`); break;
      case 'safehouse-locked': {
        const left = s.tasks.filter((t) => t.required && !t.done).map((t) => t.label.toLowerCase());
        this.say(`Door locked. Still to do: ${left.join(', ')}`);
        break;
      }
      case 'tier-up': this.say(e.tier === 1 ? 'The horde is stirring...' : 'They know where you are!'); break;
      case 'time-penalty': this.say(`-${e.seconds}s`); break;
      default: break;
    }
  }

  private say(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('on'), 2200);
  }

  showEnd(s: GameState, result: RunResult): void {
    const won = s.phase === 'won';
    $('ov-title').textContent = won ? 'Safe.' : s.lossReason === 'time' ? 'Out of time' : 'Caught';
    $('ov-text').textContent = won
      ? `You made it with ${fmt(result.secondsLeft)} to spare.`
      : s.lossReason === 'time'
        ? 'The clock ran out before you reached the safehouse.'
        : 'The dead got you.';
    $('ov-seed').textContent = `Seed ${s.seed}`;
    this.arrow.style.display = 'none';
    this.hold.style.display = 'none';
    this.overlay.style.display = 'flex';
  }
}
