import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger';
import { ffmpegService } from '../services/FfmpegService';

/**
 * Downloads a remote thumbnail and resizes it to fit Telegram's thumbnail constraints
 * (JPEG, <=320px per side). Returns the local path, or undefined if anything failed —
 * a missing cover art should never block sending the actual media.
 */
export async function prepareThumbnail(url: string | undefined, outDir: string): Promise<string | undefined> {
  if (!url) return undefined;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    const rawPath = path.join(outDir, 'thumb_raw');
    const finalPath = path.join(outDir, 'thumb.jpg');
    await fs.writeFile(rawPath, buffer);
    await ffmpegService.resizeThumbnail(rawPath, finalPath);
    return finalPath;
  } catch (err) {
    logger.debug('Failed to prepare thumbnail (non-fatal)', { url, err: (err as Error).message });
    return undefined;
  }
}
