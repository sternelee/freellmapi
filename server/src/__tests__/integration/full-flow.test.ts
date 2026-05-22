import { describe, it } from 'vitest';

/**
 * Full integration tests require a live D1 + KV + Durable Object.
 * Run with: wrangler dev --local and @cloudflare/vitest-pool-workers
 */
describe('Full flow (integration — requires @cloudflare/vitest-pool-workers)', () => {
  it.skip('complete chat request lifecycle', () => {});
  it.skip('streaming response', () => {});
  it.skip('fallback on rate limit', () => {});
});
