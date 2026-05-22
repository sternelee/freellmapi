// Durable Object — single global instance that owns all rate-limit state.
// Workers proxy via `env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName('global'))`.

interface Window {
  timestamps: number[];
  tokenTimestamps: { ts: number; tokens: number }[];
}

interface StickyEntry {
  modelDbId: number;
  lastUsed: number;
}

interface PenaltyEntry {
  count: number;
  lastHit: number;
  penalty: number;
}

interface Limits {
  rpm: number | null;
  rpd: number | null;
  tpm: number | null;
  tpd: number | null;
}

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const STICKY_TTL_MS = 30 * 60 * 1000;
const PENALTY_PER_429 = 3;
const MAX_PENALTY = 10;
const DECAY_INTERVAL_MS = 2 * 60 * 1000;
const DECAY_AMOUNT = 1;

export class RateLimiterDO {
  private windows = new Map<string, Window>();
  private cooldowns = new Map<string, number>(); // key -> expiry ms
  private roundRobinIndex = new Map<string, number>();
  private penalties = new Map<number, PenaltyEntry>();
  private stickyMap = new Map<string, StickyEntry>();

  // Durable Objects require this constructor shape
  constructor(_state: DurableObjectState, _env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = await request.json() as Record<string, unknown>;

    switch (url.pathname) {
      case '/can-make-request':
        return Response.json(this.canMakeRequest(body));
      case '/can-use-tokens':
        return Response.json(this.canUseTokens(body));
      case '/record-request':
        this.recordRequest(body);
        return new Response('ok');
      case '/record-tokens':
        this.recordTokens(body);
        return new Response('ok');
      case '/set-cooldown':
        this.setCooldown(body);
        return new Response('ok');
      case '/is-on-cooldown':
        return Response.json(this.isOnCooldown(body));
      case '/get-round-robin':
        return Response.json(this.getRoundRobin(body));
      case '/set-round-robin':
        this.setRoundRobin(body);
        return new Response('ok');
      case '/get-penalty':
        return Response.json(this.getPenalty(body));
      case '/record-rl-hit':
        this.recordRlHit(body);
        return new Response('ok');
      case '/record-success':
        this.recordSuccess(body);
        return new Response('ok');
      case '/get-all-penalties':
        return Response.json(this.getAllPenalties());
      case '/get-sticky':
        return Response.json(this.getSticky(body));
      case '/set-sticky':
        this.setSticky(body);
        return new Response('ok');
      case '/get-rl-status':
        return Response.json(this.getRlStatus(body));
      default:
        return new Response('not found', { status: 404 });
    }
  }

  private getWindow(key: string): Window {
    let w = this.windows.get(key);
    if (!w) {
      w = { timestamps: [], tokenTimestamps: [] };
      this.windows.set(key, w);
    }
    return w;
  }

  private pruneTimestamps(timestamps: number[], windowMs: number, now: number): number[] {
    const cutoff = now - windowMs;
    return timestamps.filter(ts => ts > cutoff);
  }

  canMakeRequest(body: Record<string, unknown>): boolean {
    const { platform, modelId, keyId, limits } = body as {
      platform: string; modelId: string; keyId: number; limits: Limits;
    };
    const now = Date.now();

    if (limits.rpm !== null) {
      const key = `${platform}:${modelId}:${keyId}:rpm`;
      const w = this.getWindow(key);
      w.timestamps = this.pruneTimestamps(w.timestamps, MINUTE, now);
      if (w.timestamps.length >= limits.rpm) return false;
    }

    if (limits.rpd !== null) {
      const key = `${platform}:${modelId}:${keyId}:rpd`;
      const w = this.getWindow(key);
      w.timestamps = this.pruneTimestamps(w.timestamps, DAY, now);
      if (w.timestamps.length >= limits.rpd) return false;
    }

    return true;
  }

  canUseTokens(body: Record<string, unknown>): boolean {
    const { platform, modelId, keyId, estimatedTokens, limits } = body as {
      platform: string; modelId: string; keyId: number; estimatedTokens: number; limits: Limits;
    };
    const now = Date.now();

    if (limits.tpm !== null) {
      const key = `${platform}:${modelId}:${keyId}:tpm`;
      const w = this.getWindow(key);
      w.tokenTimestamps = w.tokenTimestamps.filter(t => t.ts > now - MINUTE);
      const used = w.tokenTimestamps.reduce((s, t) => s + t.tokens, 0);
      if (used + estimatedTokens > limits.tpm) return false;
    }

    if (limits.tpd !== null) {
      const key = `${platform}:${modelId}:${keyId}:tpd`;
      const w = this.getWindow(key);
      w.tokenTimestamps = w.tokenTimestamps.filter(t => t.ts > now - DAY);
      const used = w.tokenTimestamps.reduce((s, t) => s + t.tokens, 0);
      if (used + estimatedTokens > limits.tpd) return false;
    }

    return true;
  }

  recordRequest(body: Record<string, unknown>): void {
    const { platform, modelId, keyId } = body as { platform: string; modelId: string; keyId: number };
    const now = Date.now();
    this.getWindow(`${platform}:${modelId}:${keyId}:rpm`).timestamps.push(now);
    this.getWindow(`${platform}:${modelId}:${keyId}:rpd`).timestamps.push(now);
  }

