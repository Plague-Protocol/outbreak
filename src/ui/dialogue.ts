import { HERO, RADIO, type Line } from '../core/story';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const CHARS_PER_SEC = 55;

/**
 * Plays "Speaker|line" dialogue as subtitles. A cutscene blocks and waits for taps (or reading
 * time), like Eko Lockdown's PlayLines; ambient lines (radio calls during play) queue up and play
 * without stopping the game.
 */
export class Dialogue {
  private box = $('subs');
  private who = $('subs-who');
  private text = $('subs-text');
  private catcher = $('tap-catcher');
  private skipBtn = $('skip');
  private queue: Line[] = [];
  private line: Line | null = null;
  private shown = 0; // characters revealed
  private hold = 0; // seconds left on a fully shown line
  private cutscene: { onDone: () => void } | null = null;

  constructor() {
    this.catcher.addEventListener('pointerdown', () => this.advance());
    this.skipBtn.addEventListener('click', () => this.skip());
    window.addEventListener('keydown', (e) => {
      if (!this.cutscene) return;
      if (e.code === 'Space' || e.code === 'Enter') this.advance();
      if (e.code === 'Escape') this.skip();
    });
  }

  get inCutscene(): boolean {
    return this.cutscene !== null;
  }

  /** Blocking: plays the lines, then calls onDone. */
  playCutscene(lines: Line[], onDone: () => void): void {
    this.queue = lines.slice();
    this.line = null;
    this.cutscene = { onDone };
    this.catcher.style.display = 'block';
    this.skipBtn.style.display = 'block';
    this.next();
  }

  /** Non-blocking: queue lines to play over the game. */
  say(lines: Line[]): void {
    if (lines.length === 0) return;
    this.queue.push(...lines);
    if (!this.line) this.next();
  }

  clear(): void {
    this.queue = [];
    this.line = null;
    this.box.classList.remove('on');
  }

  private skip(): void {
    if (!this.cutscene) return;
    this.queue = [];
    this.finishCutscene();
  }

  private advance(): void {
    if (!this.line) return;
    if (this.shown < this.line.text.length) { this.shown = this.line.text.length; this.render(); return; }
    this.next();
  }

  private finishCutscene(): void {
    const c = this.cutscene;
    this.cutscene = null;
    this.catcher.style.display = 'none';
    this.skipBtn.style.display = 'none';
    this.line = null;
    this.box.classList.remove('on');
    c?.onDone();
  }

  private next(): void {
    this.line = this.queue.shift() ?? null;
    if (!this.line) {
      if (this.cutscene) this.finishCutscene();
      else this.box.classList.remove('on');
      return;
    }
    this.shown = 0;
    this.hold = Math.max(1.8, this.line.text.split(' ').length * 0.28) + (this.cutscene ? 1.2 : 0);
    const kind = this.line.who === RADIO || this.line.who === 'Clinic' ? 'radio' : this.line.who === 'Narrator' ? 'narr' : '';
    this.who.className = `who ${kind}`;
    this.who.textContent = this.line.who === 'Narrator' ? '' : this.line.who === HERO ? HERO : this.line.who;
    this.text.className = `text ${kind}`;
    this.box.classList.add('on');
    this.render();
  }

  private render(): void {
    if (!this.line) return;
    this.text.textContent = this.line.text.slice(0, Math.floor(this.shown));
  }

  update(dt: number): void {
    if (!this.line) return;
    if (this.shown < this.line.text.length) {
      this.shown = Math.min(this.line.text.length, this.shown + dt * CHARS_PER_SEC);
      this.render();
      return;
    }
    this.hold -= dt;
    if (this.hold <= 0) this.next();
  }
}
