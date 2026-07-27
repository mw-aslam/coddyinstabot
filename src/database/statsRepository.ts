import { pool } from './db';

export interface OverviewStats {
  totalUsers: number;
  totalDownloads: number;
  successCount: number;
  errorCount: number;
  byType: Record<string, number>;
}

export async function getOverviewStats(): Promise<OverviewStats> {
  const [usersRes, totalsRes, typeRes] = await Promise.all([
    pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users'),
    pool.query<{ status: string; count: string }>('SELECT status, COUNT(*)::text AS count FROM downloads GROUP BY status'),
    pool.query<{ type: string; count: string }>('SELECT type, COUNT(*)::text AS count FROM downloads GROUP BY type'),
  ]);

  const byStatus = Object.fromEntries(totalsRes.rows.map((r) => [r.status, Number.parseInt(r.count, 10)]));
  const byType = Object.fromEntries(typeRes.rows.map((r) => [r.type, Number.parseInt(r.count, 10)]));
  const totalDownloads = Object.values(byStatus).reduce((sum, n) => sum + n, 0);

  return {
    totalUsers: Number.parseInt(usersRes.rows[0]?.count ?? '0', 10),
    totalDownloads,
    successCount: byStatus.success ?? 0,
    errorCount: byStatus.error ?? 0,
    byType,
  };
}

export interface TopQueryRow {
  title: string;
  sourceUrl: string;
  count: number;
}

/** Most-requested distinct sources in the last `days` days, success or not. */
export async function getTopQueries(days = 7, limit = 10): Promise<TopQueryRow[]> {
  const { rows } = await pool.query<{ url: string; count: string }>(
    `SELECT url, COUNT(*)::text AS count
     FROM downloads
     WHERE created_at >= now() - ($1 || ' days')::interval
     GROUP BY url
     ORDER BY COUNT(*) DESC
     LIMIT $2`,
    [days, limit],
  );
  return rows.map((r) => ({
    title: r.url.startsWith('search:') ? r.url.slice('search:'.length) : r.url,
    sourceUrl: r.url,
    count: Number.parseInt(r.count, 10),
  }));
}
