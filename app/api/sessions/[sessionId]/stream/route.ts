import { randomUUID } from "node:crypto"

import { NextRequest } from "next/server"

import {
  acquireStreamLeases,
  enforceStreamOpenLimit,
  refreshStreamLeases,
  releaseStreamLeases,
  StreamRejectedError,
} from "@/lib/timebox/session-abuse"
import { getClientIp, getExistingClientId } from "@/lib/timebox/request-security"
import { getSessionSnapshot } from "@/lib/timebox/session-service"
import { getSessionStore } from "@/lib/timebox/session-store"
import type { SessionPhase } from "@/lib/timebox/session-types"

const POLL_INTERVAL_RUNNING_MS = 1000
const POLL_INTERVAL_IDLE_MS = 5000
const HEARTBEAT_INTERVAL_MS = 15000
const IDLE_BURST_POLL_COUNT = 5
const IDLE_PHASE_CHANGE_BURST_POLL_COUNT = 2

export const runtime = "nodejs"
export const preferredRegion = "fra1"
export const maxDuration = 300

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const store = getSessionStore()
  const initialSnapshot = await getSessionSnapshot(store, sessionId)

  if (!initialSnapshot) {
    return new Response(JSON.stringify({ error: "Session not found." }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
      },
    })
  }

  const nowMs = Date.now()
  const ip = getClientIp(request)
  const clientId = getExistingClientId(request) ?? `anonymous:${ip}`

  try {
    await enforceStreamOpenLimit(store, ip, nowMs)
  } catch (error) {
    if (error instanceof StreamRejectedError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": error.retryAfterSeconds.toString(),
        },
      })
    }

    throw error
  }

  const leaseId = randomUUID()
  let leaseKeys

  try {
    leaseKeys = await acquireStreamLeases(store, sessionId, clientId, ip, leaseId, nowMs)
  } catch (error) {
    if (error instanceof StreamRejectedError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": error.retryAfterSeconds.toString(),
        },
      })
    }

    throw error
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let lastFingerprint = ""
      let isPolling = false
      let pollTimeout: ReturnType<typeof setTimeout> | undefined
      let previousPhase: SessionPhase | null = initialSnapshot.phase
      let idleBurstPollsRemaining = initialSnapshot.phase === "running" ? 0 : IDLE_BURST_POLL_COUNT

      const close = () => {
        if (closed) {
          return
        }

        closed = true
        if (pollTimeout) {
          clearTimeout(pollTimeout)
        }
        clearInterval(heartbeatInterval)
        void releaseStreamLeases(store, leaseKeys, leaseId).catch(() => {
          // Lease cleanup is best-effort on disconnect.
        })

        try {
          controller.close()
        } catch {
          // Ignore duplicate close attempts.
        }
      }

      const enqueue = (value: string) => {
        if (closed) {
          return
        }

        controller.enqueue(encoder.encode(value))
      }

      const sendSnapshot = async (force = false) => {
        if (isPolling || closed) {
          return initialSnapshot.phase
        }

        isPolling = true

        try {
          const snapshot = await getSessionSnapshot(store, sessionId)

          if (!snapshot) {
            enqueue("event: gone\ndata: {\"error\":\"Session not found.\"}\n\n")
            close()
            return null
          }

          const fingerprint =
            snapshot.phase === "running"
              ? `${snapshot.version}:${snapshot.phase}:${snapshot.serverNow}`
              : `${snapshot.version}:${snapshot.phase}`
          if (force || fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint
            enqueue(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
          }

          return snapshot.phase
        } finally {
          isPolling = false
        }
      }

      const scheduleNextPoll = (phase: SessionPhase | null) => {
        if (closed || !phase) {
          return
        }

        if (phase !== previousPhase) {
          previousPhase = phase
          idleBurstPollsRemaining =
            phase === "running" ? 0 : IDLE_PHASE_CHANGE_BURST_POLL_COUNT
        }

        const delayMs =
          phase === "running"
            ? POLL_INTERVAL_RUNNING_MS
            : idleBurstPollsRemaining-- > 0
              ? POLL_INTERVAL_RUNNING_MS
              : POLL_INTERVAL_IDLE_MS

        pollTimeout = setTimeout(async () => {
          const nextPhase = await sendSnapshot()
          scheduleNextPoll(nextPhase)
        }, delayMs)
      }

      enqueue("retry: 1000\n\n")
      void sendSnapshot(true).then((phase) => {
        scheduleNextPoll(phase)
      })

      const heartbeatInterval = setInterval(() => {
        enqueue(": heartbeat\n\n")
        void refreshStreamLeases(store, leaseKeys, leaseId, Date.now())
      }, HEARTBEAT_INTERVAL_MS)

      request.signal.addEventListener("abort", close)
    },
  })

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  })
}
