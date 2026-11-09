import { describe, expect, it } from 'vitest';
import { doTask } from './helpers';
import { answerFor } from './helpers';
import { content, stepText, validate, type Content } from '../src/core/content';
import {
  buy, chapterBonus, clearLeft, solvePuzzle, chapterSeed, createGame, currentTask, finalChapter, hurtPlayer, interactionFor, isRevealed, nextChapter,
  priceOf, restartChapter, step, escortGroup, type GameState,
} from '../src/core/state';
import { ending } from '../src/core/story';
import { CHAPTER_HEAL, CHAPTERS, GEAR, PLAYER_HEALTH } from '../src/core/config';
import type { Input, Task } from '../src/core/types';

const IDLE: Input = { dx: 0, dy: 0 };
const USE: Input = { dx: 0, dy: 0, action: true };
const DT = 1 / 30;

function calm(g: GameState): GameState {
  g.zombies = [];
  return g;
}


/** Do the steps before this one. */
function upTo(g: GameState, id: string): void {
  for (let k = 0; k < 10 && currentTask(g) && currentTask(g)!.id !== id; k++) doTask(g, currentTask(g)!);
  expect(currentTask(g)?.id).toBe(id);
}

/** Do every step in order and walk out. */
function clear(g: GameState): void {
  for (let k = 0, t = currentTask(g); t && k < 20; t = currentTask(g), k++) doTask(g, t);
  g.player.pos = { ...g.safehouse };
  step(g, IDLE, DT);
}

describe('objectives, one at a time', () => {
  it('only the current step is revealed; the map is always the last one', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = createGame(seed);
      const req = g.tasks.filter((t) => t.required);
      expect(req[req.length - 1]!.id).toBe('map');
      expect(g.safehouseKnown).toBe(false); // the map shows the way out
      expect(req.filter((t) => isRevealed(g, t))).toEqual([currentTask(g)]);
    }
  });

  it('a later step cannot be used before it comes up, and appears once the one before is done', () => {
    const g = calm(createGame(5));
    const [first, second] = g.tasks.filter((t) => t.required) as [Task, Task];
    g.player.pos = { ...second.pos };
    expect(interactionFor(g)?.kind).not.toBe('task');
    doTask(g, first);
    expect(first.done).toBe(true);
    expect(isRevealed(g, second)).toBe(true);
    doTask(g, second);
    expect(second.done).toBe(true);
  });

  it('finding the map reveals the way out', () => {
    const g = calm(createGame(8));
    for (let k = 0, t = currentTask(g); t && k < 20; t = currentTask(g), k++) {
      expect(g.safehouseKnown).toBe(false);
      doTask(g, t);
    }
    expect(g.safehouseKnown).toBe(true);
  });
});

describe('chapters', () => {
  it('each chapter is its own district, from the night seed, the same every time', () => {
    const seeds = Array.from({ length: CHAPTERS }, (_, c) => chapterSeed(77, c));
    expect(seeds[0]).toBe(77);
    expect(new Set(seeds).size).toBe(CHAPTERS);
    expect(chapterSeed(77, 2)).toBe(seeds[2]);
  });

  it('through the door: the next district, carrying weapons, gear, funds and kills, plus a time bonus', () => {
    const g = calm(createGame(12));
    g.arsenal.owned.push('shotgun');
    g.arsenal.ammo.shotgun = 9;
    g.arsenal.gear.vest = 30;
    g.kills = 7;
    g.player.health = 40;
    clear(g);
    expect(g.phase).toBe('cleared');
    expect(finalChapter(g)).toBe(false);
    const bonus = chapterBonus(g);
    expect(bonus).toBeGreaterThan(0);
    const n = nextChapter(g);
    expect(n.chapter).toBe(1);
    expect(n.night).toBe(12);
    expect(n.seed).toBe(chapterSeed(12, 1));
    expect(n.phase).toBe('playing');
    expect(n.remaining).toBe(n.timeLimit); // a fresh clock
    expect(n.arsenal.owned).toContain('shotgun');
    expect(n.arsenal.ammo.shotgun).toBe(9);
    expect(n.arsenal.gear.vest).toBe(30);
    expect(n.kills).toBe(7);
    expect(n.funds).toBe(g.funds + bonus);
    expect(n.player.health).toBe(Math.min(PLAYER_HEALTH, 40 + CHAPTER_HEAL));
    // the old state is not shared with the new one
    n.arsenal.owned.push('rifle');
    expect(g.arsenal.owned).not.toContain('rifle');
  });

  it('a retry restarts the chapter with what you came into it with', () => {
    const g = calm(createGame(12));
    clear(g);
    const n = calm(nextChapter(g));
    const funds = n.funds;
    n.funds = 0;
    n.arsenal.ammo.pistol = 0;
    n.player.health = 1;
    const r = restartChapter(n);
    expect(r.chapter).toBe(1);
    expect(r.seed).toBe(n.seed);
    expect(r.funds).toBe(funds);
    expect(r.arsenal.ammo.pistol).toBe(n.carry.arsenal.ammo.pistol);
    expect(r.player.health).toBe(n.carry.health);
  });

  it('the last chapter ends in the helicopter', () => {
    let g = calm(createGame(3));
    for (let c = 0; c < CHAPTERS - 1; c++) {
      clear(g);
      expect(g.phase).toBe('cleared');
      g = calm(nextChapter(g));
    }
    expect(finalChapter(g)).toBe(true);
    clear(g);
    expect(g.phase).toBe('won');
  });

  it('later districts are worse: runners in the crowd from the start', () => {
    const runners = (g: GameState) => g.zombies.filter((z) => z.kind === 'runner').length;
    const first = createGame(chapterSeed(4, 2));
    const last = createGame(chapterSeed(4, 2), undefined, { night: 4, chapter: 2 });
    expect(runners(first)).toBe(0);
    expect(runners(last)).toBeGreaterThan(3);
  });
});

