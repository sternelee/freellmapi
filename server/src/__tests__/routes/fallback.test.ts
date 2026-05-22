import { describe, it } from 'vitest';

/**
 * Fallback route tests require a live D1 database.
 * Run with: @cloudflare/vitest-pool-workers
 */
describe('Fallback API (integration — requires @cloudflare/vitest-pool-workers)', () => {
  it.skip('GET /api/fallback returns fallback chain', () => {});
  it.skip('PUT /api/fallback updates priorities', () => {});
  it.skip('POST /api/fallback/sort/:preset applies sort preset', () => {});
});
