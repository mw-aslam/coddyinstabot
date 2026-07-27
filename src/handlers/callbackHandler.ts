import type { Context } from 'telegraf';
import { instagramDownloader } from '../services/InstagramDownloader';
import { sessionService } from '../services/SessionService';
import { queueService } from '../services/QueueService';
import {
  mainMenuKeyboard,
  menuText,
  qualityKeyboard,
  qualityText,
  queuedText,
  stageText,
} from '../services/UIService';
import { FileTooLargeError, toUserMessage } from '../utils/errors';
import { formatDuration, formatFileSize } from '../utils/formatters';
import { createTmpDir, getFileSize, removeDir } from '../utils/fileUtils';
import { config, MAX_FILE_SIZE_BYTES } from '../config/config';
import { logger } from '../utils/logger';
import { logDownload } from '../database/downloadRepository';
import type { DownloadResult, DownloadType, QualityOption, SessionData } from '../types';

/** Routes every inline-button press to the right sub-handler based on its callback_data prefix. */
export async function callbackHandler(ctx: Context): Promise<void> {
  const query = ctx.callbackQuery;
  if (!query || !('data' in query) || !query.data) return;

  const [action, sessionId, value] = query.data.split(':');
  const session = sessionService.get(sessionId);

  if (!session) {
    await ctx.answerCbQuery('⌛ Сессия устарела, отправьте ссылку ещё раз.', { show_alert: true });
    return;
  }

  try {
    if (action === 'type') {
      await handleTypeSelection(ctx, session, value as DownloadType | 'cancel');
    } else if (action === 'quality') {
      await ctx.answerCbQuery();
      await processDownload(ctx, session, value as QualityOption);
    } else if (action === 'back') {
      await ctx.answerCbQuery();
      await showMainMenu(ctx, session);
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

    if (type === 'mp3') {
      result = await instagramDownloader.downloadAudio(url, tmpDir, info.title);
    } else if (type === 'video') {
      result = await instagramDownloader.downloadVideo(url, quality, tmpDir, info.title);
    } else {
      result = await instagramDownloader.downloadVideoWithAudio(url, quality, tmpDir, info.title);
    }

    const fileSize = await getFileSize(result.filePath);
    if (fileSize > MAX_FILE_SIZE_BYTES) {
      throw new FileTooLargeError(fileSize / (1024 * 1024), config.downloads.maxFileSizeMb);
    }

    await editStatus(ctx, session, stageText('upload'));
    await sendResult(ctx, chatId, result);
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

async function sendResult(ctx: Context, chatId: number, result: DownloadResult): Promise<void> {
  const caption = [
    `✅ *${escapeCaption(result.title)}*`,
    `📏 Размер: ${formatFileSize(result.fileSize)}`,
    result.height ? `🎬 Разрешение: ${result.width ?? '?'}x${result.height}` : undefined,
    `⏱ Длительность: ${formatDuration(result.duration)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const source = { source: result.filePath, filename: result.fileName };

  if (result.type === 'mp3') {
    await ctx.telegram.sendAudio(chatId, source, {
      caption,
      parse_mode: 'Markdown',
      title: result.title,
      duration: result.duration ? Math.round(result.duration) : undefined,
    });
  } else {
    await ctx.telegram.sendVideo(chatId, source, {
      caption,
      parse_mode: 'Markdown',
      width: result.width,
      height: result.height,
      duration: result.duration ? Math.round(result.duration) : undefined,
      supports_streaming: true,
    });
  }
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

function escapeCaption(text: string): string {
  return text.replace(/([_*[\]()`])/g, '\\$1');
}
