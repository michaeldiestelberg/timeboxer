import { NextRequest, NextResponse } from "next/server"

import {
  attachClientIdCookie,
  enforceSameOriginJsonRequest,
  getClientIp,
  getOrCreateClientId,
  readJsonBody,
  RequestGuardError,
} from "@/lib/timebox/request-security"
import { enforceActionLimit, RateLimitExceededError } from "@/lib/timebox/session-abuse"
import {
  getSessionSnapshot,
  mutateSession,
  SessionConflictError,
  SessionNotFoundError,
} from "@/lib/timebox/session-service"
import { SessionActionError } from "@/lib/timebox/session-state"
import { getSessionStore } from "@/lib/timebox/session-store"
import { sessionActionSchema } from "@/lib/timebox/session-types"

export const runtime = "nodejs"
export const preferredRegion = "fra1"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    enforceSameOriginJsonRequest(request)

    const body = await readJsonBody(request)
    const parsedAction = sessionActionSchema.safeParse(body)

    if (!parsedAction.success) {
      throw new RequestGuardError(400, "Request body is not a valid session action.")
    }

    const action = parsedAction.data
    const { sessionId } = await params
    const store = getSessionStore()
    const sessionSnapshot = await getSessionSnapshot(store, sessionId)

    if (!sessionSnapshot) {
      throw new SessionNotFoundError()
    }

    const nowMs = Date.now()
    const { clientId, shouldSetCookie } = getOrCreateClientId(request)
    await enforceActionLimit(store, sessionId, sessionSnapshot.phase, clientId, getClientIp(request), nowMs)

    const session = await mutateSession(store, sessionId, action, nowMs)
    const response = NextResponse.json({ session })

    if (shouldSetCookie) {
      attachClientIdCookie(request, response, clientId)
    }

    return response
  } catch (error) {
    if (error instanceof RequestGuardError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: error.status,
        },
      )
    }

    if (error instanceof RateLimitExceededError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 429,
          headers: {
            "Retry-After": error.retryAfterSeconds.toString(),
          },
        },
      )
    }

    if (error instanceof SessionNotFoundError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 404,
        },
      )
    }

    if (error instanceof SessionConflictError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 409,
        },
      )
    }

    if (error instanceof SessionActionError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
        },
        {
          status: 400,
        },
      )
    }

    console.error("Failed to mutate session", error)

    return NextResponse.json(
      {
        error: "Unable to update the session right now.",
      },
      {
        status: 500,
      },
    )
  }
}
