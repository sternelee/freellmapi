import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiterDO } from "../../services/rateLimiterDO.js";

// Helper: construct the DO and call its fetch method
function makeRateLimiter(): RateLimiterDO {
  return new RateLimiterDO({} as any, {});
}

async function doFetch<T>(
  do_: RateLimiterDO,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await do_.fetch(
    new Request(`https://do${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return res.json() as T;
}

async function doFetchVoid(
  do_: RateLimiterDO,
  path: string,
  body: unknown,
): Promise<void> {
  await do_.fetch(
    new Request(`https://do${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("RateLimiterDO", () => {
  let limiter: RateLimiterDO;
  let testId: number;

  beforeEach(() => {
    limiter = makeRateLimiter();
    testId = Math.floor(Math.random() * 1_000_000);
  });

  describe("can-make-request", () => {
    it("allows request when under RPM limit", async () => {
      const result = await doFetch<boolean>(limiter, "/can-make-request", {
        platform: "groq",
        modelId: "llama-70b",
        keyId: testId,
        limits: { rpm: 30, rpd: null, tpm: null, tpd: null },
      });
      expect(result).toBe(true);
    });

    it("denies request when RPM limit reached", async () => {
      const platform = "groq",
        modelId = "llama-70b";
      await doFetchVoid(limiter, "/record-request", {
        platform,
        modelId,
        keyId: testId,
      });
      await doFetchVoid(limiter, "/record-request", {
        platform,
        modelId,
        keyId: testId,
      });

      const result = await doFetch<boolean>(limiter, "/can-make-request", {
        platform,
        modelId,
        keyId: testId,
        limits: { rpm: 2, rpd: null, tpm: null, tpd: null },
      });
      expect(result).toBe(false);
    });

    it("denies request when RPD limit reached", async () => {
      await doFetchVoid(limiter, "/record-request", {
        platform: "google",
        modelId: "gemini",
        keyId: testId,
      });

      const result = await doFetch<boolean>(limiter, "/can-make-request", {
        platform: "google",
        modelId: "gemini",
        keyId: testId,
        limits: { rpm: null, rpd: 1, tpm: null, tpd: null },
      });
      expect(result).toBe(false);
    });

    it("allows request when limits are null (unlimited)", async () => {
      const result = await doFetch<boolean>(limiter, "/can-make-request", {
        platform: "nvidia",
        modelId: "nemotron",
        keyId: testId,
        limits: { rpm: null, rpd: null, tpm: null, tpd: null },
      });
      expect(result).toBe(true);
    });
  });

  describe("can-use-tokens", () => {
    it("allows tokens when under TPM limit", async () => {
      const result = await doFetch<boolean>(limiter, "/can-use-tokens", {
        platform: "groq",
        modelId: "llama-70b",
        keyId: testId,
        estimatedTokens: 500,
        limits: { rpm: null, rpd: null, tpm: 6000, tpd: null },
      });
      expect(result).toBe(true);
    });

    it("denies tokens when TPM limit would be exceeded", async () => {
      await doFetchVoid(limiter, "/record-tokens", {
        platform: "cerebras",
        modelId: "qwen3",
        keyId: testId,
        tokens: 50000,
      });
      const result = await doFetch<boolean>(limiter, "/can-use-tokens", {
        platform: "cerebras",
        modelId: "qwen3",
        keyId: testId,
        estimatedTokens: 20000,
        limits: { rpm: null, rpd: null, tpm: 60000, tpd: null },
      });
      expect(result).toBe(false);
    });

    it("allows when limit is null", async () => {
      const result = await doFetch<boolean>(limiter, "/can-use-tokens", {
        platform: "nvidia",
        modelId: "nemotron",
        keyId: testId,
        estimatedTokens: 100000,
        limits: { rpm: null, rpd: null, tpm: null, tpd: null },
      });
      expect(result).toBe(true);
    });
  });

  describe("cooldowns", () => {
    it("is-on-cooldown returns false initially", async () => {
      const result = await doFetch<boolean>(limiter, "/is-on-cooldown", {
        platform: "groq",
        modelId: "llama",
        keyId: testId,
      });
      expect(result).toBe(false);
    });

    it("is-on-cooldown returns true after set-cooldown", async () => {
      await doFetchVoid(limiter, "/set-cooldown", {
        platform: "groq",
        modelId: "llama",
        keyId: testId,
        durationMs: 10000,
      });
      const result = await doFetch<boolean>(limiter, "/is-on-cooldown", {
        platform: "groq",
        modelId: "llama",
        keyId: testId,
      });
      expect(result).toBe(true);
    });
  });

  describe("penalties", () => {
    it("get-penalty returns 0 initially", async () => {
      const result = await doFetch<number>(limiter, "/get-penalty", {
        modelDbId: testId,
      });
      expect(result).toBe(0);
    });

    it("record-rl-hit increases penalty", async () => {
      await doFetchVoid(limiter, "/record-rl-hit", { modelDbId: testId });
      const penalty = await doFetch<number>(limiter, "/get-penalty", {
        modelDbId: testId,
      });
      expect(penalty).toBeGreaterThan(0);
    });

    it("record-success decreases penalty", async () => {
      await doFetchVoid(limiter, "/record-rl-hit", { modelDbId: testId });
      await doFetchVoid(limiter, "/record-success", { modelDbId: testId });
      const penalty = await doFetch<number>(limiter, "/get-penalty", {
        modelDbId: testId,
      });
      // 1 rl-hit = +3 penalty, 1 success = -1 penalty → net 2
      expect(penalty).toBe(2);
    });

    it("record-success decreases penalty by 1", async () => {
      await doFetchVoid(limiter, "/record-rl-hit", { modelDbId: testId + 1 });
      const beforePenalty = await doFetch<number>(limiter, "/get-penalty", {
        modelDbId: testId + 1,
      });
      await doFetchVoid(limiter, "/record-success", { modelDbId: testId + 1 });
      const afterPenalty = await doFetch<number>(limiter, "/get-penalty", {
        modelDbId: testId + 1,
      });
      expect(afterPenalty).toBe(beforePenalty - 1);
    });
  });

  describe("sticky sessions", () => {
    it("get-sticky returns null initially", async () => {
      const result = await doFetch<number | null>(limiter, "/get-sticky", {
        sessionKey: `key-${testId}`,
      });
      expect(result).toBeNull();
    });

    it("returns modelDbId after set-sticky", async () => {
      await doFetchVoid(limiter, "/set-sticky", {
        sessionKey: `key-${testId}`,
        modelDbId: 42,
      });
      const result = await doFetch<number | null>(limiter, "/get-sticky", {
        sessionKey: `key-${testId}`,
      });
      expect(result).toBe(42);
    });
  });

  describe("round-robin", () => {
    it("get-round-robin returns 0 initially", async () => {
      const result = await doFetch<number>(limiter, "/get-round-robin", {
        key: `rr-${testId}`,
      });
      expect(result).toBe(0);
    });

    it("set-round-robin persists the index", async () => {
      await doFetchVoid(limiter, "/set-round-robin", {
        key: `rr-${testId}`,
        index: 7,
      });
      const result = await doFetch<number>(limiter, "/get-round-robin", {
        key: `rr-${testId}`,
      });
      expect(result).toBe(7);
    });
  });
});
