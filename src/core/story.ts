// Outbreak: the story told around a run, in the Eko Lockdown style: a title card, a cutscene,
// "Speaker|line" dialogue, an objective line per step, radio calls as the night gets worse, and
// endings. Pure data and helpers, no DOM, so the same beats can be driven from a server later.
//
// Setting: Port Halden, an invented harbour city, on the night a virus empties it. Universal on
// purpose: no real places, no real organisations.
import type { LossReason, TaskId } from './types';

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

export const INTRO: { card: string; sub: string; lines: Line[] } = {
  card: 'DAY ONE',
  sub: 'Port Halden',
  lines: [
    'Narrator|Port Halden. Three days ago a virus came in on a cargo ship. Nobody gave it a name. The news just called it the fever.',
    'Narrator|Then the fevered stopped being sick. They got up off the hospital floors and walked out into the city, hungry.',
    `${RADIO}|This is the emergency broadcast. The army is running one last evacuation tonight. Survivors, make your way to the evac point.`,
    `${RADIO}|The last helicopter leaves on schedule and it will not wait. If you need to defend yourself, the weapon stores have left their doors open. Halden Arms is one.`,
    `${HERO}|Get what I need, find a ride, and get on that helicopter. Don't stop moving.`,
  ].map(L),
};

interface Beat {
  /** Objective line in the HUD while this step is current. */
  objective: string;
  /** Two or three words, for lists. */
  short: string;
  /** Spoken when the step becomes current (a radio brief or a thought). */
  brief: string[];
  /** Spoken when it is done. */
  done: string[];
}

const BEATS: Record<TaskId, Beat> = {
  map: {
    objective: 'Find the evacuation map in the abandoned police car',
    short: 'the map',
    brief: [`${RADIO}|Police cruisers carried evacuation maps. Find one and you will know where the helicopter is landing.`],
    done: [`${HERO}|Evac map, still on the dashboard. The landing zone is circled in red. I know where I'm going.`],
  },
  key: {
    objective: 'Take the gate key from the fallen medic',
    short: 'the gate key',
    brief: [`${RADIO}|The evac zone is fenced. A medic went out for supplies with the gate key and never came back.`],
    done: [`${HERO}|Keys on a lanyard: "EVAC ZONE, SOUTH GATE". I'm sorry. Thank you.`],
  },
  power: {
    objective: 'Restart the street generator',
    short: 'the generator',
    brief: [`${RADIO}|The zone's floodlights and gate run on a street generator, and the grid is down. Somebody has to start it by hand.`],
    done: [`${HERO}|Come on, come on... it catches. Lights all down the street. Every one of them heard that.`],
  },
  gate: {
    objective: 'Open the security gate',
    short: 'the gate',
    brief: [`${HERO}|Power's on. Now the gate.`],
    done: [`${HERO}|The gate rolls back. Loud. Too loud. Move.`],
  },
  keycard: {
    objective: 'Take the keycard from the fallen soldier',
    short: 'the keycard',
    brief: [`${RADIO}|The checkpoint only opens to a military keycard. The patrol that held this street did not make it.`],
    done: [`${HERO}|He didn't make it to the checkpoint. His keycard will.`],
  },
  radio: {
    objective: 'Get the evac frequency from the radio in the shop',
    short: 'the radio',
    brief: [`${RADIO}|...the helicopter only lands for people who call in first. The frequency is on a card by the counter in the corner shop...`],
    done: [`${HERO}|Evac, this is Sam. I'm on my way. Please, hold that seat.`, `${EVAC}|Copy, Sam. We see you on thermal. Move fast.`],
  },
  fuel: {
    objective: 'Optional: siphon fuel from the wrecks (costs time)',
    short: 'fuel',
    brief: [],
    done: [`${HERO}|A jerrycan of petrol and an energy bar from the glovebox. My legs feel lighter.`],
  },
  medkit: {
    objective: 'Optional: gather medical supplies (costs time)',
    short: 'medical supplies',
    brief: [],
    done: [`${HERO}|Bandages, painkillers, and ammonia. They hate the smell. They'll come slower now.`],
  },
  rescue: {
    objective: 'Optional: help the survivor hiding in the shop (costs time)',
    short: 'the survivor',
    brief: [],
    done: ['Ana|You came back for me? Thank you. Go, go. I\'ll lock myself in until morning.', `${HERO}|Ana pressed her savings into my hand. "Buy something that shoots."`],
  },
};

export function objectiveFor(id: TaskId): string {
  return BEATS[id].objective;
}

export function shortName(id: TaskId): string {
  return BEATS[id].short;
}

export function briefFor(id: TaskId): Line[] {
  return BEATS[id].brief.map(L);
}

export function doneFor(id: TaskId): Line[] {
  return BEATS[id].done.map(L);
}

export function tierLines(tier: number): Line[] {
  return (tier === 1
    ? [`${RADIO}|Reports from downtown. They are coming out of the buildings now, hundreds of them. And some of them are running.`]
    : [`${RADIO}|The helicopter is on the pad and loading. If you are still out there... run. Don't stop for anything.`]
  ).map(L);
}

export const SAFEHOUSE_LABEL = 'Get to the evac point';
export const SAFEHOUSE_OPEN: Line[] = [L(`${HERO}|That's everything. The evac point. Go!`)];

export function safehouseLocked(missing: string[]): Line[] {
  return [L(`${EVAC}|We can't let you through yet. ${missing.length > 0 ? `You still need ${missing.join(', ')}.` : ''}`)];
}

export function lockedTask(needs: string[]): Line[] {
  return [L(`${HERO}|Not yet. First: ${needs.join(', ')}.`)];
}

export const STORE_LINES: Line[] = [L(`${HERO}|Nobody at the counter. I'll leave the money anyway.`)];

export interface Ending {
  title: string;
  text: string;
}

export function ending(outcome: 'won' | LossReason): Ending {
  switch (outcome) {
    case 'won':
      return {
        title: 'EVACUATED',
        text: 'Hands haul you up the ramp and the helicopter lifts before the door is shut. A medic checks your arms, then your eyes, then hands you water. Below, Port Halden goes dark street by street. Tonight, you are alive.',
      };
    case 'caught':
      return {
        title: 'TAKEN',
        text: 'Hands from behind, then teeth. The street lights blur. Somewhere far away, the emergency broadcast is still reading out the evacuation schedule.',
      };
    case 'time':
      return {
        title: 'LEFT BEHIND',
        text: 'You hear the rotors before you reach the corner, then the lights climb away over the harbour. The street behind you starts to move.',
      };
  }
}
