import { Hono } from 'hono';
import { getUnifiedApiKey, regenerateUnifiedKey } from '../db/index.js';
import type { Env } from '../types.js';

// NOTE: Upstream added many more endpoints (unify, fusion, anthropic-map, proxy
// settings) in Express style. Per the Upstream Merge Policy in AGENTS.md, we
// reject Express migration. Port them to Hono before mounting here.
export const settingsRouter = new Hono<{ Bindings: Env }>();

settingsRouter.get('/api-key', async (c) => {
  const apiKey = await getUnifiedApiKey(c.env.DB);
  return c.json({ apiKey });
});

settingsRouter.post('/api-key/regenerate', async (c) => {
  const apiKey = await regenerateUnifiedKey(c.env.DB);
  return c.json({ apiKey });
});
