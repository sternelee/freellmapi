// Web Crypto API — compatible with Cloudflare Workers runtime.
// AES-256-GCM encryption, 12-byte IV (standard for GCM).

const ALGORITHM = 'AES-GCM';
const KEY_BYTES = 32; // 256-bit key
const KEY_HEX_LEN = KEY_BYTES * 2; // 64 hex chars
const PLACEHOLDER_KEY = 'your-64-char-hex-key-here';

let cachedKey: CryptoKey | null = null;
let cachedKeyHex: string | null = null;

function validateHexKey(value: string, source: string): void {
  if (value.length !== KEY_HEX_LEN || !/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error(
      `Invalid ENCRYPTION_KEY (${source}): expected ${KEY_HEX_LEN} hex chars (32 bytes), got ${value.length} chars. ` +
      `Generate one with: openssl rand -hex 32`,
    );
  }
}

async function importKey(hexKey: string): Promise<CryptoKey> {
  if (hexKey === PLACEHOLDER_KEY) {
    throw new Error(
      'ENCRYPTION_KEY is set to the placeholder value. ' +
      `Set a real ${KEY_HEX_LEN}-char hex key, or remove the env var to allow DB fallback.`,
    );
  }
  validateHexKey(hexKey, 'env');
  const raw = hexToBytes(hexKey);
  return crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, ALGORITHM, false, ['encrypt', 'decrypt']);
}

async function getKey(hexKey: string): Promise<CryptoKey> {
  if (cachedKey && cachedKeyHex === hexKey) return cachedKey;
  cachedKey = await importKey(hexKey);
  cachedKeyHex = hexKey;
  return cachedKey;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function encrypt(
  text: string,
  keyHex: string,
): Promise<{ encrypted: string; iv: string; authTag: string }> {
  const key = await getKey(keyHex);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const encoded = new TextEncoder().encode(text);
  // AES-GCM output = ciphertext + 16-byte auth tag (appended by subtle.encrypt)
  const raw = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);

  const rawBytes = new Uint8Array(raw);
  const ciphertext = rawBytes.slice(0, rawBytes.length - 16);
  const authTag = rawBytes.slice(rawBytes.length - 16);

  return {
    encrypted: bytesToHex(ciphertext),
    iv: bytesToHex(iv),
    authTag: bytesToHex(authTag),
  };
}

export async function decrypt(
  encryptedHex: string,
  ivHex: string,
  authTagHex: string,
  keyHex: string,
): Promise<string> {
  const key = await getKey(keyHex);
  const iv = hexToBytes(ivHex);
  const ciphertext = hexToBytes(encryptedHex);
  const authTag = hexToBytes(authTagHex);

  // Reconstruct the raw AES-GCM blob: ciphertext || authTag
  const combinedBuf = new ArrayBuffer(ciphertext.length + authTag.length);
  const combined = new Uint8Array(combinedBuf);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv: iv as BufferSource }, key, combinedBuf);
  return new TextDecoder().decode(decrypted);
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '****' + key.slice(-4);
  return key.slice(0, 4) + '...' + key.slice(-4);
}

// Constant-time string comparison using HMAC to prevent timing attacks.
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  // Use a per-comparison random HMAC key — prevents pre-computation attacks.
  const keyMaterial = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(keyMaterial);
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const [hashA, hashB] = await Promise.all([
    crypto.subtle.sign('HMAC', hmacKey, aBytes),
    crypto.subtle.sign('HMAC', hmacKey, bBytes),
  ]);

  const a32 = new Uint8Array(hashA);
  const b32 = new Uint8Array(hashB);
  let diff = 0;
  for (let i = 0; i < a32.length; i++) diff |= a32[i] ^ b32[i];
  return diff === 0;
}
