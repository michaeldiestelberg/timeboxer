import { randomBytes, randomUUID } from "node:crypto"

import {
  applySessionAction,
  buildSessionSnapshot,
  createDraftSession,
  SessionActionError,
} from "@/lib/timebox/session-state"
import {
  SESSION_LOCK_TTL_SECONDS,
  type SessionStore,
} from "@/lib/timebox/session-store"
import type { SessionAction, SessionSnapshot } from "@/lib/timebox/session-types"

export class SessionNotFoundError extends Error {
  constructor(message = "Session not found.") {
    super(message)
    this.name = "SessionNotFoundError"
  }
}

export class SessionConflictError extends Error {
  constructor(message = "Session is busy. Please try again.") {
    super(message)
    this.name = "SessionConflictError"
  }
}

export async function createSession(
  store: SessionStore,
  nowMs: number = Date.now(),
): Promise<SessionSnapshot> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const sessionId = generateSessionId()
    const existing = await store.get(sessionId)

    if (existing) {
      continue
    }

    const session = createDraftSession(sessionId, nowMs)
    await store.set(session)

    return buildSessionSnapshot(session, nowMs)
  }

  throw new Error("Unable to generate a unique session ID.")
}

export async function getSessionSnapshot(
  store: SessionStore,
  sessionId: string,
  nowMs: number = Date.now(),
): Promise<SessionSnapshot | null> {
  const session = await store.get(sessionId)
  return session ? buildSessionSnapshot(session, nowMs) : null
}

export async function mutateSession(
  store: SessionStore,
  sessionId: string,
  action: SessionAction,
  nowMs: number = Date.now(),
  rng: () => number = Math.random,
): Promise<SessionSnapshot> {
  const lockToken = randomUUID()
  const acquired = await store.tryLock(sessionId, lockToken, SESSION_LOCK_TTL_SECONDS)

  if (!acquired) {
    throw new SessionConflictError()
  }

  try {
    const existing = await store.get(sessionId)

    if (!existing) {
      throw new SessionNotFoundError()
    }

    const nextSession = applySessionAction(existing, action, nowMs, rng)
    await store.set(nextSession)

    return buildSessionSnapshot(nextSession, nowMs)
  } catch (error) {
    if (error instanceof SessionActionError) {
      throw error
    }

    throw error
  } finally {
    await store.releaseLock(sessionId, lockToken)
  }
}

export function createShareUrl(requestUrl: string, sessionId: string) {
  return new URL(`/s/${sessionId}`, requestUrl).toString()
}

function generateSessionId() {
  return randomBytes(12).toString("base64url").slice(0, 16)
}
