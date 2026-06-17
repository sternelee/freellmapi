/**
 * Cloudflare Workers-compatible proxy module.
 *
 * Workers don't support Node.js http/https/undici/socks-proxy-agent, so this
 * is a no-op pass-through to the global `fetch()`. The API surface is kept
 * identical so `providers/base.ts`, `google.ts`, and `embeddings.ts` continue
 * to compile without changes.
 */

let _proxyUrl = '';
let _proxyEnabled = true;
let _bypassPlatforms = '';

/** Set the active proxy URL. Ignored in CF Workers (direct fetch only). */
export function applyProxyUrl(url: string): void {
  _proxyUrl = url || '';
}

/** Return the currently configured proxy URL (empty = none). */
export function getProxyUrl(): string {
  return _proxyUrl;
}

export function applyProxyEnabled(enabled: boolean): void {
  _proxyEnabled = enabled;
}

export function isProxyEnabled(): boolean {
  return _proxyEnabled;
}

export function applyProxyBypass(csv: string): void {
  _bypassPlatforms = csv || '';
}

export function getProxyBypassPlatforms(): string[] {
  return _bypassPlatforms.split(',').map(s => s.trim()).filter(Boolean);
}

function shouldBypassProxy(platform?: string): boolean {
  if (!_proxyEnabled) return true;
  if (!_proxyUrl) return true;
  if (platform && getBypassSet().has(platform)) return true;
  return false;
}

let _bypassSet: Set<string> | null = null;
function getBypassSet(): Set<string> {
  if (!_bypassSet) {
    _bypassSet = new Set(getBypassPlatforms());
  }
  return _bypassSet;
}

function getBypassPlatforms(): string[] {
  return _bypassPlatforms.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Drop-in replacement for fetch that would route through a proxy.
 * In Workers this is always a direct pass-through.
 */
export async function proxyFetch(
  url: string,
  init?: RequestInit,
  _platform?: string,
): Promise<Response> {
  return fetch(url, init);
}

/** Returns true when the proxy is configured AND enabled. */
export function isProxyActive(): boolean {
  return _proxyEnabled && !!_proxyUrl;
}
