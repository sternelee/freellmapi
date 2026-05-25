import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import type { ChatMessage } from '@freellmapi/shared/types.js';
import {
  routeRequest, recordRateLimitHit, recordSuccess,
  recordRequest, recordTokens, setCooldown, type RouteResult,
} from '../services/router.js';
import { getRateLimiterStub, doPost, doPostNoReply } from '../services/doClient.js';
import { timingSafeEqual } from '../lib/crypto.js';
import { getUnifiedApiKey } from '../db/index.js';
import type { Env } from '../types.js';

export const proxyRouter = new Hono<{ Bindings: Env; Variables: { keyHex: string } }>();

const MAX_RETRIES = 20;

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
  thought_signature: z.string().optional(),
});

const systemMessageSchema = z.object({
  role: z.literal('system'),
  content: z.string(),
  name: z.string().optional(),
});

const userMessageSchema = z.object({
  role: z.literal('user'),
  content: z.string(),
  name: z.string().optional(),
});

const assistantMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable().optional(),
  name: z.string().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
}).refine(msg => {
  const hasContent = typeof msg.content === 'string' && msg.content.length > 0;
  const hasToolCalls = (msg.tool_calls?.length ?? 0) > 0;
  return hasContent || hasToolCalls;
}, { message: 'assistant messages must include non-empty content or tool_calls' });

const toolMessageSchema = z.object({
  role: z.literal('tool'),
  content: z.string(),
  tool_call_id: z.string().min(1),
  name: z.string().optional(),
});

const toolDefinitionSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().optional(),
  }),
});

const toolChoiceSchema = z.union([
  z.enum(['none', 'auto', 'required']),
  z.object({
    type: z.literal('function'),
    function: z.object({ name: z.string().min(1) }),
  }),
]);

const chatCompletionSchema = z.object({
  messages: z.array(z.union([
    systemMessageSchema, userMessageSchema, assistantMessageSchema, toolMessageSchema,
  ])).min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
  tools: z.array(toolDefinitionSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
});

function isRetryableError(err: any): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')
    || msg.includes('quota') || msg.includes('resource_exhausted')
    || msg.includes('aborted') || msg.includes('timeout') || msg.includes('etimedout')
    || msg.includes('econnrefused') || msg.includes('econnreset')
    || msg.includes('503') || msg.includes('unavailable')
    || msg.includes('500') || msg.includes('internal server error')
    // 413: this model's payload limit is too small for the request, but another
    // provider in the fallback chain may have a larger limit. Same reasoning as 503.
    || msg.includes('413') || msg.includes('payload too large') || msg.includes('request body too large')
    || msg.includes('request entity too large') || msg.includes('content too large')
    // 404: model deprecated/removed upstream (e.g. OpenRouter's "no endpoints found"
    // for a model that's been pulled). Rotate to the next model in the chain.
    || msg.includes('404') || msg.includes('not found') || msg.includes('no endpoints found');
}

