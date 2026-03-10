import {
  applySessionAction,
  buildSessionSnapshot,
  createDraftSession,
  getRemainingSeconds,
} from "@/lib/timebox/session-state"

describe("session-state", () => {
  it("starts a session by selecting a participant and preparing the first turn", () => {
    const now = Date.parse("2026-03-09T12:00:00.000Z")
    const session = createDraftSession("session-1", now)
    const withParticipants = applySessionAction(
      applySessionAction(
        createDraftSession("session-1", now),
        { type: "addParticipant", name: "Alice" },
        now + 1,
      ),
      { type: "addParticipant", name: "Bob" },
      now + 2,
    )

    const started = applySessionAction(withParticipants, { type: "startSession" }, now + 3, () => 0)

    expect(session.phase).toBe("draft")
    expect(started.phase).toBe("ready")
    expect(started.currentParticipant).toBe("Alice")
    expect(started.remainingParticipants).toEqual(["Bob"])
    expect(started.pausedRemainingSeconds).toBe(60)
  })

  it("materializes an expired running turn as turnEnded", () => {
    const now = Date.parse("2026-03-09T12:00:00.000Z")
    const running = applySessionAction(
      {
        ...createDraftSession("session-2", now),
        phase: "ready",
        participants: ["Alice"],
        remainingParticipants: [],
        currentParticipant: "Alice",
      },
      { type: "startTurn" },
      now,
    )

    const snapshot = buildSessionSnapshot(running, now + 61_000)

    expect(snapshot.phase).toBe("turnEnded")
    expect(getRemainingSeconds(snapshot, now + 61_000)).toBe(0)
  })

  it("completes the session when there are no remaining participants", () => {
    const now = Date.parse("2026-03-09T12:00:00.000Z")
    const ready = {
      ...createDraftSession("session-3", now),
      phase: "ready" as const,
      participants: ["Alice"],
      remainingParticipants: [],
      currentParticipant: "Alice",
    }

    const completed = applySessionAction(ready, { type: "nextParticipant" }, now + 1)

    expect(completed.phase).toBe("completed")
    expect(completed.currentParticipant).toBeNull()
    expect(completed.remainingParticipants).toEqual([])
  })

  it("prevents setup edits after the session has started", () => {
    const now = Date.parse("2026-03-09T12:00:00.000Z")
    const started = applySessionAction(
      applySessionAction(createDraftSession("session-4", now), { type: "addParticipant", name: "Alice" }, now + 1),
      { type: "startSession" },
      now + 2,
      () => 0,
    )

    expect(() =>
      applySessionAction(started, { type: "addParticipant", name: "Bob" }, now + 3),
    ).toThrow("You can only add participants before the session starts.")
  })
})
