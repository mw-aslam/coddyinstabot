import type { Context } from 'telegraf';
import { upsertUser } from '../database/userRepository';
import { persistentMenuKeyboard, welcomeText } from '../services/UIService';
import { logger } from '../utils/logger';

export async function startCommand(ctx: Context): Promise<void> {
  if (ctx.from) {
    await upsertUser({ id: ctx.from.id, username: ctx.from.username, firstName: ctx.from.first_name }).catch((err) =>
      logger.error('Failed to upsert user', { err: (err as Error).message }),
    );
  }

  await ctx.replyWithMarkdown(welcomeText, persistentMenuKeyboard());
}
