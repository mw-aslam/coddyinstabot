import type { Context } from 'telegraf';
import { countFavorites, listFavorites } from '../database/favoriteRepository';
import { FAVORITES_PAGE_SIZE, favoritesKeyboard, favoritesText } from '../services/UIService';

export async function favoritesCommand(ctx: Context): Promise<void> {
  if (!ctx.from) return;
  const [rows, total] = await Promise.all([
    listFavorites(ctx.from.id, FAVORITES_PAGE_SIZE, 0),
    countFavorites(ctx.from.id),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / FAVORITES_PAGE_SIZE));
  await ctx.replyWithMarkdown(
    favoritesText(rows, 1, totalPages),
    rows.length > 0 ? favoritesKeyboard(rows, 1, totalPages) : undefined,
  );
}
