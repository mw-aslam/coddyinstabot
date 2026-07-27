import { config } from '../config/config';

interface UserQueueState {
  running: number;
  waiting: Array<() => void>;
}

/**
 * A per-user semaphore that caps how many downloads a single user can run at
 * once, queueing the rest in FIFO order instead of rejecting them.
 */
export class QueueService {
  private readonly states = new Map<number, UserQueueState>();

  constructor(private readonly maxConcurrent: number) {}

  /** How many tasks for this user are currently waiting for a free slot. */
  getQueuePosition(userId: number): number {
    return this.getState(userId).waiting.length;
  }

  /** True if the user has already reached the concurrency limit. */
  isBusy(userId: number): boolean {
    return this.getState(userId).running >= this.maxConcurrent;
  }

  /** Runs `task`, waiting for a free slot first if the user is at capacity. */
  async run<T>(userId: number, task: () => Promise<T>): Promise<T> {
    const state = this.getState(userId);
    if (state.running >= this.maxConcurrent) {
      await new Promise<void>((resolve) => state.waiting.push(resolve));
    }
    state.running += 1;
    try {
      return await task();
    } finally {
      state.running -= 1;
      const next = state.waiting.shift();
      if (next) next();
    }
  }

  private getState(userId: number): UserQueueState {
    let state = this.states.get(userId);
    if (!state) {
      state = { running: 0, waiting: [] };
      this.states.set(userId, state);
    }
    return state;
  }
}

export const queueService = new QueueService(config.downloads.maxConcurrentPerUser);
