import {
  createSession,
  getSessionSnapshot,
  mutateSession,
  SessionConflictError,
  SessionNotFoundError,
} from "@/lib/timebox/session-service"
import { MemorySessionStore } from "@/lib/timebox/session-store"

describe("session-service", () => {
  it("creates a shareable session id", async () => {
    const store = new MemorySessionStore()

    const session = await createSession(store, Date.parse("2026-03-09T12:00:00.000Z"))

    expect(session.id).toHaveLength(16)
    expect(session.phase).toBe("draft")
  })

  it("throws not found for unknown sessions", async () => {
    const store = new MemorySessionStore()

    await expect(mutateSession(store, "missing-session", { type: "startSession" })).rejects.toBeInstanceOf(
      SessionNotFoundError,
    )
  })

  it("surfaces lock contention when the session is already being mutated", async () => {
    const store = new MemorySessionStore()
    const session = await createSession(store, Date.parse("2026-03-09T12:00:00.000Z"))
    await store.tryLock(session.id, "busy-lock")

    await expect(
      mutateSession(store, session.id, { type: "clearParticipants" }, Date.parse("2026-03-09T12:00:01.000Z")),
    ).rejects.toBeInstanceOf(SessionConflictError)
  })

  it("expires sessions after the configured TTL in the memory store", async () => {
    let now = Date.parse("2026-03-09T12:00:00.000Z")
    const store = new MemorySessionStore(() => now, 1)
    const session = await createSession(store, now)

    expect(await getSessionSnapshot(store, session.id, now)).not.toBeNull()

    now += 2_000

    await expect(getSessionSnapshot(store, session.id, now)).resolves.toBeNull()
  })
})
