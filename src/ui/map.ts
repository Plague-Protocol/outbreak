import { currentTask, finalChapter, isRevealed, requiredDone, type GameState } from '../core/state';
import { CITY_NAME } from '../core/map';
import { shortName } from '../core/story';
import type { MapData, Vec2 } from '../core/types';

// The map is drawn rotated 45 degrees so that "up" on the map is "up" on screen (the camera's
// fixed yaw). World (x, y) -> map: rotate by +45 degrees.
const ROT = Math.PI / 4;
const PX = 3; // pixels per world unit in the cached base image (sharp when the full map is zoomed in)
const MAX_ZOOM = 4;

const DISTRICT_COLORS: Record<string, string> = {
  downtown: '#3b3e46', residential: '#33402f', park: '#26402a', industrial: '#3d3935', outskirts: '#3a332b', water: '#0f2a3d',
};
const SOLID_COLORS: Record<string, string> = {
  tower: '#15161a', building: '#15161a', shop: '#2a2622', house: '#4a3a30', warehouse: '#24272c', container: '#5a3a2a',
  store: '#8c2422', hospital: '#c8c8c0', bus: '#6a6a60', truck: '#3f4628', sandbag: '#7a6a4a', ambulance: '#d8d8d2', tree: '#2e5a33', deadtree: '#4a4136', water: '#0f2a3d',
};

/** The left safe-area inset (a phone's notch in landscape), in CSS px. */
function insetLeft(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--l')) || 0;
}

/** Static map image (roads, districts, buildings), drawn once per night. */
function drawBase(map: MapData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(map.size * PX);
  const g = c.getContext('2d')!;
  g.scale(PX, PX);
  g.fillStyle = '#5a5d63'; // roads
  g.fillRect(0, 0, map.size, map.size);
  for (const b of map.blocks) {
    g.fillStyle = DISTRICT_COLORS[b.district] ?? '#333';
    g.fillRect(b.x, b.y, b.size, b.size);
  }
  for (const d of map.decor) {
    if (d.kind === 'pier') { g.fillStyle = '#5a4a35'; g.fillRect(d.x, d.y, d.w, d.h); }
    if (d.kind === 'canopy') { g.fillStyle = '#7a7670'; g.fillRect(d.x, d.y, d.w, d.h); }
  }
  for (const o of map.buildings) {
    const col = SOLID_COLORS[o.kind];
    if (!col) continue;
    g.fillStyle = col;
    if (o.kind === 'tree' || o.kind === 'deadtree') { g.beginPath(); g.arc(o.x + o.w / 2, o.y + o.h / 2, 1.6, 0, Math.PI * 2); g.fill(); }
    else g.fillRect(o.x, o.y, o.w, o.h);
  }
  return c;
}

interface Marker { pos: Vec2; color: string; size: number; label?: string; shape?: 'dot' | 'square' | 'ring' | 'cash' }

function markers(s: GameState): Marker[] {
  const out: Marker[] = [];
  const cur = currentTask(s);
  for (const t of s.tasks) {
    if (t.done || !isRevealed(s, t)) continue; // later steps stay hidden until they come up
    out.push({ pos: t.pos, color: t.required ? '#f2b630' : '#3f9be6', size: t === cur ? 7 : 5, shape: 'ring', label: t === cur ? shortName(t.id) : undefined });
  }
  if (s.safehouseKnown) out.push({ pos: s.safehouse, color: requiredDone(s) ? '#3ddc84' : '#d9534f', size: 8, shape: 'ring', label: finalChapter(s) ? 'Evac' : 'Subway' });
  for (const st of s.stores) out.push({ pos: st.pos, color: '#ff4b4b', size: 6, shape: 'cash', label: 'Weapons' });
  for (const v of s.survivors) {
    if (v.status === 'done') continue;
    out.push({ pos: v.pos, color: '#7fe08a', size: 6, shape: 'ring', label: v.name });
    if (v.request === 'fetch' && v.status === 'asked' && !v.carrying) out.push({ pos: v.fetchPos, color: '#7fe08a', size: 4, shape: 'dot', label: `${v.name}'s bag` });
  }
  for (const h of s.houses) if (!h.searched) out.push({ pos: h.pos, color: '#c8d4ee', size: 2.2, shape: 'dot' });
  for (const p of s.pickups) if (!p.taken && p.kind === 'jerrycan') out.push({ pos: p.pos, color: '#e05030', size: 3, shape: 'square' });
  for (const p of s.pickups) if (!p.taken && p.kind !== 'ammo' && p.kind !== 'bottles' && p.kind !== 'jerrycan') out.push({ pos: p.pos, color: p.kind === 'bat' || p.kind === 'machete' ? '#d0a070' : p.kind === 'vest' || p.kind === 'helmet' ? '#8cc4ff' : '#f2d060', size: 3.5, shape: 'dot' });
  for (const v of s.vehicles) if (!v.wrecked && v.id !== s.player.vehicleId) out.push({ pos: v.pos, color: '#e8e8e8', size: 3, shape: 'square' });
  return out;
}

