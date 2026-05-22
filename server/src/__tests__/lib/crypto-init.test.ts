import { describe, it, expect } from 'vitest';
import { getOrCreateEncryptionKeyHex } from '../../db/index.js';

// Minimal D1Database mock that supports:
//   db.prepare(sql).first()            — direct first (no bind)
//   db.prepare(sql).bind(...).first()  — bound first
//   db.prepare(sql).bind(...).run()    — insert
function makeMockD1(storedKey?: string): D1Database {
  const store = new Map<string, string>();
  if (storedKey) store.set('encryption_key', storedKey);

  const makeStmt = (sql: string, args: unknown[] = []) => ({
    first: async () => {
      if (sql.includes('WHERE key =')) {
        const keyName = args[0] as string ?? 'encryption_key';
        if (store.has(keyName)) return { value: store.get(keyName) };
        return null;
      }
      return null;
    },
    run: async () => {
      if (sql.includes('INSERT OR IGNORE')) {
        const [k, v] = args as [string, string];
        if (!store.has(k)) store.set(k, v);
      }
      return { success: true, meta: {} };
    },
    all: async () => ({ results: [] }),
    bind: (...bindArgs: unknown[]) => makeStmt(sql, bindArgs),
  });

  return {
    prepare: (sql: string) => makeStmt(sql) as any,
    exec: async () => ({ count: 0, duration: 0 }),
    batch: async () => [],
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

describe('getOrCreateEncryptionKeyHex', () => {
  it('accepts a valid 64-char hex env key', async () => {
    const db = makeMockD1();
    const hex = await getOrCreateEncryptionKeyHex(db, 'a'.repeat(64));
    expect(hex).toBe('a'.repeat(64));
  });

  it('throws on too-short env key', async () => {
    const db = makeMockD1();
    await expect(getOrCreateEncryptionKeyHex(db, 'abc')).rejects.toThrow(/Invalid ENCRYPTION_KEY \(env\)/);
  });

  it('throws on too-long env key', async () => {
    const db = makeMockD1();
    await expect(getOrCreateEncryptionKeyHex(db, 'a'.repeat(80))).rejects.toThrow(/Invalid ENCRYPTION_KEY \(env\)/);
  });

  it('throws on non-hex env key of correct length', async () => {
    const db = makeMockD1();
    await expect(getOrCreateEncryptionKeyHex(db, 'g'.repeat(64))).rejects.toThrow(/Invalid ENCRYPTION_KEY \(env\)/);
  });

  it('treats the placeholder value as not set', async () => {
    const db = makeMockD1();
    const hex = await getOrCreateEncryptionKeyHex(db, 'your-64-char-hex-key-here');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads key from DB when no env key provided', async () => {
    const stored = 'b'.repeat(64);
    const db = makeMockD1(stored);
    const hex = await getOrCreateEncryptionKeyHex(db);
    expect(hex).toBe(stored);
  });

  it('throws on a corrupted DB-stored key', async () => {
    const db = makeMockD1('not-hex');
    await expect(getOrCreateEncryptionKeyHex(db)).rejects.toThrow(/Invalid ENCRYPTION_KEY \(db\)/);
  });

  it('generates a fresh key when DB has no key and no env', async () => {
    const db = makeMockD1();
    const hex = await getOrCreateEncryptionKeyHex(db);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});
