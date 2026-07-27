import { Telegraf } from 'telegraf';
import { config } from './config/config';
import { loggerMiddleware } from './middlewares/loggerMiddleware';
import { registerErrorMiddleware } from './middlewares/errorMiddleware';
import { startCommand } from './commands/start';
import { helpCommand } from './commands/help';
import { linkHandler } from './handlers/linkHandler';
import { callbackHandler } from './handlers/callbackHandler';

export function createBot(): Telegraf {
  const bot = new Telegraf(config.botToken);

  bot.use(loggerMiddleware);
  registerErrorMiddleware(bot);

  bot.start(startCommand);
  bot.help(helpCommand);

  bot.on('text', linkHandler);
  bot.on('callback_query', callbackHandler);

  return bot;
}
