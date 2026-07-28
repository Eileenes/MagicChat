import type { ClientMessage, MessageChoiceSnapshot } from "@/data/models"
import type { AuthenticatedTarget, ServerTarget } from "@/data/query"

type ChoiceMessageTombstoneStatus = "deleted" | "revoked"

const choiceMessageTombstones = new Map<
  string,
  Map<string, ChoiceMessageTombstoneStatus>
>()

export function recordChoiceMessageTombstone(
  target: AuthenticatedTarget,
  snapshot: MessageChoiceSnapshot
) {
  if (snapshot.status !== "deleted" && snapshot.status !== "revoked") return

  const key = createConversationKey(target, snapshot.conversationId)
  const conversation = choiceMessageTombstones.get(key) ?? new Map()
  const current = conversation.get(snapshot.messageId)
  if (current !== "deleted") {
    conversation.set(snapshot.messageId, snapshot.status)
  }
  choiceMessageTombstones.set(key, conversation)
}

export function applyChoiceMessageTombstone(
  target: AuthenticatedTarget,
  message: ClientMessage
): ClientMessage | null {
  const status = choiceMessageTombstones
    .get(createConversationKey(target, message.conversationId))
    ?.get(message.id)
  if (status === "deleted") return null
  if (status !== "revoked") return message

  return {
    ...message,
    body: { type: "revoked" },
    choice: undefined,
    reactions: [],
  }
}

export function clearConversationMessageTombstones(
  target: AuthenticatedTarget,
  conversationId: string
) {
  choiceMessageTombstones.delete(createConversationKey(target, conversationId))
}

export function clearServerMessageTombstones(server: ServerTarget) {
  for (const key of choiceMessageTombstones.keys()) {
    if (conversationKeyBelongsToServer(key, server)) {
      choiceMessageTombstones.delete(key)
    }
  }
}

function createConversationKey(
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

function conversationKeyBelongsToServer(key: string, server: ServerTarget) {
  try {
    const value: unknown = JSON.parse(key)
    return (
      Array.isArray(value) &&
      value[0] === server.id &&
      value[1] === server.url
    )
  } catch {
    return false
  }
}
