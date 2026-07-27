import type { Context } from 'telegraf';
import { upsertUser } from '../database/userRepository';
import { getDeliveredItem } from '../database/deliveredItemRepository';
import { redeliverItem } from '../handlers/deliveryHandler';
import { welcomeText } from '../services/UIService';
import { logger } from '../utils/logger';

const DEEP_LINK_PREFIX = 't_';

export async function startCommand(ctx: Context): Promise<void> {
  if (ctx.from) {
    await upsertUser({ id: ctx.from.id, username: ctx.from.username, firstName: ctx.from.first_name }).catch((err) =>
      logger.error('Failed to upsert user', { err: (err as Error).message }),
    );
  }

  const payload = (ctx as unknown as { payload?: string }).payload;
  if (payload?.startsWith(DEEP_LINK_PREFIX)) {
    const item = await getDeliveredItem(payload.slice(DEEP_LINK_PREFIX.length));
    if (item) {
      await redeliverItem(ctx, item);
      return;
    }
    await ctx.reply('⌛ Эта ссылка устарела или файл больше не найден.');
    return;
  }

  await ctx.replyWithMarkdown(welcomeText);
}
