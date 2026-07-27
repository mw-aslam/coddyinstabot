import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { sanitizeFileName } from '../utils/formatters';
import { findFirstFile } from '../utils/fileUtils';
import {
  DownloadError,
  InvalidLinkError,
  MediaNotFoundError,
  NetworkError,
  PrivateAccountError,
  TimeoutError,
} from '../utils/errors';
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

const BASE_ARGS = [
  '--no-warnings',
  '--no-playlist',
  '--no-call-home',
  '--socket-timeout',
  '30',
  '--retries',
  '3',
  '--user-agent',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
];

/** Runs yt-dlp with the given args, enforcing a timeout and translating known failures. */
function runYtDlp(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.binaries.ytDlpPath, [...BASE_ARGS, ...args], { windowsHide: true });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new TimeoutError('yt-dlp timed out'));
    }, config.downloads.processTimeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new DownloadError(`Failed to start yt-dlp: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(mapYtDlpError(stderr));
    });
  });
}

/** Translates yt-dlp's stderr text into one of our typed, user-friendly errors. */
function mapYtDlpError(stderr: string): Error {
  const text = stderr.toLowerCase();
  if (text.includes('private')) return new PrivateAccountError(stderr.slice(-500));
  if (text.includes('login required') || text.includes('rate-limit reached')) {
    return new PrivateAccountError(stderr.slice(-500));
  }
  if (
    text.includes('unsupported url') ||
    text.includes('is not a valid url') ||
    text.includes('unable to extract')
  ) {
    return new InvalidLinkError(stderr.slice(-500));
  }
  if (
    text.includes('404') ||
    text.includes('does not exist') ||
    text.includes('no video formats found') ||
    text.includes('content unavailable')
  ) {
    return new MediaNotFoundError(stderr.slice(-500));
  }
  if (
    text.includes('timed out') ||
    text.includes('etimedout') ||
    text.includes('enotfound') ||
    text.includes('econnreset') ||
    text.includes('temporary failure')
  ) {
    return new NetworkError(stderr.slice(-500));
  }
  return new DownloadError(stderr.slice(-500) || 'yt-dlp failed');
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
    const selector = `bv*${capExpr}+ba/b${capExpr}/best`;
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
