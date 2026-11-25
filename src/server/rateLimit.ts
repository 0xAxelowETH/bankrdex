// Fixed-window rate limiter. Uses Upstash Redis (REST) when configured so limits are
// shared across serverless instances; otherwise falls back to per-instance memory.

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

interface MemoryWindow {
  count: number;
  resetAt: number;
}

const MEMORY_MAX_KEYS = 10_000;
const memoryWindows = new Map<string, MemoryWindow>();
let redisBackoffUntil = 0;

function getRedisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

function memoryHit(key: string, limit: number, windowMs: number, now: number): RateLimitResult {
  let entry = memoryWindows.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    memoryWindows.delete(key);
    memoryWindows.set(key, entry);
    if (memoryWindows.size > MEMORY_MAX_KEYS) {
      for (const [staleKey, staleEntry] of memoryWindows) {
        if (staleEntry.resetAt <= now || memoryWindows.size > MEMORY_MAX_KEYS) memoryWindows.delete(staleKey);
        if (memoryWindows.size <= MEMORY_MAX_KEYS * 0.9) break;
      }
    }
  }
  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}

async function redisHit(
  config: { url: string; token: string },
  key: string,
  limit: number,
  windowMs: number,
  now: number
): Promise<RateLimitResult> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const redisKey = `bankrdex:rl:${key}:${windowStart}`;
  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['INCR', redisKey],
      ['PEXPIRE', redisKey, String(windowMs), 'NX'],
    ]),
    signal: AbortSignal.timeout(1_500),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Upstash rate limit request failed (${response.status}).`);
  const results = await response.json() as Array<{ result?: unknown; error?: string }>;
  const count = Number(results[0]?.result);
  if (!Number.isFinite(count)) throw new Error('Upstash returned an invalid counter.');
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt: windowStart + windowMs,
  };
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = Date.now();
  const redis = getRedisConfig();
  if (redis && now >= redisBackoffUntil) {
    try {
      return await redisHit(redis, key, limit, windowMs, now);
    } catch (error) {
      redisBackoffUntil = now + 30_000;
      console.error('Shared rate limiter unavailable; using memory limiter:', error);
    }
  }
  return memoryHit(key, limit, windowMs, now);
}

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip')?.trim() || 'local';
}
