import type { D1DB } from '../db/index.js';
import { getProvider } from '../providers/index.js';
import { decrypt } from '../lib/crypto.js';
import { getRateLimiterStub, doPost, doPostNoReply } from './doClient.js';
import type { Env } from '../types.js';
import type { BaseProvider } from '../providers/base.js';

interface ModelRow {
  id: number;
  platform: string;
  model_id: string;
  display_name: string;
  rpm_limit: number | null;
  rpd_limit: number | null;
  tpm_limit: number | null;
  tpd_limit: number | null;
}

interface KeyRow {
  id: number;
  platform: string;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  status: string;
  enabled: number;
}

interface FallbackRow {
  model_db_id: number;
  priority: number;
  enabled: number;
}

export interface RouteResult {
  provider: BaseProvider;
  modelId: string;
  modelDbId: number;
  apiKey: string;
  keyId: number;
  platform: string;
  displayName: string;
}

export async function recordRateLimitHit(env: Env, modelDbId: number): Promise<void> {
  const stub = getRateLimiterStub(env);
  await doPostNoReply(stub, '/record-rl-hit', { modelDbId });
}

export async function recordSuccess(env: Env, modelDbId: number): Promise<void> {
  const stub = getRateLimiterStub(env);
  await doPostNoReply(stub, '/record-success', { modelDbId });
}

export async function getAllPenalties(
  env: Env,
): Promise<Array<{ modelDbId: number; count: number; penalty: number }>> {
  const stub = getRateLimiterStub(env);
  return doPost(stub, '/get-all-penalties', {});
}

export async function setCooldown(
  env: Env,
  platform: string,
  modelId: string,
  keyId: number,
  durationMs = 120_000,
): Promise<void> {
  const stub = getRateLimiterStub(env);
  await doPostNoReply(stub, '/set-cooldown', { platform, modelId, keyId, durationMs });
}

/**
 * Route a request to the best available model.
 */
export async function routeRequest(
  db: D1DB,
  env: Env,
  keyHex: string,
  estimatedTokens = 1000,
  skipKeys?: Set<string>,
  preferredModelDbId?: number,
): Promise<RouteResult> {
  const stub = getRateLimiterStub(env);

  // Fetch fallback chain from D1
  const { results: fallbackChain } = await db
    .prepare('SELECT fc.model_db_id, fc.priority, fc.enabled FROM fallback_config fc ORDER BY fc.priority ASC')
    .all<FallbackRow>();

  // Fetch all penalty scores from the DO
  const penalties = await doPost<Array<{ modelDbId: number; penalty: number }>>(stub, '/get-all-penalties', {});
  const penaltyMap = new Map(penalties.map(p => [p.modelDbId, p.penalty]));

  // Sort by effective priority
  const sortedChain = fallbackChain.map(entry => ({
    ...entry,
    effectivePriority: entry.priority + (penaltyMap.get(entry.model_db_id) ?? 0),
  })).sort((a, b) => a.effectivePriority - b.effectivePriority);

  // Sticky session: move preferred model to front
  if (preferredModelDbId) {
    const idx = sortedChain.findIndex(e => e.model_db_id === preferredModelDbId);
    if (idx > 0) {
      const [preferred] = sortedChain.splice(idx, 1);
      sortedChain.unshift(preferred);
    }
  }

  for (const entry of sortedChain) {
    if (!entry.enabled) continue;

    const model = await db
      .prepare('SELECT * FROM models WHERE id = ? AND enabled = 1')
      .bind(entry.model_db_id)
      .first<ModelRow>();
    if (!model) continue;

    const provider = getProvider(model.platform as any);
    if (!provider) continue;

    const { results: keys } = await db
      .prepare("SELECT * FROM api_keys WHERE platform = ? AND enabled = 1 AND status != 'invalid'")
      .bind(model.platform)
      .all<KeyRow>();

    if (keys.length === 0) continue;

    const limits = {
      rpm: model.rpm_limit,
      rpd: model.rpd_limit,
      tpm: model.tpm_limit,
      tpd: model.tpd_limit,
    };

    const rrKey = `${model.platform}:${model.model_id}`;
    let idx = await doPost<number>(stub, '/get-round-robin', { key: rrKey });

    for (let attempt = 0; attempt < keys.length; attempt++) {
      const key = keys[idx % keys.length];
      idx++;

      const skipId = `${model.platform}:${model.model_id}:${key.id}`;
      if (skipKeys?.has(skipId)) continue;

      const onCooldown = await doPost<boolean>(stub, '/is-on-cooldown', {
        platform: model.platform, modelId: model.model_id, keyId: key.id,
      });
      if (onCooldown) continue;

      const canMake = await doPost<boolean>(stub, '/can-make-request', {
        platform: model.platform, modelId: model.model_id, keyId: key.id, limits,
      });
      if (!canMake) continue;

      const canUse = await doPost<boolean>(stub, '/can-use-tokens', {
        platform: model.platform, modelId: model.model_id, keyId: key.id, estimatedTokens, limits,
      });
      if (!canUse) continue;

      // Update round-robin index
      await doPostNoReply(stub, '/set-round-robin', { key: rrKey, index: idx });

      const decryptedKey = await decrypt(key.encrypted_key, key.iv, key.auth_tag, keyHex);

      return {
        provider,
        modelId: model.model_id,
        modelDbId: model.id,
        apiKey: decryptedKey,
        keyId: key.id,
        platform: model.platform,
        displayName: model.display_name,
      };
    }

    // No available key for this model — update round-robin anyway
    await doPostNoReply(stub, '/set-round-robin', { key: rrKey, index: idx });
  }

  const err = new Error('All models exhausted. Add more API keys or wait for rate limits to reset.') as any;
  err.status = 429;
  throw err;
}

export async function recordRequest(env: Env, platform: string, modelId: string, keyId: number): Promise<void> {
  const stub = getRateLimiterStub(env);
  await doPostNoReply(stub, '/record-request', { platform, modelId, keyId });
}

export async function recordTokens(env: Env, platform: string, modelId: string, keyId: number, tokens: number): Promise<void> {
  const stub = getRateLimiterStub(env);
  await doPostNoReply(stub, '/record-tokens', { platform, modelId, keyId, tokens });
}
