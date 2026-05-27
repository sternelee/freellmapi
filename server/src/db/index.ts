// Cloudflare D1 database helpers
// All operations are async (D1 API) — no global state, D1 instance passed per call.

export type D1DB = D1Database;

// ── Schema ────────────────────────────────────────────────────────────────────
// Applied by `wrangler d1 migrations apply`. Calling initDb() at runtime is a
// defensive no-op check so the worker doesn't crash on missing tables.

// NOTE: Schema is applied by `wrangler d1 migrations apply`. ensureSchema() below
// is a defensive runtime check so the worker doesn't crash on missing tables.
// D1's db.exec() has known issues with multi-statement DDL in some Workers
// runtime versions, so we use individual prepare().run() calls instead.

/** Ensure tables exist (idempotent). Call once per Worker invocation. */
export async function ensureSchema(db: D1DB): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      model_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      intelligence_rank INTEGER NOT NULL,
      speed_rank INTEGER NOT NULL,
      size_label TEXT NOT NULL DEFAULT '',
      rpm_limit INTEGER,
      rpd_limit INTEGER,
      tpm_limit INTEGER,
      tpd_limit INTEGER,
      monthly_token_budget TEXT NOT NULL DEFAULT '',
      context_window INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(platform, model_id)
    )`,
    `CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      encrypted_key TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_checked_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      model_id TEXT NOT NULL,
      key_id INTEGER,
      status TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS rate_limit_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      model_id TEXT NOT NULL,
      key_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('request', 'tokens')),
      tokens INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS rate_limit_cooldowns (
      platform TEXT NOT NULL,
      model_id TEXT NOT NULL,
      key_id INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (platform, model_id, key_id)
    )`,
    `CREATE TABLE IF NOT EXISTS fallback_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_db_id INTEGER NOT NULL REFERENCES models(id),
      priority INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(model_db_id)
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_requests_platform ON requests(platform)`,
    `CREATE INDEX IF NOT EXISTS idx_rate_limit_usage_lookup ON rate_limit_usage(platform, model_id, key_id, kind, created_at_ms)`,
    `CREATE INDEX IF NOT EXISTS idx_rate_limit_cooldowns_expires ON rate_limit_cooldowns(expires_at_ms)`,
    `CREATE INDEX IF NOT EXISTS idx_api_keys_platform ON api_keys(platform)`,
  ];
  for (const sql of statements) {
    await db.prepare(sql).run();
  }
}

/** Seed the models table if empty (idempotent). */
export async function seedModels(db: D1DB): Promise<void> {
  const row = await db.prepare('SELECT COUNT(*) as cnt FROM models').first<{ cnt: number }>();
  if (!row || row.cnt > 0) return;

  // NOTE: Limits current as of April 2026. See migrateModels() for in-place updates.
  const models: [string, string, string, number, number, string, number | null, number | null, number | null, number | null, string, number][] = [
    // Google — gemini-2.5-flash free quotas were cut Dec 2025 (now ~20 RPD, budget much lower than before)
    ['google', 'gemini-2.5-pro', 'Gemini 2.5 Pro', 1, 8, 'Frontier', 5, 100, 250000, null, '~12M', 1048576],
    ['google', 'gemini-2.5-flash', 'Gemini 2.5 Flash', 4, 5, 'Large', 10, 20, 250000, null, '~3M', 1048576],
    ['google', 'gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 8, 3, 'Medium', 15, 1000, 250000, null, '~120M', 1048576],
    // OpenRouter — upgraded DeepSeek R1 -> V3.1 (stronger reasoning); default RPD ~200
    ['openrouter', 'deepseek/deepseek-v3.1:free', 'DeepSeek V3.1 (free)', 2, 10, 'Frontier', 20, 200, null, null, '~6M', 131072],
    ['openrouter', 'moonshotai/kimi-k2:free', 'Kimi K2 (free)', 2, 9, 'Frontier', 20, 200, null, null, '~6M', 131072],
    ['openrouter', 'qwen/qwen3-coder:free', 'Qwen3 Coder (free)', 3, 9, 'Frontier', 20, 200, null, null, '~6M', 262144],
    ['openrouter', 'z-ai/glm-4.5-air:free', 'GLM-4.5 Air (free)', 4, 9, 'Large', 20, 200, null, null, '~6M', 131072],
    // Cerebras — same 30 RPM / 1M TPD free pool; adding frontier coder, Llama 4 Maverick, GPT-OSS
    ['cerebras', 'qwen-3-coder-480b', 'Qwen3-Coder 480B', 2, 1, 'Frontier', 30, null, 60000, 1000000, '~30M', 131072],
    ['cerebras', 'llama-4-maverick-17b-128e-instruct', 'Llama 4 Maverick', 3, 1, 'Frontier', 30, null, 60000, 1000000, '~30M', 131072],
    ['cerebras', 'qwen3-235b', 'Qwen3 235B', 3, 1, 'Large', 30, null, 60000, 1000000, '~30M', 8192],
    ['cerebras', 'gpt-oss-120b', 'GPT-OSS 120B', 3, 1, 'Large', 30, null, 60000, 1000000, '~30M', 131072],
    // GitHub Models — GPT-4o replaced with GPT-5 (same free tier key)
    ['github', 'openai/gpt-5', 'GPT-5 (GitHub)', 1, 7, 'Frontier', 10, 50, null, null, '~18M', 128000],
    // SambaNova — 70B RPM bumped to 20
    ['sambanova', 'Meta-Llama-3.3-70B-Instruct', 'Llama 3.3 70B', 6, 9, 'Large', 20, null, null, 200000, '~6M', 8192],
    // Mistral — Experiment pool ~1B tokens/mo shared across all models
    ['mistral', 'mistral-large-latest', 'Mistral Large 3', 7, 8, 'Large', 2, null, 500000, null, '~50-100M', 131072],
    ['mistral', 'magistral-medium-latest', 'Magistral Medium', 4, 8, 'Large', 2, null, 500000, null, '~50-100M', 40000],
    ['mistral', 'codestral-latest', 'Codestral', 6, 6, 'Medium', 2, null, 500000, null, '~50-100M', 32000],
    // Groq — scout TPM corrected to 6k (not 30k)
    ['groq', 'llama-3.3-70b-versatile', 'Llama 3.3 70B', 9, 2, 'Medium', 30, 1000, 6000, 500000, '~15M', 131072],
    ['groq', 'llama-4-scout-17b-16e-instruct', 'Llama 4 Scout', 10, 2, 'Medium', 30, 1000, 6000, 1000000, '~30M', 131072],
    // NVIDIA NIM — moved to credit-based model in 2025; no longer truly recurring monthly. Disabled by default.
    ['nvidia', 'meta/llama-3.1-70b-instruct', 'Llama 3.1 70B (NV)', 11, 6, 'Large', 40, null, null, null, 'credits-based', 131072],
    // Cohere — trial tier is 1000 calls/mo total → realistic budget 1-2M
    ['cohere', 'command-r-plus-08-2024', 'Command R+ (08-2024)', 12, 11, 'Large', 20, 33, null, null, '~1-2M', 131072],
    ['cloudflare', '@cf/meta/llama-3.1-70b-instruct', 'Llama 3.1 70B (CF)', 13, 11, 'Medium', null, null, null, null, '~18-45M', 131072],
    // Hugging Face — free Inference credits are ~$0.10/mo → budget closer to 1-3M on a 70B model
    ['huggingface', 'accounts/fireworks/models/llama-v3p3-70b-instruct', 'Llama 3.3 70B (HF)', 14, 11, 'Medium', null, null, null, null, '~1-3M', 131072],
    // New providers — recurring monthly free tiers, no card required
    ['zhipu', 'glm-4.5-flash', 'GLM-4.5 Flash', 5, 4, 'Large', null, null, null, 1000000, '~30M', 131072],
    ['moonshot', 'kimi-latest', 'Kimi Latest', 4, 8, 'Large', 60, null, null, 500000, '~15M', 200000],
    ['minimax', 'MiniMax-M1', 'MiniMax M1', 5, 8, 'Large', 20, null, 1000000, null, '~30M', 200000],
  ];

  const insert = db.prepare(`
    INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const m of models) {
    await insert.bind(...m).run();
  }
}

