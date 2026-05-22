import { describe, it } from 'vitest';

/**
 * Proxy tool-call tests require a live D1 database + Durable Object.
 * Run with: @cloudflare/vitest-pool-workers
 */
describe('Proxy tool calls (integration — requires @cloudflare/vitest-pool-workers)', () => {
  it.skip('passes tool definitions to provider', () => {});
  it.skip('returns tool call results from provider', () => {});
});
