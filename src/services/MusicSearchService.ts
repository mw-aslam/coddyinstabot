import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../utils/logger';
import { sanitizeFileName } from '../utils/formatters';
import { findFirstFile } from '../utils/fileUtils';
import { prepareThumbnail } from '../utils/thumbnail';
import { runYtDlp } from '../utils/ytdlpRunner';
import { DownloadError, MediaNotFoundError, NetworkError, TimeoutError } from '../utils/errors';
import { ffmpegService } from './FfmpegService';
import type { DownloadResult, MusicTrack } from '../types';

interface RawSearchResult {
  id: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  webpage_url?: string;
  thumbnail?: string;
}

const DEFAULT_RESULT_LIMIT = 5;

/** Resolves a free-text query (song/artist name) to one or more candidate tracks. */
export class MusicSearchService {
  /**
   * Returns up to `limit` YouTube matches for the query — lets the user pick the right version.
   * Retries once on transient timeout/network failures, same as InstagramDownloader.analyze().
   */
  async search(query: string, limit = DEFAULT_RESULT_LIMIT): Promise<MusicTrack[]> {
    logger.info('Searching for tracks', { query, limit });
    let stdout: string;
    try {
      ({ stdout } = await runYtDlp(['-j', `ytsearch${limit}:${query}`]));
    } catch (err) {
      if (err instanceof TimeoutError || err instanceof NetworkError) {
        logger.warn('Search failed with a transient error, retrying once', { query, err: err.message });
        ({ stdout } = await runYtDlp(['-j', `ytsearch${limit}:${query}`]));
      } else {
        throw err;
      }
    }

    const lines = stdout.trim().split('\n').filter(Boolean);
    if (lines.length === 0) throw new MediaNotFoundError(`No results for "${query}"`);

    const tracks: MusicTrack[] = [];
    for (const line of lines) {
      try {
        const raw: RawSearchResult = JSON.parse(line);
        if (!raw.webpage_url) continue;
        tracks.push({
          title: raw.title || query,
          uploader: raw.uploader ?? raw.channel,
          duration: raw.duration,
          url: raw.webpage_url,
          thumbnail: raw.thumbnail,
        });
      } catch (err) {
        logger.warn('Failed to parse a search result line, skipping it', { err: (err as Error).message });
      }
    }

    if (tracks.length === 0) throw new MediaNotFoundError(`No results for "${query}"`);
    return tracks;
  }

  /** Downloads a previously resolved track and converts it to MP3, with cover art if available. */
  async downloadTrackMp3(track: MusicTrack, outDir: string): Promise<DownloadResult> {
    // Cover art is independent of the audio itself — fetch it while yt-dlp/ffmpeg are busy instead of after.
    const thumbnailPromise = prepareThumbnail(track.thumbnail, outDir);

    const outputTemplate = path.join(outDir, 'source.%(ext)s');
    await runYtDlp(['-f', 'bestaudio/best', '-o', outputTemplate, track.url]);

    const sourceFile = await findFirstFile(outDir, (name) => name.startsWith('source.'));
    if (!sourceFile) throw new DownloadError('yt-dlp produced no audio file');

    const artist = track.uploader ?? 'Unknown';
    const mp3Path = path.join(outDir, `${sanitizeFileName(track.title)}.mp3`);
    await ffmpegService.convertToMp3(sourceFile, mp3Path, track.title, artist);

    const [stat, probe, thumbnailPath] = await Promise.all([
      fs.stat(mp3Path),
      ffmpegService.probe(mp3Path),
      thumbnailPromise,
    ]);

    return {
      filePath: mp3Path,
      fileName: path.basename(mp3Path),
      fileSize: stat.size,
      title: track.title,
      duration: probe.duration ?? track.duration,
      type: 'mp3',
      thumbnailPath,
    };
  }
}

export const musicSearchService = new MusicSearchService();
