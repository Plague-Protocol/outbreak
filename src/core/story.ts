// Outbreak: the story told around a run, in the Eko Lockdown style: a title card, a cutscene,
// "Speaker|line" dialogue, an objective line per step, radio calls as the night gets worse, and
// endings. Pure data and helpers, no DOM, so the same beats can be driven from a server later.
//
// Setting: Lagos, the night Eko Fever stopped being a fever. District names are invented.
import type { LossReason, TaskId } from './types';

export interface Line {
  who: string;
  text: string;
}

const L = (s: string): Line => {
  const i = s.indexOf('|');
  return { who: s.slice(0, i), text: s.slice(i + 1) };
};

export const HERO = 'Tolu';
export const RADIO = 'Radio 90.5';

export const INTRO: { card: string; sub: string; lines: Line[] } = {
  card: 'NIGHT ONE',
  sub: 'Ebute Gardens, Lagos mainland',
  lines: [
    'Narrator|Lagos. For six weeks they called it Eko Fever, and the government said it was under control.',
    'Narrator|Tonight the fevered stopped being sick. They got up off the hospital floors and walked out into the city, hungry.',
    'Narrator|The army pulled back across the bridges at sunset. Whoever is still on the mainland is on their own.',
    `${RADIO}|This is Ronke on Lockdown News, ninety point five. If you can hear me, St. Agnes Clinic in Ebute Gardens is still taking survivors.`,
    `${RADIO}|The clinic seals its doors when the last convoy leaves. After that, nobody gets in. Not for anyone.`,
    `${HERO}|Okay. Okay. Find the way in, and get off the street before those doors close.`,
  ].map(L),
};

interface Beat {
  /** Objective line in the HUD while this step is current. */
  objective: string;
  /** Spoken when the step becomes current (a radio brief or a thought). */
  brief: string[];
  /** Spoken when it is done. */
  done: string[];
}

const BEATS: Record<TaskId, Beat> = {
  map: {
    objective: 'Find the evacuation map in the abandoned police car',
    brief: [`${RADIO}|Police posted evacuation maps in their patrol cars. If you find one, the clinic is marked in red.`],
    done: [`${HERO}|Evacuation map, still on the dashboard. St. Agnes is circled in red. I know where I'm going.`],
  },
  key: {
    objective: 'Find the clinic key on the orderly',
    brief: [`${RADIO}|The clinic's back door is locked from outside. An orderly went out for supplies with the key and never came back.`],
    done: [`${HERO}|Keys on a lanyard: "St. Agnes, back door". I'm sorry, my friend. Thank you.`],
  },
  power: {
    objective: 'Restore power at the street generator',
    brief: [`${RADIO}|The clinic's gate runs on the street generator, and the grid is gone. Somebody has to start it by hand.`],
    done: [`${HERO}|Come on, come on... it catches. Lights all down the street. Every one of them heard that.`],
  },
  gate: {
    objective: 'Open the security gate',
    brief: [`${HERO}|Power's on. Now the gate.`],
    done: [`${HERO}|The gate rolls back. Loud. Too loud. Move.`],
  },
  keycard: {
    objective: 'Take the keycard from the security guard',
    brief: [`${RADIO}|The clinic lift needs a security keycard. The guards on the night shift carried them.`],
    done: [`${HERO}|He didn't make it to the door. His keycard did.`],
  },
  radio: {
    objective: 'Get the clinic frequency from the radio in the shop',
    brief: [`${RADIO}|...the clinic only opens to people who call in first. The door frequency is on a card by the till at the corner shop...`],
    done: [`${HERO}|St. Agnes, this is Tolu. I'm coming in on foot. Please, keep the door for me.`, 'Clinic|We hear you, Tolu. Come to the back. Hands where we can see them.'],
  },
  fuel: {
    objective: 'Optional: siphon fuel from the wrecks (costs time)',
    brief: [],
    done: [`${HERO}|A jerrycan of petrol for the clinic generator, and a sugar bar from the glovebox. My legs feel lighter.`],
  },
  medkit: {
    objective: 'Optional: gather medical supplies (costs time)',
    brief: [],
    done: [`${HERO}|Bandages, painkillers, and ammonia. They hate the smell. They'll come slower now.`],
  },
  rescue: {
    objective: 'Optional: help the survivor hiding in the shop (costs time)',
    brief: [],
    done: ['Bisi|You came back for me? God bless you. Go, go. I will lock myself in until morning.', `${HERO}|Bisi gave me her savings. "Buy something good when this is over."`],
  },
};

export function objectiveFor(id: TaskId): string {
  return BEATS[id].objective;
}

export function briefFor(id: TaskId): Line[] {
  return BEATS[id].brief.map(L);
}

export function doneFor(id: TaskId): Line[] {
  return BEATS[id].done.map(L);
}

export function tierLines(tier: number): Line[] {
  return (tier === 1
    ? [`${RADIO}|Reports from the markets. They are coming out of the buildings now, hundreds of them. And some of them are running.`]
    : [`${RADIO}|The last convoy is loading. St. Agnes will seal its doors soon. If you are still outside... run. Don't stop for anything.`]
  ).map(L);
}

export const SAFEHOUSE_OPEN: Line[] = [L(`${HERO}|That's everything. St. Agnes. Go!`)];

export function safehouseLocked(missing: string[]): Line[] {
  return [L(`Clinic|We can't open for you yet. ${missing.length > 0 ? `You still need: ${missing.join(', ')}.` : ''}`)];
}

export function lockedTask(needs: string[]): Line[] {
  return [L(`${HERO}|Not yet. First: ${needs.join(', ')}.`)];
}

export interface Ending {
  title: string;
  text: string;
}

export function ending(outcome: 'won' | LossReason): Ending {
  switch (outcome) {
    case 'won':
      return {
        title: 'SAFE',
        text: 'The door slams behind you and the bolts go home. A nurse checks your arms, then your eyes, then hands you water. Through the slot you watch Ebute Gardens go dark. Tomorrow the convoy crosses the bridge. Tonight, you are alive.',
      };
    case 'caught':
      return {
        title: 'TAKEN',
        text: 'Hands from behind, then teeth. The street lights blur. Somewhere far away, Ronke is still reading the names of the open clinics on ninety point five.',
      };
    case 'time':
      return {
        title: 'DOORS SEALED',
        text: 'You hear the bolts before you reach the corner. Through the slot, a soldier shakes his head. "I am sorry. Orders." The street behind you starts to move.',
      };
  }
}
