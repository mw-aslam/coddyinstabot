import { pool } from './db';
import type { DownloadType } from '../types';

export interface DeliveredItem {
  id: string;
  title: string;
  sourceUrl: string;
  type: DownloadType;
}

/** Records a successfully sent file so later "save"/"share" button taps can look it back up. */
export async function createDeliveredItem(item: DeliveredItem): Promise<void> {
  await pool.query(
    `INSERT INTO delivered_items (id, title, source_url, type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [item.id, item.title, item.sourceUrl, item.type],
  );
}

export async function getDeliveredItem(id: string): Promise<DeliveredItem | null> {
  const { rows } = await pool.query<{ id: string; title: string; source_url: string; type: DownloadType }>(
    'SELECT id, title, source_url, type FROM delivered_items WHERE id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, title: row.title, sourceUrl: row.source_url, type: row.type };
}

/** Attaches the Telegram file_id Telegram assigned on upload, so future sends can reuse it instantly. */
export async function setDeliveredItemFileId(id: string, fileId: string): Promise<void> {
  await pool.query('UPDATE delivered_items SET file_id = $1 WHERE id = $2', [fileId, id]);
}

export interface CachedAudioItem {
  id: string;
  title: string;
  fileId: string;
}

/** Titles of previously-delivered MP3s (with a cached file_id) matching `query` — powers inline mode. */
export async function searchDeliveredAudio(query: string, limit = 20): Promise<CachedAudioItem[]> {
  const { rows } = await pool.query<{ id: string; title: string; file_id: string }>(
    `SELECT DISTINCT ON (title) id, title, file_id
     FROM delivered_items
     WHERE type = 'mp3' AND file_id IS NOT NULL AND title ILIKE $1
     ORDER BY title, created_at DESC
     LIMIT $2`,
    [`%${query}%`, limit],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, fileId: r.file_id }));
}
