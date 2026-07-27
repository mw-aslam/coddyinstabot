import type { Context } from 'telegraf';
import { musicSearchService } from '../services/MusicSearchService';
import { queueService } from '../services/QueueService';
import { escapeMarkdown, queuedText, searchingText, stageText } from '../services/UIService';
import { FileTooLargeError, toUserMessage } from '../utils/errors';
import { formatDuration, formatFileSize } from '../utils/formatters';
import { createTmpDir, getFileSize, removeDir } from '../utils/fileUtils';
import { config, MAX_FILE_SIZE_BYTES } from '../config/config';
import { logger } from '../utils/logger';
import { logDownload } from '../database/downloadRepository';
import { upsertUser } from '../database/userRepository';
import { nanoid } from 'nanoid';
import type { DownloadResult } from '../types';

/** Handles a plain-text message that isn't a link: treats it as a song/artist search query. */
export async function musicSearchHandler(ctx: Context, query: string): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  await upsertUser({ id: userId, username: ctx.from.username, firstName: ctx.from.first_name }).catch((err) =>
    logger.error('Failed to upsert user', { err: (err as Error).message }),
  );

  const statusMessage = await ctx.reply(searchingText(query));

  const edit = async (text: string): Promise<void> => {
    await ctx.telegram.editMessageText(chatId, statusMessage.message_id, undefined, text).catch(() => undefined);
  };

  if (queueService.isBusy(userId)) {
    await edit(queuedText(queueService.getQueuePosition(userId) + 1));
  }

  await queueService.run(userId, () => runMusicSearch(ctx, chatId, userId, query, edit));
}

async function runMusicSearch(
  ctx: Context,
  chatId: number,
  userId: number,
  query: string,
  edit: (text: string) => Promise<void>,
): Promise<void> {
  const tmpDir = await createTmpDir(`music_${nanoid(8)}`);
  let result: DownloadResult | undefined;

  try {
    await edit(stageText('download'));
    result = await musicSearchService.searchAndDownloadMp3(query, tmpDir);

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

    await ctx.telegram.sendAudio(
      chatId,
      { source: result.filePath, filename: result.fileName },
      {
        caption,
        parse_mode: 'Markdown',
        title: result.title,
        duration: result.duration ? Math.round(result.duration) : undefined,
      },
    );
    await edit('✅ Готово!');

    await logDownload({ userId, url: `search:${query}`, type: 'mp3', status: 'success', fileSize: result.fileSize });
  } catch (err) {
    logger.error('Music search failed', { query, err: (err as Error).message });
    await edit(toUserMessage(err));
    await logDownload({
      userId,
      url: `search:${query}`,
      type: 'mp3',
      status: 'error',
      errorMessage: (err as Error).message.slice(0, 500),
    }).catch(() => undefined);
  } finally {
    await removeDir(tmpDir);
  }
}
