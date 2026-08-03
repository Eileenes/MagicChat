import { BellOff, Pin } from "lucide-react-native"
import { useTheme, XStack } from "tamagui"

import type { ClientConversation } from "@/core/models"

export function ConversationPreferenceIndicators({
  conversation,
  showPinned = true,
}: {
  conversation: ClientConversation
  showPinned?: boolean
}) {
  const theme = useTheme()
  const color = String(theme.gray10.val)
  const pinned = showPinned && conversation.pinned

  if (!pinned && !conversation.notificationMuted) {
    return null
  }

  return (
    <XStack gap={2} items="center" shrink={0}>
      {pinned ? (
        <Pin
          accessibilityLabel="已置顶"
          color={color}
          size={11}
          strokeWidth={1.7}
        />
      ) : null}
      {conversation.notificationMuted ? (
        <BellOff
          accessibilityLabel="消息免打扰"
          color={color}
          size={11}
          strokeWidth={1.7}
        />
      ) : null}
    </XStack>
  )
}
