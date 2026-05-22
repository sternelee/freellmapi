// Cloudflare D1 database helpers
// All operations are async (D1 API) — no global state, D1 instance passed per call.

export type D1DB = D1Database;

// ── Schema ────────────────────────────────────────────────────────────────────
// Applied by `wrangler d1 migrations apply`. Calling initDb() at runtime is a
// defensive no-op check so the worker doesn't crash on missing tables.

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS models (
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
);
CREATE TABLE IF NOT EXISTS api_keys (
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
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fallback_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_db_id INTEGER NOT NULL REFERENCES models(id),
  priority INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(model_db_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
CREATE INDEX IF NOT EXISTS idx_requests_platform ON requests(platform);
CREATE INDEX IF NOT EXISTS idx_api_keys_platform ON api_keys(platform);
`;

/** Ensure tables exist (idempotent). Call once per Worker invocation. */
export async function ensureSchema(db: D1DB): Promise<void> {
  await db.exec(SCHEMA_DDL);
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
