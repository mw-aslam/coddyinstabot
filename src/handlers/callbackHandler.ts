import type { Context } from 'telegraf';
import { instagramDownloader } from '../services/InstagramDownloader';
import { sessionService } from '../services/SessionService';
import { queueService } from '../services/QueueService';
import {
  buildResultCaption,
  favoritesKeyboard,
  favoritesText,
  mainMenuKeyboard,
  menuText,
  prettifyInstagramTitle,
  qualityKeyboard,
  qualityText,
  queuedText,
  stageText,
} from '../services/UIService';
import { FileTooLargeError, toUserMessage } from '../utils/errors';
import { createTmpDir, getFileSize, removeDir } from '../utils/fileUtils';
import { prepareThumbnail } from '../utils/thumbnail';
import { config, MAX_FILE_SIZE_BYTES } from '../config/config';
import { logger } from '../utils/logger';
import { logDownload } from '../database/downloadRepository';
import { listFavorites, removeFavorite } from '../database/favoriteRepository';
import { downloadAndSendTrack } from './musicHandler';
import { buildDeliveryActions, cacheAudioFileId, handleSaveFavorite, redeliverItem } from './deliveryHandler';
import type { DownloadResult, DownloadType, QualityOption, SessionData } from '../types';

/** Routes every inline-button press to the right sub-handler based on its callback_data prefix. */
export async function callbackHandler(ctx: Context): Promise<void> {
  const query = ctx.callbackQuery;
  if (!query || !('data' in query) || !query.data) return;

  const [action, param, value] = query.data.split(':');

  try {
    // "save" / "fav" reference persistent DB records, not ephemeral sessions — handle first.
    if (action === 'save') {
      await handleSaveFavorite(ctx, param);
      return;
    }
    if (action === 'fav') {
      await ctx.answerCbQuery();
      if (param === 'cancel') {
        await ctx.deleteMessage().catch(() => undefined);
        return;
      }
      await handleFavoriteRedownload(ctx, Number.parseInt(param, 10));
      return;
    }
    if (action === 'favdel') {
      await handleFavoriteDelete(ctx, Number.parseInt(param, 10));
      return;
    }

    const session = sessionService.get(param);
    if (!session) {
      await ctx.answerCbQuery('⌛ Сессия устарела, отправьте ссылку ещё раз.', { show_alert: true });
      return;
    }

    if (action === 'type') {
      await handleTypeSelection(ctx, session, value as DownloadType | 'cancel');
    } else if (action === 'quality') {
      await ctx.answerCbQuery();
      await processDownload(ctx, session, value as QualityOption);
    } else if (action === 'back') {
      await ctx.answerCbQuery();
      await showMainMenu(ctx, session);
    } else if (action === 'track') {
      await ctx.answerCbQuery();
      await handleTrackSelection(ctx, session, value);
    } else if (action === 'extractaudio') {
      await ctx.answerCbQuery();
      await handleExtractAudio(ctx, session);
    }
  } catch (err) {
    logger.error('Callback handling failed', { err: (err as Error).message, action });
    await ctx.answerCbQuery(toUserMessage(err), { show_alert: true }).catch(() => undefined);
  }
}

async function handleTypeSelection(
  ctx: Context,
  session: SessionData,
  type: DownloadType | 'cancel',
): Promise<void> {
  if (type === 'cancel') {
    await ctx.answerCbQuery('Отменено');
    await editStatus(ctx, session, '❌ Отменено.');
    sessionService.delete(session.id);
    return;
  }

  await ctx.answerCbQuery();
  sessionService.update(session.id, { type });

  if (type === 'mp3') {
    await processDownload(ctx, session, 'best');
    return;
  }

  const info = session.info;
  if (!info) return;
  const qualities = instagramDownloader.getAvailableQualities(info);
  await editStatus(ctx, session, qualityText(), qualityKeyboard(session.id, qualities));
}

async function showMainMenu(ctx: Context, session: SessionData): Promise<void> {
  if (!session.info) return;
  await editStatus(ctx, session, menuText(session.info.title), mainMenuKeyboard(session.id));
}

async function processDownload(ctx: Context, session: SessionData, quality: QualityOption): Promise<void> {
  const { userId, type, info } = session;
  if (!type || !info) return;

  if (queueService.isBusy(userId)) {
    const position = queueService.getQueuePosition(userId) + 1;
    await editStatus(ctx, session, queuedText(position));
  }

  await queueService.run(userId, () => runDownload(ctx, session, type, quality));
}

