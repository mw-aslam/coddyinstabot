import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../utils/logger';
import { sanitizeFileName } from '../utils/formatters';
import { findFirstFile } from '../utils/fileUtils';
import { runYtDlp } from '../utils/ytdlpRunner';
import { DownloadError, MediaNotFoundError } from '../utils/errors';
import { ffmpegService } from './FfmpegService';
import type { DownloadResult } from '../types';

interface RawSearchResult {
  id: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  webpage_url?: string;
}

/** Resolves a free-text query (song/artist name) to a track and downloads it as MP3. */
export class MusicSearchService {
  async searchAndDownloadMp3(query: string, outDir: string): Promise<DownloadResult> {
    logger.info('Searching for track', { query });
    const { stdout } = await runYtDlp(['-j', `ytsearch1:${query}`]);

    const line = stdout.trim().split('\n')[0];
    if (!line) throw new MediaNotFoundError(`No results for "${query}"`);

    let raw: RawSearchResult;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      throw new DownloadError(`Failed to parse yt-dlp search output: ${(err as Error).message}`);
    }

    const trackUrl = raw.webpage_url;
    if (!trackUrl) throw new MediaNotFoundError(`No results for "${query}"`);

    const title = raw.title || query;
    const artist = raw.uploader ?? raw.channel ?? 'Unknown';

    const outputTemplate = path.join(outDir, 'source.%(ext)s');
    await runYtDlp(['-f', 'bestaudio/best', '-o', outputTemplate, trackUrl]);

    const sourceFile = await findFirstFile(outDir, (name) => name.startsWith('source.'));
    if (!sourceFile) throw new DownloadError('yt-dlp produced no audio file');

    const mp3Path = path.join(outDir, `${sanitizeFileName(title)}.mp3`);
    await ffmpegService.convertToMp3(sourceFile, mp3Path, title, artist);

    const stat = await fs.stat(mp3Path);
    const probe = await ffmpegService.probe(mp3Path);

    return {
      filePath: mp3Path,
      fileName: path.basename(mp3Path),
      fileSize: stat.size,
      title,
      duration: probe.duration ?? raw.duration,
      type: 'mp3',
    };
  }
}

export const musicSearchService = new MusicSearchService();
