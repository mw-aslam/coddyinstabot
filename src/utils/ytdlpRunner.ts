import { spawn } from 'node:child_process';
import { config } from '../config/config';
import {
  AgeRestrictedError,
  DownloadError,
  InvalidLinkError,
  MediaNotFoundError,
  NetworkError,
  PrivateAccountError,
  TimeoutError,
} from './errors';

const BASE_ARGS = [
  '--no-warnings',
  '--no-playlist',
  '--socket-timeout',
  '30',
  '--retries',
  '3',
  '--concurrent-fragments',
  '8',
  '--user-agent',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  // Works around YouTube's "Sign in to confirm you're not a bot" block on the default web/
  // android clients — mweb is the one that still returns real (non-storyboard-only) formats
  // without hitting that check, as of this writing. Re-check if YouTube changes this again.
  '--extractor-args',
  'youtube:player_client=mweb,tv',
];

/** Runs yt-dlp with the given args, enforcing a timeout and translating known failures. */
export function runYtDlp(args: string[]): Promise<{ stdout: string; stderr: string }> {
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
export function mapYtDlpError(stderr: string): Error {
  const text = stderr.toLowerCase();
  if (text.includes('private')) return new PrivateAccountError(stderr.slice(-500));
  if (text.includes('login required') || text.includes('rate-limit reached')) {
    return new PrivateAccountError(stderr.slice(-500));
  }
  if (text.includes('unsupported url') || text.includes('is not a valid url') || text.includes('unable to extract')) {
    return new InvalidLinkError(stderr.slice(-500));
  }
  if (text.includes('confirm your age') || text.includes('age-restricted') || text.includes('inappropriate for some users')) {
    return new AgeRestrictedError(stderr.slice(-500));
  }
  if (
    text.includes('404') ||
    text.includes('does not exist') ||
    text.includes('no video formats found') ||
    text.includes('no results') ||
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
