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
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
    };

    const videoStream = data.streams?.find((s) => s.codec_type === 'video');
    const audioStream = data.streams?.find((s) => s.codec_type === 'audio');

    return {
      duration: data.format?.duration ? Number.parseFloat(data.format.duration) : undefined,
      width: videoStream?.width,
      height: videoStream?.height,
      hasVideo: Boolean(videoStream),
      hasAudio: Boolean(audioStream),
      vcodec: videoStream?.codec_name,
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
      '-movflags',
      '+faststart',
      outputPath,
    ]);
  }

  /**
   * Rewrites an MP4's moov atom to the front of the file without re-encoding.
   * Without this, players (e.g. Telegram) can start audio before the video index
   * is available and render the video as a frozen/static frame until fully downloaded.
   */
  async faststart(inputPath: string, outputPath: string): Promise<void> {
    logger.debug('Remuxing for faststart', { inputPath, outputPath });
    await runProcess(config.binaries.ffmpegPath, [
      '-y',
      '-i',
      inputPath,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
  }

  /**
   * Re-encodes the video track to H.264/AAC. Instagram frequently serves VP9-only
   * streams in an MP4 container; VP9-in-MP4 isn't decoded by many players (Telegram
   * included), so audio plays while the video sits frozen on the first frame.
   */
  async transcodeToH264(inputPath: string, outputPath: string): Promise<void> {
    logger.debug('Transcoding video to H.264', { inputPath, outputPath });
    await runProcess(config.binaries.ffmpegPath, [
      '-y',
      '-i',
      inputPath,
      '-vf',
      "scale='min(640,iw)':'min(640,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '28',
      '-maxrate',
      '1200k',
      '-bufsize',
      '2400k',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
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

  /**
   * Cuts [startSeconds, startSeconds+durationSeconds) out of a video. Re-encodes rather than
   * stream-copying: an arbitrary -ss cut point usually isn't on a keyframe, and copy-mode would
   * either snap to the nearest keyframe (wrong start time) or produce a broken first frame.
   */
  async trimVideo(inputPath: string, outputPath: string, startSeconds: number, durationSeconds: number): Promise<void> {
    logger.debug('Trimming video', { inputPath, outputPath, startSeconds, durationSeconds });
    await runProcess(config.binaries.ffmpegPath, [
      '-y',
      '-ss',
      String(startSeconds),
      '-i',
      inputPath,
      '-t',
      String(durationSeconds),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
  }

  /** Renders [startSeconds, startSeconds+durationSeconds) of a video as an animated GIF. */
  async makeGif(inputPath: string, outputPath: string, startSeconds: number, durationSeconds: number): Promise<void> {
    logger.debug('Making GIF', { inputPath, outputPath, startSeconds, durationSeconds });
    await runProcess(config.binaries.ffmpegPath, [
      '-y',
      '-ss',
      String(startSeconds),
      '-i',
      inputPath,
      '-t',
      String(durationSeconds),
      '-vf',
      "fps=12,scale=480:-1:flags=lanczos",
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
