import * as React from "react"
import { AudioLines, ChevronDown, ChevronUp, LoaderCircle, Pause, Play } from "lucide-react"
import { toast } from "sonner"

import type { ClientVoiceMessageBody } from "@/lib/client-data-api"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

type MessageVoiceProps = {
  voice: ClientVoiceMessageBody
}

let activeVoiceAudio: HTMLAudioElement | null = null
const playbackStartTimeoutMS = 15_000
type PlaybackState = "error" | "idle" | "loading" | "paused" | "playing"

export function MessageVoice({ voice }: MessageVoiceProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const objectURLRef = React.useRef<string | null>(null)
  const playbackStateRef = React.useRef<PlaybackState>("idle")
  const timeoutRef = React.useRef<number | null>(null)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [playbackState, setPlaybackState] = React.useState<PlaybackState>("idle")
  const [transcriptExpanded, setTranscriptExpanded] = React.useState(false)
  const durationSeconds = voice.durationMS / 1_000
  const transcript = voice.transcript.trim()

  function updatePlaybackState(state: PlaybackState) {
    playbackStateRef.current = state
    setPlaybackState(state)
  }

  function clearPlaybackAttempt() {
    abortRef.current?.abort()
    abortRef.current = null
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }

  function releaseSource(audio: HTMLAudioElement | null) {
    if (audio && activeVoiceAudio === audio) activeVoiceAudio = null
    audio?.pause()
    if (audio) {
      audio.removeAttribute("src")
      audio.load()
    }
    if (objectURLRef.current) URL.revokeObjectURL(objectURLRef.current)
    objectURLRef.current = null
  }

  function failPlayback(message = "语音播放失败，请重试") {
    if (playbackStateRef.current === "error") return
    updatePlaybackState("error")
    clearPlaybackAttempt()
    releaseSource(audioRef.current)
    setCurrentTime(0)
    toast.error(message)
  }

  React.useEffect(
    () => () => {
      clearPlaybackAttempt()
      releaseSource(audioRef.current)
    },
    [],
  )

  async function handlePlayToggle() {
    const audio = audioRef.current
    if (!audio || playbackStateRef.current === "loading") return

    if (!audio.paused) {
      audio.pause()
      return
    }

    clearPlaybackAttempt()
    if (playbackStateRef.current === "error") releaseSource(audio)
    updatePlaybackState("loading")
    const controller = new AbortController()
    abortRef.current = controller

    try {
      if (!audio.src) {
        const response = await fetch(
          `/api/client/temporary-files/${encodeURIComponent(voice.fileId)}/content`,
          { signal: controller.signal },
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        objectURLRef.current = URL.createObjectURL(await response.blob())
        audio.src = objectURLRef.current
      }
      if (activeVoiceAudio && activeVoiceAudio !== audio) {
        activeVoiceAudio.pause()
      }
      activeVoiceAudio = audio
      await Promise.race([
        audio.play(),
        new Promise<never>((_resolve, reject) => {
          timeoutRef.current = window.setTimeout(
            () => reject(new Error("playback timeout")),
            playbackStartTimeoutMS,
          )
        }),
      ])
      clearPlaybackAttempt()
      updatePlaybackState("playing")
    } catch {
      failPlayback("语音加载或解码失败，请重试")
    }
  }

  function handleSeek(value: number[]) {
    const nextTime = value[0] ?? 0
    const audio = audioRef.current

    setCurrentTime(nextTime)
    if (audio) {
      audio.currentTime = nextTime
    }
  }

  return (
    <div className="grid w-80 max-w-full gap-2">
      <audio
        ref={audioRef}
        onEnded={() => {
          setCurrentTime(0)
          updatePlaybackState("idle")
        }}
        onError={() => failPlayback()}
        onPause={() => {
          if (playbackStateRef.current !== "error") updatePlaybackState("paused")
        }}
        onPlay={() => updatePlaybackState("playing")}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        preload="none"
      />
      <div className="flex min-h-10 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background/50 text-muted-foreground">
          <AudioLines className="size-5" />
        </div>
        <div className="grid min-w-0 flex-1 gap-1">
          <Slider
            aria-label="语音播放进度"
            disabled={playbackState === "error" || playbackState === "loading"}
            max={durationSeconds}
            min={0}
            onValueChange={handleSeek}
            step={0.01}
            value={[Math.min(currentTime, durationSeconds)]}
          />
          <div className="text-xs leading-snug text-muted-foreground tabular-nums">
            {playbackState === "error"
              ? "播放失败，可重试"
              : `${Math.max(1, Math.ceil(durationSeconds))} 秒`}
          </div>
        </div>
        <Button
          aria-label={
            playbackState === "playing"
              ? "暂停语音"
              : playbackState === "error"
                ? "重试语音"
                : "播放语音"
          }
          className="hover:bg-background/70 data-[state=open]:bg-background/70 dark:hover:bg-background/70 dark:data-[state=open]:bg-background/70"
          onClick={() => void handlePlayToggle()}
          size="icon-sm"
          title={playbackState === "playing" ? "暂停" : playbackState === "error" ? "重试" : "播放"}
          type="button"
          variant="ghost"
        >
          {playbackState === "loading" ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : playbackState === "playing" ? (
            <Pause className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
        </Button>
      </div>
      {transcript && (
        <div className="border-t border-foreground/10 pt-2">
          <Button
            aria-expanded={transcriptExpanded}
            className="h-7 w-full justify-between px-1 text-xs"
            onClick={() => setTranscriptExpanded((expanded) => !expanded)}
            type="button"
            variant="ghost"
          >
            语音转写
            {transcriptExpanded ? <ChevronUp /> : <ChevronDown />}
          </Button>
          {transcriptExpanded && (
            <p className="max-h-32 overflow-y-auto pt-1 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {transcript}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
