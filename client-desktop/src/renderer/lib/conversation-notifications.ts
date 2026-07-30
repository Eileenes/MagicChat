import type { ClientConversation } from "@/lib/client-data-api"

export function getTotalUnreadCount(conversations: ReadonlyArray<ClientConversation>): number {
  return conversations.reduce((total, conversation) => total + conversation.unreadCount, 0)
}

export function getNotifiableUnreadCount(conversations: ReadonlyArray<ClientConversation>): number {
  return conversations.reduce(
    (total, conversation) =>
      conversation.notificationMuted ? total : total + conversation.unreadCount,
    0,
  )
}
