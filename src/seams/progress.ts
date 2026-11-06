// Seam for progress saving. The slice keeps nothing; a real store (backend, per account) plugs in here.
import type { LossReason } from '../core/types';
import type { AuthSession } from './session';

export interface RunResult {
  seed: number;
  outcome: 'won' | 'lost';
  lossReason: LossReason | null;
  secondsLeft: number;
  timeLimit: number;
  optionalDone: number;
}

export interface ProgressStore {
  saveRun(session: AuthSession, result: RunResult): Promise<void>;
}

export const noopProgress: ProgressStore = {
  async saveRun() {
    /* nothing persisted in this slice */
  },
};
