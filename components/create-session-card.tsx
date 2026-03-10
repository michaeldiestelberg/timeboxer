"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { ArrowRight, Link2, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function CreateSessionCard() {
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreateSession() {
    setIsCreating(true)
    setError(null)

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
      })
      const payload = (await response.json().catch(() => null)) as { shareUrl?: string; error?: string } | null

      if (!response.ok || !payload?.shareUrl) {
        throw new Error(payload?.error ?? "Unable to create a session right now.")
      }

      router.push(payload.shareUrl)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Unable to create a session right now."
      setError(message)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-4 py-12">
      <div className="grid w-full gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-slate-200 shadow-lg">
          <CardHeader className="space-y-3">
            <CardTitle className="text-4xl font-semibold tracking-tight text-slate-950">Timeboxer</CardTitle>
            <CardDescription className="max-w-2xl text-base leading-7 text-slate-600">
              Create a shared meeting timer, send one link to the room, and let everyone follow the same
              roster, countdown, and session controls from their own browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <Link2 className="mb-3 h-5 w-5 text-slate-700" />
                <h2 className="font-medium text-slate-900">Shareable by default</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Every new timebox starts as a linkable session. No extra setup, no screen-sharing dependency.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <Users className="mb-3 h-5 w-5 text-slate-700" />
                <h2 className="font-medium text-slate-900">Public room controls</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Anyone with the session URL can help run the meeting: start, pause, reset, skip, or end.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                className="h-11 min-w-[220px] gap-2"
                disabled={isCreating}
                onClick={handleCreateSession}
                size="lg"
              >
                {isCreating ? "Creating session..." : "Create shared session"}
                <ArrowRight className="h-4 w-4" />
              </Button>
              <p className="text-sm text-slate-500">The first screen after creation is already your share link.</p>
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-slate-950 text-slate-50 shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl">How it works</CardTitle>
            <CardDescription className="text-slate-300">
              The new flow keeps setup and the live meeting in sync for everyone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6 text-slate-200">
            <p>1. Create a session and copy the link.</p>
            <p>2. Add the roster and choose the per-person time.</p>
            <p>3. Start the session and let the room follow along in real time.</p>
            <p>4. When a turn ends, anyone in the room can move to the next participant.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
