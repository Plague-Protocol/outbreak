// Shared test moves: do a step the way a player would (pieces first, bring whoever is with you,
// solve its puzzle, put down whoever comes for you).
import { clearLeft, solvePuzzle, step, type GameState } from '../src/core/state';
import { TASK_HOLD_SECONDS } from '../src/core/config';
import type { Input, Task } from '../src/core/types';

const IDLE: Input = { dx: 0, dy: 0 };
const USE: Input = { dx: 0, dy: 0, action: true };
const DT = 1 / 30;

/** The right answer to a puzzle step. */
export function answerFor(t: Task): number[] | string {
  if (t.puzzle === 'keypad') return t.code;
  if (t.puzzle === 'tiles') return t.scramble!.map((r) => (4 - r) % 4);
  return [0, 1, 2, 3].map((i) => t.scramble!.indexOf(i)); // wires: each left wire to its colour
}

export function doTask(g: GameState, t: Task): void {
  t.parts?.forEach((q, i) => { if (!t.got![i]) { g.player.pos = { ...q }; step(g, IDLE, DT); } });
  g.player.pos = { ...t.pos };
  g.player.vel = { x: 0, y: 0 };
  if (g.escort) g.escort.pos = { x: t.pos.x + 1, y: t.pos.y };
  if (t.kind === 'clear') {
    step(g, IDLE, DT); // they come
    for (const z of g.zombies) if (t.targets?.includes(z.id)) { z.health = 0; z.action = 'dead'; z.actionT = 1; }
    step(g, IDLE, DT);
    void clearLeft;
    return;
  }
  step(g, USE, DT);
  if (t.kind === 'puzzle') { solvePuzzle(g, t.id, answerFor(t)); return; }
  const hold = t.seconds ?? TASK_HOLD_SECONDS;
  for (let i = 0; i < Math.ceil(hold / DT) + 2 && !t.done && g.phase === 'playing'; i++) step(g, IDLE, DT);
}
