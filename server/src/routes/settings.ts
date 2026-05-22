import { Hono } from 'hono';
import { getUnifiedApiKey, regenerateUnifiedKey } from '../db/index.js';
import type { Env } from '../types.js';

export const settingsRouter = new Hono<{ Bindings: Env }>();

settingsRouter.get('/api-key', async (c) => {
  const apiKey = await getUnifiedApiKey(c.env.DB);
  return c.json({ apiKey });
});

settingsRouter.post('/api-key/regenerate', async (c) => {
  const apiKey = await regenerateUnifiedKey(c.env.DB);
  return c.json({ apiKey });
});
