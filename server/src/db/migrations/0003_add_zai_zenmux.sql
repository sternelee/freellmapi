-- Add z.ai (Zhipu international) and Zenmux free-tier models
-- Apply with: wrangler d1 migrations apply freellmapi [--local|--remote]

-- ── z.ai models ───────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO models
  (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
   rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled)
VALUES
('zai','glm-4.5-flash','GLM-4.5 Flash (Z.ai)',24,4,'Large',NULL,NULL,NULL,1000000,'~30M',131072,1);

-- ── Zenmux models ─────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO models
  (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
   rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled)
VALUES
('zenmux','google/gemini-3.5-flash-free','Gemini 3.5 Flash Free',20,5,'Large',10,NULL,NULL,NULL,'~1M',1000000,1),
('zenmux','z-ai/glm-4.7-flash-free','GLM-4.7 Flash Free',19,4,'Large',10,NULL,NULL,NULL,'~1M',131072,1),
('zenmux','z-ai/glm-4.6v-flash-free','GLM-4.6V Flash Free',21,4,'Large',10,NULL,NULL,NULL,'~1M',131072,1);

-- ── Fallback config for new models ────────────────────────────────────────────
INSERT OR IGNORE INTO fallback_config (model_db_id, priority, enabled)
SELECT m.id,
       (SELECT COALESCE(MAX(priority), 0) + 1 FROM fallback_config) + ROW_NUMBER() OVER (ORDER BY m.intelligence_rank ASC, m.id ASC) - 1,
       1
FROM models m
WHERE m.platform IN ('zai', 'zenmux')
  AND NOT EXISTS (SELECT 1 FROM fallback_config f WHERE f.model_db_id = m.id);
