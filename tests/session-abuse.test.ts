import {
  acquireStreamLeases,
  enforceActionLimit,
  enforceCreateSessionLimit,
  enforceStreamOpenLimit,
  RateLimitExceededError,
  releaseStreamLeases,
  StreamRejectedError,
} from "@/lib/timebox/session-abuse"
import { MemorySessionStore } from "@/lib/timebox/session-store"

describe("session-abuse", () => {
  it("trips the create-session limit on the 21st request", async () => {
    let now = Date.parse("2026-03-09T12:00:00.000Z")
    const store = new MemorySessionStore(() => now)

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect(enforceCreateSessionLimit(store, "203.0.113.10", now)).resolves.toBeUndefined()
    }

    await expect(enforceCreateSessionLimit(store, "203.0.113.10", now)).rejects.toBeInstanceOf(
      RateLimitExceededError,
    )
  })

  it("allows fast draft setup without throttling normal roster entry", async () => {
    let now = Date.parse("2026-03-09T12:00:00.000Z")
    const store = new MemorySessionStore(() => now)

    for (let attempt = 0; attempt < 90; attempt += 1) {
      await expect(
        enforceActionLimit(store, "session-1", "draft", "client-1", "203.0.113.10", now),
      ).resolves.toBeUndefined()
    }
  })

  it("trips the live action limit under obvious abuse", async () => {
    let now = Date.parse("2026-03-09T12:00:00.000Z")
    const store = new MemorySessionStore(() => now)

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await expect(
        enforceActionLimit(store, "session-1", "running", "client-1", "203.0.113.10", now),
      ).resolves.toBeUndefined()
    }

    await expect(
      enforceActionLimit(store, "session-1", "running", "client-1", "203.0.113.10", now),
    ).rejects.toBeInstanceOf(RateLimitExceededError)
  })

  it("rejects excess concurrent streams and recovers after lease release", async () => {
    let now = Date.parse("2026-03-09T12:00:00.000Z")
    const store = new MemorySessionStore(() => now)

    const leaseA = await acquireStreamLeases(store, "session-1", "client-1", "203.0.113.10", "lease-a", now)
    const leaseB = await acquireStreamLeases(store, "session-1", "client-1", "203.0.113.10", "lease-b", now)
    const leaseC = await acquireStreamLeases(store, "session-1", "client-1", "203.0.113.10", "lease-c", now)

    await expect(
      acquireStreamLeases(store, "session-1", "client-1", "203.0.113.10", "lease-d", now),
    ).rejects.toBeInstanceOf(StreamRejectedError)

    await releaseStreamLeases(store, leaseA, "lease-a")
    await releaseStreamLeases(store, leaseB, "lease-b")
    await releaseStreamLeases(store, leaseC, "lease-c")

    await expect(
      acquireStreamLeases(store, "session-1", "client-1", "203.0.113.10", "lease-e", now),
    ).resolves.toBeDefined()
  })

  it("trips the stream open-rate limit after sustained reconnects", async () => {
    let now = Date.parse("2026-03-09T12:00:00.000Z")
    const store = new MemorySessionStore(() => now)

    for (let attempt = 0; attempt < 300; attempt += 1) {
      await expect(enforceStreamOpenLimit(store, "203.0.113.10", now)).resolves.toBeUndefined()
    }

    await expect(enforceStreamOpenLimit(store, "203.0.113.10", now)).rejects.toBeInstanceOf(
      StreamRejectedError,
    )
  })
})
