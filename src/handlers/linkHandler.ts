import type { Context } from 'telegraf';
import { instagramDownloader } from '../services/InstagramDownloader';
import { sessionService } from '../services/SessionService';
import { mainMenuKeyboard, menuText, stageText } from '../services/UIService';
import { extractInstagramUrl, looksLikeUnsupportedInstagramLink } from '../utils/validators';
import { toUserMessage } from '../utils/errors';
import { logger } from '../utils/logger';
import { upsertUser } from '../database/userRepository';

/** Handles a plain-text message: looks for an Instagram link and, if found, analyzes it. */
export async function linkHandler(ctx: Context): Promise<void> {
  const message = ctx.message;
  if (!message || !('text' in message)) return;

  const text = message.text.trim();
  const url = extractInstagramUrl(text);

  if (!url) {
    if (looksLikeUnsupportedInstagramLink(text)) {
      await ctx.reply('🚫 Не удалось распознать ссылку. Отправьте ссылку вида instagram.com/reel/... или instagram.com/p/...');
    }
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
