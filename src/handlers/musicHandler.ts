import type { Context } from 'telegraf';
import { musicSearchService } from '../services/MusicSearchService';
import { sessionService } from '../services/SessionService';
import { queueService } from '../services/QueueService';
import {
  escapeMarkdown,
  queuedText,
  searchingText,
  stageText,
  trackPickerKeyboard,
  trackPickerText,
} from '../services/UIService';
import { FileTooLargeError, toUserMessage } from '../utils/errors';
import { formatDuration, formatFileSize } from '../utils/formatters';
import { createTmpDir, getFileSize, removeDir } from '../utils/fileUtils';
import { config, MAX_FILE_SIZE_BYTES } from '../config/config';
import { logger } from '../utils/logger';
import { logDownload } from '../database/downloadRepository';
import { upsertUser } from '../database/userRepository';
import { buildDeliveryActions } from './deliveryHandler';
import type { DownloadResult, MusicTrack, SessionData } from '../types';

/** Handles a plain-text message that isn't a link: searches YouTube and offers a track picker. */
export async function musicSearchHandler(ctx: Context, query: string): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  await upsertUser({ id: userId, username: ctx.from.username, firstName: ctx.from.first_name }).catch((err) =>
    logger.error('Failed to upsert user', { err: (err as Error).message }),
  );

  const statusMessage = await ctx.reply(searchingText(query));

  const session = sessionService.create({
    userId,
    chatId,
    statusMessageId: statusMessage.message_id,
    url: `search:${query}`,
    type: 'mp3',
    musicQuery: query,
  });

  try {
    const tracks = await musicSearchService.search(query);
    sessionService.update(session.id, { musicResults: tracks });

    await ctx.telegram.editMessageText(
      chatId,
      statusMessage.message_id,
      undefined,
      trackPickerText(query, tracks.length),
      { parse_mode: 'Markdown', ...trackPickerKeyboard(session.id, tracks) },
    );
  } catch (err) {
    logger.error('Music search failed', { query, err: (err as Error).message });
    sessionService.delete(session.id);
    await ctx.telegram
      .editMessageText(chatId, statusMessage.message_id, undefined, toUserMessage(err))
      .catch(() => undefined);
  }
}

/** Downloads a track the user picked (from search results or an "extract audio" button) and sends it. */
export async function downloadAndSendTrack(ctx: Context, session: SessionData, track: MusicTrack): Promise<void> {
  const { userId, chatId } = session;

  const edit = async (text: string): Promise<void> => {
    if (!session.statusMessageId) return;
    await ctx.telegram.editMessageText(chatId, session.statusMessageId, undefined, text).catch(() => undefined);
  };

  if (queueService.isBusy(userId)) {
    await edit(queuedText(queueService.getQueuePosition(userId) + 1));
  }

  await queueService.run(userId, async () => {
    const tmpDir = await createTmpDir(session.id);
    let result: DownloadResult | undefined;

    try {
      await edit(stageText('download'));
      result = await musicSearchService.downloadTrackMp3(track, tmpDir);

      const fileSize = await getFileSize(result.filePath);
      if (fileSize > MAX_FILE_SIZE_BYTES) {
        throw new FileTooLargeError(fileSize / (1024 * 1024), config.downloads.maxFileSizeMb);
      }

      await edit(stageText('upload'));
      const caption = [
        `✅ *${escapeMarkdown(result.title)}*`,
        `📏 Размер: ${formatFileSize(result.fileSize)}`,
        `⏱ Длительность: ${formatDuration(result.duration)}`,
      ].join('\n');

      const actions = await buildDeliveryActions(ctx, { title: result.title, sourceUrl: track.url, type: 'mp3' });

      await ctx.telegram.sendAudio(
        chatId,
        { source: result.filePath, filename: result.fileName },
        {
          caption,
          parse_mode: 'Markdown',
          title: result.title,
          duration: result.duration ? Math.round(result.duration) : undefined,
          thumbnail: result.thumbnailPath ? { source: result.thumbnailPath } : undefined,
          ...actions,
        },
      );
      await edit('✅ Готово!');

      await logDownload({ userId, url: track.url, type: 'mp3', status: 'success', fileSize: result.fileSize });
    } catch (err) {
      logger.error('Track download failed', { url: track.url, err: (err as Error).message });
      await edit(toUserMessage(err));
      await logDownload({
        userId,
        url: track.url,
        type: 'mp3',
        status: 'error',
        errorMessage: (err as Error).message.slice(0, 500),
      }).catch(() => undefined);
    } finally {
      await removeDir(tmpDir);
      sessionService.delete(session.id);
    }
  });
}
