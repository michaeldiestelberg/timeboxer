import { z } from "zod"

export const SESSION_PHASES = [
  "draft",
  "ready",
  "running",
  "paused",
  "turnEnded",
  "completed",
  "ended",
] as const

export const sessionPhaseSchema = z.enum(SESSION_PHASES)

export type SessionPhase = (typeof SESSION_PHASES)[number]

export const sessionRecordSchema = z.object({
  id: z.string().min(1),
  phase: sessionPhaseSchema,
  participants: z.array(z.string()),
  remainingParticipants: z.array(z.string()),
  currentParticipant: z.string().nullable(),
  turnDurationSeconds: z.number().int().min(1).max(3659),
  turnStartedAt: z.string().datetime().nullable(),
  turnEndsAt: z.string().datetime().nullable(),
  pausedRemainingSeconds: z.number().int().min(0).max(3659),
  version: z.number().int().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type SessionRecord = z.infer<typeof sessionRecordSchema>

export const sessionSnapshotSchema = sessionRecordSchema.extend({
  serverNow: z.string().datetime(),
})

export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>

const addParticipantActionSchema = z.object({
  type: z.literal("addParticipant"),
  name: z.string().min(1).max(100),
})

const removeParticipantActionSchema = z.object({
  type: z.literal("removeParticipant"),
  name: z.string().min(1).max(100),
})

const setDurationActionSchema = z.object({
  type: z.literal("setDuration"),
  durationSeconds: z.number().int().min(1).max(3659),
})

const clearParticipantsActionSchema = z.object({
  type: z.literal("clearParticipants"),
})

const startSessionActionSchema = z.object({
  type: z.literal("startSession"),
})

const startTurnActionSchema = z.object({
  type: z.literal("startTurn"),
})

const pauseTurnActionSchema = z.object({
  type: z.literal("pauseTurn"),
})

const resumeTurnActionSchema = z.object({
  type: z.literal("resumeTurn"),
})

const resetTurnActionSchema = z.object({
  type: z.literal("resetTurn"),
})

const nextParticipantActionSchema = z.object({
  type: z.literal("nextParticipant"),
})

const endSessionActionSchema = z.object({
  type: z.literal("endSession"),
})

export const sessionActionSchema = z.discriminatedUnion("type", [
  addParticipantActionSchema,
  removeParticipantActionSchema,
  setDurationActionSchema,
  clearParticipantsActionSchema,
  startSessionActionSchema,
  startTurnActionSchema,
  pauseTurnActionSchema,
  resumeTurnActionSchema,
  resetTurnActionSchema,
  nextParticipantActionSchema,
  endSessionActionSchema,
])

export type SessionAction = z.infer<typeof sessionActionSchema>
