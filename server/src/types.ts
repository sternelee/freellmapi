// Cloudflare Workers bindings, injected via env parameter
export interface Env {
  // Cloudflare D1 — persistent SQLite database
  DB: D1Database;
  // Cloudflare KV — sticky session storage (TTL-based)
  SESSIONS: KVNamespace;
  // Cloudflare Durable Object — in-memory rate-limit state
  RATE_LIMITER: DurableObjectNamespace;
  // Secret: 64-char hex-encoded 32-byte AES-256-GCM key
  ENCRYPTION_KEY?: string;
}
