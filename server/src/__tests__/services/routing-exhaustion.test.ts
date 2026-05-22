import { describe, it } from 'vitest';

/**
 * Routing exhaustion tests require a live D1 database + Durable Object.
 * Run integration tests with: wrangler dev + @cloudflare/vitest-pool-workers
 */
describe('Routing exhaustion (integration — requires @cloudflare/vitest-pool-workers)', () => {
  it.skip('should exhaust all models and return 429', () => {});
});