describe('protective gear', () => {
  it('takes its share of a hit and wears down; without it the full hit lands', () => {
    const g = createGame(1);
    g.arsenal.gear = { vest: GEAR.vest.durability, helmet: GEAR.helmet.durability };
    const through = hurtPlayer(g, 40);
    expect(through).toBeCloseTo(40 * (1 - GEAR.vest.absorb - GEAR.helmet.absorb));
    expect(g.player.health).toBeCloseTo(PLAYER_HEALTH - through);
    expect(g.arsenal.gear.vest).toBeCloseTo(GEAR.vest.durability - 40 * GEAR.vest.absorb);
    const bare = createGame(1);
    expect(hurtPlayer(bare, 40)).toBe(40);
  });

  it('breaks when it is used up, and only absorbs what it has left', () => {
    const g = createGame(1);
    g.arsenal.gear.vest = 5;
    const through = hurtPlayer(g, 40);
    expect(through).toBe(35);
    expect(g.arsenal.gear.vest).toBe(0);
    expect(g.events).toContainEqual({ type: 'gear-broken', gear: 'vest' });
  });

  it('is sold at the store; a worn piece costs only its wear, a new one is not for sale', () => {
    const g = createGame(1);
    g.funds = 500;
    expect(priceOf(g, { kind: 'gear', gear: 'vest' })).toBe(GEAR.vest.price);
    expect(buy(g, { kind: 'gear', gear: 'vest' })).toBe(true);
    expect(g.arsenal.gear.vest).toBe(GEAR.vest.durability);
    expect(priceOf(g, { kind: 'gear', gear: 'vest' })).toBeNull();
    g.arsenal.gear.vest = GEAR.vest.durability / 2;
    expect(priceOf(g, { kind: 'gear', gear: 'vest' })).toBe(Math.round(GEAR.vest.price / 2));
  });

  it('can be found lying in the street, and putting it on is a pickup', () => {
    let found = false;
    for (let seed = 1; seed <= 10 && !found; seed++) {
      const g = calm(createGame(seed));
      const pk = g.pickups.find((p) => p.kind === 'vest' || p.kind === 'helmet');
      if (!pk) continue;
      found = true;
      g.player.pos = { ...pk.pos };
      step(g, IDLE, DT);
      const kind = pk.kind as 'vest' | 'helmet';
      expect(g.arsenal.gear[kind]).toBe(GEAR[kind].durability);
    }
    expect(found).toBe(true);
  });
});

