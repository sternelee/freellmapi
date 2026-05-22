import { Hono } from 'hono';
import { z } from 'zod';
import { getAllPenalties } from '../services/router.js';
import type { Env } from '../types.js';

export const fallbackRouter = new Hono<{ Bindings: Env }>();

fallbackRouter.get('/', async (c) => {
  const db = c.env.DB;

  const [{ results: rows }, { results: keyCounts }, penalties] = await Promise.all([
    db.prepare(`
      SELECT fc.model_db_id, fc.priority, fc.enabled,
             m.platform, m.model_id, m.display_name, m.intelligence_rank,
             m.speed_rank, m.size_label, m.rpm_limit, m.rpd_limit, m.monthly_token_budget
      FROM fallback_config fc
      JOIN models m ON m.id = fc.model_db_id
      ORDER BY fc.priority ASC
    `).all<any>(),
    db.prepare(`
      SELECT platform, COUNT(*) as count FROM api_keys WHERE enabled = 1 GROUP BY platform
    `).all<{ platform: string; count: number }>(),
    getAllPenalties(c.env),
  ]);

  const keyCountMap = new Map(keyCounts.map(k => [k.platform, k.count]));
  const penaltyMap = new Map(penalties.map(p => [p.modelDbId, p]));

  return c.json(rows.map(r => {
    const penalty = penaltyMap.get(r.model_db_id);
    return {
      modelDbId: r.model_db_id,
      priority: r.priority,
      effectivePriority: r.priority + (penalty?.penalty ?? 0),
      penalty: penalty?.penalty ?? 0,
      rateLimitHits: penalty?.count ?? 0,
      enabled: r.enabled === 1,
      platform: r.platform,
      modelId: r.model_id,
      displayName: r.display_name,
      intelligenceRank: r.intelligence_rank,
      speedRank: r.speed_rank,
      sizeLabel: r.size_label,
      rpmLimit: r.rpm_limit,
      rpdLimit: r.rpd_limit,
      monthlyTokenBudget: r.monthly_token_budget,
      keyCount: keyCountMap.get(r.platform) ?? 0,
    };
  }));
});

const updateSchema = z.array(z.object({
  modelDbId: z.number(),
  priority: z.number(),
  enabled: z.boolean(),
}));

fallbackRouter.put('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { message: parsed.error.issues.map((e: { message: string }) => e.message).join(', ') } }, 400);
  }

  const db = c.env.DB;
  const stmts = parsed.data.map(entry =>
    db.prepare('UPDATE fallback_config SET priority = ?, enabled = ? WHERE model_db_id = ?')
      .bind(entry.priority, entry.enabled ? 1 : 0, entry.modelDbId)
  );
  await db.batch(stmts);
  return c.json({ success: true });
});

const SORT_PRESETS: Record<string, string> = {
  intelligence: 'm.intelligence_rank ASC',
  speed: 'm.speed_rank ASC',
  budget: "CASE m.monthly_token_budget WHEN '~120M' THEN 1 WHEN '~50-100M' THEN 2 WHEN '~30M' THEN 3 WHEN '~18-45M' THEN 4 WHEN '~18M' THEN 5 WHEN '~15M' THEN 6 WHEN '~12M' THEN 7 WHEN '~6M' THEN 8 WHEN '~5-10M' THEN 9 WHEN '~4M' THEN 10 ELSE 11 END ASC",
};

fallbackRouter.post('/sort/:preset', async (c) => {
  const preset = c.req.param('preset');
  const orderBy = SORT_PRESETS[preset];
  if (!orderBy) {
    return c.json({ error: { message: `Unknown preset: ${preset}. Use: intelligence, speed, budget` } }, 400);
  }

  const db = c.env.DB;
  const { results: models } = await db
    .prepare(`SELECT m.id FROM models m ORDER BY ${orderBy}`)
    .all<{ id: number }>();

  const stmts = models.map((m, i) =>
    db.prepare('UPDATE fallback_config SET priority = ? WHERE model_db_id = ?').bind(i + 1, m.id)
  );
  await db.batch(stmts);
  return c.json({ success: true, preset });
});

fallbackRouter.get('/token-usage', async (c) => {
  const db = c.env.DB;

  const [{ results: platforms }, { results: models }, usage] = await Promise.all([
    db.prepare("SELECT DISTINCT ak.platform FROM api_keys ak WHERE ak.enabled = 1").all<{ platform: string }>(),
    db.prepare(`
      SELECT m.platform, m.model_id, m.display_name, m.monthly_token_budget, fc.priority
      FROM models m JOIN fallback_config fc ON fc.model_db_id = m.id
      WHERE m.enabled = 1 ORDER BY fc.priority ASC
    `).all<{ platform: string; model_id: string; display_name: string; monthly_token_budget: string; priority: number }>(),
    db.prepare(`
      SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total_used
      FROM requests WHERE created_at >= datetime('now', 'start of month')
    `).first<{ total_used: number }>(),
  ]);

  const platformSet = new Set(platforms.map(p => p.platform));

  function parseBudget(s: string): number {
    const m = s.match(/~?([\d.]+)(?:-([\d.]+))?([MK])?/);
    if (!m) return 0;
    const high = parseFloat(m[2] ?? m[1]);
    const unit = m[3] === 'M' ? 1_000_000 : m[3] === 'K' ? 1_000 : 1;
    return high * unit;
  }

  const modelBudgets = models
    .filter(m => platformSet.has(m.platform))
    .map(m => ({
      displayName: m.display_name,
      platform: m.platform,
      budget: parseBudget(m.monthly_token_budget),
    }));

  const totalBudget = modelBudgets.reduce((s, m) => s + m.budget, 0);

  return c.json({
    totalBudget,
    totalUsed: usage?.total_used ?? 0,
    models: modelBudgets,
  });
});
