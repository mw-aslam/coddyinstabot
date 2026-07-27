import { Markup } from 'telegraf';
import type { QualityOption } from '../types';

export type Stage = 'analyze' | 'download' | 'convert' | 'upload';

const STAGE_TEXT: Record<Stage, string> = {
  analyze: '⏳ Анализ ссылки...',
  download: '⬇️ Скачивание...',
  convert: '🎬 Конвертация...',
  upload: '📤 Отправка...',
};

export function stageText(stage: Stage): string {
  return STAGE_TEXT[stage];
}

export function queuedText(position: number): string {
  return `⏳ В очереди на загрузку (позиция: ${position}). Пожалуйста, подождите...`;
}

export const welcomeText = [
  '👋 Привет! Я скачиваю видео из *Instagram*.',
  '',
  'Просто отправь мне ссылку на:',
  '🎥 Reels',
  '📮 Пост',
  '📹 Видео',
  '',
  'И я предложу скачать видео, только звук (MP3) или видео со звуком в нужном качестве.',
].join('\n');

export const helpText = [
  '❓ *Как пользоваться ботом*',
  '',
  '1️⃣ Отправь ссылку на Instagram Reels/пост/видео.',
  '2️⃣ Выбери, что скачать: видео, MP3 или видео со звуком.',
  '3️⃣ При необходимости выбери качество.',
  '4️⃣ Дождись обработки — бот пришлёт готовый файл.',
  '',
  `⚠️ Ограничение Telegram: файл не может быть больше 50 МБ.`,
  '⚙️ Одновременно можно запустить не более 2 загрузок — остальные встанут в очередь.',
].join('\n');

export function menuText(title: string): string {
  return [`📎 *${escapeMarkdown(title)}*`, '', '📥 Что скачать?'].join('\n');
}

export function mainMenuKeyboard(sessionId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🎥 Видео', `type:${sessionId}:video`)],
    [Markup.button.callback('🎵 Только музыку (MP3)', `type:${sessionId}:mp3`)],
    [Markup.button.callback('📹 Видео + звук', `type:${sessionId}:videoaudio`)],
    [Markup.button.callback('❌ Отмена', `type:${sessionId}:cancel`)],
  ]);
}

const QUALITY_LABELS: Record<QualityOption, string> = {
  '360': '360p',
  '480': '480p',
  '720': '720p',
  '1080': '1080p',
  best: '⭐ Лучшее качество',
};

export function qualityText(): string {
  return '📥 Выберите качество видео:';
}

export function qualityKeyboard(sessionId: string, qualities: QualityOption[]) {
  const numeric = qualities.filter((q): q is Exclude<QualityOption, 'best'> => q !== 'best');
  const rows = numeric.map((q) => [Markup.button.callback(QUALITY_LABELS[q], `quality:${sessionId}:${q}`)]);
  if (qualities.includes('best')) {
    rows.push([Markup.button.callback(QUALITY_LABELS.best, `quality:${sessionId}:best`)]);
  }
  rows.push([Markup.button.callback('⬅️ Назад', `back:${sessionId}`)]);
  return Markup.inlineKeyboard(rows);
}

/** Escapes the handful of characters that break Telegram legacy Markdown parsing. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()`])/g, '\\$1');
}
