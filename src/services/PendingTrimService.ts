import type { DownloadType } from '../types';

const PENDING_TTL_MS = 10 * 60 * 1000;

export interface PendingTrim {
  chatId: number;
  sourceUrl: string;
  title: string;
  type: DownloadType;
  createdAt: number;
}

/**
 * Holds one pending "waiting for a time range" request per user, so the next plain-text
 * message they send after tapping "✂️ Обрезать" is read as "0:10-0:40" instead of falling
 * through to the music-search handler.
 */
export class PendingTrimService {
  private readonly pending = new Map<number, PendingTrim>();

  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  set(userId: number, data: Omit<PendingTrim, 'createdAt'>): void {
    this.pending.set(userId, { ...data, createdAt: Date.now() });
  }

  get(userId: number): PendingTrim | undefined {
    return this.pending.get(userId);
  }

  delete(userId: number): void {
    this.pending.delete(userId);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [userId, req] of this.pending) {
      if (now - req.createdAt > PENDING_TTL_MS) {
        this.pending.delete(userId);
      }
    }
  }
}

export const pendingTrimService = new PendingTrimService();
