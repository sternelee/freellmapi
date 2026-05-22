const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

function getAdminKey(): string | null {
  return localStorage.getItem('freellmapi_admin_key');
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const adminKey = getAdminKey();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(adminKey ? { Authorization: `Bearer ${adminKey}` } : {}),
      ...options?.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}
