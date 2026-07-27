# Instagram Downloader Telegram Bot

Telegram-бот на TypeScript/Telegraf для скачивания видео из Instagram (Reels, посты, видео) —
как видео, как MP3 или как видео с гарантированной звуковой дорожкой, с выбором качества.

## Возможности

- Распознаёт ссылки Instagram и YouTube — один и тот же движок (`yt-dlp`) под капотом.
- Поиск музыки по названию: если сообщение не ссылка, бот ищет трек (через `ytsearch`) и
  сразу присылает его в MP3, без меню.
- Меню: 🎥 Видео / 🎵 MP3 / 📹 Видео + звук / ❌ Отмена.
- Выбор качества: 360p / 480p / 720p / 1080p (если доступно) / лучшее.
- Конвертация в MP3 и склейка видео+аудио через FFmpeg (с фолбэком, если у выбранного
  формата не оказалось звука).
- Один статусный месседж, который редактируется по стадиям: анализ → скачивание →
  конвертация → отправка.
- Понятные сообщения об ошибках (приватный аккаунт, видео удалено, файл слишком большой,
  сеть/таймаут).
- Очередь на пользователя: не более `MAX_CONCURRENT_DOWNLOADS_PER_USER` (по умолчанию 2)
  одновременных загрузок, остальное — в очередь.
- История загрузок и пользователи — в PostgreSQL.
- Логирование в консоль и файлы (`logs/combined.log`, `logs/error.log`) через winston.
- Опциональная обязательная подписка на канал(ы) перед использованием бота (`REQUIRED_CHANNELS`).
- Обложка (превью) у отправляемых видео/аудио, если у источника есть миниатюра.
- «🎵 Скачать только песню» — кнопка под присланным Instagram-видео, докачивает звук отдельно.
- ❤️ «Сохранить» — добавляет файл в `/favorites`; 🔁 «Поделиться» — диплинк, по которому
  любой получит тот же файл без поиска заново.
- `/top` — самые популярные запросы за 7 дней.
- `/stats` — статистика бота (только для `ADMIN_IDS`).
- 🎧 Распознавание музыки: пришли голосовое/аудио/видеосообщение — бот определит трек через
  AudD.io и пришлёт его в MP3 (нужен `AUDD_API_KEY`).
- Inline-режим (`@бот запрос` в любом чате) — мгновенно отдаёт уже скачанные раньше треки из
  кэша. Для совсем новых запросов не подходит физически (Telegram даёт ~10 сек на ответ, а
  скачивание дольше) — для них по-прежнему нужно писать боту напрямую.

## Структура проекта

```
src/
  commands/     — /start, /help
  handlers/     — обработка текстовых сообщений и inline-кнопок
  services/     — InstagramDownloader, FfmpegService, QueueService, SessionService, UIService
  middlewares/  — логирование, глобальная обработка ошибок
  config/       — чтение .env
  database/     — pg pool, миграции, репозитории
  utils/        — логгер, ошибки, валидаторы, форматтеры, работа с файлами
  types/        — общие типы
```

## Требования

| Инструмент | Зачем | Проверить |
|---|---|---|
| Node.js ≥ 18 | сам бот | `node -v` |
| yt-dlp | скачивание из Instagram | `yt-dlp --version` |
| ffmpeg / ffprobe | конвертация в MP3, склейка видео+аудио, метаданные | `ffmpeg -version` |
| PostgreSQL | пользователи и история загрузок | `psql --version` |

### Установка yt-dlp и ffmpeg

**Windows (winget):**
```powershell
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
```

**macOS:**
```bash
brew install yt-dlp ffmpeg
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt-get install ffmpeg
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

После установки **перезапустите терминал**, чтобы обновлённый PATH подхватился. Если бинарники
не на PATH (или их несколько версий), укажите точный путь в `.env` через `YTDLP_PATH` /
`FFMPEG_PATH` / `FFPROBE_PATH`.

## Настройка

1. Скопируйте `.env.example` в `.env` и заполните:
   - `BOT_TOKEN` — токен от [@BotFather](https://t.me/BotFather).
   - `DATABASE_URL` (или `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`) — доступ к PostgreSQL.
   - При необходимости — пути к бинарникам и лимиты загрузок.
   - `REQUIRED_CHANNELS` — необязательно; список `@username` каналов через запятую, подписка на
     которые обязательна перед использованием бота. Пусто по умолчанию (фича выключена). Бот
     должен быть администратором в каждом из перечисленных каналов, иначе проверка подписки
     всегда будет проваливаться.
   - `ADMIN_IDS` — необязательно; список Telegram user id через запятую, кому доступна команда
     `/stats`. Свой id можно узнать, например, у @userinfobot.
   - `AUDD_API_KEY` — необязательно; токен с [dashboard.audd.io](https://dashboard.audd.io),
     включает распознавание музыки по голосовым/аудио. Пусто — фича молча выключена.

   Чтобы заработал inline-режим (`@бот запрос` в любом чате), включите его один раз через
   [@BotFather](https://t.me/BotFather) → выберите бота → *Bot Settings → Inline Mode → Turn on*.

   **Файлы больше 50 МБ (до 2 ГБ).** Telegram's cloud Bot API отдаёт максимум 50 МБ, это
   ограничение самого Telegram, не настройки бота. Чтобы поднять лимит до 2 ГБ, нужен свой
   локальный Bot API сервер:
   1. Получите `api_id`/`api_hash` на [my.telegram.org](https://my.telegram.org) → *API development tools*.
   2. Локально (без Docker Compose): `docker run -d --name telegram-bot-api -p 8081:8081 -e TELEGRAM_API_ID=... -e TELEGRAM_API_HASH=... -e TELEGRAM_LOCAL=true -v telegram-bot-api-data:/var/lib/telegram-bot-api aiogram/telegram-bot-api:latest`
      (в полном `docker compose up` эта служба уже включена как `bot-api`).
   3. В `.env` впишите `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` и `TELEGRAM_API_ROOT=http://localhost:8081`.
      `MAX_FILE_SIZE_MB` при этом сам по умолчанию поднимется до 2000, если явно не задан.