describe('different steps every chapter', () => {
  const kinds = (g: GameState) => g.tasks.filter((t) => t.required && t.id !== 'map').map((t) => t.id);

  it('no step repeats within a night, and nights differ', () => {
    const nights = new Set<string>();
    for (let night = 1; night <= 25; night++) {
      const seen: string[] = [];
      for (let c = 0; c < CHAPTERS; c++) seen.push(...kinds(createGame(chapterSeed(night, c), undefined, { night, chapter: c })));
      expect(new Set(seen).size).toBe(seen.length);
      nights.add(seen.join(','));
    }
    expect(nights.size).toBeGreaterThan(15);
  });

  /** A chapter-0 game (for some night) whose steps include this one. */
  function withStep(id: string): GameState {
    for (let night = 1; night < 400; night++) {
      const g = createGame(night);
      if (g.tasks.some((t) => t.id === id)) return calm(g);
    }
    throw new Error(`no night with ${id}`);
  }

  it('the fuses: find all three first, then fit them in the box', () => {
    const g = withStep('fuses');
    upTo(g, 'fuses');
    const t = currentTask(g)!;
    expect(t.parts!.length).toBe(3);
    g.player.pos = { ...t.pos };
    expect(interactionFor(g)?.kind).not.toBe('task'); // nothing to fit yet
    t.parts!.forEach((q, i) => {
      g.player.pos = { ...q };
      step(g, IDLE, DT);
      expect(t.got![i]).toBe(true);
    });
    expect(g.tasks.find((x) => x.id === 'fuses')!.got!.every(Boolean)).toBe(true);
    doTask(g, t);
    expect(t.done).toBe(true);
  });

  it('Nora follows you, and the shelter only takes her if she is with you', () => {
    const g = withStep('survivor');
    upTo(g, 'survivor');
    doTask(g, currentTask(g)!);
    expect(g.escort).not.toBeNull();
    // walk a few steps: she keeps up
    const start = { ...g.escort!.pos };
    for (let i = 0; i < 90; i++) step(g, { dx: 1, dy: 0 }, DT);
    expect(Math.hypot(g.escort!.pos.x - start.x, g.escort!.pos.y - start.y)).toBeGreaterThan(1);
    // teleport to the shelter without her: not yet
    const shelter = currentTask(g)!;
    expect(shelter.id).toBe('shelter');
    g.escort!.pos = { x: shelter.pos.x + 30, y: shelter.pos.y };
    g.player.pos = { ...shelter.pos };
    g.player.vel = { x: 0, y: 0 };
    step(g, USE, DT);
    expect(g.events).toContainEqual({ type: 'escort-behind' });
    expect(g.hold.taskId).toBeNull();
    g.escort!.pos = { x: shelter.pos.x + 1, y: shelter.pos.y };
    doTask(g, shelter);
    expect(shelter.done).toBe(true);
    expect(g.escort).toBeNull();
  });

  it('a lit flare draws them away; a broken barricade brings a horde', () => {
    const f = withStep('flare');
    upTo(f, 'flare');
    const flare = currentTask(f)!;
    doTask(f, flare);
    expect(f.flare).not.toBeNull();
    const fresh = createGame(f.seed);
    const z = fresh.zombies[0]!;
    f.zombies = [{ ...z, pos: { x: flare.pos.x + 8, y: flare.pos.y }, lure: null, lureT: 0 }];
    f.player.pos = { x: flare.pos.x + 30, y: flare.pos.y + 30 };
    step(f, IDLE, DT);
    expect(f.zombies[0]!.lure).toEqual(flare.pos);

    const b = withStep('barricade');
    upTo(b, 'barricade');
    const before = b.zombies.length;
    doTask(b, currentTask(b)!);
    expect(b.zombies.length).toBeGreaterThan(before);
  });
});

