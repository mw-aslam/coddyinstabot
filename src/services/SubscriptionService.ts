import { Markup } from 'telegraf';
import type { Telegram } from 'telegraf';
import { config } from '../config/config';
import { logger } from '../utils/logger';

const ACTIVE_STATUSES = new Set(['member', 'administrator', 'creator']);

/** True only if the user is a current member/admin/creator of every required channel. */
export async function isSubscribedToAll(telegram: Telegram, userId: number): Promise<boolean> {
  if (config.requiredChannels.length === 0) return true;

  for (const channel of config.requiredChannels) {
    try {
      const member = await telegram.getChatMember(channel, userId);
      if (!ACTIVE_STATUSES.has(member.status)) return false;
    } catch (err) {
      logger.warn('Subscription check failed (is the bot an admin in this channel?)', {
        channel,
        err: (err as Error).message,
      });
      return false;
    }
  }
  return true;
}

export const gateText = [
  '📢 Чтобы пользоваться ботом, подпишись на канал(ы) ниже.',
  '',
  'После подписки нажми «✅ Я подписался».',
].join('\n');

export function gateKeyboard() {
  const channelButtons = config.requiredChannels.map((channel) =>
    Markup.button.url(`📢 ${channel}`, `https://t.me/${channel.replace(/^@/, '')}`),
  );
  return Markup.inlineKeyboard([...channelButtons.map((b) => [b]), [Markup.button.callback('✅ Я подписался', 'check_subscription')]]);
}
