import { Hono } from 'hono';
import { hasProvider } from '../providers/index.js';
import type { Env } from '../types.js';

export const modelsRouter = new Hono<{ Bindings: Env }>();

modelsRouter.get('/', async (c) => {
  const db = c.env.DB;

  const { results: models } = await db
    .prepare(`
      SELECT m.*, fc.priority, fc.enabled as fallback_enabled
      FROM models m
      LEFT JOIN fallback_config fc ON fc.model_db_id = m.id
      ORDER BY COALESCE(fc.priority, m.intelligence_rank) ASC
    `)
    .all<any>();

  const { results: keyCounts } = await db
    .prepare('SELECT platform, COUNT(*) as count FROM api_keys WHERE enabled = 1 GROUP BY platform')
    .all<{ platform: string; count: number }>();

  const keyCountMap = new Map(keyCounts.map(k => [k.platform, k.count]));

  return c.json(models.map(m => ({
    id: m.id,
    platform: m.platform,
    modelId: m.model_id,
    displayName: m.display_name,
    intelligenceRank: m.intelligence_rank,
    speedRank: m.speed_rank,
    sizeLabel: m.size_label,
    rpmLimit: m.rpm_limit,
    rpdLimit: m.rpd_limit,
    tpmLimit: m.tpm_limit,
    tpdLimit: m.tpd_limit,
    monthlyTokenBudget: m.monthly_token_budget,
    contextWindow: m.context_window,
    enabled: m.enabled === 1,
    priority: m.priority,
    fallbackEnabled: m.fallback_enabled === 1,
    hasProvider: hasProvider(m.platform),
    keyCount: keyCountMap.get(m.platform) ?? 0,
  })));
});
