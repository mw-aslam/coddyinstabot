import { Telegraf } from 'telegraf';
import { config } from './config/config';
import { loggerMiddleware } from './middlewares/loggerMiddleware';
import { registerErrorMiddleware } from './middlewares/errorMiddleware';
import { subscriptionMiddleware } from './middlewares/subscriptionMiddleware';
import { startCommand } from './commands/start';
import { helpCommand } from './commands/help';
import { statsCommand } from './commands/stats';
import { favoritesCommand } from './commands/favorites';
import { topCommand } from './commands/top';
import { unwatchCommand, watchCommand, watchListCommand } from './commands/watch';
import { linkHandler } from './handlers/linkHandler';
import { callbackHandler } from './handlers/callbackHandler';
import { recognizeHandler } from './handlers/recognizeHandler';
import { inlineHandler } from './handlers/inlineHandler';
import { isSubscribedToAll } from './services/SubscriptionService';
import { logger } from './utils/logger';

export const BOT_COMMANDS = [
  { command: 'start', description: 'Запустить бота и показать главное меню' },
  { command: 'help', description: 'Инструкция и помощь по использованию бота' },
  { command: 'favorites', description: 'Моё избранное (сохранённые медиа)' },
  { command: 'top', description: 'Топ самых популярных скачиваний' },
  { command: 'watch', description: 'Отслеживать новые посты аккаунта' },
  { command: 'watchlist', description: 'Список отслеживаемых аккаунтов' },
  { command: 'unwatch', description: 'Удалить аккаунт из отслеживания' },
  { command: 'stats', description: 'Статистика бота (для админов)' },
];

export async function setupBotCommands(bot: Telegraf): Promise<void> {
  try {
    await bot.telegram.setMyCommands(BOT_COMMANDS);
    logger.info('Bot commands registered successfully in Russian');
  } catch (err) {
    logger.error('Failed to set bot commands', { err: (err as Error).message });
  }
}

export function createBot(): Telegraf {
  const bot = new Telegraf(
    config.botToken,
    config.telegramApiRoot ? { telegram: { apiRoot: config.telegramApiRoot } } : undefined,
  );

  bot.use(loggerMiddleware);
  registerErrorMiddleware(bot);

  bot.action('check_subscription', async (ctx) => {
    if (!ctx.from) return;
    const subscribed = await isSubscribedToAll(ctx.telegram, ctx.from.id);
    if (subscribed) {
      await ctx.answerCbQuery('✅ Спасибо за подписку!');
      await ctx.deleteMessage().catch(() => undefined);
      await ctx.reply('✅ Подписка подтверждена. Пришли ссылку на Instagram, чтобы начать.');
    } else {
      await ctx.answerCbQuery('❌ Подписка не найдена. Подпишись и попробуй снова.', { show_alert: true });
    }
  });

  bot.use(subscriptionMiddleware);

  bot.start(startCommand);
  bot.help(helpCommand);
  bot.command('stats', statsCommand);
  bot.command('favorites', favoritesCommand);
  bot.command('top', topCommand);
  bot.command('watch', watchCommand);
  bot.command('watchlist', watchListCommand);
  bot.command('unwatch', unwatchCommand);

  bot.on('text', linkHandler);
  bot.on(['voice', 'audio', 'video_note'], recognizeHandler);
  bot.on('callback_query', callbackHandler);
  bot.on('inline_query', inlineHandler);

  return bot;
}
