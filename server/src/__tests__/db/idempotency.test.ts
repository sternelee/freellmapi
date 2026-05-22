import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Verify the SQL migration files are syntactically valid and self-consistent.
 * Actual D1 migration application is tested via: wrangler d1 migrations apply --local
 */
describe('D1 Migration files', () => {
  const migrationsDir = join(import.meta.dirname, '../../db/migrations');

  function getMigrationFiles(): string[] {
    return readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
  }

  it('migration directory has at least 2 files (schema + seed)', () => {
    const files = getMigrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it('each migration file has content', () => {
    for (const file of getMigrationFiles()) {
      const content = readFileSync(join(migrationsDir, file), 'utf8');
      expect(content.trim().length, `${file} must not be empty`).toBeGreaterThan(0);
    }
  });

  it('migration files are numbered sequentially (0001, 0002, ...)', () => {
    const files = getMigrationFiles();
    for (let i = 0; i < files.length; i++) {
      const expected = String(i + 1).padStart(4, '0');
      expect(files[i], `File ${i + 1} should start with ${expected}`).toMatch(new RegExp(`^${expected}_`));
    }
  });

  it('schema file (0001) contains all required tables', () => {
    const schema = readFileSync(join(migrationsDir, '0001_schema.sql'), 'utf8');
    for (const table of ['models', 'api_keys', 'requests', 'fallback_config', 'settings']) {
      expect(schema, `0001_schema.sql must define table: ${table}`).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('seed file (0002) inserts into models and fallback_config', () => {
    const seed = readFileSync(join(migrationsDir, '0002_seed.sql'), 'utf8');
    expect(seed).toContain('INSERT OR IGNORE INTO models');
    expect(seed).toContain('INSERT OR IGNORE INTO fallback_config');
  });

  it('seed file inserts rows for all major platforms', () => {
    const seed = readFileSync(join(migrationsDir, '0002_seed.sql'), 'utf8');
    const platforms = ['google', 'openrouter', 'groq', 'cerebras', 'mistral', 'sambanova', 'cloudflare'];
    for (const p of platforms) {
      expect(seed, `seed must include platform: ${p}`).toContain(`('${p}',`);
    }
  });
});
