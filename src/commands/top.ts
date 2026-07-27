import type { Context } from 'telegraf';
import { getTopQueries } from '../database/statsRepository';
import { topText } from '../services/UIService';

export async function topCommand(ctx: Context): Promise<void> {
  const rows = await getTopQueries();
  await ctx.replyWithMarkdown(topText(rows));
}
