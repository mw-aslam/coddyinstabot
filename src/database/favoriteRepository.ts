import { pool } from './db';
import type { DownloadType } from '../types';

export interface FavoriteInput {
  userId: number;
  title: string;
  sourceUrl: string;
  type: DownloadType;
  author?: string;
}

export interface FavoriteRow {
  id: number;
  title: string;
  sourceUrl: string;
  type: DownloadType;
  author?: string;
}

/** Adds a favorite; silently no-ops if the user already saved this exact source. */
export async function addFavorite(input: FavoriteInput): Promise<void> {
  await pool.query(
    `INSERT INTO favorites (user_id, title, source_url, type, author)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, source_url) DO NOTHING`,
    [input.userId, input.title, input.sourceUrl, input.type, input.author ?? null],
  );
}

export async function listFavorites(userId: number, limit = 20, offset = 0): Promise<FavoriteRow[]> {
  const { rows } = await pool.query<{
    id: number;
    title: string;
    source_url: string;
    type: DownloadType;
    author: string | null;
  }>(
    'SELECT id, title, source_url, type, author FROM favorites WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [userId, limit, offset],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    sourceUrl: r.source_url,
    type: r.type,
    author: r.author ?? undefined,
  }));
}

export async function countFavorites(userId: number): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM favorites WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.count ?? 0;
}

export async function removeFavorite(userId: number, favoriteId: number): Promise<void> {
  await pool.query('DELETE FROM favorites WHERE user_id = $1 AND id = $2', [userId, favoriteId]);
}
