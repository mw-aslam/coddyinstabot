import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/config';
import { logger } from './logger';

/** Creates a fresh, unique temp directory for a single download session. */
export async function createTmpDir(sessionId: string): Promise<string> {
  const dir = path.join(config.downloads.tmpDir, sessionId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Best-effort recursive cleanup; failures are logged but never thrown. */
export async function removeDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    logger.warn('Failed to remove temp directory', { dir, err: (err as Error).message });
  }
}

/** Returns the first file in a directory, optionally filtered by extension prefix. */
export async function findFirstFile(dir: string, predicate?: (fileName: string) => boolean): Promise<string | null> {
  const entries = await fs.readdir(dir);
  const match = entries.find((entry) => (predicate ? predicate(entry) : true));
  return match ? path.join(dir, match) : null;
}

export async function getFileSize(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  return stat.size;
}