describe('task content and its mechanics', () => {
  /** A chapter-0 game whose steps include this one, played up to it. */
  function at(id: string): GameState {
    for (let night = 1; night < 600; night++) {
      const g = createGame(night);
      if (!g.tasks.some((t) => t.id === id)) continue;
      calm(g);
      for (let k = 0; k < 10 && currentTask(g) && currentTask(g)!.id !== id; k++) doTask(g, currentTask(g)!);
      return g;
    }
    throw new Error(`no night with ${id}`);
  }

  it('the content file checks out, and broken content is refused', () => {
    expect(validate(content())).toEqual([]);
    expect(content().groups.length).toBeGreaterThanOrEqual(20);
    const broken = JSON.parse(JSON.stringify(content())) as Content;
    broken.groups[0]![0]!.kind = 'dance' as never;
    broken.groups[1]![0]!.done = ['no speaker here'];
    expect(validate(broken).length).toBe(2);
  });

  it('a keypad opens on the right code only', () => {
    const g = at('keypad');
    const t = currentTask(g)!;
    expect(t.code).toMatch(/^\d{4}$/);
    expect(stepText('guard-note', false, { code: t.code }).done.join(' ')).toContain(t.code); // the note had it
    g.player.pos = { ...t.pos };
    step(g, USE, DT);
    expect(g.events).toContainEqual({ type: 'puzzle-open', id: 'keypad' });
    expect(solvePuzzle(g, 'keypad', '0000' === t.code ? '1111' : '0000')).toBe(false);
    expect(t.done).toBe(false);
    expect(solvePuzzle(g, 'keypad', t.code)).toBe(true);
    expect(t.done).toBe(true);
  });

  it('the torn map: every piece first, then every tile turned the right way up', () => {
    const g = at('transit');
    const t = currentTask(g)!;
    expect(t.parts!.length).toBe(4);
    g.player.pos = { ...t.pos };
    expect(interactionFor(g)?.kind).not.toBe('task');
    expect(solvePuzzle(g, 'transit', answerFor(t))).toBe(true); // the page itself only opens at the desk...
    const h = at('transit');
    const u = currentTask(h)!;
    const wrong = u.scramble!.map(() => 0);
    expect(solvePuzzle(h, 'transit', wrong)).toBe(false);
  });

  it('the wires: each to its own colour', () => {
    const g = at('rewire');
    const t = currentTask(g)!;
    const right = answerFor(t) as number[];
    expect(solvePuzzle(g, 'rewire', [right[1]!, right[0]!, right[2]!, right[3]!])).toBe(false); // two crossed
    expect(solvePuzzle(g, 'rewire', answerFor(t))).toBe(true);
  });

  it('a clear step: they come when you get close, and it is done when they are down', () => {
    const g = at('dock');
    const t = currentTask(g)!;
    expect(interactionFor(g)?.kind).not.toBe('task');
    g.player.pos = { x: t.pos.x + 2, y: t.pos.y };
    step(g, IDLE, DT);
    expect(t.targets!.length).toBe(5);
    expect(clearLeft(g, t)).toBe(5);
    for (const z of g.zombies) if (t.targets!.includes(z.id)) { z.health = 0; z.action = 'dead'; z.actionT = 1; }
    step(g, IDLE, DT);
    expect(t.done).toBe(true);
  });

  it('a family follows in a line, and the shelter takes them only when all three are with you', () => {
    const g = at('family');
    g.guarded = g.tasks.map((t) => t.id);
    doTask(g, currentTask(g)!);
    const party = escortGroup(g);
    expect(party.map((m) => m.name)).toEqual(['Ade', 'Funmi', 'Tobi']);
    for (let i = 0; i < 150; i++) step(g, { dx: 1, dy: 0 }, DT);
    // a line: each one near the one in front
    for (let i = 1; i < party.length; i++) expect(Math.hypot(party[i]!.pos.x - party[i - 1]!.pos.x, party[i]!.pos.y - party[i - 1]!.pos.y)).toBeLessThan(4);
    const shelter = currentTask(g)!;
    expect(shelter.id).toBe('family-shelter');
    g.player.pos = { ...shelter.pos };
    g.player.vel = { x: 0, y: 0 };
    party.forEach((m, i) => { m.pos = { x: shelter.pos.x + 1 + i * 0.5, y: shelter.pos.y }; });
    party[2]!.pos = { x: shelter.pos.x + 30, y: shelter.pos.y }; // Tobi has fallen behind
    step(g, USE, DT);
    expect(g.events).toContainEqual({ type: 'escort-behind' });
    party[2]!.pos = { x: shelter.pos.x + 2, y: shelter.pos.y + 1 };
    doTask(g, shelter);
    expect(shelter.done).toBe(true);
    expect(g.escort).toBeNull();
  });

  it('if one of them is bitten, it is over', () => {
    const g = at('family');
    g.guarded = g.tasks.map((t) => t.id);
    doTask(g, currentTask(g)!);
    for (let i = 0; i < 120; i++) step(g, IDLE, DT); // past the moment's grace after finishing a step
    const tobi = escortGroup(g)[2]!;
    g.zombies = [{ id: 77, kind: 'walker', pos: { x: tobi.pos.x + 3, y: tobi.pos.y }, heading: 0, speed: 0, action: 'idle', actionT: 0, cooldown: 0, health: 60, staggerT: 0, alertT: 0, wanderT: 9, wanderDir: { x: 0, y: 0 } }];
    step(g, IDLE, DT);
    expect(g.events.some((e) => e.type === 'escort-danger')).toBe(true); // whoever it is nearest
    g.zombies[0]!.pos = { x: tobi.pos.x + 0.8, y: tobi.pos.y };
    for (let i = 0; i < 40 && g.phase === 'playing'; i++) { g.zombies[0]!.pos = { x: tobi.pos.x + 0.8, y: tobi.pos.y }; step(g, IDLE, DT); }
    expect(g.phase).toBe('lost');
    expect(g.lossReason).toBe('infected');
    expect(ending('infected').title).toBe('INFECTED');
  });

  it('Leo is small, follows you, and his mother only counts once he is with you', () => {
    const g = at('lost-boy');
    doTask(g, currentTask(g)!);
    expect(g.escort?.name).toBe('Leo');
    expect(g.escort!.scale).toBeLessThan(1);
    expect(currentTask(g)!.id).toBe('mother');
    doTask(g, currentTask(g)!);
    expect(g.escort).toBeNull();
  });
});
