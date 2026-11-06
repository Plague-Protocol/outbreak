import { describe, expect, it } from 'vitest';
import { createGame, currentTask, interactionFor, requiredDone, step, withVehiclesBlocked, type GameState } from '../src/core/state';
import { cellOf, distanceField } from '../src/core/map';
import type { Input, Vec2 } from '../src/core/types';

const DT = 1 / 30;

/** Walks the shortest street route to the current objective (no dodging). */
export function botInput(g: GameState, field: { target: Vec2 | null; f: Int16Array | null }): Input {
  const t = currentTask(g);
  const target = requiredDone(g) || !t ? g.safehouse : t.pos;
  const it = interactionFor(g);
  if (it?.kind === 'task' && t && it.taskId === t.id) return { dx: 0, dy: 0, action: true };
  if (g.hold.taskId) return { dx: 0, dy: 0 };
  if (field.target !== target) { field.target = target; field.f = withVehiclesBlocked(g, () => distanceField(g.map, target)); }
  const f = field.f!;
  const cols = g.map.cols;
  const c = cellOf(g.map, g.player.pos);
  let best = f[c] as number, bc = c;
  for (const n of [c - 1, c + 1, c - cols, c + cols]) {
    if (n >= 0 && n < f.length && (f[n] as number) < best) { best = f[n] as number; bc = n; }
  }
  if (bc === c) return { dx: target.x - g.player.pos.x, dy: target.y - g.player.pos.y };
  return { dx: (bc % cols) + 0.5 - g.player.pos.x, dy: Math.floor(bc / cols) + 0.5 - g.player.pos.y };
}

describe('tuning sanity (route-following bot, no dodging, no optional tasks)', () => {
  it('can win a good share of seeds, proving the clock is feasible', () => {
    let wins = 0, timeouts = 0, caught = 0, slack = 0;
    const N = 40;
    for (let seed = 1; seed <= N; seed++) {
      const g = createGame(seed);
      const field = { target: null as Vec2 | null, f: null as Int16Array | null };
      for (let i = 0; i < 30 * 60 * 8 && g.phase === 'playing'; i++) step(g, botInput(g, field), DT);
      if (g.phase === 'won') { wins++; slack += g.remaining / g.timeLimit; }
      else if (g.lossReason === 'time') timeouts++;
      else caught++;
    }
    process.stdout.write(`bot: ${wins}/${N} won, ${timeouts} timeouts, ${caught} caught, avg slack ${(slack / Math.max(1, wins)).toFixed(2)}` + "\n");
    expect(timeouts).toBeLessThan(N * 0.1); // the clock itself must be beatable
    expect(wins).toBeGreaterThan(N * 0.3);
  }, 120_000);
});
