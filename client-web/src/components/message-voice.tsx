import * as React from "react"
import { AudioLines, LoaderCircle } from "lucide-react"

import type { ClientVoiceMessageBody } from "@/lib/client-data-api"
import { cn } from "@/lib/utils"

type MessageVoiceProps = {
  voice: ClientVoiceMessageBody
}

let activeVoiceAudio: HTMLAudioElement | null = null

export function MessageVoice({ voice }: MessageVoiceProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const [error, setError] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [playing, setPlaying] = React.useState(false)

  React.useEffect(
    () => () => {
      const audio = audioRef.current
      if (audio && activeVoiceAudio === audio) {
        activeVoiceAudio = null
      }
      audio?.pause()
    },
    []
  )

  async function handlePlayToggle() {
    const audio = audioRef.current
    if (!audio || loading) return

    if (!audio.paused) {
      audio.pause()
      return
    }

    setLoading(true)
    setError(false)
    try {
      if (activeVoiceAudio && activeVoiceAudio !== audio) {
        activeVoiceAudio.pause()
      }
      activeVoiceAudio = audio
      await audio.play()
    } catch {
      setError(true)
      setPlaying(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid w-80 max-w-full gap-2">
      <audio
        ref={audioRef}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        preload="none"
        src={`/api/client/temporary-files/${encodeURIComponent(voice.fileId)}/content`}
      />
      <button
        aria-label={playing ? "暂停语音" : "播放语音"}
        className="group/voice-row flex min-w-0 cursor-pointer items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait"
        disabled={loading}
        onClick={() => void handlePlayToggle()}
        title={playing ? "暂停" : "播放"}
        type="button"
      >
        {loading ? (
          <LoaderCircle className="size-4.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <AudioLines
            className={cn(
              "size-4.5 shrink-0 text-muted-foreground",
              playing && "text-foreground"
            )}
          />
        )}
        <span className="min-w-0 flex-1 text-sm transition-colors group-hover/voice-row:text-sky-500">
          {error ? "加载失败" : `语音 ${formatVoiceDuration(voice.durationMS)}`}
        </span>
      </button>
      {voice.transcript && (
        <button
          aria-expanded={expanded}
          aria-label={expanded ? "收起语音文字" : "展开语音文字"}
          className={cn(
            "w-full cursor-pointer text-left text-xs text-muted-foreground",
            expanded ? "break-words whitespace-pre-wrap" : "truncate"
          )}
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {voice.transcript}
        </button>
      )}
    </div>
  )
}

function formatVoiceDuration(durationMS: number) {
  const totalSeconds = Math.max(1, Math.ceil(durationMS / 1_000))
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`
}
