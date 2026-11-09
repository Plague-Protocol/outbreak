// The full-screen city map: drag to move, pinch or wheel to zoom, a plain tap closes. Loaded the first
// time the map is opened (not in the main bundle).
import { CITY_NAME } from '../core/map';
import type { GameState } from '../core/state';
import type { Vec2 } from '../core/types';
import { drawMarker, drawPlayer, insetLeft, markers, ROT, type CityMap } from './map';

const MAX_ZOOM = 4;

export class FullMap {
  // zoom 1 fits the whole city; `center` is the world point in the middle of the screen
  private zoom = 1;
  private center: Vec2 = { x: 0, y: 0 };
  private k = 1; // screen px per world unit, as last drawn
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture = { moved: 0, pinch: 0 };
  private openedAt = 0;

  constructor(private map: CityMap) {
    const o = map.overlay;
    o.addEventListener('pointerdown', (e) => {
      if (!map.open || (e.target as HTMLElement).closest('button')) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) this.gesture = { moved: 0, pinch: 0 };
      if (this.pointers.size === 2) this.gesture.pinch = this.spread();
      o.setPointerCapture?.(e.pointerId);
    });
    o.addEventListener('pointermove', (e) => {
      const last = this.pointers.get(e.pointerId);
      if (!last) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last.x = e.clientX; last.y = e.clientY;
      if (this.pointers.size === 1) {
        this.gesture.moved += Math.abs(dx) + Math.abs(dy);
        this.pan(dx, dy);
      } else if (this.pointers.size === 2) {
        this.gesture.moved += 99;
        const d = this.spread();
        if (this.gesture.pinch > 0) this.zoomBy(d / this.gesture.pinch);
        this.gesture.pinch = d;
      }
    });
    const up = (e: PointerEvent) => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (this.pointers.size === 0 && this.gesture.moved < 10 && e.type === 'pointerup') map.toggle();
      if (this.pointers.size === 1) this.gesture.pinch = 0;
    };
    o.addEventListener('pointerup', up);
    o.addEventListener('pointercancel', up);
    o.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    const btn = (id: string, f: () => void) => document.getElementById(id)?.addEventListener('click', (e) => {
      e.stopPropagation();
      // the tap that opened the map also ends in a click, right where the close button now sits
      if (performance.now() - this.openedAt > 400) f();
    });
    btn('map-in', () => this.zoomBy(1.4));
    btn('map-out', () => this.zoomBy(1 / 1.4));
    btn('map-close', () => { if (map.open) map.toggle(); });
  }

  opened(): void {
    this.openedAt = performance.now();
    // a phone screen is short: open zoomed in on the player; a big screen shows the whole city
    const short = Math.min(window.innerWidth, window.innerHeight) < 500;
    this.zoom = short ? 1.9 : 1;
    this.center = short && this.map.player ? { ...this.map.player } : { x: -1, y: -1 };
    this.pointers.clear();
  }

  closed(): void {
    this.pointers.clear();
  }

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private zoomBy(f: number): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(1, this.zoom * f));
  }

  /** Move the map by a screen-space drag (the map is rotated, so turn it back into world units). */
  private pan(dx: number, dy: number): void {
    if (this.center.x < 0) return;
    const c = Math.cos(-ROT), s = Math.sin(-ROT);
    this.center.x -= (dx * c - dy * s) / this.k;
    this.center.y -= (dx * s + dy * c) / this.k;
  }

  draw(s: GameState, base: HTMLCanvasElement): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (this.map.full.width !== cw || this.map.full.height !== ch) { this.map.full.width = cw; this.map.full.height = ch; }
    const g = this.map.full.getContext('2d')!;
    const half = s.map.size / 2;
    // zoom 1: the rotated city (a diamond as tall and wide as its diagonal) fits the screen
    const fit = (Math.min(W, H - 24) * 0.97) / (s.map.size * Math.SQRT2);
    this.k = fit * this.zoom;
    if (this.center.x < 0 || this.zoom <= 1.001) this.center = { x: half, y: half };
    this.center.x = Math.min(s.map.size, Math.max(0, this.center.x));
    this.center.y = Math.min(s.map.size, Math.max(0, this.center.y));
    const k = this.k * dpr;
    const cx = cw / 2, cy = ch / 2;
    const C = this.center;
    const toMap = (v: Vec2) => {
      const dx = v.x - C.x, dy = v.y - C.y;
      return { x: cx + (dx * Math.cos(ROT) - dy * Math.sin(ROT)) * k, y: cy + (dx * Math.sin(ROT) + dy * Math.cos(ROT)) * k };
    };
    g.clearRect(0, 0, cw, ch);
    g.save();
    g.translate(cx, cy);
    g.rotate(ROT);
    g.drawImage(base, -C.x * k, -C.y * k, s.map.size * k, s.map.size * k);
    g.restore();
    // district and landmark labels
    g.font = `${Math.round(10 * dpr)}px system-ui`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.55)';
    // one label per landmark, at the centre of its blocks
    const named = new Map<string, { x: number; y: number; n: number }>();
    for (const b of s.map.blocks) {
      if (!b.landmark) continue;
      const e = named.get(b.landmark) ?? { x: 0, y: 0, n: 0 };
      e.x += b.x + b.size / 2; e.y += b.y + b.size / 2; e.n++;
      named.set(b.landmark, e);
    }
    for (const [name, e] of named) {
      const m = toMap({ x: e.x / e.n, y: e.y / e.n });
      g.fillText(name, m.x, m.y);
    }
    const down = s.map.blocks.filter((b) => b.district === 'downtown');
    if (down.length) {
      const m = toMap({ x: down.reduce((a, b) => a + b.x + b.size / 2, 0) / down.length, y: down.reduce((a, b) => a + b.y + b.size / 2, 0) / down.length });
      g.fillText('Downtown', m.x, m.y);
    }
    for (const l of s.map.labels) { const m = toMap(l); g.fillText(l.name, m.x, m.y); }
    const water = s.map.buildings.find((o) => o.kind === 'water');
    if (water) { const m = toMap({ x: s.map.size / 2, y: water.y + 12 }); g.fillText('Harbour', m.x, m.y); }
    for (const mk of markers(s)) { const m = toMap(mk.pos); drawMarker(g, mk, m.x, m.y, dpr * 0.9, true); }
    const pm = toMap(s.player.pos);
    drawPlayer(g, pm.x, pm.y, s.player.heading, 9 * dpr);
    g.font = `bold ${Math.round(13 * dpr)}px system-ui`;
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.fillText(CITY_NAME.toUpperCase(), Math.max(14, insetLeft()) * dpr, 24 * dpr);
  }
}
