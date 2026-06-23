import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { keysRouter } from './routes/keys.js';
import { modelsRouter } from './routes/models.js';
import { proxyRouter } from './routes/proxy.js';
import { fallbackRouter } from './routes/fallback.js';
import { analyticsRouter } from './routes/analytics.js';
import { healthRouter } from './routes/health.js';
import { settingsRouter } from './routes/settings.js';
import { createProxyRateLimiter } from './middleware/rateLimit.js';
import { timingSafeEqual } from './lib/crypto.js';
import { getUnifiedApiKey, getOrCreateEncryptionKeyHex } from './db/index.js';
import type { Env } from './types.js';

// NOTE: Upstream added several new routers (responses, anthropic, profiles,
// embeddings, media, premium) in Express style. Per the Upstream Merge
// Policy in AGENTS.md, we reject Express migration. Those routes are not
// mounted here; port them to Hono first if you need them.
export function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: { keyHex: string } }>();

  // ── Global middleware ─────────────────────────────────────────────────────
  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['X-Routed-Via', 'X-Fallback-Attempts'],
  }));
  app.use('*', secureHeaders());

  // Health ping — no auth required
  app.get('/ping', (c) => c.text('ok'));
  app.get('/api/ping', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // ── Encryption key ────────────────────────────────────────────────────────
  // Resolved once per API request and stored in context variables.
  app.use('*', async (c, next) => {
    const hex = await getOrCreateEncryptionKeyHex(c.env.DB, c.env.ENCRYPTION_KEY);
    c.set('keyHex', hex);
    await next();
  });

  type AppEnv = { Bindings: Env; Variables: { keyHex: string } };

  // ── Admin auth middleware ─────────────────────────────────────────────────
  // Applied before the respective route mounts (Hono evaluates middleware in
  // registration order — middleware must come before route handlers).
  const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    const unifiedKey = await getUnifiedApiKey(c.env.DB);
    if (!token || !(await timingSafeEqual(token, unifiedKey))) {
      return c.json({ error: { message: 'Unauthorized', type: 'authentication_error' } }, 401);
    }
    await next();
  };

  // ── Protected routes ──────────────────────────────────────────────────────
  app.use('/api/keys/*', requireAuth);
  app.use('/api/settings/*', requireAuth);
  app.use('/api/health/check*', requireAuth);
  const requireWriteAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.req.method === 'PUT' || c.req.method === 'POST') {
      return requireAuth(c, next);
    }
    await next();
  };
  app.use('/api/fallback', requireWriteAuth);

  app.route('/api/keys', keysRouter);
  app.route('/api/models', modelsRouter);
  app.route('/api/fallback', fallbackRouter);
  app.route('/api/analytics', analyticsRouter);
  app.route('/api/health', healthRouter);
  app.route('/api/settings', settingsRouter);

  // OpenAI-compatible proxy. Per-IP rate limiting (#35 item #6) runs first so
  // it throttles unauthenticated brute-force / flood attempts before any
  // routing work. Tune via PROXY_RATE_LIMIT_RPM; 0 disables it.
  app.use('/v1', createProxyRateLimiter());
  app.route('/v1', proxyRouter);

  // ── Error handler ─────────────────────────────────────────────────────────
  app.onError((err, c) => {
    console.error('[App] Unhandled error:', err.message);
    const status = (err as any).status ?? 500;
    return c.json({ error: { message: err.message ?? 'Internal server error', type: 'server_error' } }, status);
  });

  return app;
}
