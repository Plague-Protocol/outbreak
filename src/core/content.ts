// Task content: what each step is called, what is said, what it looks like, and which mechanic it
// uses. The mechanics are code (hold, collect, puzzle, clear, plus effects); everything else is data in
// public/content/tasks.json, so new steps are written, not programmed. A backend can later serve the
// same file (and choose per night); the version goes into every run so a replay uses the same content.

import type { Theme } from './types';

/** How a step plays. */
export type Archetype =
  | 'hold' // stand at it for a moment (take it, start it, give it)
  | 'collect' // find `parts.count` pieces scattered nearby, then stand at it to fit them
  | 'puzzle' // a puzzle page (after collecting pieces, if it has any)
  | 'clear'; // kill the infected that come for you there

/** What finishing a step does. */
export type Effect = 'reveal-exit' | 'escort-start' | 'escort-end' | 'lure' | 'horde';
export type PuzzleKind = 'tiles' | 'keypad' | 'wires';
export type Skin = 'humanMaleA' | 'humanFemaleA';

export interface StepText {
  objective: string; // the HUD line while it is current
  short: string; // two or three words, for lists
  brief: string[]; // "Speaker|line" when it comes up
  done: string[]; // "Speaker|line" when it is done
}

export interface StepDef extends StepText {
  id: string;
  kind: Archetype;
  verb: string; // the Use button
  seconds?: number; // standing time (hold, collect's fitting)
  effect?: Effect;
  /** Someone has to be with you (escort-end). */
  needsEscort?: boolean;
  escort?: { name: string; skin: Skin; scale?: number; behind: string; party?: Array<{ name: string; skin: Skin; scale?: number }> };
  parts?: { count: number; item: string; name: string; objective: string; fit: string; ready: string };
  puzzle?: PuzzleKind;
  clear?: number;
  /** The scenery and people there (a preset in the renderer), and the thing you take, if any. */
  scene: string;
  item?: string;
  /** Different words in the last chapter (the map shows the landing zone, not a tunnel). */
  final?: Partial<StepText>;
  /** It happens at someone's door: placed against a real building, the door in its wall. */
  door?: boolean;
  /** Optional detours only. */
  timeCost?: number;
  reward?: 'speed' | 'calm' | 'funds';
}

export interface Ending { title: string; text: string }

/** A chapter's night: fog and sky colours, the moon, the street lamps, how far you see (1 = normal). */
export interface Light { fog: string; sky: string; ground: string; moon: string; lamp: string; haze: number }

/** The story around the steps: the intro, chapter cards, radio calls as it gets worse, endings. */
export interface Story {
  intro: { card: string; sub: string; lines: string[] };
  /** Each chapter: its title card, the part of the city it is in, how you leave it, and its light. */
  chapters: Array<{ card: string; sub: string; theme?: Theme; exit?: 'subway' | 'gate' | 'heli'; way?: string; light?: Light }>;
  arrive: { other: string[]; final: string[] };
  tier: string[][];
  /** Said the first time you get in a car, or on a bike, in a run: what the engine does. */
  vehicle?: { car: string[]; bike: string[] };
  endings: { won: Ending; caught: Ending; time: Ending; sealed: Ending; infected?: Ending };
}

export interface Content {
  version: number;
  story: Story;
  /** Each group is one or more steps done in order (each needs the one before). */
  groups: StepDef[][];
  /** Always the last step of a chapter: it shows the way out. */
  map: StepDef;
  optional: StepDef[];
}

let current: Content | null = null;
const index = new Map<string, StepDef>();

/** Install the content (the game fetches it at start; tests read the file). Checks it first. */
export function setContent(c: Content): void {
  const problems = validate(c);
  if (problems.length) throw new Error(`task content: ${problems.join('; ')}`);
  current = c;
  index.clear();
  for (const d of [...c.groups.flat(), c.map, ...c.optional]) index.set(d.id, d);
}

let chapterNow = 0;
/** The chapter being played (for words like {way}: how you leave it). */
export function setChapter(n: number): void { chapterNow = n; }
export function chapterInfo(n = chapterNow): Partial<Content['story']['chapters'][number]> {
  return content().story.chapters[n] ?? {};
}

export function content(): Content {
  if (!current) throw new Error('task content not loaded');
  return current;
}

export function stepDef(id: string): StepDef {
  const d = index.get(id);
  if (!d) throw new Error(`unknown step ${id}`);
  return d;
}

