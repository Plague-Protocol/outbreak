// Outbreak: the story told around a run, in the Eko Lockdown style: a title card, a cutscene,
// "Speaker|line" dialogue, an objective line per step, radio calls as the night gets worse, and
// endings. Pure data and helpers, no DOM, so the same beats can be driven from a server later.
//
// Setting: Port Halden, an invented harbour city, on the night a virus empties it. Universal on
// purpose: no real places, no real organisations.
import type { LossReason, Survivor, SurvivorReward, Task } from './types';
import { content, stepDef, stepText, type Ending } from './content';

export interface Line {
  who: string;
  text: string;
}

const L = (s: string): Line => {
  const i = s.indexOf('|');
  return { who: s.slice(0, i), text: s.slice(i + 1) };
};

export const HERO = 'Sam';
export const RADIO = 'Emergency Radio';
export const EVAC = 'Evac';

/** The intro: a title card, then the cutscene. */
export function intro(): { card: string; sub: string; lines: Line[] } {
  const i = content().story.intro;
  return { card: i.card, sub: i.sub, lines: i.lines.map(L) };
}

/** A step's words, from the task content, with its values ({code}) filled in. */
function words(t: Task, final: boolean) {
  return stepText(t.id, final, { code: t.code });
}

/** The HUD objective for a step right now: its pieces found so far, how many are left to clear. */
export function objectiveFor(t: Task, final = true, left: number | null = null): string {
  const d = stepDef(t.id);
  if (d.parts && t.got) {
    const got = t.got.filter(Boolean).length, of = t.got.length;
    return got < of ? d.parts.objective.replace('{got}', String(got)).replace('{of}', String(of)) : d.parts.fit;
  }
  const o = words(t, final).objective;
  return left !== null ? `${o} (${left} left)` : o;
}

export function shortName(t: Task): string {
  return words(t, true).short;
}

export function briefFor(t: Task, final = true): Line[] {
  return words(t, final).brief.map(L);
}

export function doneFor(t: Task, final = true): Line[] {
  return words(t, final).done.map(L);
}

/** Said when the last piece is found. */
export function partsReady(t: Task): Line[] {
  const p = stepDef(t.id).parts;
  return p ? [L(p.ready)] : [];
}

/** Said at the door when whoever you are escorting has fallen behind. */
export function escortBehind(t: Task | null): Line[] {
  const e = t ? stepDef(t.id).escort : undefined;
  return [L(e?.behind ?? `${HERO}|They're not with me. Wait for them.`)];
}

/** The verb on the Use button for a step. */
export function verbFor(t: Task): string {
  return stepDef(t.id).verb;
}

/** The card shown as each chapter begins. */
export function chapterCard(chapter: number): { card: string; sub: string } {
  return content().story.chapters[chapter] ?? { card: `CHAPTER ${chapter + 1}`, sub: 'Keep moving' };
}

/** Spoken as you come up out of the tunnel into a new district. */
export function chapterLines(final: boolean): Line[] {
  const a = content().story.arrive;
  return (final ? a.final : a.other).map(L);
}

/** The HUD objective once every step is done. */
export function exitLabel(final: boolean): string {
  return final ? 'Get to the evac point' : 'Get to the subway entrance (the next district)';
}

export function exitOpen(final: boolean): Line[] {
  return [L(final ? `${HERO}|That's everything. The evac point. Go!` : `${HERO}|That's everything. The subway entrance. Go!`)];
}

export function exitLocked(missing: string[], final: boolean): Line[] {
  if (final) return safehouseLocked(missing);
  return [L(`${HERO}|The shutter's chained. ${missing.length > 0 ? `I still need ${missing.join(', ')}.` : ''}`)];
}

/** The first time you get in a car (or on a bike) in a run. */
export function vehicleLines(bike: boolean): Line[] {
  const v = content().story.vehicle;
  return ((bike ? v?.bike : v?.car) ?? []).map(L);
}

export function tierLines(tier: number): Line[] {
  return (content().story.tier[tier] ?? []).map(L);
}


export function safehouseLocked(missing: string[]): Line[] {
  return [L(`${EVAC}|We can't let you through yet. ${missing.length > 0 ? `You still need ${missing.join(', ')}.` : ''}`)];
}

export function lockedTask(needs: string[]): Line[] {
  return [L(`${HERO}|Not yet. First: ${needs.join(', ')}.`)];
}

export const STORE_LINES: Line[] = [L(`${HERO}|Nobody at the counter. I'll leave the money anyway.`)];

/** What a survivor says, in their own name. */
export function survivorLines(v: Survivor, moment: 'asked' | 'reminder' | 'fetched' | 'ready' | 'done', reward?: SurvivorReward): Line[] {
  const me = v.name;
  switch (moment) {
    case 'asked':
      return v.request === 'fetch'
        ? [L(`${me}|Thank God, a living face. My medical bag, I dropped it running. It's on the street a couple of blocks from here. Bring it back and I'll make it worth your while.`), L(`${HERO}|Stay down. I'll find it.`)]
        : [L(`${me}|Don't shout! They're all around this corner, waiting for me to move. Clear them out and I'll make it worth your while.`), L(`${HERO}|Stay behind me.`)];
    case 'reminder':
      return [L(v.request === 'fetch' ? `${me}|The bag. Please. It's marked on your map.` : `${me}|They're still out there. I can hear them.`)];
    case 'fetched':
      return [L(`${HERO}|Got the bag. Back to ${me}.`)];
    case 'ready':
      return [L(`${me}|That's the last of them. Come here, quick.`)];
    case 'done': {
      const gift = reward === 'weapon' ? `Take this. I can't use it, you can.`
        : reward === 'ammo' ? `Here, all the rounds I've got. I never fired a shot.`
          : reward === 'intel' ? `The evac point: I heard it on the police band. I've marked it on your map.`
            : `It's all the cash I had on me. It won't buy my way out, maybe it buys yours.`;
      return [L(`${me}|${gift}`), L(`${HERO}|Keep your head down. Someone will come.`)];
    }
  }
}

export function ending(outcome: 'won' | LossReason, final = true): Ending {
  const e = content().story.endings;
  if (outcome === 'infected') return e.infected ?? e.caught;
  return outcome === 'time' && !final ? e.sealed : e[outcome];
}
