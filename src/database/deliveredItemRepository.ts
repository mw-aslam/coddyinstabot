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
