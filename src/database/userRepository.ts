import { pool } from './db';

export interface TelegramUserInput {
  id: number;
  username?: string;
  firstName?: string;
}

/** Inserts a user on first contact, otherwise just bumps last_seen_at. */
export async function upsertUser(user: TelegramUserInput): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, username, first_name, first_seen_at, last_seen_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (id) DO UPDATE
       SET username = EXCLUDED.username,
           first_name = EXCLUDED.first_name,
           last_seen_at = now()`,
    [user.id, user.username ?? null, user.firstName ?? null],
  );
}