2. Создайте базу данных (если её ещё нет):
   ```sql
   CREATE DATABASE instabot;
   ```
   Таблицы (`users`, `downloads`) бот создаёт сам при старте (миграции идемпотентны).

   > ⚠️ Если у вас уже установлен локальный PostgreSQL (например, как служба Windows), он,
   > скорее всего, тоже слушает порт 5432. В этом случае либо используйте его напрямую
   > (создав в нём базу `instabot`), либо поменяйте порт Postgres-контейнера в
   > `docker-compose.yml` (например, на `5433:5432`) и обновите `DATABASE_URL`.

## Запуск локально (npm)

```bash
npm install
npm run dev
```

`npm run dev` поднимает бота через `ts-node-dev` с автоперезапуском при изменении файлов.
Для продакшен-сборки:

```bash
npm run build
npm start
```

При старте бот сам проверяет наличие `yt-dlp`/`ffmpeg`/`ffprobe` и пишет предупреждение в лог,
если чего-то не хватает — но не падает, чтобы `/start` и `/help` работали в любом случае.

## Запуск через Docker

Полностью в контейнерах (бот + PostgreSQL, yt-dlp и ffmpeg уже внутри образа):

```bash
docker compose up -d --build
```

Только база данных в Docker, а бот — локально через `npm run dev`:

```bash
docker compose up -d postgres
npm run dev
```

## Деплой на Render.com (бесплатно, без карты)

1. Зарегистрируйтесь на [render.com](https://render.com) через GitHub — карта не нужна.
2. **New +** → **Blueprint** → выберите этот репозиторий. Render прочитает `render.yaml` и сам
   создаст веб-сервис (из `Dockerfile`) и бесплатную базу PostgreSQL.
3. Когда попросит — заполните секретные переменные: `BOT_TOKEN`, `AUDD_API_KEY` (опционально),
   `REQUIRED_CHANNELS` (опционально), `ADMIN_IDS` (опционально).
4. После деплоя скопируйте URL сервиса (вида `https://coddyinstabot.onrender.com`).
5. В настройках GitHub-репозитория: **Settings → Secrets and variables → Actions → Variables**
   → добавьте `RENDER_APP_URL` со значением этого URL. Это нужно, чтобы workflow
   `.github/workflows/keep-alive.yml` пинговал сервис каждые 10 минут и не давал ему "заснуть"
   (бесплatный план Render засыпает после ~15 минут без запросов).

> ⚠️ Бесплатная PostgreSQL на Render живёт 90 дней, потом Render попросит пересоздать базу
> (данные при этом теряются, если не сделать бэкап заранее).

## Ограничения

- Telegram Bot API принимает файлы до **50 МБ** через обычную отправку — при превышении бот
  попросит выбрать качество ниже (лимит настраивается через `MAX_FILE_SIZE_MB`).
- Приватные аккаунты недоступны для скачивания — Instagram их не отдаёт анонимно.
- Каждый пользователь может держать не более `MAX_CONCURRENT_DOWNLOADS_PER_USER` активных
  загрузок одновременно; остальные становятся в очередь и стартуют по мере освобождения слотов.

## Как это работает вкратце

1. `linkHandler` находит Instagram-ссылку в тексте, шлёт `⏳ Анализ ссылки...` и вызывает
   `InstagramDownloader.analyze()` (`yt-dlp -j`), затем редактирует это же сообщение в меню.
2. `callbackHandler` обрабатывает нажатия: выбор типа → (для видео) выбор качества →
   `QueueService.run()` ставит задачу в очередь пользователя и выполняет скачивание.
3. `InstagramDownloader` качает нужный формат через `yt-dlp -f ...`; если для варианта
   "видео + звук" итоговый файл оказался без звука, отдельно докачивает лучший аудиопоток и
   склеивает через `FfmpegService.mergeVideoAudio` (`ffmpeg -c:v copy -c:a aac`). Для MP3 —
   качает `bestaudio` и конвертирует через `FfmpegService.convertToMp3` (`libmp3lame`).
4. Итоговый файл проверяется через `ffprobe` (разрешение/длительность), при превышении лимита
   размера — понятная ошибка. Файл отправляется, статусное сообщение обновляется на `✅ Готово!`,
   временная папка удаляется, запись пишется в таблицу `downloads`.

## Логи

- `logs/combined.log` — все события.
- `logs/error.log` — только ошибки.
- Уровень логирования — `LOG_LEVEL` в `.env` (`debug`/`info`/`warn`/`error`).
