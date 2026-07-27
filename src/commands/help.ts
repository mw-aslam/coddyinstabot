import type { Context } from 'telegraf';
import { helpText } from '../services/UIService';

export async function helpCommand(ctx: Context): Promise<void> {
  await ctx.replyWithMarkdown(helpText);
}
