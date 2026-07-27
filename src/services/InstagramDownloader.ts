import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { sanitizeFileName } from '../utils/formatters';
import { findFirstFile } from '../utils/fileUtils';
import { runYtDlp } from '../utils/ytdlpRunner';
import { DownloadError } from '../utils/errors';
import { ffmpegService } from './FfmpegService';
import type { DownloadResult, DownloadType, InstagramFormat, InstagramMediaInfo, QualityOption } from '../types';

interface RawFormat {
  format_id: string;
  ext: string;
  height?: number;
  width?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
}

interface RawInfo {
  id: string;
  title?: string;
  description?: string;
  uploader?: string;
  channel?: string;
  thumbnail?: string;
  duration?: number;
  formats?: RawFormat[];
  webpage_url?: string;
}

function mapFormat(raw: RawFormat): InstagramFormat {
  const hasVideo = Boolean(raw.vcodec && raw.vcodec !== 'none');
  const hasAudio = Boolean(raw.acodec && raw.acodec !== 'none');
  return {
    formatId: raw.format_id,
    ext: raw.ext,
    height: raw.height,
    width: raw.width,
    vcodec: raw.vcodec,
    acodec: raw.acodec,
    filesize: raw.filesize ?? raw.filesize_approx,
    tbr: raw.tbr,
    hasVideo,
    hasAudio,
  };
}

const QUALITY_HEIGHTS: Record<Exclude<QualityOption, 'best'>, number> = {
  '360': 360,
  '480': 480,
  '720': 720,
  '1080': 1080,
};

/** A thin yt-dlp wrapper — despite the name, it works identically for Instagram and YouTube URLs. */
export class InstagramDownloader {
  /** Fetches metadata + available formats for a link without downloading any media. */
  async analyze(url: string): Promise<InstagramMediaInfo> {
    logger.info('Analyzing Instagram link', { url });
    const { stdout } = await runYtDlp(['-j', url]);

    let raw: RawInfo;
    try {
      raw = JSON.parse(stdout.trim().split('\n')[0]);
    } catch (err) {
      throw new DownloadError(`Failed to parse yt-dlp output: ${(err as Error).message}`);
    }

    const formats = (raw.formats ?? []).map(mapFormat);

    return {
      id: raw.id,
      title: raw.title || raw.description?.slice(0, 80) || 'Instagram media',
      uploader: raw.uploader ?? raw.channel,
      thumbnail: raw.thumbnail,
      duration: raw.duration,
      formats,
      url: raw.webpage_url ?? url,
    };
  }

  /** Quality buttons to offer, based on what heights are actually available. */
  getAvailableQualities(info: InstagramMediaInfo): QualityOption[] {
    const maxHeight = info.formats.reduce((max, f) => Math.max(max, f.height ?? 0), 0);
    const qualities: QualityOption[] = ['360', '480', '720'];
    if (maxHeight >= 1080) qualities.push('1080');
    qualities.push('best');
    return qualities;
  }

  /** Downloads the video in the requested quality, audio included if the source has it. */
  async downloadVideo(url: string, quality: QualityOption, outDir: string, title: string): Promise<DownloadResult> {
    return this.downloadWithSelector(url, quality, outDir, 'video', false, title);
  }

  /** Downloads the video guaranteeing an audio track, merging separate streams if required. */
  async downloadVideoWithAudio(
    url: string,
    quality: QualityOption,
    outDir: string,
    title: string,
  ): Promise<DownloadResult> {
    return this.downloadWithSelector(url, quality, outDir, 'videoaudio', true, title);
  }