async function runDownload(
  ctx: Context,
  session: SessionData,
  type: DownloadType,
  quality: QualityOption,
): Promise<void> {
  const { userId, chatId, url, info } = session;
  if (!info) return;

  const tmpDir = await createTmpDir(session.id);
  let result: DownloadResult | undefined;

  try {
    await editStatus(ctx, session, stageText('download'));

    // Cover art doesn't depend on the download result, so fetch it while yt-dlp/ffmpeg are busy.
    const thumbnailPromise = prepareThumbnail(info.thumbnail, tmpDir);
    const botName = ctx.botInfo?.first_name ?? 'Instagram видео';
    const { title: displayTitle, author } = prettifyInstagramTitle(info.title, info.uploader, botName);

    if (type === 'mp3') {
      result = await instagramDownloader.downloadAudio(url, tmpDir, displayTitle);
    } else if (type === 'video') {
      result = await instagramDownloader.downloadVideo(url, quality, tmpDir, displayTitle);
    } else {
      result = await instagramDownloader.downloadVideoWithAudio(url, quality, tmpDir, displayTitle);
    }
    result.author = author;

    const [fileSize, thumbnailPath] = await Promise.all([getFileSize(result.filePath), thumbnailPromise]);
    if (fileSize > MAX_FILE_SIZE_BYTES) {
      throw new FileTooLargeError(fileSize / (1024 * 1024), config.downloads.maxFileSizeMb);
    }
    result.thumbnailPath = thumbnailPath;

    await editStatus(ctx, session, stageText('upload'));

    // Let the user grab just the audio from a delivered video without resending the link.
    const extractSessionId =
      type !== 'mp3' ? sessionService.create({ userId, chatId, url, info, type: 'mp3' }).id : undefined;
    const delivery = await buildDeliveryActions(ctx, { title: result.title, sourceUrl: url, type }, extractSessionId);

    await sendResult(ctx, chatId, result, delivery);
    await editStatus(ctx, session, '✅ Готово!');

    await logDownload({ userId, url, type, quality, status: 'success', fileSize: result.fileSize });
  } catch (err) {
    logger.error('Download failed', { url, type, quality, err: (err as Error).message });
    await editStatus(ctx, session, toUserMessage(err));
    await logDownload({
      userId,
      url,
      type,
      quality,
      status: 'error',
      errorMessage: (err as Error).message.slice(0, 500),
    }).catch(() => undefined);
  } finally {
    await removeDir(tmpDir);
    sessionService.delete(session.id);
  }
}

async function sendResult(
  ctx: Context,
  chatId: number,
  result: DownloadResult,
  delivery: Awaited<ReturnType<typeof buildDeliveryActions>>,
): Promise<void> {
  const caption = buildResultCaption(result);
  const source = { source: result.filePath, filename: result.fileName };
  const thumbnail = result.thumbnailPath ? { source: result.thumbnailPath } : undefined;

  if (result.type === 'mp3') {
    const sent = await ctx.telegram.sendAudio(chatId, source, {
      caption,
      parse_mode: 'Markdown',
      title: result.title,
      duration: result.duration ? Math.round(result.duration) : undefined,
      thumbnail,
      ...delivery.keyboard,
    });
    await cacheAudioFileId(delivery.deliveredId, sent);
  } else {
    await ctx.telegram.sendVideo(chatId, source, {
      caption,
      parse_mode: 'Markdown',
      width: result.width,
      height: result.height,
      duration: result.duration ? Math.round(result.duration) : undefined,
      supports_streaming: true,
      thumbnail,
      ...delivery.keyboard,
    });
  }
}

/** Handles a "🎵" button picked from a music-search track list. */
async function handleTrackSelection(ctx: Context, session: SessionData, value: string): Promise<void> {
  if (value === 'cancel') {
    await editStatus(ctx, session, '❌ Отменено.');
    sessionService.delete(session.id);
    return;
  }

  const index = Number.parseInt(value, 10);
  const track = session.musicResults?.[index];
  if (!track) {
    await editStatus(ctx, session, '⚠️ Не удалось найти выбранный трек, попробуйте снова.');
    sessionService.delete(session.id);
    return;
  }

  await downloadAndSendTrack(ctx, session, track);
}

/** Handles the "🎵 Скачать только песню" button attached to a delivered Instagram video. */
async function handleExtractAudio(ctx: Context, session: SessionData): Promise<void> {
  if (!session.info) return;
  const statusMessage = await ctx.reply(stageText('download'));
  const updated = sessionService.update(session.id, { statusMessageId: statusMessage.message_id });
  if (!updated) return;
  await processDownload(ctx, updated, 'best');
}

/** Handles a tap on a saved item from /favorites: re-downloads and sends it. */
async function handleFavoriteRedownload(ctx: Context, favoriteId: number): Promise<void> {
  if (!ctx.from) return;
  const rows = await listFavorites(ctx.from.id, 50);
  const favorite = rows.find((r) => r.id === favoriteId);
  if (!favorite) {
    await ctx.reply('⚠️ Не удалось найти этот элемент в избранном — возможно, он был удалён.');
    return;
  }
  await redeliverItem(ctx, { id: `fav-${favorite.id}`, title: favorite.title, sourceUrl: favorite.sourceUrl, type: favorite.type });
}

/** Handles a "🗑" tap: removes the item and refreshes the /favorites list in place. */
async function handleFavoriteDelete(ctx: Context, favoriteId: number): Promise<void> {
  if (!ctx.from) return;
  await removeFavorite(ctx.from.id, favoriteId);
  await ctx.answerCbQuery('🗑 Удалено');

  const rows = await listFavorites(ctx.from.id);
  const query = ctx.callbackQuery;
  if (!query?.message) return;
  await ctx.telegram
    .editMessageText(query.message.chat.id, query.message.message_id, undefined, favoritesText(rows), {
      parse_mode: 'Markdown',
      ...(rows.length > 0 ? favoritesKeyboard(rows) : {}),
    })
    .catch(() => undefined);
}

async function editStatus(
  ctx: Context,
  session: SessionData,
  text: string,
  keyboard?: ReturnType<typeof mainMenuKeyboard>,
): Promise<void> {
  if (!session.statusMessageId) return;
  try {
    await ctx.telegram.editMessageText(session.chatId, session.statusMessageId, undefined, text, {
      parse_mode: 'Markdown',
      ...(keyboard ?? {}),
    });
  } catch (err) {
    logger.debug('editMessageText failed (likely identical content)', { err: (err as Error).message });
  }
}
