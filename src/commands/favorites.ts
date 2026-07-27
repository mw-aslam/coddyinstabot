import type { Context } from 'telegraf';
import { listFavorites } from '../database/favoriteRepository';
import { favoritesKeyboard, favoritesText } from '../services/UIService';

export async function favoritesCommand(ctx: Context): Promise<void> {
  if (!ctx.from) return;
  const rows = await listFavorites(ctx.from.id);
  await ctx.replyWithMarkdown(favoritesText(rows), rows.length > 0 ? favoritesKeyboard(rows) : undefined);
}
