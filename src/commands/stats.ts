import type { Context } from 'telegraf';
import { config } from '../config/config';
import { getOverviewStats } from '../database/statsRepository';
import { statsText } from '../services/UIService';

export async function statsCommand(ctx: Context): Promise<void> {
  if (!ctx.from || !config.adminIds.includes(ctx.from.id)) {
    await ctx.reply('🚫 Команда доступна только администратору.');
    return;
  }
  const stats = await getOverviewStats();
  await ctx.replyWithMarkdown(statsText(stats));
}
