import { NextRequest, NextResponse } from "next/server"

import { attachClientIdCookie, assertEmptyJsonObject, enforceSameOriginJsonRequest, getClientIp, getOrCreateClientId, readJsonBody, RequestGuardError } from "@/lib/timebox/request-security"
import { enforceCreateSessionLimit, RateLimitExceededError } from "@/lib/timebox/session-abuse"
import { createSession, createShareUrl } from "@/lib/timebox/session-service"
import { getSessionStore } from "@/lib/timebox/session-store"

export const runtime = "nodejs"
export const preferredRegion = "fra1"

export async function POST(request: NextRequest) {
  try {
    enforceSameOriginJsonRequest(request)
    assertEmptyJsonObject(await readJsonBody(request))

    const store = getSessionStore()
    const nowMs = Date.now()
    await enforceCreateSessionLimit(store, getClientIp(request), nowMs)

    const { clientId, shouldSetCookie } = getOrCreateClientId(request)
    const session = await createSession(store, nowMs)
    const response = NextResponse.json(
      {
        session,
        shareUrl: createShareUrl(request.url, session.id),
      },
      {
        status: 201,
      },
    )

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

    console.error("Failed to create session", error)

    return NextResponse.json(
      {
        error: "Unable to create a session right now.",
      },
      {
        status: 500,
      },
    )
  }
}
