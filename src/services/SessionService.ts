import { nanoid } from 'nanoid';
import type { SessionData } from '../types';

const SESSION_TTL_MS = 15 * 60 * 1000;

/**
 * Holds short-lived per-request state (the URL being processed, fetched metadata,
 * chosen type/quality) keyed by a short id that fits inside a Telegram callback_data.
 */
export class SessionService {
  private readonly sessions = new Map<string, SessionData>();

  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  create(data: Omit<SessionData, 'id' | 'createdAt'>): SessionData {
    const session: SessionData = { ...data, id: nanoid(10), createdAt: Date.now() };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): SessionData | undefined {
    return this.sessions.get(id);
  }

  update(id: string, patch: Partial<SessionData>): SessionData | undefined {
    const existing = this.sessions.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.sessions.set(id, updated);
    return updated;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }
}

export const sessionService = new SessionService();
