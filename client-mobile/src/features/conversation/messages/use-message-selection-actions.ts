import * as Clipboard from "expo-clipboard"
import { useRouter } from "expo-router"
import { useEffect } from "react"
import { useToastController } from "tamagui"

import type { AppToastTone } from "@/components/feedback/app-toast"
import { ApiRequestError, isUnauthorizedError } from "@/data/api-client"
import { useRevokeConversationMessage } from "@/data/messages/message-hooks"
import type { AuthenticatedTarget } from "@/core/server-target"
import {
  formatClientMessageBodySummary,
  type MessageMentionLabelResolver,
  type PresentedMessage,
} from "@/domain/messages/message-presenter"
import type { MessageReplyTarget } from "@/features/conversation/composer/message-reply-preview"
import { addMessageSelectionActionListener } from "@/native/message-selection-actions"
import { useAuth } from "@/providers/auth-provider"

export type ScopedMessageActionTarget = MessageReplyTarget & {
  avatar: string
  conversationId: string
  createdAt: string
}

export function useMessageSelectionActions({
  conversationId,
  isFocused,
  messages,
  onForward,
  onReply,
  onRevoked,
  resolveMentionLabel,
  server,
  topicArchived,
}: {
  conversationId: string
  isFocused: boolean
  messages: PresentedMessage[]
  onForward: (target: ScopedMessageActionTarget) => void
  onReply: (target: ScopedMessageActionTarget) => void
  onRevoked: (messageId: string) => void
  resolveMentionLabel: MessageMentionLabelResolver
  server: AuthenticatedTarget
  topicArchived: boolean
}) {
  const router = useRouter()
  const toast = useToastController()
  const { invalidateSession } = useAuth()
  const revokeMessageMutation = useRevokeConversationMessage(
    server,
    conversationId
  )

  useEffect(() => {
    if (!isFocused) return

    const subscription = addMessageSelectionActionListener((event) => {
      const message = messages.find(
        (candidate) => candidate.id === event.messageId
      )
      if (!message) return

      const target: ScopedMessageActionTarget = {
        author: message.author,
        avatar: message.avatar,
        conversationId,
        createdAt: message.createdAt,
        id: message.id,
        summary: formatClientMessageBodySummary(
          message.body,
          resolveMentionLabel
        ),
      }

      if (event.action === "copy") {
        void Clipboard.setStringAsync(target.summary)
          .then(() => {
            toast.show("已复制", {
              customData: { tone: "success" satisfies AppToastTone },
            })
          })
          .catch(() => {
            toast.show("复制失败", {
              customData: { tone: "error" satisfies AppToastTone },
            })
          })
        return
      }

      if (event.action === "reply") {
        if (!topicArchived) onReply(target)
        return
      }

      if (event.action === "forward") {
        onForward(target)
        return
      }

      if (
        event.action !== "revoke" ||
        !message.canRevoke ||
        revokeMessageMutation.isPending
      ) {
        return
      }

      void revokeMessageMutation
        .mutateAsync(message.id)
        .then(() => {
          onRevoked(message.id)
          toast.show("消息已撤回", {
            customData: { tone: "success" satisfies AppToastTone },
          })
        })
        .catch((error: unknown) => {
          if (isUnauthorizedError(error)) {
            void invalidateSession()
            router.replace("/server-management")
            return
          }
          toast.show(
            error instanceof ApiRequestError
              ? error.message
              : "撤回消息失败，请重试。",
            { customData: { tone: "error" satisfies AppToastTone } }
          )
        })
    })

    return () => subscription?.remove()
  }, [
    conversationId,
    invalidateSession,
    isFocused,
    messages,
    onForward,
    onReply,
    onRevoked,
    resolveMentionLabel,
    revokeMessageMutation,
    router,
    toast,
    topicArchived,
  ])
}
