import type { SessionAction, SessionRecord, SessionSnapshot } from "@/lib/timebox/session-types"

const ISO_ZERO = new Date(0).toISOString()

export class SessionActionError extends Error {
  constructor(
    readonly code: "invalid_action" | "invalid_payload",
    message: string,
  ) {
    super(message)
    this.name = "SessionActionError"
  }
}

export function createDraftSession(
  id: string,
  nowMs: number,
  defaultDurationSeconds = 60,
): SessionRecord {
  const nowIso = toIso(nowMs)

  return {
    id,
    phase: "draft",
    participants: [],
    remainingParticipants: [],
    currentParticipant: null,
    turnDurationSeconds: defaultDurationSeconds,
    turnStartedAt: null,
    turnEndsAt: null,
    pausedRemainingSeconds: defaultDurationSeconds,
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}

export function buildSessionSnapshot(session: SessionRecord, nowMs: number): SessionSnapshot {
  const materialized = materializeSession(session, nowMs)

  return {
    ...materialized,
    serverNow: toIso(nowMs),
  }
}

export function materializeSession(session: SessionRecord, nowMs: number): SessionRecord {
  if (session.phase !== "running" || !session.turnEndsAt) {
    return session
  }

  const remainingSeconds = getRemainingSeconds(session, nowMs)
  if (remainingSeconds > 0) {
    return session
  }

  return {
    ...session,
    phase: "turnEnded",
    pausedRemainingSeconds: 0,
  }
}

export function getRemainingSeconds(session: Pick<SessionRecord, "phase" | "turnEndsAt" | "pausedRemainingSeconds" | "turnDurationSeconds">, nowMs: number) {
  if (session.phase === "running" && session.turnEndsAt) {
    return Math.max(0, Math.ceil((Date.parse(session.turnEndsAt) - nowMs) / 1000))
  }

  if (session.phase === "completed" || session.phase === "ended") {
    return 0
  }

  return session.pausedRemainingSeconds
}

export function applySessionAction(
  session: SessionRecord,
  action: SessionAction,
  nowMs: number,
  rng: () => number = Math.random,
): SessionRecord {
  const current = materializeSession(session, nowMs)

  switch (action.type) {
    case "addParticipant": {
      assertPhase(current, ["draft"], "You can only add participants before the session starts.")
      const name = normalizeParticipantName(action.name)

      if (!name) {
        throw new SessionActionError("invalid_payload", "Participant name cannot be empty.")
      }

      if (current.participants.includes(name)) {
        throw new SessionActionError("invalid_action", "Participant already exists.")
      }

      return withMutation(
        current,
        {
          participants: [...current.participants, name],
        },
        nowMs,
      )
    }

    case "removeParticipant": {
      assertPhase(current, ["draft"], "You can only remove participants before the session starts.")
      const name = normalizeParticipantName(action.name)

      if (!current.participants.includes(name)) {
        throw new SessionActionError("invalid_action", "Participant does not exist.")
      }

      return withMutation(
        current,
        {
          participants: current.participants.filter((participant) => participant !== name),
        },
        nowMs,
      )
    }

    case "setDuration": {
      assertPhase(current, ["draft"], "You can only change the duration before the session starts.")

      return withMutation(
        current,
        {
          turnDurationSeconds: action.durationSeconds,
          pausedRemainingSeconds: action.durationSeconds,
        },
        nowMs,
      )
    }

    case "clearParticipants": {
      assertPhase(current, ["draft"], "You can only clear participants before the session starts.")

      return withMutation(
        current,
        {
          participants: [],
        },
        nowMs,
      )
    }

    case "startSession": {
      assertPhase(current, ["draft"], "This session has already started.")

      if (current.participants.length === 0) {
        throw new SessionActionError("invalid_action", "Add at least one participant before starting.")
      }

      const { selected, remaining } = takeRandomParticipant(current.participants, rng)

      return withMutation(
        current,
        {
          phase: "ready",
          currentParticipant: selected,
          remainingParticipants: remaining,
          pausedRemainingSeconds: current.turnDurationSeconds,
          turnStartedAt: null,
          turnEndsAt: null,
        },
        nowMs,
      )
    }

    case "startTurn": {
      assertPhase(current, ["ready"], "You can only start a turn when a participant is ready.")
      assertCurrentParticipant(current)

      return withMutation(
        current,
        {
          phase: "running",
          turnStartedAt: toIso(nowMs),
          turnEndsAt: toIso(nowMs + current.pausedRemainingSeconds * 1000),
        },
        nowMs,
      )
    }

    case "pauseTurn": {
      assertPhase(current, ["running"], "You can only pause a running turn.")
      const remainingSeconds = getRemainingSeconds(current, nowMs)

      if (remainingSeconds === 0) {
        return withMutation(
          current,
          {
            phase: "turnEnded",
            pausedRemainingSeconds: 0,
          },
          nowMs,
        )
      }

      return withMutation(
        current,
        {
          phase: "paused",
          pausedRemainingSeconds: remainingSeconds,
          turnStartedAt: null,
          turnEndsAt: null,
        },
        nowMs,
      )
    }

    case "resumeTurn": {
      assertPhase(current, ["paused"], "You can only resume a paused turn.")
      assertCurrentParticipant(current)

      if (current.pausedRemainingSeconds === 0) {
        return withMutation(
          current,
          {
            phase: "turnEnded",
          },
          nowMs,
        )
      }

      return withMutation(
        current,
        {
          phase: "running",
          turnStartedAt: toIso(nowMs),
          turnEndsAt: toIso(nowMs + current.pausedRemainingSeconds * 1000),
        },
        nowMs,
      )
    }

    case "resetTurn": {
      assertPhase(
        current,
        ["ready", "running", "paused", "turnEnded"],
        "You can only reset the current turn after the session has started.",
      )
      assertCurrentParticipant(current)

      return withMutation(
        current,
        {
          phase: "ready",
          pausedRemainingSeconds: current.turnDurationSeconds,
          turnStartedAt: null,
          turnEndsAt: null,
        },
        nowMs,
      )
    }

    case "nextParticipant": {
      assertPhase(
        current,
        ["ready", "running", "paused", "turnEnded"],
        "You can only move to the next participant during an active session.",
      )
      assertCurrentParticipant(current)

      if (current.remainingParticipants.length === 0) {
        return withMutation(
          current,
          {
            phase: "completed",
            currentParticipant: null,
            remainingParticipants: [],
            pausedRemainingSeconds: 0,
            turnStartedAt: null,
            turnEndsAt: null,
          },
          nowMs,
        )
      }

      const { selected, remaining } = takeRandomParticipant(current.remainingParticipants, rng)

      return withMutation(
        current,
        {
          phase: "ready",
          currentParticipant: selected,
          remainingParticipants: remaining,
          pausedRemainingSeconds: current.turnDurationSeconds,
          turnStartedAt: null,
          turnEndsAt: null,
        },
        nowMs,
      )
    }

    case "endSession": {
      if (current.phase === "ended") {
        throw new SessionActionError("invalid_action", "This session has already ended.")
      }

      return withMutation(
        current,
        {
          phase: "ended",
          currentParticipant: null,
          remainingParticipants: [],
          pausedRemainingSeconds: 0,
          turnStartedAt: null,
          turnEndsAt: null,
        },
        nowMs,
      )
    }
  }
}

function withMutation(session: SessionRecord, updates: Partial<SessionRecord>, nowMs: number): SessionRecord {
  return {
    ...session,
    ...updates,
    version: session.version + 1,
    updatedAt: toIso(nowMs),
  }
}

function assertPhase(session: SessionRecord, allowedPhases: SessionRecord["phase"][], message: string) {
  if (!allowedPhases.includes(session.phase)) {
    throw new SessionActionError("invalid_action", message)
  }
}

function assertCurrentParticipant(session: SessionRecord) {
  if (!session.currentParticipant) {
    throw new SessionActionError("invalid_action", "There is no active participant.")
  }
}

function takeRandomParticipant(participants: string[], rng: () => number) {
  const randomIndex = Math.min(participants.length - 1, Math.floor(rng() * participants.length))
  const selected = participants[randomIndex] ?? participants[0] ?? null

  if (!selected) {
    throw new SessionActionError("invalid_action", "There are no participants available.")
  }

  return {
    selected,
    remaining: participants.filter((_, index) => index !== randomIndex),
  }
}

function normalizeParticipantName(name: string) {
  return name.trim()
}

function toIso(nowMs: number) {
  return Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : ISO_ZERO
}
