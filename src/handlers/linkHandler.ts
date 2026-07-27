import type { Context } from 'telegraf';
import { instagramDownloader } from '../services/InstagramDownloader';
import { sessionService } from '../services/SessionService';
import { mainMenuKeyboard, menuText, stageText } from '../services/UIService';
import {
  extractInstagramUrl,
  extractYouTubeUrl,
  looksLikeUnsupportedInstagramLink,
  looksLikeUrl,
} from '../utils/validators';
import { toUserMessage } from '../utils/errors';
import { logger } from '../utils/logger';
import { upsertUser } from '../database/userRepository';
import { musicSearchHandler } from './musicHandler';
import { favoritesCommand } from '../commands/favorites';
import { helpCommand } from '../commands/help';

const MAX_SEARCH_QUERY_LENGTH = 200;

/** Text sent by the persistent bottom keyboard's buttons — handled here since they arrive as plain text. */
const MENU_BUTTON_HANDLERS: Record<string, (ctx: Context) => Promise<void>> = {
  '❤️ Избранное': favoritesCommand,
  '❓ Помощь': helpCommand,
};

/**
 * Handles a plain-text message: an Instagram/YouTube link goes through the
 * analyze+menu flow (yt-dlp supports both the same way), anything else that isn't
 * a link is treated as a song/artist search query.
 */
export async function linkHandler(ctx: Context): Promise<void> {
  const message = ctx.message;
  if (!message || !('text' in message)) return;

  const text = message.text.trim();

  const menuHandler = MENU_BUTTON_HANDLERS[text];
  if (menuHandler) {
    await menuHandler(ctx);
    return;
  }

  const url = extractInstagramUrl(text) ?? extractYouTubeUrl(text);

  if (!url) {
    if (looksLikeUnsupportedInstagramLink(text)) {
      await ctx.reply('🚫 Не удалось распознать ссылку. Отправьте ссылку вида instagram.com/reel/... или instagram.com/p/...');
      return;
    }
    if (text.startsWith('/') || looksLikeUrl(text) || text.length === 0 || text.length > MAX_SEARCH_QUERY_LENGTH) {
      return;
    }
    await musicSearchHandler(ctx, text);
    return;
  }

  if (!ctx.from || !ctx.chat) return;

  await upsertUser({ id: ctx.from.id, username: ctx.from.username, firstName: ctx.from.first_name }).catch((err) =>
    logger.error('Failed to upsert user', { err: (err as Error).message }),
  );

  const statusMessage = await ctx.reply(stageText('analyze'));

  const session = sessionService.create({
    userId: ctx.from.id,
    chatId: ctx.chat.id,
    statusMessageId: statusMessage.message_id,
    url,
  });

  try {
    const info = await instagramDownloader.analyze(url);
    sessionService.update(session.id, { info });

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      undefined,
      menuText(info.title),
      { parse_mode: 'Markdown', ...mainMenuKeyboard(session.id) },
    );
  } catch (err) {
    logger.error('Failed to analyze Instagram link', { url, err: (err as Error).message });
    sessionService.delete(session.id);
    await ctx.telegram
      .editMessageText(ctx.chat.id, statusMessage.message_id, undefined, toUserMessage(err))
      .catch(() => undefined);
  }
}
