/**
 * FreeLLMAPI — Cloudflare Worker entry point
 *
 * Exports:
 *  - default: HTTP fetch handler (Hono app)
 *  - scheduled: Cron trigger handler (health check every 5 minutes)
 *  - RateLimiterDO: Durable Object class for rate-limit state
 */
import { createApp } from './app.js';
import { ensureSchema, getOrCreateEncryptionKeyHex } from './db/index.js';
import { checkAllKeys } from './services/health.js';
import type { Env } from './types.js';

export { RateLimiterDO } from './services/rateLimiterDO.js';

const app = createApp();

let schemaEnsured = false;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Ensure schema on first request (idempotent DDL)
    if (!schemaEnsured) {
      try {
        await ensureSchema(env.DB);
        schemaEnsured = true;
      } catch (e) {
        console.error('[Init] Schema ensure failed:', e);
      }
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('[Scheduled] Running key health check...');
    try {
      const keyHex = await getOrCreateEncryptionKeyHex(env.DB, env.ENCRYPTION_KEY);
      await checkAllKeys(env.DB, keyHex);
    } catch (e) {
      console.error('[Scheduled] Health check failed:', e);
    }
  },
};
