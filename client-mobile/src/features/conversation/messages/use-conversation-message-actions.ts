import { useRouter } from "expo-router"
import { Alert } from "react-native"
import { useToastController } from "tamagui"

import type { AppToastTone } from "@/components/feedback/app-toast"
import { ApiRequestError, isUnauthorizedError } from "@/data/api-client"
import {
  useForwardConversationMessage,
  useSendConversationFileMessage,
  useSendConversationImageMessage,
  useSendConversationTextMessage,
  useSendConversationVoiceMessage,
  useSetConversationMessageReaction,
  useSubmitConversationMessageChoiceResponse,
} from "@/data/messages/message-hooks"
import type {
  PreparedClientMessageUpload,
  PreparedClientVoiceMessage,
} from "@/data/messages/message-upload"
import type { AuthenticatedTarget } from "@/core/server-target"
import { useAuth } from "@/providers/auth-provider"

export function useConversationMessageActions({
  conversationId,
  forwardMessageId,
  onReplySent,
  replyToMessageId,
  server,
}: {
  conversationId: string
  forwardMessageId: string | undefined
  onReplySent: (messageId: string) => void
  replyToMessageId: string | undefined
  server: AuthenticatedTarget
}) {
  const router = useRouter()
  const toast = useToastController()
  const { invalidateSession } = useAuth()
  const sendTextMutation = useSendConversationTextMessage(
    server,
    conversationId
  )
  const sendFileMutation = useSendConversationFileMessage(
    server,
    conversationId
  )
  const sendImageMutation = useSendConversationImageMessage(
    server,
    conversationId
  )
  const sendVoiceMutation = useSendConversationVoiceMessage(
    server,
    conversationId
  )
  const setReactionMutation = useSetConversationMessageReaction(
    server,
    conversationId
  )
  const submitChoiceMutation = useSubmitConversationMessageChoiceResponse(
    server,
    conversationId
  )
  const forwardMutation = useForwardConversationMessage(
    server,
    conversationId
  )
  const isSending =
    sendTextMutation.isPending ||
    sendFileMutation.isPending ||
    sendImageMutation.isPending ||
    sendVoiceMutation.isPending

  async function sendText(content: string) {
    const repliedMessageId = replyToMessageId
    try {
      await sendTextMutation.mutateAsync({
        clientMessageId: createClientMessageId(),
        content,
        replyToMessageId: repliedMessageId,
      })
      if (repliedMessageId) onReplySent(repliedMessageId)
      return true
    } catch (error: unknown) {
      Alert.alert(
        "发送失败",
        error instanceof ApiRequestError ? error.message : "消息发送失败，请重试。"
      )
      return false
    }
  }

  async function sendUpload(selection: PreparedClientMessageUpload) {
    const repliedMessageId = replyToMessageId
    try {
      if (selection.kind === "image") {
        await sendImageMutation.mutateAsync({
          clientMessageId: createClientMessageId(),
          image: selection.upload,
          replyToMessageId: repliedMessageId,
        })
      } else {
        await sendFileMutation.mutateAsync({
          clientMessageId: createClientMessageId(),
          file: selection.upload,
          replyToMessageId: repliedMessageId,
        })
      }
      if (repliedMessageId) onReplySent(repliedMessageId)
      return true
    } catch (error: unknown) {
      Alert.alert(
        selection.kind === "image" ? "图片发送失败" : "文件发送失败",
        error instanceof ApiRequestError
          ? error.message
          : "消息发送失败，请重试。"
      )
      return false
    }
  }

  async function sendVoice(recording: PreparedClientVoiceMessage) {
    const repliedMessageId = replyToMessageId
    try {
      await sendVoiceMutation.mutateAsync({
        clientMessageId: createClientMessageId(),
        durationMS: recording.durationMS,
        replyToMessageId: repliedMessageId,
        transcript: recording.transcript,
        voice: recording.upload,
      })
      if (repliedMessageId) onReplySent(repliedMessageId)
      return true
    } catch (error: unknown) {
      Alert.alert(
        "语音发送失败",
        error instanceof Error ? error.message : "消息发送失败，请重试。"
      )
      return false
    }
  }

  async function setReaction(
    messageId: string,
    text: string,
    reacted: boolean
  ) {
    try {
      await setReactionMutation.mutateAsync({ messageId, reacted, text })
    } catch (error: unknown) {
      if (isUnauthorizedError(error)) {
        void invalidateSession()
        router.replace("/init")
      } else {
        toast.show(
          error instanceof ApiRequestError
            ? error.message
            : "更新消息表情失败，请重试。",
          { customData: { tone: "error" satisfies AppToastTone } }
        )
      }
      throw error
    }
  }

  async function respondChoice(messageId: string, optionIds: string[]) {
    try {
      await submitChoiceMutation.mutateAsync({ messageId, optionIds })
    } catch (error: unknown) {
      if (isUnauthorizedError(error)) {
        void invalidateSession()
        router.replace("/init")
      }
      throw error
    }
  }

  async function forward(targetConversationIds: string[]) {
    if (!forwardMessageId || forwardMutation.isPending) return false

    try {
      const result = await forwardMutation.mutateAsync({
        clientForwardId: createClientMessageId(),
        messageId: forwardMessageId,
        targetConversationIds,
      })
      if (result.sentCount === 0) {
        const firstFailure = result.results.find(
          (candidate) => candidate.status === "failed"
        )
        toast.show(
          firstFailure?.status === "failed"
            ? firstFailure.error.message
            : "转发消息失败，请重试。",
          { customData: { tone: "error" satisfies AppToastTone } }
        )
        return false
      }

      toast.show(
        result.failedCount > 0
          ? `已转发到 ${result.sentCount} 个会话，${result.failedCount} 个失败`
          : `已转发到 ${result.sentCount} 个会话`,
        {
          customData: {
            tone: (result.failedCount > 0
              ? "error"
              : "success") satisfies AppToastTone,
          },
        }
      )
      return true
    } catch (error: unknown) {
      if (isUnauthorizedError(error)) {
        void invalidateSession()
        router.replace("/init")
      } else {
        toast.show(
          error instanceof ApiRequestError
            ? error.message
            : "转发消息失败，请重试。",
          { customData: { tone: "error" satisfies AppToastTone } }
        )
      }
      return false
    }
  }

  return {
    forward,
    isSending,
    respondChoice,
    sendText,
    sendUpload,
    sendVoice,
    setReaction,
  }
}

function createClientMessageId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }

  let seed = Date.now()
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (value) => {
    const random = (seed + Math.random() * 16) % 16 | 0
    seed = Math.floor(seed / 16)
    return (value === "x" ? random : (random & 0x3) | 0x8).toString(16)
  })
}
