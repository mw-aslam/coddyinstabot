import { Markup } from 'telegraf';
import type { DownloadType, MusicTrack, QualityOption } from '../types';
import { formatDuration, formatFileSize, MAX_TRIM_DURATION_SECONDS } from '../utils/formatters';
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
  'Я — бот для скачивания видео из *Instagram и YouTube* и поиска музыки. Быстро, без рекламы, без лишних шагов.',
  '',
  '📥 *Пришли ссылку* на Reels, пост, YouTube-видео или Shorts —',
  'предложу скачать видео, MP3 или видео со звуком в нужном качестве.',
  '',
  '🎵 *Или просто напиши название трека* — например «Macan Черное платье» —',
  'найду его на YouTube и пришлю в MP3.',
  '',
  '🎧 *Или пришли голосовое* с играющей песней — распознаю и найду трек.',
  '',
  '👉 Попробуй прямо сейчас: отправь ссылку или название песни.',
].join('\n');

export const helpText = [
  '❓ *Как пользоваться ботом*',
  '',
  '*Скачивание* (Instagram / YouTube)',
  '1️⃣ Отправь ссылку на видео/Reels/пост/Shorts.',
  '2️⃣ Выбери, что скачать: видео, MP3 или видео со звуком.',
  '3️⃣ При необходимости выбери качество.',
  '4️⃣ Дождись обработки — бот пришлёт готовый файл.',
  '',
  '*Музыка*',
  '🎵 Напиши название трека или исполнителя текстом, без ссылки — найду на YouTube и пришлю MP3.',
  '🎧 Или пришли голосовое/аудио с играющей песней — распознаю и найду трек.',
  '💡 Для точного результата указывай исполнителя вместе с названием.',
  '',
  '*Полезное*',
  '❤️ Кнопка «Сохранить» под файлом добавляет его в Избранное (кнопка снизу).',
  '↪️ Чтобы поделиться файлом с другом — просто перешли сообщение (кнопка Telegram).',
  '🎞 Под видео есть кнопки GIF и «Обрезать», под MP3 — «Текст песни».',
  '🔥 /top — самые популярные запросы за последние 7 дней.',
  '📡 /watch <ссылка> — авто-репост новых постов аккаунта в этот чат. /watchlist, /unwatch <id>.',
  '',
  '⚙️ Одновременно можно запустить не более 2 загрузок — остальные встанут в очередь.',
].join('\n');

/** Persistent bottom keyboard — stays visible across the whole chat, no commands to remember. */
export function persistentMenuKeyboard() {
  return Markup.keyboard([['❤️ Избранное', '❓ Помощь']]).resize();
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
  type: DownloadType;
  /** Present only for Instagram video/videoaudio results — offers a one-tap "just the song" button. */
  extractSessionId?: string;
}

/**
 * Action row(s) attached under every delivered file: extract audio, GIF/trim (video), lyrics
 * (mp3), save. Sharing itself is left to Telegram's native "forward" — it already sends the
 * real file, no custom deep link needed.
 */
export function resultActionsKeyboard(opts: ResultActionsOptions) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  if (opts.extractSessionId) {
    rows.push([Markup.button.callback('🎵 Скачать только песню', `extractaudio:${opts.extractSessionId}`)]);
  }
  if (opts.type !== 'mp3') {
    rows.push([
      Markup.button.callback('🎞 GIF', `gif:${opts.deliveredId}`),
      Markup.button.callback('✂️ Обрезать', `trim:${opts.deliveredId}`),
    ]);
  } else {
    rows.push([Markup.button.callback('📝 Текст песни', `lyrics:${opts.deliveredId}`)]);
  }
  rows.push([Markup.button.callback('❤️ Сохранить', `save:${opts.deliveredId}`)]);
  return Markup.inlineKeyboard(rows);
}

/** Prompt shown after "✂️ Обрезать" is tapped — asks for the time range as plain text. */
export function trimPromptText(): string {
  return [
    '✂️ Укажи начало и конец, например `0:10-0:40` (можно и просто `10-40`, через пробел или "до").',
    `Максимум ${MAX_TRIM_DURATION_SECONDS} секунд за раз.`,
  ].join('\n');
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

/** Favorites are paginated so long lists don't blow past Telegram's keyboard size limits. */
export const FAVORITES_PAGE_SIZE = 5;

export function favoritesText(rows: FavoriteRow[], page: number, totalPages: number): string {
  if (rows.length === 0 && page <= 1) {
    return '❤️ У тебя пока нет сохранённых треков/видео. Сохраняй их кнопкой «❤️ Сохранить» под результатом.';
  }
  const lines = ['❤️ *Твоё избранное*', '', 'Нажми на название, чтобы скачать заново, или 🗑 чтобы удалить:'];
  if (totalPages > 1) lines.push('', `Страница ${page} из ${totalPages}`);
  return lines.join('\n');
}

export function favoritesKeyboard(rows: FavoriteRow[], page: number, totalPages: number) {
  // Telegram caps inline button text at 64 chars; 58 leaves room for the "🎬 "/"🎵 " prefix.
  const buttons = rows.map((row) => [
    Markup.button.callback(`${row.type === 'mp3' ? '🎵' : '🎬'} ${truncate(row.title, 58)}`, `fav:${row.id}`),
    Markup.button.callback('🗑', `favdel:${row.id}:${page}`),
  ]);
  if (totalPages > 1) {
    const navRow = [];
    if (page > 1) navRow.push(Markup.button.callback('◀️', `favpage:${page - 1}`));
    navRow.push(Markup.button.callback(`${page}/${totalPages}`, 'fav:noop'));
    if (page < totalPages) navRow.push(Markup.button.callback('▶️', `favpage:${page + 1}`));
    buttons.push(navRow);
  }
  buttons.push([Markup.button.callback('❌ Закрыть', 'fav:cancel')]);
  return Markup.inlineKeyboard(buttons);
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

const GENERIC_TITLE_PATTERN = /^(video|photo|reel)\s+by\s+(.+)$/i;

/**
 * Instagram posts with no caption get a generic yt-dlp title like "Video by masterkind0" —
 * shown as-is that reads as broken/ugly. Swap it for the creator's name instead, which (unlike
 * the bot's own static name) still tells entries apart in the Favorites list, which reuses this
 * same title. Falls back to the bot's name only if even the creator is unknown.
 */
export function prettifyInstagramTitle(
  rawTitle: string,
  uploader: string | undefined,
  botName: string,
): { title: string; author?: string } {
  const match = rawTitle.match(GENERIC_TITLE_PATTERN);
  if (match) {
    const author = uploader ?? match[2].trim();
    return { title: author || botName, author };
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
    result.author && result.author !== result.title ? `👤 Автор: ${escapeMarkdown(result.author)}` : undefined,
    `📏 Размер: ${formatFileSize(result.fileSize)}`,
    result.height ? `🎬 Разрешение: ${result.width ?? '?'}x${result.height}` : undefined,
    result.height ? `📊 Качество: ${result.height}p` : undefined,
    `⏱ Длительность: ${formatDuration(result.duration)}`,
  ]
    .filter(Boolean)
    .join('\n');
}
