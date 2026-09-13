import { Pool } from 'pg';
import { config } from '../config/config';
import { logger } from '../utils/logger';

// Managed Postgres (Render, Railway, etc.) requires SSL; local/self-hosted Postgres typically doesn't.
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;

export const pool = config.database.connectionString
  ? new Pool({ connectionString: config.database.connectionString, ssl })
  : new Pool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
      ssl,
    });

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', { err: err.message });
});

const MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS downloads (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    type TEXT NOT NULL,
    quality TEXT,
    status TEXT NOT NULL,
    file_size BIGINT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_downloads_user_id ON downloads(user_id);

  -- One row per successfully delivered file: backs the "save to favorites" and
  -- "share via deep link" buttons attached to sent results, and (once file_id is set)
  -- lets inline-mode queries return an already-uploaded track instantly.
  CREATE TABLE IF NOT EXISTS delivered_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_url TEXT NOT NULL,
    type TEXT NOT NULL,
    file_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  ALTER TABLE delivered_items ADD COLUMN IF NOT EXISTS file_id TEXT;
  ALTER TABLE delivered_items ADD COLUMN IF NOT EXISTS author TEXT;

  CREATE INDEX IF NOT EXISTS idx_delivered_items_title ON delivered_items (title text_pattern_ops);

  CREATE TABLE IF NOT EXISTS favorites (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source_url TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, source_url)
  );

  ALTER TABLE favorites ADD COLUMN IF NOT EXISTS author TEXT;

  CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);

  -- Instagram/YouTube accounts to auto-repost from when they publish something new. chat_id is
  -- where the repost is sent (a group/channel if /watch was run there, otherwise the user's DM);
  -- user_id is who set it up, for /unwatch and per-user listing.
  CREATE TABLE IF NOT EXISTS watched_accounts (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_url TEXT NOT NULL,
    label TEXT NOT NULL,
    last_seen_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, profile_url)
  );

  ALTER TABLE watched_accounts ADD COLUMN IF NOT EXISTS chat_id BIGINT;
  UPDATE watched_accounts SET chat_id = user_id WHERE chat_id IS NULL;
  ALTER TABLE watched_accounts ALTER COLUMN chat_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_watched_accounts_user_id ON watched_accounts(user_id);
  CREATE INDEX IF NOT EXISTS idx_watched_accounts_chat_id ON watched_accounts(chat_id);
`;

/** Creates the schema if it doesn't exist yet. Safe to run on every startup. */
export async function runMigrations(): Promise<void> {
  await pool.query(MIGRATIONS);
  logger.info('Database migrations applied');
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
