import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { config } from './config/config';
import { logger } from './utils/logger';
import { runMigrations, closeDatabase } from './database/db';
import { createBot, setupBotCommands } from './bot';
import { startWatchPoller } from './services/WatchService';

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

  const bot = createBot();
  await setupBotCommands(bot);
  startWatchPoller(bot.telegram);

  process.once('SIGINT', () => shutdown(bot, 'SIGINT'));
  process.once('SIGTERM', () => shutdown(bot, 'SIGTERM'));

  // Start a dummy HTTP server for Render Web Service compatibility
  const port = process.env.PORT || 3000;
  http.createServer((_req, res) => {
    res.writeHead(200);
    res.end('Bot is running!');
  }).listen(port, () => {
    logger.info(`Dummy HTTP server listening on port ${port} for Render health checks`);
  });

  await launchWithRetry(bot);
}

/**
 * During a deploy, the outgoing instance can still hold Telegram's polling slot for a few
 * seconds after the incoming one starts, so the first launch attempt gets a 409 Conflict.
 * Retrying a few times beats it registering as a crashed deploy over something that
 * self-resolves in well under a minute.
 */
async function launchWithRetry(bot: ReturnType<typeof createBot>, attempt = 1): Promise<void> {
  const maxAttempts = 5;
  const retryDelayMs = 5_000;

  // bot.launch() only resolves once the bot is stopped (it awaits the polling loop
  // internally), so we don't await it here — just react if it fails to start.
  bot.launch(() => {
    logger.info('Bot started and polling for updates');
  }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('409') && attempt < maxAttempts) {
      logger.warn(`Polling conflict (likely the old instance still shutting down), retrying ${attempt}/${maxAttempts}`);
      setTimeout(() => launchWithRetry(bot, attempt + 1), retryDelayMs);
      return;
    }
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
