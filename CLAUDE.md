# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FreeLLMAPI is an OpenAI-compatible API proxy that aggregates free-tier LLM providers (Google, Groq, Cerebras, SambaNova, Mistral, OpenRouter, GitHub Models, Cloudflare, Cohere, Zhipu, Ollama, Kilo, Pollinations, LLM7). It runs as a Cloudflare Worker with a React admin dashboard.

## Workspace Structure

Monorepo managed by pnpm workspaces (`pnpm-workspace.yaml`):

- `shared/` — TypeScript types shared between server and client. No build step; imported directly.
- `server/` — Hono-based Cloudflare Worker. Entry: `src/index.ts`.
- `client/` — React 19 + Vite + Tailwind CSS v4 + shadcn/ui admin dashboard.

## Common Commands

Install dependencies:
```bash
pnpm install
```

Develop (server + client concurrently):
```bash
pnpm dev
```
- Server runs via `wrangler dev` (uses `server/wrangler.jsonc`)
- Client runs via `vite dev` with proxy to server on `:3001`
- Vite proxies `/api` and `/v1` to the local wrangler dev server

Run tests:
```bash
# All tests (server only — client has no test suite)
pnpm test

# Server tests only
pnpm --filter @freellmapi/server test

# Watch mode
pnpm --filter @freellmapi/server test:watch

# Single test file
pnpm --filter @freellmapi/server vitest run src/__tests__/services/router.test.ts
```

Build:
```bash
# Both
pnpm build

# Server only (dry-run deploy)
pnpm --filter @freellmapi/server build

# Client only
pnpm --filter @freellmapi/client build
```

Deploy:
```bash
pnpm --filter @freellmapi/server deploy
```

Database migrations (D1):
```bash
# Local
pnpm --filter @freellmapi/server db:migrate:local

# Remote
pnpm --filter @freellmapi/server db:migrate:remote
```

## Architecture

### Server (`server/src/`)

**Hono app** (`app.ts`) mounts routes under `/api/*` (admin) and `/v1` (OpenAI-compatible proxy). Global middleware: CORS, secure headers, encryption key resolution, bearer-token auth for admin routes.

**Worker entry** (`index.ts`) exports `fetch` (HTTP), `scheduled` (cron every 5 min for health checks), and `RateLimiterDO` (Durable Object class). Schema is ensured lazily on first request.

**Cloudflare bindings** (`types.ts`):
- `DB` — D1 SQLite database (schema in `db/index.ts`)
- `SESSIONS` — KV namespace for sticky session storage
- `RATE_LIMITER` — Durable Object namespace for in-memory rate-limit state
- `ENCRYPTION_KEY` — secret: 64-char hex string for AES-256-GCM

**Routing** (`services/router.ts`):
- Reads fallback chain from D1 (`fallback_config` table ordered by priority)
- Queries `RateLimiterDO` for penalties, cooldowns, round-robin index, and rate-limit windows (RPM/RPD/TPM/TPD)
- Picks the first model with a healthy, non-cooldown, under-limit key
- Decrypts the key via `lib/crypto.ts` and returns a `RouteResult`
- Sticky sessions: same conversation hashes to same model for 30 min

**Rate limiter DO** (`services/rateLimiterDO.ts`):
- Single global DO instance (`idFromName('global')`)
- Tracks per-`(platform, model, key)` request windows, token windows, cooldowns, round-robin indices, penalty scores (decay over time), and sticky session mappings
- Communicated with via internal `doPost`/`doPostNoReply` helpers in `doClient.ts`

**Providers** (`providers/`):
- `base.ts` — abstract `BaseProvider` with `chatCompletion`, `streamChatCompletion`, `validateKey`
- `index.ts` — registry map. Most providers use `OpenAICompatProvider` (Groq, Cerebras, SambaNova, NVIDIA, Mistral, OpenRouter, GitHub, Zhipu, Ollama, Kilo, Pollinations, LLM7)
- `google.ts` — Gemini API with function-calling translation
- `cohere.ts` — Cohere compatibility endpoint
- `cloudflare.ts` — Workers AI with `account_id:token` key format

**Proxy route** (`routes/proxy.ts`):
- `POST /v1/chat/completions` — validates body with Zod, authenticates unified key, routes via `router.ts`, retries up to 20 times on retryable errors (429, 5xx, timeout), records analytics to D1
- `GET /v1/models` — lists enabled models from D1
- Streaming uses `hono/streaming` with SSE format
- Non-streaming returns JSON with `X-Routed-Via` and `X-Fallback-Attempts` headers

**Admin routes** (`routes/`):
- `keys.ts` — CRUD for encrypted provider API keys
- `fallback.ts` — reorder fallback chain (PUT requires auth)
- `models.ts` — list models
- `analytics.ts` — query request logs from D1
- `health.ts` — trigger/manual health checks
- `settings.ts` — unified API key management

**Crypto** (`lib/crypto.ts`):
- AES-256-GCM envelope encryption using Web Crypto API
- `timingSafeEqual` for constant-time API key comparison

### Client (`client/src/`)

React 19 SPA with React Router. Pages: Keys, Fallback Chain, Analytics, Playground.
- API client in `lib/api.ts`
- UI components in `components/ui/` (shadcn/ui style, custom built with Base UI + Tailwind v4)
- `vite.config.ts` proxies `/api` and `/v1` to the local server

### Shared (`shared/types.ts`)

Single source of truth for `Platform` union, chat types, analytics types, and rate-limit types. Any new provider must update this file and `server/src/providers/index.ts`.

## Adding a New Provider

1. Add platform to `Platform` union in `shared/types.ts`
2. If OpenAI-compatible: register in `server/src/providers/index.ts` with `OpenAICompatProvider`
3. If custom API: create `server/src/providers/<name>.ts` extending `BaseProvider`, register in `index.ts`
4. Add models to D1 seed (`db/index.ts` or migration)
5. Add test in `server/src/__tests__/providers/`

## Testing

Server uses Vitest with `environment: 'node'`. Tests cover providers, routes, router logic, rate limiting, crypto, and idempotency. No client test suite exists.

## Deployment

Cloudflare Workers. Requires:
- D1 database (`freellmapi`)
- KV namespace (`SESSIONS`)
- Durable Object binding (`RATE_LIMITER`)
- Secret `ENCRYPTION_KEY` (set via `wrangler secret put ENCRYPTION_KEY`)

Assets served from `client/dist` via Workers Sites (`[assets]` in `wrangler.jsonc`).
## Upstream Merge Policy

When merging upstream (`upstream/main`), **always preserve the Cloudflare Workers architecture**:
- Hono (not Express)
- D1 async database API (not better-sqlite3 / synchronous SQLite)
- Durable Objects for rate-limit state (not in-memory Node.js modules)
- Web Crypto API for encryption (not Node.js `crypto` module)
- pnpm workspace scripts (not npm workspace syntax)

Accept upstream functional improvements (bug fixes, retry logic, new endpoints, schema additions), but reject any architecture migration toward Node.js/Express/SQLite.