function drawMarker(g: CanvasRenderingContext2D, m: Marker, x: number, y: number, scale: number, labels: boolean): void {
  const r = m.size * scale;
  g.fillStyle = m.color;
  g.strokeStyle = m.color;
  g.lineWidth = Math.max(1.5, 2 * scale);
  switch (m.shape) {
    case 'ring': g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x, y, r * 0.35, 0, Math.PI * 2); g.fill(); break;
    case 'square': g.fillRect(x - r, y - r, r * 2, r * 2); break;
    case 'cash': g.fillRect(x - r, y - r, r * 2, r * 2); g.fillStyle = '#000'; g.font = `bold ${Math.round(r * 1.6)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', x, y + 0.5); break;
    default: g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  if (labels && m.label) {
    g.font = `${Math.round(11 * Math.max(1, scale))}px system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillStyle = '#fff';
    g.shadowColor = '#000';
    g.shadowBlur = 3;
    g.fillText(m.label, x, y - r - 3);
    g.shadowBlur = 0;
  }
}

function drawPlayer(g: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(heading + ROT + Math.PI / 2);
  g.fillStyle = '#fff';
  g.strokeStyle = '#000';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, -size);
  g.lineTo(size * 0.7, size * 0.8);
  g.lineTo(0, size * 0.4);
  g.lineTo(-size * 0.7, size * 0.8);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}

export class CityMap {
  private base: HTMLCanvasElement | null = null;
  private seed = -1;
  private mini: HTMLCanvasElement;
  private full: HTMLCanvasElement;
  private overlay: HTMLElement;
  open = false;
  // full map view: zoom 1 fits the whole city; `center` is the world point in the middle of the screen
  private zoom = 1;
  private center: Vec2 = { x: 0, y: 0 };
  private k = 1; // screen px per world unit, as last drawn
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture = { moved: 0, pinch: 0 };
  private player: Vec2 | null = null;
  private openedAt = 0;

  constructor(onToggle: (open: boolean) => void) {
    this.mini = document.getElementById('minimap') as HTMLCanvasElement;
    this.full = document.getElementById('fullmap') as HTMLCanvasElement;
    this.overlay = document.getElementById('map-screen')!;
    const toggle = () => {
      this.open = !this.open;
      this.overlay.style.display = this.open ? 'flex' : 'none';
      if (this.open) {
        this.openedAt = performance.now();
        // a phone screen is short: open zoomed in on the player; a big screen shows the whole city
        const short = Math.min(window.innerWidth, window.innerHeight) < 500;
        this.zoom = short ? 1.9 : 1;
        this.center = short && this.player ? { ...this.player } : { x: -1, y: -1 };
      }
      this.pointers.clear();
      onToggle(this.open);
    };
    this.mini.addEventListener('pointerdown', (e) => { e.stopPropagation(); toggle(); });
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyM') toggle(); });
    this.toggle = toggle;

    // drag to move, pinch or wheel to zoom, a plain tap closes
    const o = this.overlay;
    o.addEventListener('pointerdown', (e) => {
      if (!this.open || (e.target as HTMLElement).closest('button')) return;
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
      if (this.pointers.size === 0 && this.gesture.moved < 10 && e.type === 'pointerup') toggle();
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
    btn('map-close', () => { if (this.open) toggle(); });
  }

  toggle: () => void;

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private zoomBy(f: number): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(1, this.zoom * f));
  }

  /** Move the full map by a screen-space drag (the map is rotated, so turn it back into world units). */
  private pan(dx: number, dy: number): void {
    if (this.center.x < 0) return;
    const c = Math.cos(-ROT), s = Math.sin(-ROT);
    this.center.x -= (dx * c - dy * s) / this.k;
    this.center.y -= (dx * s + dy * c) / this.k;
  }

  private ensureBase(s: GameState): HTMLCanvasElement {
    if (!this.base || this.seed !== s.seed) {
      this.base = drawBase(s.map);
      this.seed = s.seed;
    }
    return this.base;
  }

  /** The corner minimap, centred on the player, ~60 m around. */
  drawMini(s: GameState): void {
    this.player = s.player.pos; // the full map opens on the player
    const base = this.ensureBase(s);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = this.mini.clientWidth || 120;
    if (this.mini.width !== Math.round(size * dpr)) { this.mini.width = this.mini.height = Math.round(size * dpr); }
    const g = this.mini.getContext('2d')!;
    const R = (size * dpr) / 2;
    const worldR = 55;
    const k = R / worldR; // px per world unit
    const p = s.player.pos;
    g.save();
    g.clearRect(0, 0, R * 2, R * 2);
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#0b0c0f';
    g.fillRect(0, 0, R * 2, R * 2);
    g.translate(R, R);
    g.rotate(ROT);
    g.drawImage(base, -p.x * k, -p.y * k, base.width * (k / PX), base.height * (k / PX));
    g.restore();
    // markers (positions rotated into minimap space, clamped to the rim when out of range)
    const cos = Math.cos(ROT), sin = Math.sin(ROT);
    g.save();
    for (const m of markers(s)) {
      const dx = m.pos.x - p.x, dy = m.pos.y - p.y;
      let x = (dx * cos - dy * sin) * k, y = (dx * sin + dy * cos) * k;
      const d = Math.hypot(x, y);
      const edge = R - 8 * dpr;
      if (d > edge) {
        if (m.shape !== 'ring') continue; // only objectives stick to the rim
        x *= edge / d; y *= edge / d;
      }
      drawMarker(g, m, R + x, R + y, dpr * 0.8, false);
    }
    drawPlayer(g, R, R, s.player.heading, 7 * dpr);
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.stroke();
  }

  /** The full city map. */
  drawFull(s: GameState): void {
    if (!this.open) return;
    const base = this.ensureBase(s);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (this.full.width !== cw || this.full.height !== ch) { this.full.width = cw; this.full.height = ch; }
    const g = this.full.getContext('2d')!;
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
