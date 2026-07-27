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
`;

/** Creates the schema if it doesn't exist yet. Safe to run on every startup. */
export async function runMigrations(): Promise<void> {
  await pool.query(MIGRATIONS);
  logger.info('Database migrations applied');
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
