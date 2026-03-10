import { Redis } from "@upstash/redis"

import { sessionRecordSchema, type SessionRecord } from "@/lib/timebox/session-types"

export const SESSION_TTL_SECONDS = 60 * 60 * 24
export const SESSION_LOCK_TTL_SECONDS = 2

export type FixedWindowRateLimitResult = {
  allowed: boolean
  count: number
  limit: number
  resetAt: number
}

export type LeaseResult = {
  acquired: boolean
  active: number
  limit: number
  resetAt: number
}

export interface SessionStore {
  get(id: string): Promise<SessionRecord | null>
  set(session: SessionRecord): Promise<void>
  tryLock(id: string, token: string, ttlSeconds?: number): Promise<boolean>
  releaseLock(id: string, token: string): Promise<void>
  consumeFixedWindowRateLimit(
    key: string,
    limit: number,
    windowMs: number,
    nowMs: number,
  ): Promise<FixedWindowRateLimitResult>
  acquireLease(
    key: string,
    leaseId: string,
    limit: number,
    ttlMs: number,
    nowMs: number,
  ): Promise<LeaseResult>
  refreshLease(key: string, leaseId: string, ttlMs: number, nowMs: number): Promise<boolean>
  releaseLease(key: string, leaseId: string): Promise<void>
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, { session: SessionRecord; expiresAt: number }>()
  private readonly locks = new Map<string, { token: string; expiresAt: number }>()
  private readonly rateLimits = new Map<string, { count: number; expiresAt: number }>()
  private readonly leases = new Map<string, Map<string, number>>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlSeconds: number = SESSION_TTL_SECONDS,
  ) {}

  async get(id: string) {
    this.cleanup()
    const entry = this.sessions.get(id)

    if (!entry) {
      return null
    }

    return structuredClone(entry.session)
  }

  async set(session: SessionRecord) {
    this.cleanup()
    this.sessions.set(session.id, {
      session: structuredClone(session),
      expiresAt: this.now() + this.ttlSeconds * 1000,
    })
  }

  async tryLock(id: string, token: string, ttlSeconds = SESSION_LOCK_TTL_SECONDS) {
    this.cleanup()
    const existing = this.locks.get(id)

    if (existing && existing.expiresAt > this.now()) {
      return false
    }

    this.locks.set(id, {
      token,
      expiresAt: this.now() + ttlSeconds * 1000,
    })

    return true
  }

  async releaseLock(id: string, token: string) {
    const existing = this.locks.get(id)

    if (existing?.token === token) {
      this.locks.delete(id)
    }
  }

  async consumeFixedWindowRateLimit(key: string, limit: number, windowMs: number, nowMs: number) {
    this.cleanup()

    const existing = this.rateLimits.get(key)
    if (!existing || existing.expiresAt <= nowMs) {
      const expiresAt = nowMs + windowMs
      this.rateLimits.set(key, {
        count: 1,
        expiresAt,
      })

      return {
        allowed: true,
        count: 1,
        limit,
        resetAt: expiresAt,
      }
    }

    existing.count += 1

    return {
      allowed: existing.count <= limit,
      count: existing.count,
      limit,
      resetAt: existing.expiresAt,
    }
  }

  async acquireLease(key: string, leaseId: string, limit: number, ttlMs: number, nowMs: number) {
    this.cleanup()

    const activeLeases = this.leases.get(key) ?? new Map<string, number>()

    for (const [member, expiresAt] of activeLeases) {
      if (expiresAt <= nowMs) {
        activeLeases.delete(member)
      }
    }

    if (!activeLeases.has(leaseId) && activeLeases.size >= limit) {
      this.leases.set(key, activeLeases)

      return {
        acquired: false,
        active: activeLeases.size,
        limit,
        resetAt: earliestLeaseExpiry(activeLeases, nowMs + ttlMs),
      }
    }

    activeLeases.set(leaseId, nowMs + ttlMs)
    this.leases.set(key, activeLeases)

    return {
      acquired: true,
      active: activeLeases.size,
      limit,
      resetAt: nowMs + ttlMs,
    }
  }

  async refreshLease(key: string, leaseId: string, ttlMs: number, nowMs: number) {
    this.cleanup()
    const activeLeases = this.leases.get(key)

    if (!activeLeases?.has(leaseId)) {
      return false
    }

    activeLeases.set(leaseId, nowMs + ttlMs)
    return true
  }

  async releaseLease(key: string, leaseId: string) {
    const activeLeases = this.leases.get(key)

    if (!activeLeases) {
      return
    }

    activeLeases.delete(leaseId)
    if (activeLeases.size === 0) {
      this.leases.delete(key)
    }
  }

  reset() {
    this.sessions.clear()
    this.locks.clear()
    this.rateLimits.clear()
    this.leases.clear()
  }

  private cleanup() {
    const now = this.now()

    for (const [id, entry] of this.sessions) {
      if (entry.expiresAt <= now) {
        this.sessions.delete(id)
      }
    }

    for (const [id, lock] of this.locks) {
      if (lock.expiresAt <= now) {
        this.locks.delete(id)
      }
    }

    for (const [key, entry] of this.rateLimits) {
      if (entry.expiresAt <= now) {
        this.rateLimits.delete(key)
      }
    }

    for (const [key, activeLeases] of this.leases) {
      for (const [leaseId, expiresAt] of activeLeases) {
        if (expiresAt <= now) {
          activeLeases.delete(leaseId)
        }
      }

      if (activeLeases.size === 0) {
        this.leases.delete(key)
      }
    }
  }
}

