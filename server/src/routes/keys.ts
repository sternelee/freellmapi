import { Hono } from 'hono';
import { z } from 'zod';
import { encrypt, decrypt, maskKey } from '../lib/crypto.js';
import type { Env } from '../types.js';

export const keysRouter = new Hono<{ Bindings: Env; Variables: { keyHex: string } }>();

const createKeySchema = z.object({
  platform: z.string().min(1),
  apiKey: z.string().min(1),
  label: z.string().optional(),
});

// List all API keys (masked)
keysRouter.get('/', async (c) => {
  const db = c.env.DB;
  const { results } = await db
    .prepare('SELECT id, platform, label, status, enabled, created_at, last_checked_at FROM api_keys ORDER BY platform, created_at DESC')
    .all<{
      id: number; platform: string; label: string; status: string;
      enabled: number; created_at: string; last_checked_at: string | null;
    }>();

  return c.json(results.map(k => ({
    id: k.id,
    platform: k.platform,
    label: k.label,
    status: k.status,
    enabled: k.enabled === 1,
    createdAt: k.created_at,
    lastCheckedAt: k.last_checked_at,
  })));
});

// Add a new API key
keysRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { message: parsed.error.issues.map((e: { message: string }) => e.message).join(', ') } }, 400);
  }

  const { platform, apiKey, label = '' } = parsed.data;
  const keyHex = c.get('keyHex');
  const { encrypted, iv, authTag } = await encrypt(apiKey, keyHex);

  const result = await c.env.DB
    .prepare('INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag) VALUES (?, ?, ?, ?, ?)')
    .bind(platform, label, encrypted, iv, authTag)
    .run();

  return c.json({ id: result.meta.last_row_id, platform, label, masked: maskKey(apiKey) }, 201);
});

// Delete an API key
keysRouter.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: { message: 'Invalid key ID' } }, 400);

  await c.env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// Enable/disable a key
keysRouter.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: { message: 'Invalid key ID' } }, 400);

  const body = await c.req.json().catch(() => ({})) as { enabled?: boolean };
  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: { message: "'enabled' must be a boolean" } }, 400);
  }

  await c.env.DB
    .prepare('UPDATE api_keys SET enabled = ? WHERE id = ?')
    .bind(body.enabled ? 1 : 0, id)
    .run();
  return c.json({ success: true });
});

// Test/reveal a key (masked)
keysRouter.get('/:id/reveal', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: { message: 'Invalid key ID' } }, 400);

  const row = await c.env.DB
    .prepare('SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE id = ?')
    .bind(id)
    .first<{ encrypted_key: string; iv: string; auth_tag: string }>();
  if (!row) return c.json({ error: { message: 'Key not found' } }, 404);

  const keyHex = c.get('keyHex');
  const apiKey = await decrypt(row.encrypted_key, row.iv, row.auth_tag, keyHex);
  return c.json({ masked: maskKey(apiKey), length: apiKey.length });
});
