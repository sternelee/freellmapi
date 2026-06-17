import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, maskKey, timingSafeEqual } from '../../lib/crypto.js';

const TEST_KEY = '0'.repeat(64); // 32 zero bytes as hex

describe('Crypto (Web Crypto API)', () => {
  it('should encrypt and decrypt a key round-trip', async () => {
    const original = 'gsk_test1234567890abcdef';
    const { encrypted, iv, authTag } = await encrypt(original, TEST_KEY);
    const decrypted = await decrypt(encrypted, iv, authTag, TEST_KEY);
    expect(decrypted).toBe(original);
  });

  it('should produce different ciphertext for same input (random IV)', async () => {
    const original = 'same-key';
    const a = await encrypt(original, TEST_KEY);
    const b = await encrypt(original, TEST_KEY);
    expect(a.encrypted).not.toBe(b.encrypted);
    expect(a.iv).not.toBe(b.iv);
  });

  it('should fail to decrypt with wrong auth tag', async () => {
    const { encrypted, iv } = await encrypt('test-key', TEST_KEY);
    await expect(decrypt(encrypted, iv, 'a'.repeat(32), TEST_KEY)).rejects.toThrow();
  });

  it('should fail to decrypt with wrong key', async () => {
    const { encrypted, iv, authTag } = await encrypt('test-key', TEST_KEY);
    const wrongKey = 'f'.repeat(64);
    await expect(decrypt(encrypted, iv, authTag, wrongKey)).rejects.toThrow();
  });

  it('should reject truncated auth tags (< 16 bytes) to block forgery brute-force', async () => {
    const { encrypted, iv, authTag } = await encrypt('test-key', TEST_KEY);
    for (const truncatedBytes of [4, 8, 12, 13, 14, 15]) {
      const truncated = authTag.slice(0, truncatedBytes * 2);
      await expect(decrypt(encrypted, iv, truncated, TEST_KEY)).rejects.toThrow();
    }
  });

  describe('maskKey', () => {
    it('should mask long keys', () => {
      expect(maskKey('gsk_test1234567890abcdef')).toBe('gsk_...cdef');
    });

    it('should mask short keys', () => {
      expect(maskKey('abcd')).toBe('****abcd');
    });
  });

  describe('timingSafeEqual', () => {
    it('returns true for equal strings', async () => {
      expect(await timingSafeEqual('hello', 'hello')).toBe(true);
    });

    it('returns false for different strings', async () => {
      expect(await timingSafeEqual('hello', 'world')).toBe(false);
    });

    it('returns false for different lengths', async () => {
      expect(await timingSafeEqual('short', 'a-much-longer-string')).toBe(false);
    });

    it('returns false for empty vs non-empty', async () => {
      expect(await timingSafeEqual('', 'something')).toBe(false);
    });
  });
});
