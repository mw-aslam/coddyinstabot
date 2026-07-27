import { Markup } from 'telegraf';
import type { MusicTrack, QualityOption } from '../types';
import { formatDuration, formatFileSize } from '../utils/formatters';
import type { OverviewStats, TopQueryRow } from '../database/statsRepository';
import type { FavoriteRow } from '../database/favoriteRepository';

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
  '*Полезные команды*',
  '❤️ Кнопка «Сохранить» под файлом добавляет его в /favorites.',
  '🔁 Кнопка «Поделиться» даёт ссылку, по которой друг сразу получит тот же файл.',
  '🔥 /top — самые популярные запросы за неделю.',
  '',
  `⚠️ Ограничение Telegram: файл не может быть больше 50 МБ.`,
  '⚙️ Одновременно можно запустить не более 2 загрузок — остальные встанут в очередь.',
].join('\n');

/** Quick-access row under the welcome message so common commands don't require typing. */
export function quickNavKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔥 Топ', 'nav:top'), Markup.button.callback('❤️ Избранное', 'nav:favorites')],
    [Markup.button.callback('❓ Помощь', 'nav:help')],
  ]);
}

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

interface ResultActionsOptions {
  deliveredId: string;
  /** Present only for Instagram video/videoaudio results — offers a one-tap "just the song" button. */
  extractSessionId?: string;
}

/**
 * Action row(s) attached under every delivered file: extract audio, save.
 * Sharing itself is left to Telegram's native "forward" — it already sends the real file,
 * no custom deep link needed.
 */
export function resultActionsKeyboard(opts: ResultActionsOptions) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  if (opts.extractSessionId) {
    rows.push([Markup.button.callback('🎵 Скачать только песню', `extractaudio:${opts.extractSessionId}`)]);
  }
  rows.push([Markup.button.callback('❤️ Сохранить', `save:${opts.deliveredId}`)]);
  return Markup.inlineKeyboard(rows);
}

export function statsText(stats: OverviewStats): string {
  const byType = Object.entries(stats.byType)
    .map(([type, count]) => `   • ${type}: ${count}`)
    .join('\n');
  return [
    '📊 *Статистика бота*',
    '',
    `👤 Пользователей: ${stats.totalUsers}`,
    `📥 Всего загрузок: ${stats.totalDownloads}`,
    `✅ Успешных: ${stats.successCount}`,
    `❌ С ошибкой: ${stats.errorCount}`,
    '',
    '*По типам:*',
    byType || '   —',
  ].join('\n');
}

export function topText(rows: TopQueryRow[]): string {
  if (rows.length === 0) return '📈 За последние 7 дней запросов ещё не было.';
  const lines = rows.map((r, i) => `${i + 1}. ${escapeMarkdown(truncate(r.title, 60))} — ${r.count}x`);
  return ['🔥 *Топ за 7 дней*', '', ...lines].join('\n');
}

export function favoritesText(rows: FavoriteRow[]): string {
  if (rows.length === 0) return '❤️ У тебя пока нет сохранённых треков/видео. Сохраняй их кнопкой «❤️ Сохранить» под результатом.';
  return ['❤️ *Твоё избранное*', '', 'Нажми, чтобы скачать заново:'].join('\n');
}

export function favoritesKeyboard(rows: FavoriteRow[]) {
  const buttons = rows.map((row) => [
    Markup.button.callback(`${row.type === 'mp3' ? '🎵' : '🎬'} ${truncate(row.title, 45)}`, `fav:${row.id}`),
  ]);
  return Markup.inlineKeyboard(buttons);
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

const GENERIC_TITLE_PATTERN = /^(video|photo|reel)\s+by\s+(.+)$/i;

/**
 * Instagram posts with no caption get a generic yt-dlp title like "Video by masterkind0" —
 * shown as-is that reads as broken/ugly. Swap it for the bot's own name and keep the creator
 * as a separate, clearly-labelled author line instead.
 */
export function prettifyInstagramTitle(
  rawTitle: string,
  uploader: string | undefined,
  botName: string,
): { title: string; author?: string } {
  const match = rawTitle.match(GENERIC_TITLE_PATTERN);
  if (match) {
    return { title: botName, author: uploader ?? match[2].trim() };
  }
  return { title: rawTitle, author: uploader };
}

interface ResultCaptionInput {
  title: string;
  author?: string;
  fileSize: number;
  width?: number;
  height?: number;
  duration?: number;
}

/** The single caption format used under every delivered video/audio, wherever it's sent from. */
export function buildResultCaption(result: ResultCaptionInput): string {
  return [
    `✅ *${escapeMarkdown(result.title)}*`,
    result.author ? `👤 Автор: ${escapeMarkdown(result.author)}` : undefined,
    `📏 Размер: ${formatFileSize(result.fileSize)}`,
    result.height ? `🎬 Разрешение: ${result.width ?? '?'}x${result.height}` : undefined,
    `⏱ Длительность: ${formatDuration(result.duration)}`,
  ]
    .filter(Boolean)
    .join('\n');
}
