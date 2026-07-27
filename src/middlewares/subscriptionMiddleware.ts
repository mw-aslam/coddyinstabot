import type { MiddlewareFn } from 'telegraf';
import { config } from '../config/config';
import { gateKeyboard, gateText, isSubscribedToAll } from '../services/SubscriptionService';

/** Blocks every update behind a forced-subscription gate, unless the check itself is bypassing it. */
export const subscriptionMiddleware: MiddlewareFn<any> = async (ctx, next) => {
  if (config.requiredChannels.length === 0) return next();
  if (!ctx.from) return next();

  const isCheckButton =
    ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data === 'check_subscription';
  if (isCheckButton) return next();

  const subscribed = await isSubscribedToAll(ctx.telegram, ctx.from.id);
  if (subscribed) return next();

  await ctx.reply(gateText, gateKeyboard());
};
