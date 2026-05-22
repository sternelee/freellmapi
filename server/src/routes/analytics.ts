import { Hono } from 'hono';
import type { Env } from '../types.js';

export const analyticsRouter = new Hono<{ Bindings: Env }>();

function getSinceTimestamp(range: string): string {
  const now = Date.now();
  switch (range) {
    case '24h': return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    case '7d':
    default: return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
}

analyticsRouter.get('/summary', async (c) => {
  const range = c.req.query('range') ?? '7d';
  const since = getSinceTimestamp(range);
  const db = c.env.DB;

  const stats = await db.prepare(`
    SELECT
      COUNT(*) as total_requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      AVG(latency_ms) as avg_latency_ms
    FROM requests
    WHERE created_at >= ?
  `).bind(since).first<any>();

  const totalRequests = stats?.total_requests ?? 0;
  const successRate = totalRequests > 0 ? (stats.success_count / totalRequests) * 100 : 0;
  const inputCost = ((stats?.total_input_tokens ?? 0) / 1_000_000) * 3;
  const outputCost = ((stats?.total_output_tokens ?? 0) / 1_000_000) * 15;

  return c.json({
    totalRequests,
    successRate: Math.round(successRate * 10) / 10,
    totalInputTokens: stats?.total_input_tokens ?? 0,
    totalOutputTokens: stats?.total_output_tokens ?? 0,
    avgLatencyMs: Math.round(stats?.avg_latency_ms ?? 0),
    estimatedCostSavings: Math.round((inputCost + outputCost) * 100) / 100,
  });
});

analyticsRouter.get('/by-model', async (c) => {
  const range = c.req.query('range') ?? '7d';
  const since = getSinceTimestamp(range);

  const { results: rows } = await c.env.DB.prepare(`
    SELECT r.platform, r.model_id, m.display_name,
      COUNT(*) as requests,
      SUM(CASE WHEN r.status = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate,
      AVG(r.latency_ms) as avg_latency_ms,
      SUM(r.input_tokens) as total_input_tokens,
      SUM(r.output_tokens) as total_output_tokens
    FROM requests r
    LEFT JOIN models m ON m.platform = r.platform AND m.model_id = r.model_id
    WHERE r.created_at >= ?
    GROUP BY r.platform, r.model_id
    ORDER BY requests DESC
  `).bind(since).all<any>();

  return c.json(rows.map(r => ({
    platform: r.platform,
    modelId: r.model_id,
    displayName: r.display_name ?? r.model_id,
    requests: r.requests,
    successRate: Math.round(r.success_rate * 10) / 10,
    avgLatencyMs: Math.round(r.avg_latency_ms),
    totalInputTokens: r.total_input_tokens ?? 0,
    totalOutputTokens: r.total_output_tokens ?? 0,
  })));
});

analyticsRouter.get('/by-platform', async (c) => {
  const range = c.req.query('range') ?? '7d';
  const since = getSinceTimestamp(range);

  const { results: rows } = await c.env.DB.prepare(`
    SELECT platform,
      COUNT(*) as requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate,
      AVG(latency_ms) as avg_latency_ms,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens
    FROM requests
    WHERE created_at >= ?
    GROUP BY platform
    ORDER BY requests DESC
  `).bind(since).all<any>();

  return c.json(rows.map(r => ({
    platform: r.platform,
    requests: r.requests,
    successRate: Math.round(r.success_rate * 10) / 10,
    avgLatencyMs: Math.round(r.avg_latency_ms),
    totalInputTokens: r.total_input_tokens ?? 0,
    totalOutputTokens: r.total_output_tokens ?? 0,
  })));
});

analyticsRouter.get('/timeline', async (c) => {
  const range = c.req.query('range') ?? '7d';
  const interval = c.req.query('interval') ?? (range === '24h' ? 'hour' : 'day');
  const since = getSinceTimestamp(range);

  const dateFormat = interval === 'hour' ? '%Y-%m-%dT%H:00:00' : '%Y-%m-%d';

  const { results: rows } = await c.env.DB.prepare(`
    SELECT
      strftime('${dateFormat}', created_at) as timestamp,
      COUNT(*) as requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failure_count
    FROM requests
    WHERE created_at >= ?
    GROUP BY strftime('${dateFormat}', created_at)
    ORDER BY timestamp ASC
  `).bind(since).all<any>();

  return c.json(rows.map(r => ({
    timestamp: r.timestamp,
    requests: r.requests,
    successCount: r.success_count,
    failureCount: r.failure_count,
  })));
});

const ERROR_CATEGORIES_SQL = `
  CASE
    WHEN error LIKE '%429%' OR error LIKE '%rate limit%' OR error LIKE '%too many%' OR error LIKE '%quota%' THEN 'Rate Limited (429)'
    WHEN error LIKE '%401%' OR error LIKE '%unauthorized%' OR error LIKE '%invalid.*key%' THEN 'Auth Error (401)'
    WHEN error LIKE '%403%' OR error LIKE '%forbidden%' THEN 'Forbidden (403)'
    WHEN error LIKE '%404%' OR error LIKE '%not found%' THEN 'Not Found (404)'
    WHEN error LIKE '%timeout%' OR error LIKE '%ETIMEDOUT%' OR error LIKE '%ECONNREFUSED%' THEN 'Timeout/Connection'
    WHEN error LIKE '%500%' OR error LIKE '%internal server%' THEN 'Server Error (500)'
    WHEN error LIKE '%503%' OR error LIKE '%unavailable%' THEN 'Unavailable (503)'
    ELSE 'Other'
  END
`;

analyticsRouter.get('/error-distribution', async (c) => {
  const range = c.req.query('range') ?? '7d';
  const since = getSinceTimestamp(range);
  const db = c.env.DB;

  const [{ results: byCategory }, { results: byPlatform }, { results: detailed }] = await Promise.all([
    db.prepare(`
      SELECT ${ERROR_CATEGORIES_SQL} as category, COUNT(*) as count
      FROM requests WHERE status = 'error' AND created_at >= ?
      GROUP BY category ORDER BY count DESC
    `).bind(since).all<any>(),
    db.prepare(`
      SELECT platform, COUNT(*) as count
      FROM requests WHERE status = 'error' AND created_at >= ?
      GROUP BY platform ORDER BY count DESC
    `).bind(since).all<any>(),
    db.prepare(`
      SELECT platform, model_id, ${ERROR_CATEGORIES_SQL} as error_category, COUNT(*) as count
      FROM requests WHERE status = 'error' AND created_at >= ?
      GROUP BY platform, error_category ORDER BY count DESC
    `).bind(since).all<any>(),
  ]);

  return c.json({ byCategory, byPlatform, detailed });
});

analyticsRouter.get('/errors', async (c) => {
  const range = c.req.query('range') ?? '7d';
  const since = getSinceTimestamp(range);

  const { results: rows } = await c.env.DB.prepare(`
    SELECT id, platform, model_id, error, latency_ms, created_at
    FROM requests
    WHERE status = 'error' AND created_at >= ?
    ORDER BY created_at DESC LIMIT 50
  `).bind(since).all<any>();

  return c.json(rows.map(r => ({
    id: r.id,
    platform: r.platform,
    modelId: r.model_id,
    error: r.error,
    latencyMs: r.latency_ms,
    createdAt: r.created_at,
  })));
});
