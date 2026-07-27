import type { MiddlewareFn } from 'telegraf';
import { logger } from '../utils/logger';

/** Logs every incoming update with basic timing, without leaking payloads. */
export const loggerMiddleware: MiddlewareFn<any> = async (ctx, next) => {
  const start = Date.now();
  const from = ctx.from ? `${ctx.from.id}${ctx.from.username ? ` (@${ctx.from.username})` : ''}` : 'unknown';
  await next();
  logger.info('Update handled', {
    updateType: ctx.updateType,
    from,
    ms: Date.now() - start,
  });
};
