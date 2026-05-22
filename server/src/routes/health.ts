import { Hono } from 'hono';
import { hasProvider } from '../providers/index.js';
import { checkKeyHealth, checkAllKeys } from '../services/health.js';
import type { Env } from '../types.js';

export const healthRouter = new Hono<{ Bindings: Env; Variables: { keyHex: string } }>();

healthRouter.get('/', async (c) => {
  const db = c.env.DB;

  const [{ results: platforms }, { results: keys }] = await Promise.all([
    db.prepare(`
      SELECT
        platform,
        COUNT(*) as total_keys,
        SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END) as healthy_keys,
        SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited_keys,
        SUM(CASE WHEN status = 'invalid' THEN 1 ELSE 0 END) as invalid_keys,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_keys,
        SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) as unknown_keys,
        SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled_keys
      FROM api_keys GROUP BY platform
    `).all<any>(),
    db.prepare(
      'SELECT id, platform, label, status, enabled, created_at, last_checked_at FROM api_keys ORDER BY platform, created_at DESC'
    ).all<any>(),
  ]);

  return c.json({
    platforms: platforms.map(p => ({
      platform: p.platform,
      hasProvider: hasProvider(p.platform),
      totalKeys: p.total_keys,
      healthyKeys: p.healthy_keys,
      rateLimitedKeys: p.rate_limited_keys,
      invalidKeys: p.invalid_keys,
      errorKeys: p.error_keys,
      unknownKeys: p.unknown_keys,
      enabledKeys: p.enabled_keys,
    })),
    keys: keys.map(k => ({
      id: k.id,
      platform: k.platform,
      label: k.label,
      status: k.status,
      enabled: k.enabled === 1,
      createdAt: k.created_at,
      lastCheckedAt: k.last_checked_at,
    })),
  });
});

healthRouter.post('/check/:keyId', async (c) => {
  const keyId = parseInt(c.req.param('keyId'), 10);
  if (isNaN(keyId)) return c.json({ error: { message: 'Invalid key ID' } }, 400);

  const keyHex = c.get('keyHex');
  const status = await checkKeyHealth(keyId, c.env.DB, keyHex);
  return c.json({ keyId, status });
});

healthRouter.post('/check-all', async (c) => {
  const keyHex = c.get('keyHex');
  await checkAllKeys(c.env.DB, keyHex);
  return c.json({ success: true });
});
