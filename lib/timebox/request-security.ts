import { randomBytes } from "node:crypto"

import { NextRequest, NextResponse } from "next/server"

export const CLIENT_ID_COOKIE_NAME = "tb_client"

const CLIENT_ID_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const JSON_CONTENT_TYPE = "application/json"
const FALLBACK_CLIENT_IP = "127.0.0.1"
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,}$/

export class RequestGuardError extends Error {
  constructor(
    readonly status: 400 | 403 | 415,
    message: string,
  ) {
    super(message)
    this.name = "RequestGuardError"
  }
}

export function enforceSameOriginJsonRequest(request: Request) {
  enforceSameOrigin(request)
  enforceJsonContentType(request)
}

export function enforceSameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  const expectedOrigins = getExpectedOrigins(request)
  const referer = request.headers.get("referer")
  const secFetchSite = request.headers.get("sec-fetch-site")

  if (origin) {
    if (!expectedOrigins.has(origin)) {
      throw new RequestGuardError(403, "Cross-site requests are not allowed.")
    }

    return
  }

  if (referer) {
    try {
      if (expectedOrigins.has(new URL(referer).origin)) {
        return
      }
    } catch {
      throw new RequestGuardError(403, "Cross-site requests are not allowed.")
    }
  }

  if (secFetchSite === "same-origin") {
    return
  }

  throw new RequestGuardError(403, "Cross-site requests are not allowed.")
}

function getExpectedOrigins(request: Request) {
  const url = new URL(request.url)
  const origins = new Set<string>([url.origin])
  const host = request.headers.get("host")
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
  const protocol = forwardedProto || url.protocol.replace(/:$/, "")

  if (host) {
    origins.add(`${protocol}://${host}`)
  }

  return origins
}

export function enforceJsonContentType(request: Request) {
  const contentType = request.headers.get("content-type")

  if (!contentType || !contentType.toLowerCase().startsWith(JSON_CONTENT_TYPE)) {
    throw new RequestGuardError(415, "Requests must use application/json.")
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new RequestGuardError(400, "Request body must be valid JSON.")
  }
}

export function assertEmptyJsonObject(value: unknown) {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    return
  }

  throw new RequestGuardError(400, "Session creation does not accept request parameters.")
}

export function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim()
    if (first) {
      return first
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) {
    return realIp
  }

  return FALLBACK_CLIENT_IP
}

export function getOrCreateClientId(request: NextRequest) {
  const existing = getExistingClientId(request)

  if (existing) {
    return {
      clientId: existing,
      shouldSetCookie: false,
    }
  }

  return {
    clientId: randomBytes(18).toString("base64url"),
    shouldSetCookie: true,
  }
}

export function getExistingClientId(request: NextRequest) {
  const existing = request.cookies.get(CLIENT_ID_COOKIE_NAME)?.value
  return existing && CLIENT_ID_PATTERN.test(existing) ? existing : null
}

export function attachClientIdCookie(
  request: NextRequest,
  response: NextResponse,
  clientId: string,
) {
  response.cookies.set({
    name: CLIENT_ID_COOKIE_NAME,
    value: clientId,
    httpOnly: true,
    maxAge: CLIENT_ID_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production",
  })

  return response
}
