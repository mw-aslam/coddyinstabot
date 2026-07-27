import type { Telegraf } from 'telegraf';
import { logger } from '../utils/logger';
import { toUserMessage } from '../utils/errors';

/** Registers a catch-all handler so an unhandled error never crashes the bot process. */
export function registerErrorMiddleware(bot: Telegraf): void {
  bot.catch(async (err, ctx) => {
    logger.error('Unhandled error while processing update', {
      err: err instanceof Error ? err.stack : String(err),
      updateType: ctx.updateType,
    });
    try {
      await ctx.reply(toUserMessage(err));
    } catch (replyErr) {
      logger.error('Failed to notify user about error', { err: (replyErr as Error).message });
    }
  });
}
