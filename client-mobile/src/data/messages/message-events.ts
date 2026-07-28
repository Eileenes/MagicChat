import type { ClientMessage, ClientMessageList } from "@/data/models"
import type { AuthenticatedTarget } from "@/data/query"

export type ConversationMessagesChangedEvent =
  | { page: ClientMessageList; type: "latest-page" }
  | { messages: ClientMessage[]; type: "upsert" }
  | { type: "clear" }

type MessageListener = (event: ConversationMessagesChangedEvent) => void

const listeners = new Map<string, Set<MessageListener>>()

export function subscribeConversationMessages(
  target: AuthenticatedTarget,
  conversationId: string,
  listener: MessageListener
) {
  const key = createConversationEventKey(target, conversationId)
  const current = listeners.get(key) ?? new Set<MessageListener>()
  current.add(listener)
  listeners.set(key, current)

  return () => {
    current.delete(listener)
    if (current.size === 0) listeners.delete(key)
  }
}

export function publishConversationMessagesChanged(
  target: AuthenticatedTarget,
  conversationId: string,
  event: ConversationMessagesChangedEvent
) {
  const current = listeners.get(
    createConversationEventKey(target, conversationId)
  )
  for (const listener of current ?? []) {
    try {
      listener(event)
    } catch {
      // One presentation subscriber must not make a committed message write fail.
    }
  }
}

function createConversationEventKey(
  target: AuthenticatedTarget,
  conversationId: string
) {
  return JSON.stringify([
    target.id,
    target.url,
    target.userId,
    conversationId,
  ])
}
