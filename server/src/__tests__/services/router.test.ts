import { describe, it, expect } from 'vitest';

/**
 * Router tests require a live D1 database + Durable Object.
 * Run integration tests with: wrangler dev + @cloudflare/vitest-pool-workers
 *
 * Unit-level coverage of the routing algorithm is provided indirectly via
 * the RateLimiterDO tests in services/ratelimit.test.ts.
 */
describe('Router (integration — requires @cloudflare/vitest-pool-workers)', () => {
  it.skip('should throw when no keys are configured', () => {});
  it.skip('should route to highest priority model with available key', () => {});
  it.skip('should prefer higher-priority model when keys exist for multiple platforms', () => {});
});
