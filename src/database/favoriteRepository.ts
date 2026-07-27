import { pool } from './db';
import type { DownloadType } from '../types';

export interface FavoriteInput {
  userId: number;
  title: string;
  sourceUrl: string;
  type: DownloadType;
}

export interface FavoriteRow {
  id: number;
  title: string;
  sourceUrl: string;
  type: DownloadType;
}

/** Adds a favorite; silently no-ops if the user already saved this exact source. */
export async function addFavorite(input: FavoriteInput): Promise<void> {
  await pool.query(
    `INSERT INTO favorites (user_id, title, source_url, type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, source_url) DO NOTHING`,
    [input.userId, input.title, input.sourceUrl, input.type],
  );
}

export async function listFavorites(userId: number, limit = 20): Promise<FavoriteRow[]> {
  const { rows } = await pool.query<{ id: number; title: string; source_url: string; type: DownloadType }>(
    'SELECT id, title, source_url, type FROM favorites WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, sourceUrl: r.source_url, type: r.type }));
}

export async function removeFavorite(userId: number, favoriteId: number): Promise<void> {
  await pool.query('DELETE FROM favorites WHERE user_id = $1 AND id = $2', [userId, favoriteId]);
}
