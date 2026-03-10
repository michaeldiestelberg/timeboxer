import { NextRequest, NextResponse } from "next/server"

import { attachClientIdCookie, getOrCreateClientId } from "@/lib/timebox/request-security"
import { getSessionSnapshot } from "@/lib/timebox/session-service"
import { getSessionStore } from "@/lib/timebox/session-store"

export const runtime = "nodejs"
export const preferredRegion = "fra1"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const session = await getSessionSnapshot(getSessionStore(), sessionId)

  if (!session) {
    return NextResponse.json(
      {
        error: "Session not found.",
      },
      {
        status: 404,
      },
    )
  }

  const response = NextResponse.json({ session })
  const { clientId, shouldSetCookie } = getOrCreateClientId(request)

  if (shouldSetCookie) {
    attachClientIdCookie(request, response, clientId)
  }

  return response
}
