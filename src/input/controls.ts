import type { Input } from '../core/types';

const STICK_RADIUS = 55; // px for full deflection
const SQRT1_2 = Math.SQRT1_2;

/**
 * Keyboard (WASD/arrows) and a floating touch/mouse stick. Both give a screen-space direction
 * that is rotated 45 degrees into world space, because the camera is isometric.
 */
export class Controls {
  private keys = new Set<string>();
  private pointerId: number | null = null;
  private origin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 }; // screen space, y down

  constructor(surface: HTMLElement, private stick: HTMLElement, private knob: HTMLElement) {
    window.addEventListener('keydown', (e) => { this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => this.keys.clear());

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
  }

  read(): Input {
    let sx = this.stickVec.x, sy = this.stickVec.y; // screen right, screen down
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) sx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) sx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) sy -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) sy += 1;
    // screen -> world (camera looks along -x,-z): up = (-1,-1), right = (1,-1)
    return { dx: (sx + sy) * SQRT1_2, dy: (sy - sx) * SQRT1_2 };
  }
}
