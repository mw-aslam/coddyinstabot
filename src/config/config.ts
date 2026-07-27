import 'dotenv/config';
import path from 'node:path';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const config = {
  botToken: required('BOT_TOKEN'),

  database: {
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST ?? 'localhost',
    port: int('PGPORT', 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'instabot',
  },

  binaries: {
    ytDlpPath: process.env.YTDLP_PATH ?? 'yt-dlp',
    ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
  },

  downloads: {
    maxConcurrentPerUser: int('MAX_CONCURRENT_DOWNLOADS_PER_USER', 2),
    maxFileSizeMb: int('MAX_FILE_SIZE_MB', 50),
    processTimeoutMs: int('PROCESS_TIMEOUT_MS', 300_000),
    tmpDir: path.resolve(process.cwd(), process.env.TMP_DIR ?? './downloads/tmp'),
  },

  logging: {
    level: process.env.LOG_LEVEL ?? 'info',
    dir: path.resolve(process.cwd(), process.env.LOG_DIR ?? './logs'),
  },

  // Comma-separated @usernames the bot requires users to subscribe to before use.
  // Empty by default (feature off). The bot must be an admin in every listed channel.
  requiredChannels: (process.env.REQUIRED_CHANNELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Comma-separated Telegram user IDs allowed to run admin-only commands (e.g. /stats).
  adminIds: (process.env.ADMIN_IDS ?? '')
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n)),
} as const;

export const MAX_FILE_SIZE_BYTES = config.downloads.maxFileSizeMb * 1024 * 1024;