/** Stable session key: hash of the first user message using Web Crypto SHA-1. */
async function getSessionKey(messages: ChatMessage[]): Promise<string | null> {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser || typeof firstUser.content !== 'string') return null;
  const hasMultiTurn = messages.some(m => m.role === 'assistant');
  if (!hasMultiTurn) return null;
  const encoded = new TextEncoder().encode(firstUser.content);
  const hashBuf = await crypto.subtle.digest('SHA-1', encoded);
  const hex = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex}:${messages.length > 2 ? 'multi' : 'single'}`;
}

async function getStickyModel(env: Env, messages: ChatMessage[]): Promise<number | undefined> {
  const sessionKey = await getSessionKey(messages);
  if (!sessionKey) return undefined;
  const stub = getRateLimiterStub(env);
  const modelDbId = await doPost<number | null>(stub, '/get-sticky', { sessionKey });
  return modelDbId ?? undefined;
}

async function setStickyModel(env: Env, messages: ChatMessage[], modelDbId: number): Promise<void> {
  const sessionKey = await getSessionKey(messages);
  if (!sessionKey) return;
  const stub = getRateLimiterStub(env);
  await doPostNoReply(stub, '/set-sticky', { sessionKey, modelDbId });
}

async function logRequest(
  db: D1Database,
  platform: string,
  modelId: string,
  status: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  error: string | null,
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(platform, modelId, status, inputTokens, outputTokens, Math.round(latencyMs), error).run();
  } catch (e) {
    console.error('[Proxy] Failed to log request:', e);
  }
}

// OpenAI-compatible /models endpoint
proxyRouter.get('/models', async (c) => {
  const { results: models } = await c.env.DB
    .prepare('SELECT platform, model_id, display_name, context_window FROM models WHERE enabled = 1 ORDER BY intelligence_rank')
    .all<{ platform: string; model_id: string; display_name: string; context_window: number | null }>();

  return c.json({
    object: 'list',
    data: models.map(m => ({
      id: m.model_id,
      object: 'model',
      created: 0,
      owned_by: m.platform,
      name: m.display_name,
      context_window: m.context_window,
    })),
  });
});

proxyRouter.post('/chat/completions', async (c) => {
  const start = Date.now();
  const db = c.env.DB;
  const keyHex = c.get('keyHex');

  // Authenticate: all requests require a Bearer token matching the unified key.
  // Unlike the Node.js version, CF Workers don't expose a trusted local IP.
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const unifiedKey = await getUnifiedApiKey(db);
  if (!token || !(await timingSafeEqual(token, unifiedKey))) {
    return c.json({ error: { message: 'Invalid API key', type: 'authentication_error' } }, 401);
  }

  // Validate request body
  const body = await c.req.json().catch(() => null);
  const parsed = chatCompletionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: {
        message: `Invalid request: ${parsed.error.issues.map((e: { message: string }) => e.message).join(', ')}`,
        type: 'invalid_request_error',
      },
    }, 400);
  }

  const {
    model: requestedModel, temperature, max_tokens, top_p,
    stream: wantStream, tools, tool_choice, parallel_tool_calls,
  } = parsed.data;

  const messages: ChatMessage[] = parsed.data.messages.map((m): ChatMessage => {
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content ?? null,
        ...(m.name ? { name: m.name } : {}),
        ...(m.tool_calls ? { tool_calls: m.tool_calls.map(tc => ({
          id: tc.id, type: tc.type, function: tc.function,
          thought_signature: tc.thought_signature,
        })) } : {}),
      };
    }
    if (m.role === 'tool') {
      return {
        role: 'tool', content: m.content, tool_call_id: m.tool_call_id,
        ...(m.name ? { name: m.name } : {}),
      };
    }
    return { role: m.role, content: m.content, ...(m.name ? { name: m.name } : {}) };
  });

  const estimatedInputTokens = messages.reduce((sum, m) =>
    typeof m.content === 'string' ? sum + Math.ceil(m.content.length / 4) : sum, 0);
  const estimatedTotal = estimatedInputTokens + (max_tokens ?? 1000);

  // Resolve preferred model
  let preferredModel: number | undefined;
  if (requestedModel) {
    const enabled = await db
      .prepare('SELECT id FROM models WHERE model_id = ? AND enabled = 1')
      .bind(requestedModel).first<{ id: number }>();
    if (enabled) {
      preferredModel = enabled.id;
    } else {
      const disabled = await db
        .prepare('SELECT id FROM models WHERE model_id = ?')
        .bind(requestedModel).first<{ id: number }>();
      const reason = disabled ? 'is disabled' : 'is not in the catalog';
      return c.json({
        error: {
          message: `Model '${requestedModel}' ${reason}. Omit the 'model' field to auto-route.`,
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      }, 400);
    }
  } else {
    preferredModel = await getStickyModel(c.env, messages);
  }

  const skipKeys = new Set<string>();
  let lastError: any = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let route: RouteResult;
    try {
      route = await routeRequest(db, c.env, keyHex, estimatedTotal, skipKeys.size > 0 ? skipKeys : undefined, preferredModel);
    } catch (err: any) {
      console.error('[Proxy] routeRequest error:', err);
      const status = lastError ? 429 : (err.status ?? 503);
      const message = lastError
        ? `All models rate-limited. Last error: ${lastError.message}`
        : err.message;
      return c.json({ error: { message, type: lastError ? 'rate_limit_error' : 'routing_error' } }, status);
    }

    await recordRequest(c.env, route.platform, route.modelId, route.keyId);

    try {
      if (wantStream) {
        // Streaming SSE response using hono/streaming
        let totalOutputTokens = 0;
        let streamStarted = false;

        // Set SSE headers on the context before calling stream()
        c.res.headers.set('Content-Type', 'text/event-stream');
        c.res.headers.set('Cache-Control', 'no-cache');
        c.res.headers.set('X-Routed-Via', `${route.platform}/${route.modelId}`);
        if (attempt > 0) c.res.headers.set('X-Fallback-Attempts', String(attempt));

        return stream(c, async (s) => {
          const gen = route.provider.streamChatCompletion(
            route.apiKey, messages, route.modelId,
            { temperature, max_tokens, top_p, tools, tool_choice: tool_choice as any, parallel_tool_calls },
          );

          try {
            for await (const chunk of gen) {
              if (!streamStarted) streamStarted = true;
              const text = chunk.choices[0]?.delta?.content ?? '';
              totalOutputTokens += Math.ceil(text.length / 4);
              await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }

            await s.write('data: [DONE]\n\n');

            await Promise.all([
              recordTokens(c.env, route.platform, route.modelId, route.keyId, estimatedInputTokens + totalOutputTokens),
              recordSuccess(c.env, route.modelDbId),
              setStickyModel(c.env, messages, route.modelDbId),
              logRequest(db, route.platform, route.modelId, 'success', estimatedInputTokens, totalOutputTokens, Date.now() - start, null),
            ]);
          } catch (streamErr: any) {
            if (streamStarted) {
              // Mid-stream error — emit error SSE frame then close cleanly
              console.error(`[Proxy] Mid-stream error from ${route.displayName}:`, streamErr.message);
              const payload = { error: { message: `Provider error (${route.displayName}): stream interrupted`, type: 'stream_error' } };
              try { await s.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* socket gone */ }
              try { await s.write('data: [DONE]\n\n'); } catch { /* socket gone */ }
              await logRequest(db, route.platform, route.modelId, 'error', estimatedInputTokens, totalOutputTokens, Date.now() - start, streamErr.message);
            } else {
              // Pre-stream error — can't retry via outer loop when inside stream()
              const payload = { error: { message: streamErr.message, type: 'provider_error' } };
              await s.write(`data: ${JSON.stringify(payload)}\n\n`);
              await s.write('data: [DONE]\n\n');
              await logRequest(db, route.platform, route.modelId, 'error', estimatedInputTokens, 0, Date.now() - start, streamErr.message);
            }
          }
        });
      } else {
        // Non-streaming
        const result = await route.provider.chatCompletion(
          route.apiKey, messages, route.modelId,
          { temperature, max_tokens, top_p, tools, tool_choice: tool_choice as any, parallel_tool_calls },
        );

        const totalTokens = result.usage?.total_tokens ?? 0;
        await Promise.all([
          recordTokens(c.env, route.platform, route.modelId, route.keyId, totalTokens),
          recordSuccess(c.env, route.modelDbId),
          setStickyModel(c.env, messages, route.modelDbId),
          logRequest(db, route.platform, route.modelId, 'success',
            result.usage?.prompt_tokens ?? 0,
            result.usage?.completion_tokens ?? 0,
            Date.now() - start, null),
        ]);

        return new Response(JSON.stringify(result), {
          headers: {
            'Content-Type': 'application/json',
            'X-Routed-Via': `${route.platform}/${route.modelId}`,
            ...(attempt > 0 ? { 'X-Fallback-Attempts': String(attempt) } : {}),
          },
        });
      }
    } catch (err: any) {
      const latency = Date.now() - start;
      await logRequest(db, route.platform, route.modelId, 'error', estimatedInputTokens, 0, latency, err.message);

      if (isRetryableError(err)) {
        const skipId = `${route.platform}:${route.modelId}:${route.keyId}`;
        skipKeys.add(skipId);
        await Promise.all([
          setCooldown(c.env, route.platform, route.modelId, route.keyId, 120_000),
          recordRateLimitHit(c.env, route.modelDbId),
        ]);
        lastError = err;
        console.log(`[Proxy] ${err.message.slice(0, 60)} from ${route.displayName}, falling back (attempt ${attempt + 1}/${MAX_RETRIES})`);
        continue;
      }

      return c.json({
        error: {
          message: `Provider error (${route.displayName}): ${err.message}`,
          type: 'provider_error',
        },
      }, 502);
    }
  }

  return c.json({
    error: {
      message: `All models rate-limited after ${MAX_RETRIES} attempts. Last: ${lastError?.message}`,
      type: 'rate_limit_error',
    },
  }, 429);
});
