import type { Telegram } from 'telegraf';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { listAllWatches, updateLastSeen, type WatchedAccount } from '../database/watchedAccountRepository';
import { instagramDownloader } from './InstagramDownloader';
import { buildResultCaption, escapeMarkdown } from './UIService';
import { createTmpDir, getFileSize, removeDir } from '../utils/fileUtils';
import { MAX_FILE_SIZE_BYTES } from '../config/config';
import { nanoid } from 'nanoid';

const STAGGER_DELAY_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Starts the background poller that checks every watched account for a new post. */
export function startWatchPoller(telegram: Telegram): void {
  const intervalMs = config.watchPollIntervalMinutes * 60 * 1000;
  setInterval(() => {
    pollAll(telegram).catch((err) => logger.error('Watch poll cycle failed', { err: (err as Error).message }));
  }, intervalMs).unref();
  logger.info('Watch poller started', { intervalMinutes: config.watchPollIntervalMinutes });
}

async function pollAll(telegram: Telegram): Promise<void> {
  const watches = await listAllWatches();
  for (const watch of watches) {
    await checkOne(telegram, watch).catch((err) =>
      logger.warn('Checking a watched account failed', { profileUrl: watch.profileUrl, err: (err as Error).message }),
    );
    // Stagger requests so a long watchlist doesn't hammer yt-dlp/the source site all at once.
    await sleep(STAGGER_DELAY_MS);
  }
}

async function checkOne(telegram: Telegram, watch: WatchedAccount): Promise<void> {
  const latest = await instagramDownloader.getLatestPost(watch.profileUrl);
  if (!latest || latest.id === watch.lastSeenId) return;

  const isFirstCheck = !watch.lastSeenId;
  await updateLastSeen(watch.id, latest.id);
  // Don't blast out the account's entire existing history the moment someone adds a watch —
  // only the very next post after that baseline counts as "new".
  if (isFirstCheck) return;

  await repost(telegram, watch, latest.url);
}

async function repost(telegram: Telegram, watch: WatchedAccount, postUrl: string): Promise<void> {
  const tmpDir = await createTmpDir(nanoid(10));
  try {
    const info = await instagramDownloader.analyze(postUrl);
    const result = await instagramDownloader.downloadVideoWithAudio(postUrl, 'best', tmpDir, info.title || watch.label);

    const fileSize = await getFileSize(result.filePath);
    if (fileSize > MAX_FILE_SIZE_BYTES) throw new Error('File too large for auto-repost');

    const caption = `🔔 Новый пост от *${escapeMarkdown(watch.label)}*\n\n${buildResultCaption(result)}`;
    await telegram.sendVideo(
      watch.chatId,
      { source: result.filePath, filename: result.fileName },
      {
        caption,
        parse_mode: 'Markdown',
        width: result.width,
        height: result.height,
        duration: result.duration ? Math.round(result.duration) : undefined,
        supports_streaming: true,
      },
    );
  } catch (err) {
    // Photo posts, private accounts, oversized files, etc. — fall back to a plain link
    // notification rather than silently dropping the new post.
    logger.warn('Auto-repost download failed, sending link instead', { postUrl, err: (err as Error).message });
    await telegram
      .sendMessage(watch.chatId, `🔔 Новый пост от ${watch.label}:\n${postUrl}`)
      .catch((sendErr) => logger.error('Auto-repost link fallback also failed', { err: (sendErr as Error).message }));
  } finally {
    await removeDir(tmpDir);
  }
}
