import type { D1DB } from '../db/index.js';
import { getProvider } from '../providers/index.js';
import { decrypt } from '../lib/crypto.js';
import type { Platform, KeyStatus } from '@freellmapi/shared/types.js';

interface KeyRow {
  id: number;
  platform: string;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  status: string;
  enabled: number;
}

// Per-key consecutive-failure counts (in-memory within the Worker instance).
// Precise enough for health checks which are run via Cron, not under load.
const failureCount = new Map<number, number>();
const CONSECUTIVE_FAILURES_TO_DISABLE = 3;

export async function checkKeyHealth(keyId: number, db: D1DB, keyHex: string): Promise<KeyStatus> {
  const row = await db
    .prepare('SELECT * FROM api_keys WHERE id = ?')
    .bind(keyId)
    .first<KeyRow>();
  if (!row) return 'error';

  const provider = getProvider(row.platform as Platform);
  if (!provider) return 'error';

  try {
    const apiKey = await decrypt(row.encrypted_key, row.iv, row.auth_tag, keyHex);
    const isValid = await provider.validateKey(apiKey);
    const status: KeyStatus = isValid ? 'healthy' : 'invalid';

    await db
      .prepare("UPDATE api_keys SET status = ?, last_checked_at = datetime('now') WHERE id = ?")
      .bind(status, keyId)
      .run();

    if (isValid) {
      failureCount.delete(keyId);
    } else {
      const count = (failureCount.get(keyId) ?? 0) + 1;
      failureCount.set(keyId, count);
      if (count >= CONSECUTIVE_FAILURES_TO_DISABLE) {
        await db.prepare('UPDATE api_keys SET enabled = 0 WHERE id = ?').bind(keyId).run();
        console.log(`[Health] Auto-disabled key ${keyId} after ${count} consecutive failures`);
      }
    }

    return status;
  } catch (err: any) {
    // Transport errors — mark error but don't count toward auto-disable.
    console.error(`[Health] Key ${keyId} transport error:`, err.message);
    await db
      .prepare("UPDATE api_keys SET status = ?, last_checked_at = datetime('now') WHERE id = ?")
      .bind('error', keyId)
      .run();
    return 'error';
  }
}

export async function checkAllKeys(db: D1DB, keyHex: string): Promise<void> {
  const { results: keys } = await db
    .prepare('SELECT id, platform FROM api_keys WHERE enabled = 1')
    .all<{ id: number; platform: string }>();

  console.log(`[Health] Checking ${keys.length} keys...`);
  for (const key of keys) {
    await checkKeyHealth(key.id, db, keyHex);
  }
  console.log('[Health] Check complete.');
}
