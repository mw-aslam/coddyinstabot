import type { Context } from 'telegraf';
import { addWatch, listWatchesForChat, removeWatch } from '../database/watchedAccountRepository';
import { looksLikeUrl } from '../utils/validators';
import { logger } from '../utils/logger';

/** Pulls a display label out of a profile/channel URL, e.g. instagram.com/nasa -> "nasa". */
function labelFromUrl(url: string): string {
  const cleaned = url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const segments = cleaned.split('/');
  return segments[1] || segments[0] || url;
}

function commandArgs(ctx: Context): string {
  const message = ctx.message;
  if (!message || !('text' in message)) return '';
  return message.text.replace(/^\/\w+(@\w+)?\s*/, '').trim();
}

/** `/watch <instagram-or-youtube-profile-url> [label]` — auto-reposts new uploads into this chat. */
export async function watchCommand(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const args = commandArgs(ctx);
  const [url, ...labelParts] = args.split(/\s+/).filter(Boolean);

  if (!url || !looksLikeUrl(url)) {
    await ctx.reply(
      '📡 Использование: `/watch <ссылка на профиль/канал> [название]`\n' +
        'Например: `/watch https://www.youtube.com/@nasa` или `/watch https://www.instagram.com/nasa/`',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const label = labelParts.join(' ') || labelFromUrl(url);
  await addWatch(ctx.from.id, ctx.chat.id, url, label).catch((err) => {
    logger.error('Failed to add watch', { url, err: (err as Error).message });
    throw err;
  });
  await ctx.reply(`✅ Слежу за *${label}* — пришлю сюда новые посты автоматически.`, { parse_mode: 'Markdown' });
}

export async function watchListCommand(ctx: Context): Promise<void> {
  if (!ctx.chat) return;
  const watches = await listWatchesForChat(ctx.chat.id);
  if (watches.length === 0) {
    await ctx.reply('📡 В этом чате пока нет отслеживаемых аккаунтов. Добавь через /watch.');
    return;
  }
  const lines = watches.map((w) => `• \`${w.id}\` — ${w.label} (${w.profileUrl})`);
  await ctx.replyWithMarkdown(['📡 *Отслеживаемые аккаунты:*', '', ...lines, '', 'Удалить: `/unwatch <id>`'].join('\n'));
}

export async function unwatchCommand(ctx: Context): Promise<void> {
  if (!ctx.from) return;
  const args = commandArgs(ctx);
  const id = Number.parseInt(args, 10);
  if (!Number.isFinite(id)) {
    await ctx.reply('Использование: `/unwatch <id>` — id смотри в /watchlist.', { parse_mode: 'Markdown' });
    return;
  }
  const removed = await removeWatch(ctx.from.id, id);
  await ctx.reply(removed ? '🗑 Удалено.' : '⚠️ Не найдено — проверь id через /watchlist.');
}
