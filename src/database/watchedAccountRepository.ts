import { pool } from './db';

export interface WatchedAccount {
  id: number;
  userId: number;
  chatId: number;
  profileUrl: string;
  label: string;
  lastSeenId: string | null;
}

interface WatchedAccountRow {
  id: number;
  user_id: number;
  chat_id: number;
  profile_url: string;
  label: string;
  last_seen_id: string | null;
}

function fromRow(r: WatchedAccountRow): WatchedAccount {
  return {
    id: r.id,
    userId: r.user_id,
    chatId: r.chat_id,
    profileUrl: r.profile_url,
    label: r.label,
    lastSeenId: r.last_seen_id,
  };
}

/** Adds a watch; silently no-ops if this chat is already watching this exact profile URL. */
export async function addWatch(userId: number, chatId: number, profileUrl: string, label: string): Promise<void> {
  await pool.query(
    `INSERT INTO watched_accounts (user_id, chat_id, profile_url, label)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, profile_url) DO NOTHING`,
    [userId, chatId, profileUrl, label],
  );
}

export async function listWatchesForChat(chatId: number): Promise<WatchedAccount[]> {
  const { rows } = await pool.query<WatchedAccountRow>(
    'SELECT * FROM watched_accounts WHERE chat_id = $1 ORDER BY created_at',
    [chatId],
  );
  return rows.map(fromRow);
}

/** All watches across all users/chats — polled on a timer by WatchService. */
export async function listAllWatches(): Promise<WatchedAccount[]> {
  const { rows } = await pool.query<WatchedAccountRow>('SELECT * FROM watched_accounts');
  return rows.map(fromRow);
}

export async function removeWatch(userId: number, id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM watched_accounts WHERE user_id = $1 AND id = $2', [userId, id]);
  return (result.rowCount ?? 0) > 0;
}

export async function updateLastSeen(id: number, lastSeenId: string): Promise<void> {
  await pool.query('UPDATE watched_accounts SET last_seen_id = $1 WHERE id = $2', [lastSeenId, id]);
}
