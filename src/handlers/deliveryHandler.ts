import type { Context } from 'telegraf';
import { nanoid } from 'nanoid';
import { createDeliveredItem, getDeliveredItem, type DeliveredItem } from '../database/deliveredItemRepository';
import { addFavorite } from '../database/favoriteRepository';
import { resultActionsKeyboard } from '../services/UIService';
import { instagramDownloader } from '../services/InstagramDownloader';
import { musicSearchService } from '../services/MusicSearchService';
import { queueService } from '../services/QueueService';
import { sessionService } from '../services/SessionService';
import { stageText } from '../services/UIService';
import { toUserMessage, FileTooLargeError } from '../utils/errors';
import { formatDuration, formatFileSize } from '../utils/formatters';
import { createTmpDir, getFileSize, removeDir } from '../utils/fileUtils';
import { config, MAX_FILE_SIZE_BYTES } from '../config/config';
import { logger } from '../utils/logger';
import { logDownload } from '../database/downloadRepository';
import { escapeMarkdown } from '../services/UIService';
import type { DownloadResult, DownloadType } from '../types';

/**
 * Records a successfully delivered file and builds the action-row keyboard (extract/save/share)
 * that goes under it. Every send path (Instagram video, music search, favorites, deep links)
 * funnels through here so "save" and "share" behave identically everywhere.
 */
export async function buildDeliveryActions(
  ctx: Context,
  item: { title: string; sourceUrl: string; type: DownloadType },
  extractSessionId?: string,
) {
  const deliveredId = nanoid(10);
  await createDeliveredItem({ id: deliveredId, title: item.title, sourceUrl: item.sourceUrl, type: item.type });

  const botUsername = ctx.botInfo?.username;
  const shareUrl = botUsername ? `https://t.me/${botUsername}?start=t_${deliveredId}` : undefined;

  return resultActionsKeyboard({ deliveredId, extractSessionId, shareUrl });
}

/** Handles a tap on "❤️ Сохранить": looks up the delivered item and adds it to the user's favorites. */
export async function handleSaveFavorite(ctx: Context, deliveredId: string): Promise<void> {
  if (!ctx.from) return;
  const item = await getDeliveredItem(deliveredId);
  if (!item) {
    await ctx.answerCbQuery('⌛ Не удалось найти этот файл, он мог устареть.', { show_alert: true });
    return;
  }
  await addFavorite({ userId: ctx.from.id, title: item.title, sourceUrl: item.sourceUrl, type: item.type });
  await ctx.answerCbQuery('❤️ Сохранено в избранное!');
}

/** Re-downloads and sends a previously delivered item — used by /favorites and deep-link shares. */
export async function redeliverItem(ctx: Context, item: DeliveredItem): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  const statusMessage = await ctx.reply(stageText('download'));
  const edit = async (text: string): Promise<void> => {
    await ctx.telegram.editMessageText(chatId, statusMessage.message_id, undefined, text).catch(() => undefined);
  };

  await queueService.run(userId, async () => {
    const tmpDir = await createTmpDir(nanoid(10));
    let result: DownloadResult | undefined;

    try {
      if (item.type === 'mp3') {
        result = await musicSearchService.downloadTrackMp3({ title: item.title, url: item.sourceUrl }, tmpDir);
      } else {
        result = await instagramDownloader.downloadVideoWithAudio(item.sourceUrl, 'best', tmpDir, item.title);
      }

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
      const source = { source: result.filePath, filename: result.fileName };
      const actions = await buildDeliveryActions(ctx, { title: result.title, sourceUrl: item.sourceUrl, type: item.type });

      if (result.type === 'mp3') {
        await ctx.telegram.sendAudio(chatId, source, {
          caption,
          parse_mode: 'Markdown',
          title: result.title,
          duration: result.duration ? Math.round(result.duration) : undefined,
          thumbnail: result.thumbnailPath ? { source: result.thumbnailPath } : undefined,
          ...actions,
        });
      } else {
        await ctx.telegram.sendVideo(chatId, source, {
          caption,
          parse_mode: 'Markdown',
          width: result.width,
          height: result.height,
          duration: result.duration ? Math.round(result.duration) : undefined,
          supports_streaming: true,
          ...actions,
        });
      }
      await edit('✅ Готово!');
      await logDownload({ userId, url: item.sourceUrl, type: item.type, status: 'success', fileSize: result.fileSize });
    } catch (err) {
      logger.error('Redelivery failed', { url: item.sourceUrl, err: (err as Error).message });
      await edit(toUserMessage(err));
      await logDownload({
        userId,
        url: item.sourceUrl,
        type: item.type,
        status: 'error',
        errorMessage: (err as Error).message.slice(0, 500),
      }).catch(() => undefined);
    } finally {
      await removeDir(tmpDir);
    }
  });
}

/** Creates a throwaway mp3-only session so the "extract audio" button can reuse the normal download flow. */
export function createExtractAudioSession(userId: number, chatId: number, url: string): string {
  const session = sessionService.create({ userId, chatId, url, type: 'mp3' });
  return session.id;
}
