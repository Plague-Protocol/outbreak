import type { Input } from '../core/types';

const STICK_RADIUS = 55; // px for full deflection
const SQRT1_2 = Math.SQRT1_2;

/**
 * Keyboard and touch. Movement: WASD/arrows or a floating stick (drag anywhere that is not a
 * button). Buttons: Fire (hold), Use, Reload, Swap, Throw. Keys: Space fire, E use, R reload, Q swap, G throw.
 * The stick's screen direction is rotated 45 degrees into world space (fixed camera yaw).
 */
export class Controls {
  private keys = new Set<string>();
  private pointerId: number | null = null;
  private origin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 }; // screen space, y down
  private fireHeld = false;
  private queued = { action: false, reload: false, swap: false, throw: false };
  enabled = true;

  constructor(surface: HTMLElement, private stick: HTMLElement, private knob: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE' || e.code === 'Enter') this.queued.action = true;
      if (e.code === 'KeyR') this.queued.reload = true;
      if (e.code === 'KeyG') this.queued.throw = true;
      if (e.code === 'KeyQ' || e.code === 'Tab') { this.queued.swap = true; e.preventDefault(); }
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.fireHeld = false; });

    surface.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      surface.setPointerCapture(e.pointerId);
      this.origin = { x: e.clientX, y: e.clientY };
      this.stickVec = { x: 0, y: 0 };
      this.stick.style.display = 'block';
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(0,0)';
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      let dx = (e.clientX - this.origin.x) / STICK_RADIUS;
      let dy = (e.clientY - this.origin.y) / STICK_RADIUS;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.stickVec = { x: dx, y: dy };
      this.knob.style.transform = `translate(${dx * STICK_RADIUS * 0.6}px, ${dy * STICK_RADIUS * 0.6}px)`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.stickVec = { x: 0, y: 0 };
      this.stick.style.display = 'none';
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);

    // on-screen buttons (each tracks its own finger, so you can move and shoot together)
    const button = (id: string, down: () => void, up?: () => void) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('down'); down(); });
      const release = () => { el.classList.remove('down'); up?.(); };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
    };
    button('btn-fire', () => { this.fireHeld = true; }, () => { this.fireHeld = false; });
    button('btn-use', () => { this.queued.action = true; });
    button('btn-reload', () => { this.queued.reload = true; });
    button('btn-swap', () => { this.queued.swap = true; });
    button('btn-throw', () => { this.queued.throw = true; });
  }

  /** Movement and buttons for one simulation step. Edge-triggered buttons fire once. */
  read(): Input {
    if (!this.enabled) return { dx: 0, dy: 0 };
    let sx = this.stickVec.x, sy = this.stickVec.y; // screen right, screen down
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) sx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) sx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) sy -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) sy += 1;
    const input: Input = {
      // screen -> world (camera looks along -x,-z): up = (-1,-1), right = (1,-1)
      dx: (sx + sy) * SQRT1_2,
      dy: (sy - sx) * SQRT1_2,
      fire: this.fireHeld || k.has('Space'),
      action: this.queued.action,
      reload: this.queued.reload,
      swap: this.queued.swap,
      throw: this.queued.throw,
    };
    this.queued = { action: false, reload: false, swap: false, throw: false };
    return input;
  }
}
