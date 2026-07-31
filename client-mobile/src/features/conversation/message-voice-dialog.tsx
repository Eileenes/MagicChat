import { Mic } from "lucide-react-native"
import {
  Dialog,
  SizableText,
  Spinner,
  VisuallyHidden,
  YStack,
} from "tamagui"

import { AppButton } from "@/components/forms/app-button"
import type { PreparedClientVoiceMessage } from "@/data/message-upload"
import { formatVoiceDuration } from "@/domain/messages/message-presenter"
import { VoiceRecordingPreviewButton } from "@/features/conversation/voice-recording-preview-button"
import type { VoiceMessageRecorderStatus } from "@/features/conversation/use-voice-message-recorder"

export function MessageVoiceDialog({
  elapsedMS,
  error,
  onCancel,
  onSendText,
  onSendVoice,
  open,
  recording,
  sending,
  status,
  transcript,
  transcriptionError,
}: {
  elapsedMS: number
  error: string
  onCancel: () => void
  onSendText: () => void
  onSendVoice: () => void
  open: boolean
  recording: PreparedClientVoiceMessage | null
  sending: boolean
  status: VoiceMessageRecorderStatus
  transcript: string
  transcriptionError: string
}) {
  const recorded = status === "recorded"

  return (
    <Dialog
      modal
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !sending) onCancel()
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay bg="$shadow6" opacity={0.5} />
        <Dialog.Content bordered elevate gap="$4" maxW={440} width="90%">
          <Dialog.Title fontSize="$4" lineHeight="$5">
            语音输入
          </Dialog.Title>
          <VisuallyHidden>
            <Dialog.Description>
              录制语音并选择发送语音消息或识别后的文字消息
            </Dialog.Description>
          </VisuallyHidden>

          <YStack
            bg="$backgroundPress"
            gap="$3"
            items="center"
            justify="center"
            minH={120}
            rounded="$4"
          >
            {recorded && recording ? (
              <VoiceRecordingPreviewButton
                disabled={sending}
                uri={recording.upload.uri}
              />
            ) : (
              <Mic color="$color10" size={34} strokeWidth={1.7} />
            )}
            <SizableText color="$color10" size="$3">
              {getStatusText(status, elapsedMS)}
            </SizableText>
          </YStack>

          {error ? (
            <SizableText color="$red10" size="$3">
              {error}
            </SizableText>
          ) : null}
          {transcriptionError ? (
            <SizableText color="$color10" size="$3">
              {transcriptionError}，仍可发送语音
            </SizableText>
          ) : null}

          {status !== "idle" ? (
            <YStack gap="$2">
              <SizableText fontWeight="600" size="$3">
                文字内容
              </SizableText>
              <SizableText color="$color11" lineHeight="$6" size="$4">
                {getTranscriptText(status, transcript)}
              </SizableText>
            </YStack>
          ) : null}

          <YStack gap="$3" width="100%">
            {status === "processing" || status === "transcribing" ? (
              <>
                <AppButton
                  disabled
                  icon={<Spinner size="small" />}
                  width="100%"
                >
                  {status === "transcribing" ? "正在识别" : "正在结束"}
                </AppButton>
                <CancelButton disabled={sending} onPress={onCancel} />
              </>
            ) : null}
            {recorded ? (
              <>
                <AppButton
                  disabled={!recording || sending}
                  icon={sending ? <Spinner size="small" /> : undefined}
                  onPress={onSendVoice}
                  theme="accent"
                  width="100%"
                >
                  发送语音
                </AppButton>
                <AppButton
                  disabled={!transcript.trim() || sending}
                  onPress={onSendText}
                  theme="accent"
                  width="100%"
                >
                  发送文本
                </AppButton>
                <CancelButton disabled={sending} onPress={onCancel} />
              </>
            ) : null}
          </YStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function CancelButton({
  disabled,
  onPress,
}: {
  disabled: boolean
  onPress: () => void
}) {
  return (
    <AppButton
      disabled={disabled}
      onPress={onPress}
      theme="gray"
      width="100%"
    >
      取消
    </AppButton>
  )
}

function getTranscriptText(
  status: VoiceMessageRecorderStatus,
  transcript: string
) {
  const content = transcript.trim()
  if (content) return content
  if (status === "recorded") return "未识别到文字内容"
  return "正在识别语音内容…"
}

function getStatusText(status: VoiceMessageRecorderStatus, elapsedMS: number) {
  if (status === "idle") return "点击开始录音"
  if (status === "requesting") return "正在准备麦克风和语音识别"
  if (status === "recording") {
    return `正在录音 ${formatVoiceDuration(Math.max(1, elapsedMS))}`
  }
  if (status === "processing") return "正在生成语音"
  if (status === "transcribing") return "正在完成语音识别"
  return `语音 ${formatVoiceDuration(elapsedMS)}`
}
