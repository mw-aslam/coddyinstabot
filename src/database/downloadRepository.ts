import { pool } from './db';
import type { DownloadType } from '../types';

export type DownloadStatus = 'success' | 'error';

export interface DownloadLogInput {
  userId: number;
  url: string;
  type: DownloadType;
  quality?: string;
  status: DownloadStatus;
  fileSize?: number;
  errorMessage?: string;
}

export async function logDownload(entry: DownloadLogInput): Promise<void> {
  await pool.query(
    `INSERT INTO downloads (user_id, url, type, quality, status, file_size, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.userId,
      entry.url,
      entry.type,
      entry.quality ?? null,
      entry.status,
      entry.fileSize ?? null,
      entry.errorMessage ?? null,
    ],
  );
}
