"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Clock, Play, Pause, SkipForward, Settings, X, Plus } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

// Flashing timer CSS (opacity only)
const flashingTimerStyle = `
  @keyframes flash {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  .flashing-timer {
    animation: flash 1s steps(2, start) infinite;
    border-radius: 8px;
    padding: 0 0.5em;
    transition: opacity 0.2s;
  }
`;

export default function Timeboxer() {
  // Participant management
  const [participantName, setParticipantName] = useState("")
  const [participants, setParticipants] = useState<string[]>([])
  const [remainingParticipants, setRemainingParticipants] = useState<string[]>([])
  const [currentParticipant, setCurrentParticipant] = useState<string | null>(null)

  // Session state
  const [isSessionStarted, setIsSessionStarted] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)

  // Timer settings and state
  const [timerMinutes, setTimerMinutes] = useState(1)
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [timeRemaining, setTimeRemaining] = useState(60)
  const [isTimerRunning, setIsTimerRunning] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false); // For flashing timer
  const [customTimer, setCustomTimer] = useState<{minutes: number, seconds: number} | null>(null);
  const [isCustomSheetOpen, setIsCustomSheetOpen] = useState(false);

  // Helper for total duration in seconds
  const getTotalDuration = () => timerMinutes * 60 + timerSeconds;

  // Audio for notification (using downloadable WAV file)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Initialize audio element with the downloadable file on mount
  useEffect(() => {
    audioRef.current = new Audio('/timer-end.wav');
  }, []);

  // Timer logic
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null

    if (isTimerRunning && timeRemaining > 0) {
      interval = setInterval(() => {
        setTimeRemaining((prev) => prev - 1)
      }, 1000)
    } else if (timeRemaining === 0 && isTimerRunning) {
      setIsTimerRunning(false)
      // Play notification sound from downloadable file
      if (audioRef.current) {
        audioRef.current.currentTime = 0; // rewind to start
        audioRef.current.play().catch((error) => console.error("Error playing audio:", error));
      }
      // Start flashing effect
      setIsFlashing(true);
      setTimeout(() => setIsFlashing(false), 5000);
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isTimerRunning, timeRemaining])

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  // Add a participant
  const handleAddParticipant = () => {
    if (participantName.trim() && !participants.includes(participantName.trim())) {
      setParticipants([...participants, participantName.trim()])
      setParticipantName("")
    }
  }

  // Remove a participant
  const handleRemoveParticipant = (name: string) => {
    setParticipants(participants.filter((p) => p !== name))
  }

  // Start the demo session
  const handleStartSession = () => {
    if (participants.length > 0) {
      // Create a copy of participants array for selection
      setRemainingParticipants([...participants])
      setIsSessionStarted(true)
      selectNextParticipant([...participants])
    }
  }

  // Select the next participant randomly
  const selectNextParticipant = (remaining: string[]) => {
    if (remaining.length === 0) {
      setIsCompleted(true)
      setCurrentParticipant(null)
      return
    }

    const randomIndex = Math.floor(Math.random() * remaining.length)
    const selected = remaining[randomIndex]

    // Remove selected participant from remaining list
    const newRemaining = remaining.filter((_, index) => index !== randomIndex)

    setCurrentParticipant(selected)
    setRemainingParticipants(newRemaining)

    // Reset timer
    setTimeRemaining(getTotalDuration())
    setIsTimerRunning(false)
  }

  // Handle next participant button
  const handleNext = () => {
    selectNextParticipant(remainingParticipants)
  }

  // Reset the entire session
  const handleReset = () => {
    setIsSessionStarted(false)
    setIsCompleted(false)
    setCurrentParticipant(null)
    setIsTimerRunning(false)
    setTimeRemaining(getTotalDuration())
  }

  // Update timer duration and reset timer
  const handleTimerDurationChange = (minutes: number, seconds: number) => {
    setTimerMinutes(minutes)
    setTimerSeconds(seconds)
    setTimeRemaining(minutes * 60 + seconds)
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <style>{flashingTimerStyle}</style>
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl">Timeboxer</CardTitle>
          <CardDescription>
            Add participants and timebox their turns. Each person will get a set time for their activity, and the timer will notify you when their time is up.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {!isSessionStarted ? (
            <>
              {/* Participant Input */}
              <div className="space-y-4">
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="participant-name">Participant Name</Label>
                    <Input
                      id="participant-name"
                      value={participantName}
                      onChange={(e) => setParticipantName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddParticipant()}
                      placeholder="Enter participant name"
                    />
                  </div>
                  <Button onClick={handleAddParticipant} className="flex gap-1 items-center">
                    <Plus size={16} /> Add
                  </Button>
                </div>

                {/* Participant List */}
                <div className="space-y-2">
                  <Label>Participants ({participants.length})</Label>
                  <div className="border rounded-md p-4 min-h-[100px] max-h-[200px] overflow-y-auto">
                    {participants.length === 0 ? (
                      <p className="text-muted-foreground text-center">No participants added yet</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {participants.map((name) => (
                          <Badge key={name} variant="secondary" className="flex items-center gap-1">
                            {name}
                            <button
                              onClick={() => handleRemoveParticipant(name)}
                              className="ml-1 rounded-full hover:bg-muted p-0.5"
                            >
                              <X size={12} />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Timer Settings */}
                <div className="space-y-2">
                  <Label>Timer Presets (min)</Label>
                  <div className="flex gap-3 items-end">
                    {[1, 2, 3, 5].map((mins) => (
                      <Button
                        key={mins}
                        variant={timerMinutes === mins && timerSeconds === 0 ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleTimerDurationChange(mins, 0)}
                      >
                        {mins}
                      </Button>
                    ))}
                    {customTimer && (
                      <Button
                        variant={timerMinutes === customTimer.minutes && timerSeconds === customTimer.seconds ? "default" : "outline"}
                        size="sm"
                        className="flex items-center gap-1"
                        onClick={() => setIsCustomSheetOpen(true)}
                      >
                        <Settings size={14} /> {customTimer.minutes}:{customTimer.seconds.toString().padStart(2, "0")}
                      </Button>
                    )}
                    {!customTimer && (
                      <Button variant="outline" size="sm" className="flex items-center gap-1" onClick={() => setIsCustomSheetOpen(true)}>
                        <Settings size={14} /> Custom
                      </Button>
                    )}
                    <Sheet open={isCustomSheetOpen} onOpenChange={setIsCustomSheetOpen}>
                      <SheetContent>
                        <SheetHeader>
                          <SheetTitle>Timer Settings</SheetTitle>
                          <SheetDescription>Customize the timer duration for each participant</SheetDescription>
                        </SheetHeader>
                        <div className="py-6 space-y-4">
                          <div className="flex gap-2 items-end">
                            <div>
                              <Label htmlFor="custom-minutes">Minutes</Label>
                              <Input
                                id="custom-minutes"
                                type="number"
                                min="0"
                                max="60"
                                value={timerMinutes}
                                onChange={(e) => {
                                  const val = Math.max(0, Math.min(60, Number(e.target.value)));
                                  setTimerMinutes(val);
                                }}
                              />
                            </div>
                            <div>
                              <Label htmlFor="custom-seconds">Seconds</Label>
                              <Input
                                id="custom-seconds"
                                type="number"
                                min="0"
                                max="59"
                                value={timerSeconds}
                                onChange={(e) => {
                                  const val = Math.max(0, Math.min(59, Number(e.target.value)));
                                  setTimerSeconds(val);
                                }}
                              />
                            </div>
                          </div>
                          <Button onClick={() => {
                            setCustomTimer({minutes: timerMinutes, seconds: timerSeconds});
                            handleTimerDurationChange(timerMinutes, timerSeconds);
                            setIsCustomSheetOpen(false);
                          }} className="w-full">
                            Apply
                          </Button>
                        </div>
                      </SheetContent>
                    </Sheet>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Session View */}
              {isCompleted ? (
                <div className="text-center py-8 space-y-4">
                  <h3 className="text-xl font-semibold">Session Completed!</h3>
                  <p className="text-muted-foreground">All participants have completed their turns.</p>
                  <Button onClick={handleReset} className="mt-4">
                    Start New Session
                  </Button>
                </div>
              ) : (
                <>
                  {/* Current Participant */}
                  <div className="text-center space-y-2">
                    <h3 className="text-lg font-medium text-muted-foreground">Current Participant</h3>
                    <h2 className="text-3xl font-bold">{currentParticipant}</h2>
                  </div>

                  <Separator />

                  {/* Timer Display */}
                  <div className="space-y-4">
                    <div className="flex justify-center items-center gap-2">
                      <Clock className="text-muted-foreground" />
                      <span className={`text-4xl font-mono font-semibold${isFlashing ? ' flashing-timer' : ''}`}>{formatTime(timeRemaining)}</span>
                    </div>

                    {/* Timer Controls */}
                    <div className="flex justify-center gap-2">
                      <Button
                        variant={isTimerRunning ? "outline" : "default"}
                        onClick={() => setIsTimerRunning(true)}
                        disabled={isTimerRunning}
                      >
                        <Play className="mr-1 h-4 w-4" /> Start
                      </Button>
                      <Button
                        variant={!isTimerRunning ? "outline" : "default"}
                        onClick={() => setIsTimerRunning(false)}
                        disabled={!isTimerRunning}
                      >
                        <Pause className="mr-1 h-4 w-4" /> Pause
                      </Button>
                      <Button variant="outline" onClick={() => setTimeRemaining(timerDuration * 60)}>
                        Reset
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  {/* Remaining Participants */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label>Remaining Participants</Label>
                      <Badge variant="outline">{remainingParticipants.length}</Badge>
                    </div>
                    <div className="border rounded-md p-3 max-h-[100px] overflow-y-auto">
                      {remainingParticipants.length === 0 ? (
                        <p className="text-muted-foreground text-center text-sm">No participants remaining</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {remainingParticipants.map((name) => (
                            <Badge key={name} variant="secondary">
                              {name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>

        <CardFooter className="flex justify-between">
          {!isSessionStarted ? (
            <>
              <Button variant="outline" onClick={() => setParticipants([])}>
                Clear All
              </Button>
              <Button onClick={handleStartSession} disabled={participants.length === 0}>
                Start Session
              </Button>
            </>
          ) : !isCompleted ? (
            <>
              <Button variant="outline" onClick={handleReset}>
                End Session
              </Button>
              <Button onClick={handleNext} className="flex items-center gap-1">
                <SkipForward size={16} /> Next Participant
              </Button>
            </>
          ) : null}
        </CardFooter>
      </Card>
    </div>
  )
}
