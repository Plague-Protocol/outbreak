import { buy, equip, gunStats, isGun, meleeStats, priceOf, type GameState } from '../core/state';
import { GEAR, GUNS, JERRYCAN_FUEL, MEDKIT_HEAL, PLAYER_HEALTH, UPGRADE_EFFECT, UPGRADE_LEVELS, WEAPON_NAMES } from '../core/config';
import type { GearKind, GunKind, MeleeKind, Store, StoreItem, UpgradeKind, WeaponKind } from '../core/types';

const $ = (id: string) => document.getElementById(id)!;

type Tab = 'weapons' | 'gear' | 'upgrades' | 'ammo' | 'supplies';
const TABS: Array<[Tab, string]> = [['weapons', 'Weapons'], ['gear', 'Gear'], ['upgrades', 'Upgrades'], ['ammo', 'Ammo'], ['supplies', 'Supplies']];
const GEAR_ORDER: GearKind[] = ['vest', 'helmet'];
const GEAR_BLURB: Record<GearKind, string> = {
  vest: 'Plates front and back. Takes half of every hit until it is torn through.',
  helmet: 'Hard shell and visor. Takes a quarter of every hit.',
};

const BLURB: Record<WeaponKind, string> = {
  pistol: 'Reliable sidearm. Loud enough to draw a crowd.',
  shotgun: 'Devastating up close. Six pellets, wide spread.',
  rifle: 'Fully automatic and long range. Very loud.',
  baton: 'Quick and quiet. Keeps them off you.',
  bat: 'A wide swing that can hit three at once.',
  machete: 'Drops a walker in one clean hit.',
};
const GUN_ORDER: GunKind[] = ['pistol', 'shotgun', 'rifle'];
const MELEE_ORDER: MeleeKind[] = ['baton', 'bat', 'machete'];
const UPGRADE_NAMES: Record<UpgradeKind, [string, string]> = {
  damage: ['Damage', `+${UPGRADE_EFFECT.damage * 100}% per level`],
  mag: ['Extended magazine', `+${UPGRADE_EFFECT.mag * 100}% rounds per level`],
  reload: ['Fast reload', `-${UPGRADE_EFFECT.reload * 100}% reload time per level`],
};

/** Silhouette of each weapon (or piece of gear) for its card, drawn once into a small canvas. */
function icon(w: WeaponKind | GearKind): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8d2c4';
  const r = (x: number, y: number, w2: number, h: number, a = 0) => {
    g.save(); g.translate(x, y); g.rotate(a); g.fillRect(0, 0, w2, h); g.restore();
  };
  switch (w) {
    case 'pistol': r(38, 14, 44, 10); r(44, 22, 12, 18, 0.25); r(60, 24, 10, 4); break;
    case 'shotgun': r(12, 16, 34, 12, 0.08); r(42, 14, 22, 12); r(62, 14, 50, 6); r(66, 21, 26, 7); break;
    case 'rifle': r(10, 16, 30, 11, 0.06); r(38, 13, 40, 13); r(76, 16, 34, 5); r(58, 25, 9, 17, 0.35); r(44, 25, 8, 13, 0.3); break;
    case 'baton': r(14, 22, 92, 6); r(30, 14, 6, 14); break;
    case 'bat': r(10, 22, 8, 6); r(16, 23, 44, 4); r(58, 21, 52, 9); break;
    case 'machete': r(10, 21, 30, 7); r(38, 18, 4, 13); g.fillStyle = '#eef1f4'; r(42, 19, 68, 9); break;
    case 'vest': r(40, 6, 12, 8); r(68, 6, 12, 8); r(36, 12, 48, 32); g.fillStyle = '#9aa38c'; r(42, 30, 10, 10); r(55, 30, 10, 10); r(68, 30, 10, 10); break;
    case 'helmet':
      g.beginPath(); g.arc(60, 34, 24, Math.PI, 0); g.fill(); r(34, 33, 52, 5);
      g.fillStyle = '#8fb0c8'; r(44, 24, 32, 7); break;
  }
  return c;
}

function bar(label: string, frac: number): string {
  return `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(Math.max(0.04, Math.min(1, frac)) * 100)}%"></b></i></div>`;
}

/** The store's page: everything on sale, what you own, what is in your hand. Pauses the game. */
export class StorePage {
  private el = $('store');
  private tab: Tab = 'weapons';
  private s: GameState | null = null;
  private onClose: () => void = () => {};
  private icons = new Map<WeaponKind | GearKind, string>();