  /** Downloads the best available audio and converts it to MP3 via ffmpeg. */
  async downloadAudio(url: string, outDir: string, title: string): Promise<DownloadResult> {
    logger.info('Downloading audio track', { url });
    const outputTemplate = path.join(outDir, 'source.%(ext)s');
    await runYtDlp(['-f', 'bestaudio/best', '-o', outputTemplate, url]);

    const sourceFile = await findFirstFile(outDir, (name) => name.startsWith('source.'));
    if (!sourceFile) throw new DownloadError('yt-dlp produced no audio file');

    const mp3Path = path.join(outDir, `${sanitizeFileName(title)}.mp3`);
    await ffmpegService.convertToMp3(sourceFile, mp3Path, title);

    const stat = await fs.stat(mp3Path);
    const probe = await ffmpegService.probe(mp3Path);

    return {
      filePath: mp3Path,
      fileName: path.basename(mp3Path),
      fileSize: stat.size,
      title,
      duration: probe.duration,
      type: 'mp3',
    };
  }

  private async downloadWithSelector(
    url: string,
    quality: QualityOption,
    outDir: string,
    type: DownloadType,
    guaranteeAudio: boolean,
    title: string,
  ): Promise<DownloadResult> {
    logger.info('Downloading video', { url, quality, type });
    const heightCap = quality === 'best' ? undefined : QUALITY_HEIGHTS[quality];
    const capExpr = heightCap ? `[height<=${heightCap}]` : '';
    // Prefer H.264 first: it's universally playable, whereas VP9/AV1-in-MP4 isn't
    // decoded by many players (e.g. Telegram). Falls back to any codec if no H.264
    // stream exists (common on Instagram) — the post-download probe catches that case.
    const selector = `bv*[vcodec^=avc1]${capExpr}+ba/b[vcodec^=avc1]${capExpr}/bv*${capExpr}+ba/b${capExpr}/best`;
    const outputTemplate = path.join(outDir, 'video.%(ext)s');

    await runYtDlp([
      '-f',
      selector,
      '--merge-output-format',
      'mp4',
      '--ffmpeg-location',
      config.binaries.ffmpegPath,
      '-o',
      outputTemplate,
      url,
    ]);

    let filePath = await findFirstFile(outDir, (name) => name.startsWith('video.'));
    if (!filePath) throw new DownloadError('yt-dlp produced no video file');

    let probe = await ffmpegService.probe(filePath);

    // Defensive fallback: if audio is required but the muxed result still lacks it
    // (e.g. yt-dlp fell back to a video-only format), fetch audio separately and mux it ourselves.
    if (guaranteeAudio && !probe.hasAudio) {
      logger.warn('Downloaded video has no audio track, fetching audio separately for merge', { url });
      const audioTemplate = path.join(outDir, 'audio.%(ext)s');
      await runYtDlp(['-f', 'bestaudio/best', '-o', audioTemplate, url]);
      const audioFile = await findFirstFile(outDir, (name) => name.startsWith('audio.'));

      if (audioFile) {
        const mergedPath = path.join(outDir, 'merged.mp4');
        await ffmpegService.mergeVideoAudio(filePath, audioFile, mergedPath);
        filePath = mergedPath;
        probe = await ffmpegService.probe(filePath);
      }
    }

    if (path.extname(filePath).toLowerCase() === '.mp4' && probe.hasVideo) {
      const isH264 = probe.vcodec === 'h264';
      const finalPath = path.join(outDir, 'final.mp4');
      if (isH264) {
        await ffmpegService.faststart(filePath, finalPath);
      } else {
        // Instagram often serves VP9-only streams; VP9-in-MP4 isn't decoded by many
        // players (Telegram included), so re-encode to the universally-supported codec.
        logger.warn('Video codec is not H.264, transcoding for compatibility', { url, vcodec: probe.vcodec });
        await ffmpegService.transcodeToH264(filePath, finalPath);
      }
      filePath = finalPath;
    }

    const stat = await fs.stat(filePath);
    const safeTitle = sanitizeFileName(title);

    return {
      filePath,
      fileName: `${safeTitle}${path.extname(filePath)}`,
      fileSize: stat.size,
      title,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      type,
    };
  }
}

export const instagramDownloader = new InstagramDownloader();
