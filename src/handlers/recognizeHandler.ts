import type { Context } from 'telegraf';
import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '../config/config';
import { recognitionService } from '../services/RecognitionService';
import { musicSearchService } from '../services/MusicSearchService';
import { ffmpegService } from '../services/FfmpegService';
import { queueService } from '../services/QueueService';
import { buildDeliveryActions, cacheAudioFileId } from './deliveryHandler';
import { escapeMarkdown, queuedText, stageText } from '../services/UIService';
import { toUserMessage, FileTooLargeError, MediaNotFoundError } from '../utils/errors';
import { formatDuration, formatFileSize } from '../utils/formatters';
import { createTmpDir, getFileSize, removeDir } from '../utils/fileUtils';
import { MAX_FILE_SIZE_BYTES } from '../config/config';
import { logger } from '../utils/logger';
import { logDownload } from '../database/downloadRepository';
import { upsertUser } from '../database/userRepository';
import type { DownloadResult } from '../types';

/** Handles a voice message / audio clip / video note: recognizes the song and delivers it as MP3. */
export async function recognizeHandler(ctx: Context): Promise<void> {
  if (!recognitionService.isEnabled()) return;
  if (!ctx.from || !ctx.chat) return;

  const message = ctx.message;
  if (!message) return;

  const media = 'voice' in message ? message.voice : 'audio' in message ? message.audio : 'video_note' in message ? message.video_note : undefined;
  if (!media) return;

  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  await upsertUser({ id: userId, username: ctx.from.username, firstName: ctx.from.first_name }).catch((err) =>
    logger.error('Failed to upsert user', { err: (err as Error).message }),
  );

  const statusMessage = await ctx.reply('🎧 Слушаю и распознаю...');
  const edit = async (text: string): Promise<void> => {
    await ctx.telegram.editMessageText(chatId, statusMessage.message_id, undefined, text).catch(() => undefined);
  };

  if (queueService.isBusy(userId)) {
    await edit(queuedText(queueService.getQueuePosition(userId) + 1));
  }

  await queueService.run(userId, async () => {
    const tmpDir = await createTmpDir(`recognize_${statusMessage.message_id}`);

    try {
      const fileLink = await ctx.telegram.getFileLink(media.file_id);
      const rawPath = path.join(tmpDir, 'input');
      const res = await fetch(fileLink.toString());
      if (!res.ok) throw new MediaNotFoundError(`Failed to download voice file: HTTP ${res.status}`);
      await fs.writeFile(rawPath, Buffer.from(await res.arrayBuffer()));

      const clipPath = path.join(tmpDir, 'clip.mp3');
      await ffmpegService.trimToClip(rawPath, clipPath, 15);

      const match = await recognitionService.recognize(clipPath);
      if (!match) {
        await edit('❌ Не удалось распознать трек. Попробуй более чёткую запись без посторонних шумов.');
        return;
      }

      const query = `${match.artist} ${match.title}`;
      await edit(`🎯 Похоже, это *${escapeMarkdown(query)}*. Скачиваю...`);

      const tracks = await musicSearchService.search(query, 1);
      const track = tracks[0];
      if (!track) throw new MediaNotFoundError(`No results for "${query}"`);

      await edit(stageText('download'));
      const result: DownloadResult = await musicSearchService.downloadTrackMp3(track, tmpDir);

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

      const delivery = await buildDeliveryActions(ctx, { title: result.title, sourceUrl: track.url, type: 'mp3' });
      const sent = await ctx.telegram.sendAudio(
        chatId,
        { source: result.filePath, filename: result.fileName },
        {
          caption,
          parse_mode: 'Markdown',
          title: result.title,
          duration: result.duration ? Math.round(result.duration) : undefined,
          thumbnail: result.thumbnailPath ? { source: result.thumbnailPath } : undefined,
          ...delivery.keyboard,
        },
      );
      await cacheAudioFileId(delivery.deliveredId, sent);
      await edit('✅ Готово!');

      await logDownload({ userId, url: track.url, type: 'mp3', status: 'success', fileSize: result.fileSize });
    } catch (err) {
      logger.error('Recognition failed', { err: (err as Error).message });
      await edit(toUserMessage(err));
      await logDownload({
        userId,
        url: 'recognize:voice',
        type: 'mp3',
        status: 'error',
        errorMessage: (err as Error).message.slice(0, 500),
      }).catch(() => undefined);
    } finally {
      await removeDir(tmpDir);
    }
  });
}
