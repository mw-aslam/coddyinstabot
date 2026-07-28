/**
 * Domain-specific error types. Every error that can reach a Telegram handler
 * carries a ready-to-send, human-friendly Russian message so handlers never
 * have to guess how to explain a failure to the user.
 */

export class AppError extends Error {
  public readonly userMessage: string;

  constructor(message: string, userMessage: string) {
    super(message);
    this.name = this.constructor.name;
    this.userMessage = userMessage;
  }
}

export class InvalidLinkError extends AppError {
  constructor(message = 'Invalid Instagram link') {
    super(message, '🚫 Это не похоже на ссылку Instagram.\nОтправьте ссылку на Reels, пост или видео вида instagram.com/reel/...');
  }
}

export class PrivateAccountError extends AppError {
  constructor(message = 'Private account') {
    super(message, '🔒 Этот аккаунт приватный. Скачать контент из закрытых аккаунтов невозможно.');
  }
}

export class MediaNotFoundError extends AppError {
  constructor(message = 'Media not found') {
    super(message, '❌ Видео не найдено. Возможно, оно было удалено или ссылка неверна.');
  }
}

export class AgeRestrictedError extends AppError {
  constructor(message = 'Age-restricted content') {
    super(message, '🔞 Этот трек/видео возрастное — YouTube требует подтверждение возраста, скачать его напрямую нельзя. Попробуйте другой результат или другой запрос.');
  }
}

export class FileTooLargeError extends AppError {
  constructor(sizeMb: number, limitMb: number) {
    super(
      `File too large: ${sizeMb}MB > ${limitMb}MB`,
      `📦 Файл слишком большой (${sizeMb.toFixed(1)} МБ). Telegram позволяет отправлять файлы до ${limitMb} МБ.\nПопробуйте выбрать более низкое качество.`,
    );
  }
}

export class NetworkError extends AppError {
  constructor(message = 'Network error') {
    super(message, '🌐 Ошибка сети при обращении к Instagram. Попробуйте ещё раз чуть позже.');
  }
}

export class TimeoutError extends AppError {
  constructor(message = 'Operation timed out') {
    super(message, '⏱ Превышено время ожидания. Instagram отвечает слишком долго, попробуйте позже.');
  }
}

export class DownloadError extends AppError {
  constructor(message = 'Download failed') {
    super(message, '⚠️ Не удалось скачать медиа. Попробуйте другую ссылку или повторите попытку позже.');
  }
}

export class BotCheckError extends AppError {
  constructor(message = 'YouTube bot check') {
    super(
      message,
      '🤖 YouTube временно просит подтвердить, что вы не бот. Попробуйте ещё раз через пару минут или другую ссылку.',
    );
  }
}

export class QueueBusyError extends AppError {
  constructor(message = 'Queue busy') {
    super(message, '⏳ Слишком много активных загрузок. Пожалуйста, подождите.');
  }
}

/** Resolves any thrown value into a user-facing Russian message. */
export function toUserMessage(err: unknown): string {
  if (err instanceof AppError) return err.userMessage;
  return '⚠️ Произошла непредвиденная ошибка. Попробуйте ещё раз позже.';
}
