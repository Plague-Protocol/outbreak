// Outbreak: the story told around a run, in the Eko Lockdown style: a title card, a cutscene,
// "Speaker|line" dialogue, an objective line per step, radio calls as the night gets worse, and
// endings. Pure data and helpers, no DOM, so the same beats can be driven from a server later.
//
// Setting: Port Halden, an invented harbour city, on the night a virus empties it. Universal on
// purpose: no real places, no real organisations.
import type { LossReason, Survivor, SurvivorReward, TaskId } from './types';

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
    `${RADIO}|This is the emergency broadcast. The army is running one last evacuation tonight, from the far side of the city. Survivors, make your way there district by district. The subway tunnels between them are open for now, but the army is sealing them on a schedule.`,
    `${RADIO}|The last helicopter leaves on schedule and it will not wait. If you need to defend yourself, the weapon stores have left their doors open. Halden Arms is one.`,
    `${HERO}|One district at a time. Find the way through, get across, and get on that helicopter. Don't stop moving.`,
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
    brief: [`${RADIO}|The way out is fenced. A medic went out for supplies with the gate key and never came back.`],
    done: [`${HERO}|Keys on a lanyard: "SOUTH GATE". I'm sorry. Thank you.`],
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
  insulin: {
    objective: 'Take the insulin from the pharmacy fridge',
    short: 'the insulin',
    brief: [`${RADIO}|...a father on the north side, calling for anyone. His daughter is diabetic and they're trapped in a laundromat. The pharmacy two streets over had a fridge...`],
    done: [`${HERO}|Two pens, still cold. The fridge must have run on a battery. Hang on, kid.`],
  },
  deliver: {
    objective: 'Bring the insulin to the girl in the laundromat',
    short: 'the girl',
    brief: [`${HERO}|The laundromat. Get it to her before it warms up.`],
    done: ['Joel|You came. You actually came. Here, sweetheart, here...', 'Joel|Listen: the main road is swarming. Keep to the side streets. God bless you.'],
  },
  fuses: {
    objective: 'Find the three fuses for the shutter box',
    short: 'the fuses',
    brief: [`${RADIO}|The tunnel shutters run off a street fuse box, and it's been stripped. Maintenance crews left spares in their vans around the block. You'll need three.`],
    done: [`${HERO}|Click. Click. Click. Something hums inside the wall. That's one door that'll open for me.`],
  },
  flare: {
    objective: 'Light the signal flare at the crossroads',
    short: 'the flare',
    brief: [`${RADIO}|Rescue flights are spotting by flare tonight. Light one where they can see it from the air, then get clear. Everything nearby will go to the light.`],
    done: [`${HERO}|Red light on every wall. They're turning toward it. Not toward me. Go, now.`],
  },
  barricade: {
    objective: 'Break through the barricade',
    short: 'the barricade',
    brief: [`${HERO}|Somebody barricaded the street: cars, doors, a fridge. The only way through. It'll take a while, and it'll be loud.`],
    done: [`${HERO}|It's down. And everything for three blocks heard it. Move!`],
  },
  survivor: {
    objective: 'Find Nora, hiding in the crashed bus',
    short: 'Nora',
    brief: [`${RADIO}|...this is Nora, I'm a nurse, I'm in the crashed bus on the avenue... I can't get out on my own. Please.`],
    done: ['Nora|You heard me? Okay. Okay. I\'ll stay right behind you. Don\'t go too fast.'],
  },
  shelter: {
    objective: 'Get Nora to the church shelter (she follows you)',
    short: 'the shelter',
    brief: [`${HERO}|There's a shelter in the church, lights on, doors barred. Keep her close and get her there.`],
    done: ['Nora|We made it. They have medics in here, and a radio. Thank you. Go, find your tunnel.'],
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

/** Before the last chapter the map shows the way into the next district, not the landing zone. */
const DISTRICT_MAP: Beat = {
  objective: 'Find the district map in the abandoned police car',
  short: 'the map',
  brief: [`${RADIO}|Police cruisers carried district maps with the open tunnels marked. Find one and you'll know the way out of here.`],
  done: [`${HERO}|The map. One subway entrance is marked "OPEN". That's my way into the next district.`],
};
const beat = (id: TaskId, final: boolean): Beat => (id === 'map' && !final ? DISTRICT_MAP : BEATS[id]);

export function objectiveFor(id: TaskId, final = true): string {
  return beat(id, final).objective;
}

export function shortName(id: TaskId): string {
  return BEATS[id].short;
}

export function briefFor(id: TaskId, final = true): Line[] {
  return beat(id, final).brief.map(L);
}

export function doneFor(id: TaskId, final = true): Line[] {
  return beat(id, final).done.map(L);
}

/** The fuse step's objective changes as you find them. */
export function partsObjective(id: TaskId, got: number, of: number): string {
  if (id === 'fuses') return got < of ? `Find the fuses for the shutter box (${got}/${of})` : 'Fit the fuses in the shutter box';
  return BEATS[id].objective;
}

export const PARTS_DONE: Line[] = [L(`${HERO}|That's all of them. Now the fuse box.`)];
export const ESCORT_BEHIND: Line[] = [L(`${HERO}|Where's Nora? I can't leave her out here. Wait for her.`)];

/** The card shown as each chapter begins. */
export const CHAPTER_CARDS: ReadonlyArray<{ card: string; sub: string }> = [
  { card: 'CHAPTER ONE', sub: 'Where it started' },
  { card: 'CHAPTER TWO', sub: 'Across the tracks' },
  { card: 'CHAPTER THREE', sub: 'The last helicopter' },
];
export function chapterCard(chapter: number): { card: string; sub: string } {
  return CHAPTER_CARDS[chapter] ?? { card: `CHAPTER ${chapter + 1}`, sub: 'Keep moving' };
}

/** Spoken as you come up out of the tunnel into a new district. */
export function chapterLines(final: boolean): Line[] {
  return (final
    ? [`${HERO}|Last stretch. I can hear rotors somewhere over the rooftops.`, `${RADIO}|...final evacuation loading on schedule. Anyone still out there, this is your last chance...`]
    : [`${HERO}|Out of the tunnel. New streets, same nightmare. Find the way through.`]
  ).map(L);
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

export interface Ending {
  title: string;
  text: string;
}

export function ending(outcome: 'won' | LossReason, final = true): Ending {
  if (outcome === 'time' && !final) {
    return {
      title: 'SEALED IN',
      text: 'Somewhere under the street a siren winds down, and the subway shutters slam, one station after another. The army has sealed the tunnels. The way across is gone, and the dark around you starts to move.',
    };
  }
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