// ── Unified API key ───────────────────────────────────────────────────────────

export async function getUnifiedApiKey(db: D1DB): Promise<string> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'unified_api_key'")
    .first<{ value: string }>();
  if (row) return row.value;

  // First call: generate and persist
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const key = `sk-free-${hex}`;
  await db
    .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('unified_api_key', ?)")
    .bind(key)
    .run();
  console.log(`\n  Your unified API key: ${key}\n`);
  return key;
}

export async function regenerateUnifiedKey(db: D1DB): Promise<string> {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const key = `sk-free-${hex}`;
  await db
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('unified_api_key', ?)")
    .bind(key)
    .run();
  return key;
}

// ── Encryption key ────────────────────────────────────────────────────────────
// Stored in DB (AES-GCM key material as hex). Falls back to ENCRYPTION_KEY env.

const KEY_HEX_LEN = 64; // 32 bytes × 2 hex chars

function validateHexKey(value: string, source: string): string {
  if (value.length !== KEY_HEX_LEN || !/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error(
      `Invalid ENCRYPTION_KEY (${source}): expected ${KEY_HEX_LEN} hex chars (32 bytes), ` +
      `got ${value.length} chars.`,
    );
  }
  return value;
}

export async function getOrCreateEncryptionKeyHex(
  db: D1DB,
  envKey?: string,
): Promise<string> {
  // 1. Env var takes priority
  if (envKey && envKey !== 'your-64-char-hex-key-here') {
    return validateHexKey(envKey, 'env');
  }

  // 2. Persisted in DB
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'encryption_key'")
    .first<{ value: string }>();
  if (row) {
    return validateHexKey(row.value, 'db');
  }

  // 3. Generate and persist
  const rawKey = new Uint8Array(32);
  crypto.getRandomValues(rawKey);
  const hex = Array.from(rawKey)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  await db
    .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('encryption_key', ?)")
    .bind(hex)
    .run();
  return hex;
}
