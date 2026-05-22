// Helper to call the RateLimiterDO
import type { Env } from '../types.js';

export function getRateLimiterStub(env: Env): DurableObjectStub {
  const id = env.RATE_LIMITER.idFromName('global');
  return env.RATE_LIMITER.get(id);
}

export async function doPost<T>(stub: DurableObjectStub, path: string, body: unknown): Promise<T> {
  const res = await stub.fetch(`https://do${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DO ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function doPostNoReply(stub: DurableObjectStub, path: string, body: unknown): Promise<void> {
  await stub.fetch(`https://do${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
