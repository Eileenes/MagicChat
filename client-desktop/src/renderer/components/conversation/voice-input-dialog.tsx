import * as React from "react"
import { AudioLines, LoaderCircle, Mic, RotateCcw, Send, Square } from "lucide-react"

import { VoiceRecordingPanel } from "@/components/conversation/conversation-voice-recorder"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useVoiceRecording } from "@/hooks/use-voice-recording"
import type { ClientMessage } from "@/lib/client-data-api"
import type { VoiceMessageRecording } from "@/lib/voice-message"

type VoiceInputDialogProps = {
  conversationName: string
  onOpenChange: (open: boolean) => void
  onSendText: (text: string) => void
  onSendVoice: (voice: VoiceMessageRecording) => Promise<ClientMessage | null>
  open: boolean
  sending: boolean
}

export function VoiceInputDialog({
  conversationName,
  onOpenChange,
  onSendText,
  onSendVoice,
  open,
  sending,
}: VoiceInputDialogProps) {
  const [transcript, setTranscript] = React.useState("")
  const recording = useVoiceRecording({ onTranscript: setTranscript })
  const canChooseSendMethod = recording.status === "recorded"

  function reset() {
    setTranscript("")
    recording.resetRecording()
  }

  function handleOpenChange(nextOpen: boolean) {
    if (sending) return
    onOpenChange(nextOpen)
    if (!nextOpen) reset()
  }

  function startRecording() {
    setTranscript("")
    void recording.startRecording()
  }

  async function sendVoice() {
    if (!recording.recording || !canChooseSendMethod || sending) return
    const normalizedTranscript = transcript.trim()
    const message = await onSendVoice({
      ...recording.recording,
      transcript: normalizedTranscript || undefined,
    })
    if (!message) return
    onOpenChange(false)
    reset()
  }

  function sendText() {
    const normalizedTranscript = transcript.trim()
    if (!canChooseSendMethod || !normalizedTranscript || sending) return
    onSendText(normalizedTranscript)
    onOpenChange(false)
    reset()
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="gap-5 sm:max-w-lg"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-base">语音输入</DialogTitle>
          <DialogDescription className="sr-only">
            录制语音、修改识别文字，并选择发送语音或文字
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <VoiceRecordingPanel
            elapsedSeconds={recording.elapsedSeconds}
            level={recording.level}
            status={recording.status}
          />
          {recording.error && <p className="text-sm text-destructive">{recording.error}</p>}
          {recording.transcriptionError && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {recording.transcriptionError}，仍可发送语音或手动填写文字
            </p>
          )}
          {recording.status !== "idle" && (
            <p className="min-w-0 text-sm text-muted-foreground">
              将要发送到 <span className="font-medium text-foreground">{conversationName}</span>
            </p>
          )}
          {recording.status !== "idle" && (
            <div className="grid gap-2">
              <Label htmlFor="voice-input-transcript">文字内容</Label>
              <Textarea
                id="voice-input-transcript"
                className="max-h-48 min-h-28 resize-none"
                disabled={!canChooseSendMethod || sending}
                maxLength={5_000}
                onChange={(event) => setTranscript(event.target.value)}
                placeholder={
                  canChooseSendMethod ? "可以修改识别结果，或直接发送" : "正在识别语音内容"
                }
                value={transcript}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={sending} type="button" variant="outline">
              取消
            </Button>
          </DialogClose>
          {recording.status === "idle" && (
            <Button disabled={sending} onClick={startRecording} type="button">
              <Mic />
              开始录音
            </Button>
          )}
          {recording.status === "requesting" && (
            <Button disabled type="button">
              <LoaderCircle className="animate-spin" />
              正在连接
            </Button>
          )}
          {recording.status === "recording" && (
            <Button onClick={recording.stopRecording} type="button" variant="destructive">
              <Square />
              结束录音
            </Button>
          )}
          {(recording.status === "processing" || recording.status === "transcribing") && (
            <Button disabled type="button">
              <LoaderCircle className="animate-spin" />
              {recording.status === "transcribing" ? "正在识别" : "正在结束"}
            </Button>
          )}
          {canChooseSendMethod && (
            <>
              <Button disabled={sending} onClick={startRecording} type="button" variant="outline">
                <RotateCcw />
                重新录音
              </Button>
              <Button
                disabled={!recording.recording || sending}
                onClick={() => void sendVoice()}
                type="button"
                variant="outline"
              >
                {sending ? <LoaderCircle className="animate-spin" /> : <AudioLines />}
                发送语音
              </Button>
              <Button disabled={!transcript.trim() || sending} onClick={sendText} type="button">
                <Send />
                发送文本
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
