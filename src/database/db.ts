import { Pool } from 'pg';
import { config } from '../config/config';
import { logger } from '../utils/logger';

export const pool = config.database.connectionString
  ? new Pool({ connectionString: config.database.connectionString })
  : new Pool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
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

  CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
`;

/** Creates the schema if it doesn't exist yet. Safe to run on every startup. */
export async function runMigrations(): Promise<void> {
  await pool.query(MIGRATIONS);
  logger.info('Database migrations applied');
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
