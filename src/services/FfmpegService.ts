import { spawn } from 'node:child_process';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { DownloadError, TimeoutError } from '../utils/errors';
import type { ProbeResult } from '../types';

interface RunResult {
  stdout: string;
  stderr: string;
}

/** Spawns a binary, collects stdout/stderr, and enforces the configured timeout. */
function runProcess(binary: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new TimeoutError(`${binary} timed out after ${config.downloads.processTimeoutMs}ms`));
    }, config.downloads.processTimeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new DownloadError(`Failed to start ${binary}: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new DownloadError(`${binary} exited with code ${code}: ${stderr.slice(-800)}`));
      }
    });
  });
}

/** Thin wrapper around ffmpeg/ffprobe used for MP3 conversion, muxing and metadata probing. */
export class FfmpegService {
  /** Reads duration/resolution/audio-video presence from a media file via ffprobe. */
  async probe(filePath: string): Promise<ProbeResult> {
    const { stdout } = await runProcess(config.binaries.ffprobePath, [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    const data = JSON.parse(stdout) as {
      format?: { duration?: string; size?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };

    const videoStream = data.streams?.find((s) => s.codec_type === 'video');
    const audioStream = data.streams?.find((s) => s.codec_type === 'audio');

    return {
      duration: data.format?.duration ? Number.parseFloat(data.format.duration) : undefined,
      width: videoStream?.width,
      height: videoStream?.height,
      hasVideo: Boolean(videoStream),
      hasAudio: Boolean(audioStream),
      size: data.format?.size ? Number.parseInt(data.format.size, 10) : 0,
    };
  }

  /** Extracts/converts the audio track of a media file into an MP3 file with ID3 metadata. */
  async convertToMp3(inputPath: string, outputPath: string, title: string, artist = 'Instagram'): Promise<void> {
    logger.debug('Converting to MP3', { inputPath, outputPath });
    await runProcess(config.binaries.ffmpegPath, [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-acodec',
      'libmp3lame',
      '-q:a',
      '2',
      '-metadata',
      `title=${title}`,
      '-metadata',
      `artist=${artist}`,
      outputPath,
    ]);
  }

  /** Muxes a silent video stream with a separately downloaded audio stream into one file. */
  async mergeVideoAudio(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
    logger.debug('Merging video and audio', { videoPath, audioPath, outputPath });
    await runProcess(config.binaries.ffmpegPath, [
      '-y',
      '-i',
      videoPath,
      '-i',
      audioPath,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-shortest',
      outputPath,
    ]);
  }

  /** Resizes an arbitrary image to fit Telegram's thumbnail limits (<=320px per side, JPEG). */
  async resizeThumbnail(inputPath: string, outputPath: string): Promise<void> {
    await runProcess(config.binaries.ffmpegPath, [
      '-y',
      '-i',
      inputPath,
      '-vf',
      "scale='min(320,iw)':'min(320,ih)':force_original_aspect_ratio=decrease",
      '-vframes',
      '1',
      outputPath,
    ]);
  }

  /** Trims audio/video to its first `seconds` and converts it to MP3 — used before sending a clip off for recognition. */
  async trimToClip(inputPath: string, outputPath: string, seconds = 15): Promise<void> {
    await runProcess(config.binaries.ffmpegPath, [
      '-y',
      '-i',
      inputPath,
      '-t',
      String(seconds),
      '-vn',
      '-acodec',
      'libmp3lame',
      '-ar',
      '44100',
      outputPath,
    ]);
  }

  /** Verifies the configured ffmpeg/ffprobe binaries are runnable. */
  async checkAvailable(): Promise<boolean> {
    try {
      await runProcess(config.binaries.ffmpegPath, ['-version']);
      await runProcess(config.binaries.ffprobePath, ['-version']);
      return true;
    } catch {
      return false;
    }
  }
}

export const ffmpegService = new FfmpegService();