/** A step's words for this chapter, with its values filled in ({code}). */
export function stepText(id: string, final: boolean, vars: Record<string, string> = {}): StepText {
  const d = stepDef(id);
  const t = final && d.final ? { ...d, ...d.final } : d;
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? (k === 'way' ? chapterInfo().way : undefined) ?? m);
  return { objective: fill(t.objective), short: fill(t.short), brief: t.brief.map(fill), done: t.done.map(fill) };
}

const ARCHETYPES: Archetype[] = ['hold', 'collect', 'puzzle', 'clear'];
const EFFECTS: Effect[] = ['reveal-exit', 'escort-start', 'escort-end', 'lure', 'horde'];
const PUZZLES: PuzzleKind[] = ['tiles', 'keypad', 'wires'];

/** Everything wrong with a content file (empty if it is good). */
export function validate(c: Content): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const line = (s: string, where: string) => { if (!/^[^|]+\|[^|]+$/.test(s)) out.push(`${where}: "${s.slice(0, 30)}" is not "Speaker|line"`); };
  const check = (d: StepDef, where: string) => {
    if (!d.id) { out.push(`${where}: no id`); return; }
    if (ids.has(d.id)) out.push(`${d.id}: id used twice`);
    ids.add(d.id);
    if (!ARCHETYPES.includes(d.kind)) out.push(`${d.id}: unknown kind ${d.kind}`);
    if (d.effect && !EFFECTS.includes(d.effect)) out.push(`${d.id}: unknown effect ${d.effect}`);
    if (!d.objective || !d.short || !d.verb || !d.scene) out.push(`${d.id}: needs objective, short, verb, scene`);
    if (!Array.isArray(d.brief) || !Array.isArray(d.done) || d.done.length === 0) out.push(`${d.id}: needs brief and done lines`);
    [...(d.brief ?? []), ...(d.done ?? []), ...(d.final?.brief ?? []), ...(d.final?.done ?? [])].forEach((s) => line(s, d.id));
    if (d.kind === 'collect' && !d.parts) out.push(`${d.id}: a collect step needs parts`);
    if (d.parts && (d.parts.count < 1 || d.parts.count > 5 || !d.parts.item)) out.push(`${d.id}: parts need 1-5 of an item`);
    if (d.parts) line(d.parts.ready, d.id);
    if (d.kind === 'puzzle' && (!d.puzzle || !PUZZLES.includes(d.puzzle))) out.push(`${d.id}: a puzzle step needs a puzzle (${PUZZLES.join(', ')})`);
    if (d.kind === 'clear' && !(d.clear && d.clear > 0 && d.clear <= 8)) out.push(`${d.id}: a clear step needs 1-8 to clear`);
    if (d.effect === 'escort-start' && !d.escort) out.push(`${d.id}: escort-start needs an escort`);
    if (d.escort) line(d.escort.behind, d.id);
  };
  if (!Array.isArray(c.groups) || c.groups.length < 3) out.push('needs at least 3 groups');
  const st = c.story;
  if (!st?.intro?.lines?.length || !st.chapters?.length || !st.arrive || !Array.isArray(st.tier) || !st.endings) out.push('the story section is incomplete');
  else {
    [...st.intro.lines, ...st.arrive.other, ...st.arrive.final, ...st.tier.flat(), ...(st.vehicle?.car ?? []), ...(st.vehicle?.bike ?? [])].forEach((s) => line(s, 'story'));
    for (const k of ['won', 'caught', 'time', 'sealed'] as const) if (!st.endings[k]?.title || !st.endings[k]?.text) out.push(`story: no ${k} ending`);
  }
  c.groups?.forEach((g, i) => {
    if (!Array.isArray(g) || g.length === 0) out.push(`group ${i} is empty`);
    g.forEach((d) => check(d, `group ${i}`));
    const starts = g.filter((d) => d.effect === 'escort-start').length, ends = g.filter((d) => d.needsEscort).length;
    if (starts !== ends) out.push(`group ${i}: an escort has to start and end in the same group`);
  });
  if (c.map) { check(c.map, 'map'); if (c.map.effect !== 'reveal-exit') out.push('the map step must reveal the exit'); }
  else out.push('no map step');
  c.optional?.forEach((d) => { check(d, 'optional'); if (!d.timeCost || !d.reward) out.push(`${d.id}: optional steps need timeCost and reward`); });
  return out;
}
