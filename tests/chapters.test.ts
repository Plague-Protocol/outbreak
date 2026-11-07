import { describe, expect, it } from 'vitest';
import {
  buy, chapterBonus, chapterSeed, createGame, currentTask, finalChapter, hurtPlayer, interactionFor, isRevealed, nextChapter,
  priceOf, restartChapter, step, type GameState,
} from '../src/core/state';
import { CHAPTER_HEAL, CHAPTERS, GEAR, PLAYER_HEALTH, TASK_HOLD_SECONDS } from '../src/core/config';
import type { Input, Task } from '../src/core/types';

const IDLE: Input = { dx: 0, dy: 0 };
const USE: Input = { dx: 0, dy: 0, action: true };
const DT = 1 / 30;

function calm(g: GameState): GameState {
  g.zombies = [];
  return g;
}

function doTask(g: GameState, t: Task): void {
  g.player.pos = { ...t.pos };
  g.player.vel = { x: 0, y: 0 };
  step(g, USE, DT);
  for (let i = 0; i < Math.ceil(TASK_HOLD_SECONDS / DT) + 2 && !t.done && g.phase === 'playing'; i++) step(g, IDLE, DT);
}

/** Do every step in order and walk out. */
function clear(g: GameState): void {
  for (let t = currentTask(g); t; t = currentTask(g)) doTask(g, t);
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
    for (let t = currentTask(g); t; t = currentTask(g)) {
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
