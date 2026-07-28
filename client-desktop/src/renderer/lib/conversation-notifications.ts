import type { ClientConversation } from "@/lib/client-data-api"

export function getNotifiableUnreadCount(conversations: ReadonlyArray<ClientConversation>): number {
  return conversations.reduce(
    (total, conversation) =>
      conversation.notificationMuted ? total : total + conversation.unreadCount,
    0,
  )
}
