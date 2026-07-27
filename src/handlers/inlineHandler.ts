import type { Context } from 'telegraf';
import { searchDeliveredAudio } from '../database/deliveredItemRepository';
import { logger } from '../utils/logger';

/**
 * Answers an inline query (`@bot query` typed in any chat) with previously-downloaded tracks
 * whose Telegram file_id we already cached — the only way to return audio instantly, since
 * Telegram's ~10s inline-query budget is far too short to run a fresh yt-dlp download.
 */
export async function inlineHandler(ctx: Context): Promise<void> {
  const query = ctx.inlineQuery?.query?.trim();
  if (!query) {
    await ctx.answerInlineQuery([], { cache_time: 0 }).catch(() => undefined);
    return;
  }

  try {
    const matches = await searchDeliveredAudio(query, 20);
    const results = matches.map((track) => ({
      type: 'audio' as const,
      id: track.id,
      audio_file_id: track.fileId,
    }));

    await ctx.answerInlineQuery(results, { cache_time: 30, is_personal: false });
  } catch (err) {
    logger.error('Inline query failed', { query, err: (err as Error).message });
    await ctx.answerInlineQuery([]).catch(() => undefined);
  }
}
