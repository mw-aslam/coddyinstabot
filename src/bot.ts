import { Telegraf } from 'telegraf';
import { config } from './config/config';
import { loggerMiddleware } from './middlewares/loggerMiddleware';
import { registerErrorMiddleware } from './middlewares/errorMiddleware';
import { subscriptionMiddleware } from './middlewares/subscriptionMiddleware';
import { startCommand } from './commands/start';
import { helpCommand } from './commands/help';
import { linkHandler } from './handlers/linkHandler';
import { callbackHandler } from './handlers/callbackHandler';
import { isSubscribedToAll } from './services/SubscriptionService';

export function createBot(): Telegraf {
  const bot = new Telegraf(config.botToken);

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

  bot.on('text', linkHandler);
  bot.on('callback_query', callbackHandler);

  return bot;
}
