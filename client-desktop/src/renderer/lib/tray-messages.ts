import type { ClientConversation } from "@/lib/client-data-api"
import type { TrayMessageInput } from "@/lib/desktop-host"

const maximumConversationNameLength = 16
const maximumMessageSummaryLength = 24

export function selectUnreadTrayMessages(
  conversations: ReadonlyArray<ClientConversation>,
): TrayMessageInput[] {
  return conversations
    .filter((conversation) => conversation.unreadCount > 0 && !conversation.notificationMuted)
    .toSorted(
      (left, right) =>
        Date.parse(right.lastMessageAt ?? right.createdAt) -
        Date.parse(left.lastMessageAt ?? left.createdAt),
    )
    .map((conversation) => ({
      conversationId: conversation.id,
      name: singleLine(conversation.name, maximumConversationNameLength) || "未命名会话",
      summary: singleLine(conversation.lastMessageSummary, maximumMessageSummaryLength) || "新消息",
      unreadCount: conversation.unreadCount,
    }))
}

function singleLine(value: string, maximumLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  const characters = Array.from(normalized)
  if (characters.length <= maximumLength) return normalized
  return `${characters.slice(0, maximumLength - 1).join("")}…`
}