  constructor(private toast: (text: string) => void) {
    $('store-close').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (this.open && (e.code === 'Escape' || e.code === 'KeyE')) this.close();
    });
    const tabs = $('store-tabs');
    for (const [id, name] of TABS) {
      const b = document.createElement('button');
      b.textContent = name;
      b.dataset.tab = id;
      b.addEventListener('click', () => { this.tab = id; this.render(); });
      tabs.appendChild(b);
    }
  }

  get open(): boolean {
    return this.el.style.display === 'flex';
  }

  show(s: GameState, store: Store, onClose: () => void): void {
    this.s = s;
    this.onClose = onClose;
    $('store-name').textContent = store.name.toUpperCase();
    this.tab = 'weapons';
    this.render();
    this.el.style.display = 'flex';
  }

  close(): void {
    if (!this.open) return;
    this.el.style.display = 'none';
    this.onClose();
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  /** Each weapon's silhouette, drawn once and reused as an image (a cloned canvas would be blank). */
  private icon(w: WeaponKind | GearKind): HTMLImageElement {
    let src = this.icons.get(w);
    if (!src) { src = icon(w).toDataURL(); this.icons.set(w, src); }
    const img = new Image();
    img.src = src;
    img.alt = w === 'vest' || w === 'helmet' ? GEAR[w].name : WEAPON_NAMES[w];
    return img;
  }

  private buy(item: StoreItem, what: string): void {
    if (!this.s) return;
    if (buy(this.s, item)) this.toast(`Bought: ${what}`);
    this.render();
  }

  /** A buy button: the price, or why you cannot. */
  private priceButton(item: StoreItem, what: string, soldOut = 'Owned'): HTMLButtonElement {
    const s = this.s!;
    const price = priceOf(s, item);
    const b = document.createElement('button');
    b.className = 'buy';
    if (price === null) { b.textContent = soldOut; b.disabled = true; return b; }
    b.textContent = `$${price}`;
    b.disabled = s.funds < price;
    b.addEventListener('click', () => this.buy(item, what));
    return b;
  }

  private render(): void {
    const s = this.s;
    if (!s) return;
    const a = s.arsenal;
    $('store-cash').textContent = `$${s.funds}`;
    $('store-hand').textContent = `In hand: ${a.weapon ? WEAPON_NAMES[a.weapon] : 'nothing'}`;
    for (const b of $('store-tabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === this.tab);
    const list = $('store-list');
    list.innerHTML = '';
    const heading = (text: string) => { const h = document.createElement('h2'); h.textContent = text; list.appendChild(h); };

    if (this.tab === 'weapons') {
      const card = (w: WeaponKind) => {
        const owned = a.owned.includes(w);
        const el = document.createElement('div');
        el.className = `card${a.weapon === w ? ' held' : ''}`;
        let stats: string;
        if (isGun(w)) {
          const g = gunStats(a, w);
          stats = bar('Damage', (g.damage * g.pellets) / 130) + bar('Fire rate', 0.11 / g.interval) + bar('Range', g.range / 28) + bar('Magazine', g.mag / 42);
        } else {
          const m = meleeStats(a, w);
          stats = bar('Damage', m.damage / 72) + bar('Speed', 0.42 / m.interval) + bar('Reach', m.range / 2.8) + bar('Hits at once', m.cleave / 3);
        }
        el.innerHTML = `<div class="art"></div><div class="info"><b>${WEAPON_NAMES[w]}</b><small>${BLURB[w]}</small>${stats}</div><div class="act"></div>`;
        el.querySelector('.art')!.appendChild(this.icon(w));
        const act = el.querySelector('.act')!;
        if (owned) {
          const eq = document.createElement('button');
          eq.className = 'equip';
          eq.textContent = a.weapon === w ? 'In hand' : 'Equip';
          eq.disabled = a.weapon === w;
          eq.addEventListener('click', () => { if (equip(s, w)) this.toast(`${WEAPON_NAMES[w]} in hand`); this.render(); });
          act.appendChild(eq);
        } else {
          act.appendChild(this.priceButton({ kind: 'weapon', weapon: w }, WEAPON_NAMES[w]));
        }
        list.appendChild(el);
      };
      heading('Firearms');
      GUN_ORDER.forEach(card);
      heading('Melee');
      MELEE_ORDER.forEach(card);
    } else if (this.tab === 'gear') {
      heading('Protective gear');
      for (const g of GEAR_ORDER) {
        const spec = GEAR[g];
        const left = a.gear[g] / spec.durability;
        const el = document.createElement('div');
        el.className = `card${left > 0 ? ' held' : ''}`;
        const state = left <= 0 ? 'Not wearing one.' : left >= 0.999 ? 'Wearing it: as new.' : `Wearing it: ${Math.ceil(left * 100)}% left. Swap it for new.`;
        el.innerHTML = `<div class="art"></div><div class="info"><b>${spec.name}</b><small>${GEAR_BLURB[g]} ${state}</small>`
          + `${bar('Protection', spec.absorb / 0.5)}${bar('Condition', left)}</div><div class="act"></div>`;
        el.querySelector('.art')!.appendChild(this.icon(g));
        el.querySelector('.act')!.appendChild(this.priceButton({ kind: 'gear', gear: g }, spec.name, 'As new'));
        list.appendChild(el);
      }
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = 'Gear wears down as it takes hits. A worn piece is swapped for new at the price of the wear.';
      list.appendChild(p);
    } else if (this.tab === 'upgrades') {
      const owned = [...GUN_ORDER, ...MELEE_ORDER].filter((w) => a.owned.includes(w));
      for (const w of owned) {
        heading(WEAPON_NAMES[w]);
        const kinds: UpgradeKind[] = isGun(w) ? ['damage', 'mag', 'reload'] : ['damage'];
        for (const k of kinds) {
          const level = a.upgrades[w][k];
          const row = document.createElement('div');
          row.className = 'row';
          const pips = Array.from({ length: UPGRADE_LEVELS }, (_, i) => `<em class="${i < level ? 'on' : ''}"></em>`).join('');
          row.innerHTML = `<span><b>${UPGRADE_NAMES[k][0]}</b><small>${UPGRADE_NAMES[k][1]}</small></span><span class="pips">${pips}</span>`;
          row.appendChild(this.priceButton({ kind: 'upgrade', weapon: w, upgrade: k }, `${WEAPON_NAMES[w]}: ${UPGRADE_NAMES[k][0]}`, 'Maxed'));
          list.appendChild(row);
        }
      }
      const missing = [...GUN_ORDER, ...MELEE_ORDER].filter((w) => !a.owned.includes(w));
      if (missing.length) {
        const p = document.createElement('p');
        p.className = 'note';
        p.textContent = `Buy or find the ${missing.map((w) => WEAPON_NAMES[w].toLowerCase()).join(', ')} to upgrade it.`;
        list.appendChild(p);
      }
    } else if (this.tab === 'ammo') {
      const guns = GUN_ORDER.filter((w) => a.owned.includes(w));
      for (const w of guns) {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `<span><b>${WEAPON_NAMES[w]} ammo</b><small>${GUNS[w].ammoPack} rounds. You have ${a.mag[w]} loaded, ${a.ammo[w]} spare.</small></span>`;
        row.appendChild(this.priceButton({ kind: 'ammo', weapon: w }, `${WEAPON_NAMES[w]} ammo`));
        list.appendChild(row);
      }
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = 'Melee weapons never run dry.';
      list.appendChild(p);
    } else {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span><b>Medkit</b><small>Heals ${MEDKIT_HEAL}. Your health: ${Math.round(s.player.health)}/${PLAYER_HEALTH}.</small></span>`;
      row.appendChild(this.priceButton({ kind: 'medkit' }, 'Medkit'));
      list.appendChild(row);
      const row2 = document.createElement('div');
      row2.className = 'row';
      row2.innerHTML = `<span><b>Bottles (3)</b><small>Throw one to draw them away. You have ${s.arsenal.bottles}.</small></span>`;
      row2.appendChild(this.priceButton({ kind: 'bottles' }, 'Bottles'));
      list.appendChild(row2);
      const row3 = document.createElement('div');
      row3.className = 'row';
      row3.innerHTML = `<span><b>Jerrycan</b><small>Fills a car tank by ${Math.round(JERRYCAN_FUEL * 100)}%. You have ${s.arsenal.cans}.</small></span>`;
      row3.appendChild(this.priceButton({ kind: 'jerrycan' }, 'Jerrycan'));
      list.appendChild(row3);
    }
  }
}