  recordTokens(body: Record<string, unknown>): void {
    const { platform, modelId, keyId, tokens } = body as {
      platform: string; modelId: string; keyId: number; tokens: number;
    };
    const now = Date.now();
    this.getWindow(`${platform}:${modelId}:${keyId}:tpm`).tokenTimestamps.push({ ts: now, tokens });
    this.getWindow(`${platform}:${modelId}:${keyId}:tpd`).tokenTimestamps.push({ ts: now, tokens });
  }

  setCooldown(body: Record<string, unknown>): void {
    const { platform, modelId, keyId, durationMs = 120_000 } = body as {
      platform: string; modelId: string; keyId: number; durationMs?: number;
    };
    const key = `${platform}:${modelId}:${keyId}:cooldown`;
    this.cooldowns.set(key, Date.now() + durationMs);
  }

  isOnCooldown(body: Record<string, unknown>): boolean {
    const { platform, modelId, keyId } = body as { platform: string; modelId: string; keyId: number };
    const key = `${platform}:${modelId}:${keyId}:cooldown`;
    const expiry = this.cooldowns.get(key);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      this.cooldowns.delete(key);
      return false;
    }
    return true;
  }

  getRoundRobin(body: Record<string, unknown>): number {
    const { key } = body as { key: string };
    return this.roundRobinIndex.get(key) ?? 0;
  }

  setRoundRobin(body: Record<string, unknown>): void {
    const { key, index } = body as { key: string; index: number };
    this.roundRobinIndex.set(key, index);
  }

  getPenalty(body: Record<string, unknown>): number {
    const { modelDbId } = body as { modelDbId: number };
    const entry = this.penalties.get(modelDbId);
    if (!entry) return 0;

    const now = Date.now();
    const elapsed = now - entry.lastHit;
    const steps = Math.floor(elapsed / DECAY_INTERVAL_MS);
    if (steps > 0) {
      entry.penalty = Math.max(0, entry.penalty - steps * DECAY_AMOUNT);
      entry.lastHit = now;
      if (entry.penalty === 0) { this.penalties.delete(modelDbId); return 0; }
    }
    return entry.penalty;
  }

  recordRlHit(body: Record<string, unknown>): void {
    const { modelDbId } = body as { modelDbId: number };
    const existing = this.penalties.get(modelDbId);
    const now = Date.now();
    if (existing) {
      existing.count++;
      existing.lastHit = now;
      existing.penalty = Math.min(existing.penalty + PENALTY_PER_429, MAX_PENALTY);
    } else {
      this.penalties.set(modelDbId, { count: 1, lastHit: now, penalty: PENALTY_PER_429 });
    }
  }

  recordSuccess(body: Record<string, unknown>): void {
    const { modelDbId } = body as { modelDbId: number };
    const existing = this.penalties.get(modelDbId);
    if (existing) {
      existing.penalty = Math.max(0, existing.penalty - 1);
      if (existing.penalty === 0) this.penalties.delete(modelDbId);
    }
  }

  getAllPenalties(): Array<{ modelDbId: number; count: number; penalty: number }> {
    const result: Array<{ modelDbId: number; count: number; penalty: number }> = [];
    for (const [modelDbId] of this.penalties) {
      const penalty = this.getPenalty({ modelDbId });
      const entry = this.penalties.get(modelDbId);
      if (entry && penalty > 0) {
        result.push({ modelDbId, count: entry.count, penalty });
      }
    }
    return result.sort((a, b) => b.penalty - a.penalty);
  }

  getSticky(body: Record<string, unknown>): number | null {
    const { sessionKey } = body as { sessionKey: string };
    const entry = this.stickyMap.get(sessionKey);
    if (!entry) return null;
    if (Date.now() - entry.lastUsed > STICKY_TTL_MS) {
      this.stickyMap.delete(sessionKey);
      return null;
    }
    return entry.modelDbId;
  }

  setSticky(body: Record<string, unknown>): void {
    const { sessionKey, modelDbId } = body as { sessionKey: string; modelDbId: number };
    this.stickyMap.set(sessionKey, { modelDbId, lastUsed: Date.now() });
    // Cleanup old entries
    if (this.stickyMap.size > 500) {
      const now = Date.now();
      for (const [k, v] of this.stickyMap) {
        if (now - v.lastUsed > STICKY_TTL_MS) this.stickyMap.delete(k);
      }
    }
  }

  getRlStatus(body: Record<string, unknown>): Record<string, { used: number; limit: number | null }> {
    const { platform, modelId, keyId, limits } = body as {
      platform: string; modelId: string; keyId: number; limits: Limits;
    };
    const now = Date.now();

    const rpmW = this.getWindow(`${platform}:${modelId}:${keyId}:rpm`);
    rpmW.timestamps = this.pruneTimestamps(rpmW.timestamps, MINUTE, now);
    const rpdW = this.getWindow(`${platform}:${modelId}:${keyId}:rpd`);
    rpdW.timestamps = this.pruneTimestamps(rpdW.timestamps, DAY, now);
    const tpmW = this.getWindow(`${platform}:${modelId}:${keyId}:tpm`);
    tpmW.tokenTimestamps = tpmW.tokenTimestamps.filter(t => t.ts > now - MINUTE);
    const tpmUsed = tpmW.tokenTimestamps.reduce((s, t) => s + t.tokens, 0);

    return {
      rpm: { used: rpmW.timestamps.length, limit: limits.rpm },
      rpd: { used: rpdW.timestamps.length, limit: limits.rpd },
      tpm: { used: tpmUsed, limit: limits.tpm },
    };
  }
}
