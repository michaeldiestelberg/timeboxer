import { NextRequest } from "next/server"

import { POST as createSessionRoute } from "@/app/api/sessions/route"
import { GET as getSessionRoute } from "@/app/api/sessions/[sessionId]/route"
import { POST as actionRoute } from "@/app/api/sessions/[sessionId]/actions/route"
import { GET as streamRoute } from "@/app/api/sessions/[sessionId]/stream/route"
import { createSession } from "@/lib/timebox/session-service"
import { getSessionStore, resetSessionStoreForTests } from "@/lib/timebox/session-store"

describe("api routes", () => {
  beforeEach(() => {
    resetSessionStoreForTests()
  })

  it("creates a session for same-origin JSON requests and sets a client cookie", async () => {
    const request = new NextRequest("http://localhost:3000/api/sessions", {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": "203.0.113.10",
      },
    })

    const response = await createSessionRoute(request)
    const payload = (await response.json()) as { shareUrl?: string }

    expect(response.status).toBe(201)
    expect(payload.shareUrl).toContain("/s/")
    expect(response.headers.get("set-cookie")).toContain("tb_client=")
  })

  it("accepts same-origin browser writes when Origin is absent but Referer is same-origin", async () => {
    const request = new NextRequest("http://localhost:3000/api/sessions", {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        referer: "http://localhost:3000/",
        "sec-fetch-site": "same-origin",
      },
    })

    const response = await createSessionRoute(request)
    expect(response.status).toBe(201)
  })

  it("accepts local host alias writes when Host and Referer use 127.0.0.1", async () => {
    const request = new NextRequest("http://localhost:3000/api/sessions", {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:3000",
        referer: "http://127.0.0.1:3000/",
      },
    })

    const response = await createSessionRoute(request)
    expect(response.status).toBe(201)
  })

  it("rejects cross-site session creation", async () => {
    const request = new NextRequest("http://localhost:3000/api/sessions", {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
    })

    const response = await createSessionRoute(request)
    expect(response.status).toBe(403)
  })

  it("rejects non-JSON session creation", async () => {
    const request = new NextRequest("http://localhost:3000/api/sessions", {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "text/plain",
        origin: "http://localhost:3000",
      },
    })

    const response = await createSessionRoute(request)
    expect(response.status).toBe(415)
  })

  it("rejects unexpected create payloads", async () => {
    const request = new NextRequest("http://localhost:3000/api/sessions", {
      method: "POST",
      body: JSON.stringify({ roomName: "Weekly sync" }),
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
    })

    const response = await createSessionRoute(request)
    expect(response.status).toBe(400)
  })

  it("sets a client cookie on snapshot reads when missing", async () => {
    const store = getSessionStore()
    const session = await createSession(store, Date.parse("2026-03-09T12:00:00.000Z"))
    const request = new NextRequest(`http://localhost:3000/api/sessions/${session.id}`)

    const response = await getSessionRoute(request, {
      params: Promise.resolve({ sessionId: session.id }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain("tb_client=")
  })

  it("rejects cross-site action writes", async () => {
    const store = getSessionStore()
    const session = await createSession(store, Date.parse("2026-03-09T12:00:00.000Z"))
    const request = new NextRequest(`http://localhost:3000/api/sessions/${session.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ type: "addParticipant", name: "Alice" }),
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
    })

    const response = await actionRoute(request, {
      params: Promise.resolve({ sessionId: session.id }),
    })

    expect(response.status).toBe(403)
  })

  it("returns 429 when too many concurrent streams open for one browser", async () => {
    const store = getSessionStore()
    const session = await createSession(store, Date.parse("2026-03-09T12:00:00.000Z"))
    const controllers = Array.from({ length: 3 }, () => new AbortController())

    for (const controller of controllers) {
      const request = new NextRequest(`http://localhost:3000/api/sessions/${session.id}/stream`, {
        headers: {
          cookie: "tb_client=client-1",
          "x-forwarded-for": "203.0.113.10",
        },
        signal: controller.signal,
      })

      const response = await streamRoute(request, {
        params: Promise.resolve({ sessionId: session.id }),
      })

      expect(response.status).toBe(200)
    }

    const rejectedRequest = new NextRequest(`http://localhost:3000/api/sessions/${session.id}/stream`, {
      headers: {
        cookie: "tb_client=client-1",
        "x-forwarded-for": "203.0.113.10",
      },
    })
    const rejectedResponse = await streamRoute(rejectedRequest, {
      params: Promise.resolve({ sessionId: session.id }),
    })

    expect(rejectedResponse.status).toBe(429)

    for (const controller of controllers) {
      controller.abort()
    }
  })
})