class RedisSessionStore implements SessionStore {
  private readonly redis: Redis
  private readonly releaseLockScript
  private readonly consumeRateLimitScript
  private readonly acquireLeaseScript
  private readonly refreshLeaseScript

  constructor() {
    this.redis = Redis.fromEnv()
    this.releaseLockScript = this.redis.createScript<number>(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    )
    this.consumeRateLimitScript = this.redis.createScript<[number, number, number]>(
      `
      local current = redis.call('incr', KEYS[1])
      if current == 1 then
        redis.call('pexpire', KEYS[1], ARGV[1])
      end

      local ttl = redis.call('pttl', KEYS[1])
      local allowed = 1
      if current > tonumber(ARGV[2]) then
        allowed = 0
      end

      return {allowed, current, ttl}
      `,
    )
    this.acquireLeaseScript = this.redis.createScript<[number, number]>(
      `
      redis.call('zremrangebyscore', KEYS[1], '-inf', ARGV[1])

      if redis.call('zscore', KEYS[1], ARGV[4]) then
        redis.call('zadd', KEYS[1], ARGV[2], ARGV[4])
        redis.call('pexpire', KEYS[1], ARGV[3])
        return {1, redis.call('zcard', KEYS[1])}
      end

      local count = redis.call('zcard', KEYS[1])
      if count >= tonumber(ARGV[5]) then
        return {0, count}
      end

      redis.call('zadd', KEYS[1], ARGV[2], ARGV[4])
      redis.call('pexpire', KEYS[1], ARGV[3])
      return {1, redis.call('zcard', KEYS[1])}
      `,
    )
    this.refreshLeaseScript = this.redis.createScript<number>(
      `
      redis.call('zremrangebyscore', KEYS[1], '-inf', ARGV[1])
      if not redis.call('zscore', KEYS[1], ARGV[3]) then
        return 0
      end

      redis.call('zadd', KEYS[1], ARGV[2], ARGV[3])
      redis.call('pexpire', KEYS[1], ARGV[4])
      return 1
      `,
    )
  }

  async get(id: string) {
    const raw = await this.redis.get<unknown>(sessionKey(id))

    if (!raw) {
      return null
    }

    return sessionRecordSchema.parse(raw)
  }

  async set(session: SessionRecord) {
    await this.redis.set(sessionKey(session.id), session, {
      ex: SESSION_TTL_SECONDS,
    })
  }

  async tryLock(id: string, token: string, ttlSeconds = SESSION_LOCK_TTL_SECONDS) {
    const result = await this.redis.set(lockKey(id), token, {
      ex: ttlSeconds,
      nx: true,
    })

    return result === "OK"
  }

  async releaseLock(id: string, token: string) {
    await this.releaseLockScript.exec([lockKey(id)], [token])
  }

  async consumeFixedWindowRateLimit(key: string, limit: number, windowMs: number, nowMs: number) {
    const [allowed, count, ttlMs] = await this.consumeRateLimitScript.exec([key], [
      windowMs.toString(),
      limit.toString(),
    ])

    return {
      allowed: allowed === 1,
      count,
      limit,
      resetAt: nowMs + Math.max(0, ttlMs),
    }
  }

  async acquireLease(key: string, leaseId: string, limit: number, ttlMs: number, nowMs: number) {
    const [acquired, active] = await this.acquireLeaseScript.exec([key], [
      nowMs.toString(),
      (nowMs + ttlMs).toString(),
      ttlMs.toString(),
      leaseId,
      limit.toString(),
    ])

    return {
      acquired: acquired === 1,
      active,
      limit,
      resetAt: nowMs + ttlMs,
    }
  }

  async refreshLease(key: string, leaseId: string, ttlMs: number, nowMs: number) {
    const result = await this.refreshLeaseScript.exec([key], [
      nowMs.toString(),
      (nowMs + ttlMs).toString(),
      leaseId,
      ttlMs.toString(),
    ])
    return result === 1
  }

  async releaseLease(key: string, leaseId: string) {
    await this.redis.zrem(key, leaseId)
  }
}

declare global {
  var __timeboxerMemoryStore__: MemorySessionStore | undefined
  var __timeboxerRedisStore__: RedisSessionStore | undefined
}

export function getSessionStore(): SessionStore {
  if (process.env.TIMEBOXER_STORE === "memory" || process.env.NODE_ENV === "test") {
    globalThis.__timeboxerMemoryStore__ ??= new MemorySessionStore()
    return globalThis.__timeboxerMemoryStore__
  }

  assertRedisEnv()
  globalThis.__timeboxerRedisStore__ ??= new RedisSessionStore()
  return globalThis.__timeboxerRedisStore__
}

export function resetSessionStoreForTests() {
  globalThis.__timeboxerMemoryStore__?.reset()
}

function assertRedisEnv() {
  const requiredEnvVars = ["KV_REST_API_URL", "KV_REST_API_TOKEN", "KV_URL"] as const
  const missing = requiredEnvVars.filter((name) => !process.env[name])

  if (missing.length > 0) {
    throw new Error(`Missing Redis environment variables: ${missing.join(", ")}`)
  }
}

function sessionKey(id: string) {
  return `timebox:session:${id}`
}

function lockKey(id: string) {
  return `timebox:lock:${id}`
}

function earliestLeaseExpiry(activeLeases: Map<string, number>, fallback: number) {
  let earliest = fallback

  for (const expiresAt of activeLeases.values()) {
    if (expiresAt < earliest) {
      earliest = expiresAt
    }
  }

  return earliest
}
