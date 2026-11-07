import { HERO, RADIO, type Line } from '../core/story';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const CHARS_PER_SEC = 70;

export interface NextUp {
  title: string; // the objective, in full
  detail: string; // how far, which way
}

/**
 * Story moments you read before you carry on: what you just found, the radio's next brief, a
 * survivor talking. The game waits (no clock, no zombies) while it is open; each line waits for a
 * tap, and the last page says plainly what to do next.
 */
export class Talk {
  private el = $('talk');
  private who = $('talk-who');
  private text = $('talk-text');
  private hint = $('talk-hint');
  private lines: Line[] = [];
  private next: NextUp | null = null;
  private line: Line | null = null;
  private page: 'line' | 'next' = 'line';
  private shown = 0;
  private onDone: (() => void) | null = null;
  private openedAt = 0;

  constructor() {
    this.el.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.advance(); });
    window.addEventListener('keydown', (e) => {
      if (this.open && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) { e.preventDefault(); this.advance(); }
    });
  }

  get open(): boolean {
    return this.onDone !== null;
  }

  /** Show lines (then the next objective, if given); calls onDone when the last page is tapped. */
  show(lines: Line[], next: NextUp | null, onDone: () => void): void {
    if (this.open) { // already talking: add to it
      this.lines.push(...lines);
      if (next) this.next = next;
      return;
    }
    this.lines = lines.slice();
    this.next = next;
    this.onDone = onDone;
    this.openedAt = performance.now();
    this.el.style.display = 'flex';
    document.body.classList.add('talking');
    this.step();
  }

  close(): void {
    this.lines = [];
    this.next = null;
    this.line = null;
    this.el.style.display = 'none';
    document.body.classList.remove('talking');
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  private advance(): void {
    if (performance.now() - this.openedAt < 250) return; // the tap or key that opened it
    if (this.page === 'line' && this.line && this.shown < this.line.text.length) {
      this.shown = this.line.text.length; // first tap: show the whole line
      this.render();
      return;
    }
    this.step();
  }

  private step(): void {
    this.line = this.lines.shift() ?? null;
    if (this.line) {
      this.page = 'line';
      this.shown = 0;
      const radio = this.line.who === RADIO;
      this.el.className = radio ? 'radio' : this.line.who === HERO ? 'hero' : 'other';
      this.who.textContent = radio ? 'Emergency radio' : this.line.who;
      this.render();
      return;
    }
    if (this.next && this.page !== 'next') {
      this.page = 'next';
      this.el.className = 'next';
      this.who.textContent = 'Next objective';
      this.text.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = this.next.title;
      const small = document.createElement('small');
      small.textContent = this.next.detail;
      this.text.append(b, small);
      this.hint.textContent = 'Tap to go';
      return;
    }
    this.close();
  }

  private render(): void {
    if (!this.line) return;
    this.text.textContent = this.line.text.slice(0, Math.floor(this.shown));
    const more = this.lines.length > 0 || this.next !== null;
    this.hint.textContent = this.shown < this.line.text.length ? '' : more ? 'Tap to continue' : 'Tap to go';
  }

  update(dt: number): void {
    if (!this.open || this.page !== 'line' || !this.line || this.shown >= this.line.text.length) return;
    this.shown = Math.min(this.line.text.length, this.shown + dt * CHARS_PER_SEC);
    this.render();
  }
}
