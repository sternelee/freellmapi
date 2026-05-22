// Hono error handler — registered via app.onError() in app.ts
import type { Context } from 'hono';

export function errorHandler(err: Error, c: Context): Response {
  console.error('[Error]', err.message);
  const status = ((err as any).status ?? 500) as 400 | 500;
  return c.json({
    error: {
      message: err.message ?? 'Internal server error',
      type: (err as any).name ?? 'server_error',
    },
  }, status);
}
