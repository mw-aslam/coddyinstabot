import { Markup } from 'telegraf';
import type { MusicTrack, QualityOption } from '../types';
import { formatDuration } from '../utils/formatters';

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

export function searchingText(query: string): string {
  return `🔍 Ищу «${escapeMarkdown(query)}»...`;
}

export const welcomeText = [
  '👋 *Добро пожаловать!*',
  '',
  'Я — бот для скачивания контента из Instagram и поиска музыки. Быстро, без рекламы, без лишних шагов.',
  '',
  '📥 *Пришли ссылку* на Reels, пост или видео —',
  'предложу скачать видео, MP3 или видео со звуком в нужном качестве.',
  '',
  '🎵 *Или просто напиши название трека* — например «Macan Черное платье» —',
  'найду его на YouTube и пришлю в MP3.',
  '',
  '👉 Попробуй прямо сейчас: отправь ссылку или название песни.',
].join('\n');

export const helpText = [
  '❓ *Как пользоваться ботом*',
  '',
  '*Скачивание из Instagram*',
  '1️⃣ Отправь ссылку на Reels, пост или видео.',
  '2️⃣ Выбери, что скачать: видео, MP3 или видео со звуком.',
  '3️⃣ При необходимости выбери качество.',
  '4️⃣ Дождись обработки — бот пришлёт готовый файл.',
  '',
  '*Поиск музыки*',
  '🎵 Напиши название трека или исполнителя текстом, без ссылки — найду на YouTube и пришлю MP3.',
  '💡 Для точного результата указывай исполнителя вместе с названием.',
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

export function trackPickerText(query: string, count: number): string {
  return [`🎵 Нашёл ${count} вариант(ов) для «${escapeMarkdown(query)}»:`, '', 'Выбери нужный:'].join('\n');
}

/** One button per candidate track — title truncated so the row stays readable. */
export function trackPickerKeyboard(sessionId: string, tracks: MusicTrack[]) {
  const rows = tracks.map((track, index) => {
    const label = `🎵 ${truncate(track.title, 40)}${track.duration ? ` (${formatDuration(track.duration)})` : ''}`;
    return [Markup.button.callback(label, `track:${sessionId}:${index}`)];
  });
  rows.push([Markup.button.callback('❌ Отмена', `track:${sessionId}:cancel`)]);
  return Markup.inlineKeyboard(rows);
}

/** Shown under a delivered video so the user can grab just the audio without resending the link. */
export function extractAudioKeyboard(sessionId: string) {
  return Markup.inlineKeyboard([[Markup.button.callback('🎵 Скачать только песню', `extractaudio:${sessionId}`)]]);
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
