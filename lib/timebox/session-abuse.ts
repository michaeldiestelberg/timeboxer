import type { SessionPhase } from "@/lib/timebox/session-types"
import type { FixedWindowRateLimitResult, LeaseResult, SessionStore } from "@/lib/timebox/session-store"

const TEN_MINUTES_MS = 10 * 60 * 1000
const TWO_MINUTES_MS = 2 * 60 * 1000
const ONE_MINUTE_MS = 60 * 1000
const FIVE_MINUTES_MS = 5 * 60 * 1000
const STREAM_LEASE_TTL_MS = 30 * 1000

const CREATE_LIMIT = 20
const DRAFT_CLIENT_ACTION_LIMIT = 180
const DRAFT_IP_ACTION_LIMIT = 900
const LIVE_CLIENT_ACTION_LIMIT = 60
const LIVE_IP_ACTION_LIMIT = 300
const STREAM_OPEN_LIMIT = 300
const STREAM_CLIENT_CONCURRENCY_LIMIT = 3
const STREAM_IP_CONCURRENCY_LIMIT = 60

export class RateLimitExceededError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message)
    this.name = "RateLimitExceededError"
  }
}

export class StreamRejectedError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message)
    this.name = "StreamRejectedError"
  }
}

export async function enforceCreateSessionLimit(
  store: SessionStore,
  ip: string,
  nowMs: number,
) {
  await enforceLimit(
    store,
    `timebox:limit:create:ip:${ip}`,
    CREATE_LIMIT,
    TEN_MINUTES_MS,
    nowMs,
    "Too many sessions have been created from this network. Please wait a few minutes and try again.",
  )
}

export async function enforceActionLimit(
  store: SessionStore,
  sessionId: string,
  phase: SessionPhase,
  clientId: string,
  ip: string,
  nowMs: number,
) {
  const isDraft = phase === "draft"

  await enforceLimit(
    store,
    `timebox:limit:action:client:${sessionId}:${clientId}:${isDraft ? "draft" : "live"}`,
    isDraft ? DRAFT_CLIENT_ACTION_LIMIT : LIVE_CLIENT_ACTION_LIMIT,
    isDraft ? TWO_MINUTES_MS : ONE_MINUTE_MS,
    nowMs,
    "Too many session updates from this browser. Please slow down and try again.",
  )

  await enforceLimit(
    store,
    `timebox:limit:action:ip:${sessionId}:${ip}:${isDraft ? "draft" : "live"}`,
    isDraft ? DRAFT_IP_ACTION_LIMIT : LIVE_IP_ACTION_LIMIT,
    isDraft ? TWO_MINUTES_MS : ONE_MINUTE_MS,
    nowMs,
    "Too many session updates from this network. Please slow down and try again.",
  )
}

export async function enforceStreamOpenLimit(
  store: SessionStore,
  ip: string,
  nowMs: number,
) {
  await enforceLimit(
    store,
    `timebox:limit:stream:ip:${ip}`,
    STREAM_OPEN_LIMIT,
    FIVE_MINUTES_MS,
    nowMs,
    "Too many live updates are opening from this network. Falling back to polling for a moment.",
    StreamRejectedError,
  )
}

export async function acquireStreamLeases(
  store: SessionStore,
  sessionId: string,
  clientId: string,
  ip: string,
  leaseId: string,
  nowMs: number,
) {
  const clientLeaseKey = `timebox:lease:stream:client:${sessionId}:${clientId}`
  const ipLeaseKey = `timebox:lease:stream:ip:${sessionId}:${ip}`
  const clientLease = await store.acquireLease(
    clientLeaseKey,
    leaseId,
    STREAM_CLIENT_CONCURRENCY_LIMIT,
    STREAM_LEASE_TTL_MS,
    nowMs,
  )

  if (!clientLease.acquired) {
    throw new StreamRejectedError(
      "This browser already has too many live update streams open for the session. Falling back to polling.",
      leaseRetryAfterSeconds(clientLease, nowMs),
    )
  }

  const ipLease = await store.acquireLease(
    ipLeaseKey,
    leaseId,
    STREAM_IP_CONCURRENCY_LIMIT,
    STREAM_LEASE_TTL_MS,
    nowMs,
  )

  if (!ipLease.acquired) {
    await store.releaseLease(clientLeaseKey, leaseId)
    throw new StreamRejectedError(
      "This network already has many live update streams open for the session. Falling back to polling.",
      leaseRetryAfterSeconds(ipLease, nowMs),
    )
  }

  return {
    clientLeaseKey,
    ipLeaseKey,
  }
}

export async function refreshStreamLeases(
  store: SessionStore,
  leaseKeys: { clientLeaseKey: string; ipLeaseKey: string },
  leaseId: string,
  nowMs: number,
) {
  await Promise.all([
    store.refreshLease(leaseKeys.clientLeaseKey, leaseId, STREAM_LEASE_TTL_MS, nowMs),
    store.refreshLease(leaseKeys.ipLeaseKey, leaseId, STREAM_LEASE_TTL_MS, nowMs),
  ])
}

export async function releaseStreamLeases(
  store: SessionStore,
  leaseKeys: { clientLeaseKey: string; ipLeaseKey: string },
  leaseId: string,
) {
  await Promise.all([
    store.releaseLease(leaseKeys.clientLeaseKey, leaseId),
    store.releaseLease(leaseKeys.ipLeaseKey, leaseId),
  ])
}

async function enforceLimit(
  store: SessionStore,
  key: string,
  limit: number,
  windowMs: number,
  nowMs: number,
  message: string,
  ErrorType: typeof RateLimitExceededError | typeof StreamRejectedError = RateLimitExceededError,
) {
  const result = await store.consumeFixedWindowRateLimit(key, limit, windowMs, nowMs)

  if (!result.allowed) {
    throw new ErrorType(message, rateLimitRetryAfterSeconds(result, nowMs))
  }
}

function rateLimitRetryAfterSeconds(result: FixedWindowRateLimitResult, nowMs: number) {
  return Math.max(1, Math.ceil(Math.max(0, result.resetAt - nowMs) / 1000))
}

function leaseRetryAfterSeconds(result: LeaseResult, nowMs: number) {
  return Math.max(1, Math.ceil(Math.max(0, result.resetAt - nowMs) / 1000))
}
