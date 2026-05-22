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
import { timingSafeEqual } from './lib/crypto.js';
import { getUnifiedApiKey, getOrCreateEncryptionKeyHex } from './db/index.js';
import type { Env } from './types.js';

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

  // ── Encryption key ────────────────────────────────────────────────────────
  // Resolved once per API request and stored in context variables.
  app.use('/api/*', async (c, next) => {
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

  // ── Routes ────────────────────────────────────────────────────────────────
  app.route('/api/keys', keysRouter);
  app.route('/api/models', modelsRouter);
  app.route('/api/fallback', fallbackRouter);
  app.route('/api/analytics', analyticsRouter);
  app.route('/api/health', healthRouter);
  app.route('/api/settings', settingsRouter);

  // OpenAI-compatible proxy — auth is handled inside the proxy route itself
  app.route('/v1', proxyRouter);

  // ── Error handler ─────────────────────────────────────────────────────────
  app.onError((err, c) => {
    console.error('[App] Unhandled error:', err.message);
    const status = (err as any).status ?? 500;
    return c.json({ error: { message: err.message ?? 'Internal server error', type: 'server_error' } }, status);
  });

  return app;
}
