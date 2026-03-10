"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  Clock,
  Copy,
  Link2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  SkipForward,
  Square,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { getRemainingSeconds, materializeSession } from "@/lib/timebox/session-state"
import type { SessionAction, SessionSnapshot } from "@/lib/timebox/session-types"

const PRESET_MINUTES = [1, 2, 3, 5]
const STREAM_FAILURES_BEFORE_POLLING = 3

type SessionApiResponse = {
  session?: SessionSnapshot
  error?: string
}

export function SharedSessionView({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionSnapshot | null>(null)
  const [participantName, setParticipantName] = useState("")
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [tick, setTick] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isMutating, setIsMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFlashing, setIsFlashing] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [isCustomSheetOpen, setIsCustomSheetOpen] = useState(false)
  const [draftDuration, setDraftDuration] = useState(() => secondsToDurationParts(60))
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [transportMode, setTransportMode] = useState<"stream" | "polling">("stream")
  const [isBootstrapReady, setIsBootstrapReady] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lastExpiredMarkerRef = useRef<string | null>(null)
  const streamFailuresRef = useRef(0)

  useEffect(() => {
    audioRef.current = new Audio("/timer-end.wav")
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTick((current) => current + 1)
    }, 250)

    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!session || session.phase !== "draft") {
      return
    }

    setDraftDuration(secondsToDurationParts(session.turnDurationSeconds))
  }, [session?.phase, session?.turnDurationSeconds])

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return ""
    }

    return new URL(`/s/${sessionId}`, window.location.origin).toString()
  }, [sessionId])

  const effectiveSession = useMemo(() => {
    if (!session) {
      return null
    }

    return materializeSession(session, Date.now() + clockOffsetMs)
  }, [clockOffsetMs, session, tick])

  const timeRemaining = effectiveSession
    ? getRemainingSeconds(effectiveSession, Date.now() + clockOffsetMs)
    : 0

  useEffect(() => {
    let ignore = false

    async function loadInitialSession() {
      setTransportMode("stream")
      setIsBootstrapReady(false)
      streamFailuresRef.current = 0
      setIsLoading(true)
      const snapshot = await fetchSessionSnapshot()

      if (!ignore) {
        setSession(snapshot)
        setIsBootstrapReady(snapshot !== null)
        setIsLoading(false)
      }
    }

    void loadInitialSession()

    return () => {
      ignore = true
    }
  }, [sessionId])

  useEffect(() => {
    if (!isBootstrapReady || transportMode !== "stream") {
      return
    }

    const eventSource = new EventSource(`/api/sessions/${sessionId}/stream`)

    eventSource.onopen = () => {
      streamFailuresRef.current = 0
    }

    eventSource.addEventListener("snapshot", (event) => {
      streamFailuresRef.current = 0
      const nextSnapshot = JSON.parse((event as MessageEvent<string>).data) as SessionSnapshot
      applySnapshot(nextSnapshot)
    })

    eventSource.addEventListener("gone", () => {
      setError("This session is no longer available.")
      setSession(null)
    })

    eventSource.onerror = () => {
      streamFailuresRef.current += 1

      if (streamFailuresRef.current >= STREAM_FAILURES_BEFORE_POLLING) {
        eventSource.close()
        setTransportMode("polling")
      }
    }

    return () => {
      eventSource.close()
    }
  }, [isBootstrapReady, sessionId, transportMode])

  useEffect(() => {
    if (!isBootstrapReady || transportMode !== "polling") {
      return
    }

    let cancelled = false
    let timeoutId: number | undefined
    let consecutiveFailures = 0

    const poll = async () => {
      const snapshot = await fetchSessionSnapshot({
        suppressError: true,
      })

      if (cancelled) {
        return
      }

      consecutiveFailures = snapshot ? 0 : consecutiveFailures + 1
      timeoutId = window.setTimeout(poll, getPollingDelayMs(session?.phase ?? "draft", consecutiveFailures))
    }

    timeoutId = window.setTimeout(poll, getPollingDelayMs(session?.phase ?? "draft", consecutiveFailures))

    return () => {
      cancelled = true
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [isBootstrapReady, session?.phase, sessionId, transportMode])

  useEffect(() => {
    if (!effectiveSession || effectiveSession.phase !== "turnEnded" || timeRemaining !== 0) {
      setIsFlashing(false)
    }
  }, [effectiveSession, timeRemaining])

  useEffect(() => {
    if (!effectiveSession || effectiveSession.currentParticipant === null) {
      return
    }

    if (effectiveSession.phase !== "turnEnded" || timeRemaining !== 0) {
      return
    }

    const marker = `${effectiveSession.version}:${effectiveSession.currentParticipant}`
    if (lastExpiredMarkerRef.current === marker) {
      return
    }

    lastExpiredMarkerRef.current = marker
    setIsFlashing(true)

    const timeout = window.setTimeout(() => {
      setIsFlashing(false)
    }, 5000)

    if (audioRef.current) {
      audioRef.current.currentTime = 0
      void audioRef.current.play().catch(() => {
        // Browser autoplay restrictions are expected until a local user unlocks audio.
      })
    }

    return () => window.clearTimeout(timeout)
  }, [effectiveSession, timeRemaining])

  function applySnapshot(snapshot: SessionSnapshot) {
    setError(null)
    setSession(snapshot)
    setClockOffsetMs(Date.parse(snapshot.serverNow) - Date.now())
  }

  async function fetchSessionSnapshot(options?: { suppressError?: boolean }) {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        cache: "no-store",
      })
      const payload = (await response.json().catch(() => null)) as SessionApiResponse | null

      if (!response.ok || !payload?.session) {
        throw new Error(payload?.error ?? "Unable to load this session.")
      }

      applySnapshot(payload.session)
      return payload.session
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unable to load this session."
      if (!options?.suppressError) {
        setError(message)
      }
      return null
    }
  }

  async function postAction(action: SessionAction) {
    setIsMutating(true)
    setError(null)

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(`/api/sessions/${sessionId}/actions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(action),
        })

        const payload = (await response.json().catch(() => null)) as SessionApiResponse | null

        if (response.ok && payload?.session) {
          applySnapshot(payload.session)
          return
        }

        if (response.status === 409 && attempt === 0) {
          await fetchSessionSnapshot()
          continue
        }

        throw new Error(payload?.error ?? "Unable to update this session.")
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unable to update this session."
      setError(message)
    } finally {
      setIsMutating(false)
    }
  }

  function unlockAudio() {
    if (!audioRef.current || audioUnlocked) {
      return
    }

    audioRef.current.muted = true
    void audioRef.current
      .play()
      .then(() => {
        if (!audioRef.current) {
          return
        }

        audioRef.current.pause()
        audioRef.current.currentTime = 0
        audioRef.current.muted = false
        setAudioUnlocked(true)
      })
      .catch(() => {
        if (audioRef.current) {
          audioRef.current.muted = false
        }
      })
  }

  async function handleAddParticipant() {
    const name = participantName.trim()

    if (!name) {
      return
    }

    await postAction({
      type: "addParticipant",
      name,
    })
    setParticipantName("")
  }

  async function handleCopyShareUrl() {
    if (!shareUrl) {
      return
    }

    await navigator.clipboard.writeText(shareUrl)
    setIsCopied(true)
    window.setTimeout(() => {
      setIsCopied(false)
    }, 1500)
  }

  if (isLoading && !session) {
    return (
      <div className="container mx-auto flex min-h-screen items-center justify-center px-4 py-8">
        <Card className="w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Loading session...</CardTitle>
            <CardDescription>Connecting to the shared room.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (!session || !effectiveSession) {
    return (
      <div className="container mx-auto flex min-h-screen items-center justify-center px-4 py-8">
        <Card className="w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Session unavailable</CardTitle>
            <CardDescription>{error ?? "This session could not be loaded."}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <Link href="/">Create a new shared session</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  const showDraftView = effectiveSession.phase === "draft"
  const startButtonLabel = effectiveSession.phase === "paused" ? "Resume" : "Start"
  const canStartTurn = effectiveSession.phase === "ready" || effectiveSession.phase === "paused"
  const canPauseTurn = effectiveSession.phase === "running"
  const canResetTurn = ["ready", "running", "paused", "turnEnded"].includes(effectiveSession.phase)
  const canAdvance = ["ready", "running", "paused", "turnEnded"].includes(effectiveSession.phase)
  const isFinished = effectiveSession.phase === "completed" || effectiveSession.phase === "ended"

  return (
    <div className="container mx-auto py-8">
      <Card className="mx-auto max-w-4xl shadow-lg">
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-3xl">Timeboxer</CardTitle>
                <Badge variant={badgeVariantForPhase(effectiveSession.phase)}>{phaseLabel(effectiveSession.phase)}</Badge>
                <Badge variant="outline">Session {session.id}</Badge>
              </div>
              <CardDescription className="max-w-2xl">
                Share the link below with the room. Everyone on the URL sees the same roster, timer, and
                controls.
              </CardDescription>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Public-control room
            </div>
          </div>

          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="share-url" className="flex items-center gap-2 text-slate-700">
                <Link2 className="h-4 w-4" />
                Share link
              </Label>
              <Input id="share-url" readOnly value={shareUrl} />
            </div>
            <Button className="mt-auto gap-2" onClick={handleCopyShareUrl} variant="outline">
              <Copy className="h-4 w-4" />
              {isCopied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          {showDraftView ? (
            <DraftSessionSetup
              canSubmit={!isMutating}
              durationSeconds={effectiveSession.turnDurationSeconds}
              isCustomSheetOpen={isCustomSheetOpen}
              onAddParticipant={handleAddParticipant}
              onApplyDuration={async (durationSeconds) => {
                await postAction({
                  type: "setDuration",
                  durationSeconds,
                })
                setIsCustomSheetOpen(false)
              }}
              onCustomSheetOpenChange={setIsCustomSheetOpen}
              onOpenCustomSheet={() => setIsCustomSheetOpen(true)}
              onParticipantNameChange={setParticipantName}
              onRemoveParticipant={(name) =>
                postAction({
                  type: "removeParticipant",
                  name,
                })
              }
              participantName={participantName}
              participants={effectiveSession.participants}
              presetMinutes={PRESET_MINUTES}
              selectedDuration={draftDuration}
              setSelectedDuration={setDraftDuration}
            />
          ) : isFinished ? (
            <div className="space-y-4 py-8 text-center">
              <h2 className="text-3xl font-semibold text-slate-950">
                {effectiveSession.phase === "completed" ? "Session completed" : "Session ended"}
              </h2>
              <p className="text-slate-600">
                {effectiveSession.phase === "completed"
                  ? "Everyone in the roster has had their turn."
                  : "This shared timebox has been ended."}
              </p>
              <div className="flex justify-center">
                <Button asChild>
                  <Link href="/">Create another shared session</Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-3 text-center">
                <h2 className="text-lg font-medium text-slate-500">Current Participant</h2>
                <p className="text-4xl font-semibold tracking-tight text-slate-950" data-testid="current-participant">
                  {effectiveSession.currentParticipant}
                </p>
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="flex justify-center gap-2">
                  {[1, 2, 3, 5].map((minutes) => (
                    <Button
                      disabled
                      key={minutes}
                      size="sm"
                      variant={effectiveSession.turnDurationSeconds === minutes * 60 ? "default" : "outline"}
                    >
                      {minutes}m
                    </Button>
                  ))}
                </div>

                <div className="flex items-center justify-center gap-3">
                  <Clock className="text-slate-500" />
                  <span
                    className={`inline-block min-w-[6ch] rounded-lg px-2 text-center font-mono text-5xl font-semibold ${
                      isFlashing ? "flashing-timer" : ""
                    }`}
                    data-testid="countdown"
                  >
                    {formatTime(timeRemaining)}
                  </span>
                </div>

                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    className="gap-2"
                    data-testid="start-turn"
                    disabled={!canStartTurn || isMutating}
                    onClick={() => {
                      unlockAudio()
                      void postAction({ type: effectiveSession.phase === "paused" ? "resumeTurn" : "startTurn" })
                    }}
                  >
                    <Play className="h-4 w-4" />
                    {startButtonLabel}
                  </Button>
                  <Button
                    className="gap-2"
                    data-testid="pause-turn"
                    disabled={!canPauseTurn || isMutating}
                    onClick={() => void postAction({ type: "pauseTurn" })}
                    variant="outline"
                  >
                    <Pause className="h-4 w-4" />
                    Pause
                  </Button>
                  <Button
                    className="gap-2"
                    disabled={!canResetTurn || isMutating}
                    onClick={() => void postAction({ type: "resetTurn" })}
                    variant="outline"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Remaining participants</Label>
                  <Badge variant="outline">{effectiveSession.remainingParticipants.length}</Badge>
                </div>
                <div className="min-h-[108px] rounded-xl border border-slate-200 p-4">
                  {effectiveSession.remainingParticipants.length === 0 ? (
                    <p className="text-center text-sm text-slate-500">No participants remaining.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {effectiveSession.remainingParticipants.map((participant) => (
                        <Badge key={participant} variant="secondary">
                          {participant}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>

        <CardFooter className="flex flex-wrap justify-between gap-3">
          {showDraftView ? (
            <>
              <Button
                disabled={effectiveSession.participants.length === 0 || isMutating}
                onClick={() => void postAction({ type: "clearParticipants" })}
                variant="outline"
              >
                Clear all
              </Button>
              <Button
                disabled={effectiveSession.participants.length === 0 || isMutating}
                onClick={() => void postAction({ type: "startSession" })}
              >
                Start session
              </Button>
            </>
          ) : isFinished ? null : (
            <>
              <Button
                className="gap-2"
                disabled={isMutating}
                onClick={() => void postAction({ type: "endSession" })}
                variant="outline"
              >
                <Square className="h-4 w-4" />
                End session
              </Button>
              <Button
                className="gap-2"
                data-testid="next-participant-button"
                disabled={!canAdvance || isMutating}
                onClick={() => void postAction({ type: "nextParticipant" })}
              >
                <SkipForward className="h-4 w-4" />
                Next participant
              </Button>
            </>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}

type DraftSessionSetupProps = {
  canSubmit: boolean
  durationSeconds: number
  isCustomSheetOpen: boolean
  onAddParticipant: () => Promise<void>
  onApplyDuration: (durationSeconds: number) => Promise<void>
  onCustomSheetOpenChange: (open: boolean) => void
  onOpenCustomSheet: () => void
  onParticipantNameChange: (value: string) => void
  onRemoveParticipant: (name: string) => Promise<void>
  participantName: string
  participants: string[]
  presetMinutes: number[]
  selectedDuration: { minutes: number; seconds: number }
  setSelectedDuration: (value: { minutes: number; seconds: number }) => void
}

function DraftSessionSetup({
  canSubmit,
  durationSeconds,
  isCustomSheetOpen,
  onAddParticipant,
  onApplyDuration,
  onCustomSheetOpenChange,
  onOpenCustomSheet,
  onParticipantNameChange,
  onRemoveParticipant,
  participantName,
  participants,
  presetMinutes,
  selectedDuration,
  setSelectedDuration,
}: DraftSessionSetupProps) {
  const selectedDurationSeconds = selectedDuration.minutes * 60 + selectedDuration.seconds
  const hasCustomPreset = !PRESET_MINUTES.includes(Math.floor(durationSeconds / 60)) || durationSeconds % 60 !== 0

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor="participant-name">Participant name</Label>
            <Input
              id="participant-name"
              onChange={(event) => onParticipantNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void onAddParticipant()
                }
              }}
              placeholder="Enter participant name"
              value={participantName}
            />
          </div>
          <Button className="gap-2" disabled={!canSubmit} onClick={() => void onAddParticipant()}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>

        <div className="space-y-2">
          <Label>Participants ({participants.length})</Label>
          <div className="min-h-[108px] rounded-xl border border-slate-200 p-4">
            {participants.length === 0 ? (
              <p className="text-center text-sm text-slate-500">No participants added yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {participants.map((participant) => (
                  <Badge className="gap-1" key={participant} variant="secondary">
                    {participant}
                    <button
                      className="rounded-full p-0.5 hover:bg-slate-200"
                      onClick={() => void onRemoveParticipant(participant)}
                      type="button"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Timer per participant</Label>
          <div className="flex flex-wrap gap-2">
            {presetMinutes.map((minutes) => (
              <Button
                key={minutes}
                onClick={() => void onApplyDuration(minutes * 60)}
                size="sm"
                variant={durationSeconds === minutes * 60 ? "default" : "outline"}
              >
                {minutes}m
              </Button>
            ))}
            <Button className="gap-2" onClick={onOpenCustomSheet} size="sm" variant={hasCustomPreset ? "default" : "outline"}>
              <Settings className="h-4 w-4" />
              {formatDurationLabel(durationSeconds)}
            </Button>
          </div>
        </div>
      </div>

      <Sheet onOpenChange={onCustomSheetOpenChange} open={isCustomSheetOpen}>
        <SheetContent
          onEscapeKeyDown={() => setSelectedDuration(secondsToDurationParts(durationSeconds))}
          side="right"
        >
          <SheetHeader>
            <SheetTitle>Custom duration</SheetTitle>
            <SheetDescription>Choose the countdown each participant receives.</SheetDescription>
          </SheetHeader>
          <div className="space-y-6 py-6">
            <div className="flex items-end justify-center gap-4">
              <DurationControl
                label="Minutes"
                max={60}
                min={0}
                onChange={(minutes) => setSelectedDuration({ ...selectedDuration, minutes })}
                value={selectedDuration.minutes}
              />
              <span className="pb-3 text-2xl font-semibold">:</span>
              <DurationControl
                label="Seconds"
                max={59}
                min={0}
                onChange={(seconds) => setSelectedDuration({ ...selectedDuration, seconds })}
                value={selectedDuration.seconds}
              />
            </div>
            <Button
              className="w-full"
              onClick={() => void onApplyDuration(Math.max(1, selectedDurationSeconds))}
            >
              Apply custom duration
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function DurationControl({
  label,
  max,
  min,
  onChange,
  value,
}: {
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  value: number
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <Label>{label}</Label>
      <div className="flex flex-col items-center gap-1">
        <button
          className="rounded-md bg-slate-100 px-3 py-1 text-lg"
          onClick={() => onChange(Math.min(max, value + 1))}
          type="button"
        >
          ▲
        </button>
        <Input
          className="w-16 text-center text-lg"
          inputMode="numeric"
          max={max}
          min={min}
          onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))}
          type="number"
          value={value}
        />
        <button
          className="rounded-md bg-slate-100 px-3 py-1 text-lg"
          onClick={() => onChange(Math.max(min, value - 1))}
          type="button"
        >
          ▼
        </button>
      </div>
    </div>
  )
}

function badgeVariantForPhase(phase: SessionSnapshot["phase"]) {
  if (phase === "running") {
    return "default"
  }

  if (phase === "turnEnded" || phase === "ended") {
    return "destructive"
  }

  return "secondary"
}

function phaseLabel(phase: SessionSnapshot["phase"]) {
  switch (phase) {
    case "draft":
      return "Setup"
    case "ready":
      return "Ready"
    case "running":
      return "Running"
    case "paused":
      return "Paused"
    case "turnEnded":
      return "Time up"
    case "completed":
      return "Completed"
    case "ended":
      return "Ended"
  }
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds)
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
}

function formatDurationLabel(seconds: number) {
  const { minutes, seconds: remainingSeconds } = secondsToDurationParts(seconds)
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
}

function secondsToDurationParts(seconds: number) {
  return {
    minutes: Math.floor(seconds / 60),
    seconds: seconds % 60,
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(max, Math.max(min, value))
}

function getPollingDelayMs(phase: SessionSnapshot["phase"], consecutiveFailures: number) {
  if (consecutiveFailures >= 2) {
    return 10_000
  }

  return phase === "running" ? 2_000 : 5_000
}
