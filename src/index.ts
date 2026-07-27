import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { config } from './config/config';
import { logger } from './utils/logger';
import { runMigrations, closeDatabase } from './database/db';
import { createBot } from './bot';

/**
 * Render's free web-service tier needs an HTTP port bound and requires periodic requests
 * to avoid going to sleep — this just answers 200 OK so an external pinger (see
 * .github/workflows/keep-alive.yml) can keep the instance warm. No-op locally.
 */
function startHealthCheckServer(): void {
  const port = process.env.PORT;
  if (!port) return;

  http
    .createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    })
    .listen(Number.parseInt(port, 10), () => {
      logger.info(`Health-check server listening on port ${port}`);
    });
}

/** Runs `binary <versionFlag>` and resolves to true only if it exits with code 0. */
function checkBinary(binary: string, versionFlag: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(binary, [versionFlag], { windowsHide: true, stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

async function checkDependencies(): Promise<void> {
  const [ytDlpOk, ffmpegOk, ffprobeOk] = await Promise.all([
    checkBinary(config.binaries.ytDlpPath, '--version'),
    checkBinary(config.binaries.ffmpegPath, '-version'),
    checkBinary(config.binaries.ffprobePath, '-version'),
  ]);

  if (!ytDlpOk) {
    logger.warn(
      `yt-dlp binary not found at "${config.binaries.ytDlpPath}". Downloads will fail until it is installed and on PATH (or YTDLP_PATH is set).`,
    );
  }
  if (!ffmpegOk || !ffprobeOk) {
    logger.warn(
      'ffmpeg/ffprobe not found. MP3 conversion and audio/video merging will fail until they are installed and on PATH (or FFMPEG_PATH/FFPROBE_PATH are set).',
    );
  }
  if (ytDlpOk && ffmpegOk && ffprobeOk) {
    logger.info('All external dependencies (yt-dlp, ffmpeg, ffprobe) are available');
  }
}

async function main(): Promise<void> {
  await fs.mkdir(config.downloads.tmpDir, { recursive: true });
  await checkDependencies();
  await runMigrations();
  startHealthCheckServer();

  const bot = createBot();

  process.once('SIGINT', () => shutdown(bot, 'SIGINT'));
  process.once('SIGTERM', () => shutdown(bot, 'SIGTERM'));

  // bot.launch() only resolves once the bot is stopped (it awaits the polling
  // loop internally), so we don't await it here — just react if it fails to start.
  bot.launch({ dropPendingUpdates: true }, () => {
    logger.info('Bot started and polling for updates');
  }).catch((err) => {
    logger.error('Bot crashed while running', { err: err instanceof Error ? err.stack : String(err) });
    process.exit(1);
  });
}

async function shutdown(bot: ReturnType<typeof createBot>, signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down...`);
  bot.stop(signal);
  await closeDatabase();
  process.exit(0);
}

main().catch((err) => {
  logger.error('Fatal error during startup', { err: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
