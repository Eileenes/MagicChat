import {
  fetchConversationMessageReactionSnapshots,
  forwardConversationMessages,
  markConversationRead,
  revokeConversationMessage,
  sendConversationFileMessage,
  sendConversationImageMessage,
  sendConversationTextMessage,
  sendConversationVoiceMessage,
  setConversationMessageReaction,
} from "@/data/messages-api"
import type {
  ClientMessage,
  ClientMessageList,
  ClientMessagePage,
  MessageReactionsUpdatedEvent,
  MessageReactionSnapshot,
} from "@/data/models"
import type { ClientMessageUpload } from "@/data/message-upload"
import {
  getMessageSyncState,
  listMessageSyncStates,
  persistMessageReactionsEvent,
  persistMessageReactionSnapshot,
  persistRealtimeMessages,
  removeConversationMessageCache,
  removeServerMessageCache,
  updatePersistedMessage,
} from "@/data/messages/message-cache-store"
import { publishConversationMessagesChanged } from "@/data/messages/message-events"
import {
  fetchAndPersistMessagesAfter,
  fetchConversationMessagePage,
  initializeConversationMessageSync,
  loadCachedMessagePageBefore,
  loadLatestCachedMessagePage,
} from "@/data/messages/message-repository"
import type { AuthenticatedTarget, ServerTarget } from "@/data/query"
import {
  applyMessageReactionsUpdate,
  applyMessageReactionSnapshot,
  preserveNewerMessageReactionState,
} from "@/domain/messages/message-reactions"
import { formatClientMessageBodySummary } from "@/domain/messages/message-presenter"

type SendTextInput = {
  clientMessageId: string
  content: string
  replyToMessageId?: string
}

type SendUploadInput = {
  clientMessageId: string
  replyToMessageId?: string
}

type RuntimeConversation = Map<string, ClientMessage>

const MAX_RUNTIME_MESSAGES_PER_CONVERSATION = 3_000
const runtimeMessages = new Map<string, RuntimeConversation>()
const runtimePageState = new Map<string, ClientMessagePage>()
const latestSynchronization = new Map<string, Promise<void>>()

export const messageManager = {
  applyReactionEvent,
  applyReactionSnapshot,
  catchUpAfter,
  clearConversation,
  clearServer,
  fetchReactionSnapshots,
  forwardMessage,
  getSyncState: getMessageSyncState,
  listSyncStates: listMessageSyncStates,
  loadMessagePage,
  markRead,
  readLatestPage,
  revokeMessage,
  sendFile,
  sendImage,
  sendText,
  sendVoice,
  setReaction,
  synchronizeLatest,
  updateMessageTopic,
  updateTopicSourcePreview,
  writeMessages,
}

async function readLatestPage(
  target: AuthenticatedTarget,
  conversationId: string,
  limit: number
): Promise<ClientMessageList> {
  const cached = await loadLatestCachedMessagePage(
    target,
    conversationId,
    limit
  ).catch(() => null)
  if (cached) upsertRuntimeMessages(target, cached.messages)
  const messages = mergeMessages([
    ...(cached?.messages ?? []),
    ...readRuntimeMessages(target, conversationId),
  ]).slice(0, limit)

  return cached
    ? { ...cached, messages, page: updatePageRange(cached.page, messages) }
    : createRuntimePage(
        messages,
        limit,
        runtimePageState.get(
          createRuntimeConversationKey(target, conversationId)
        )
      )
}

async function loadMessagePage(
  target: AuthenticatedTarget,
  conversationId: string,
  input: { beforeSeq?: number; limit: number },
  options: { signal?: AbortSignal } = {}
) {
  if (input.beforeSeq === undefined) {
    return readLatestPage(target, conversationId, input.limit)
  }

  const result = await fetchConversationMessagePage(
    target,
    conversationId,
    input,
    options
  )
  upsertRuntimeMessages(target, result.messages)
  const persisted = await loadCachedMessagePageBefore(
    target,
    conversationId,
    input.beforeSeq,
    input.limit,
    result.page.hasMoreBefore
  ).catch(() => null)
  return persisted ?? result
}

function synchronizeLatest(
  target: AuthenticatedTarget,
  conversationId: string,
  limit: number
) {
  const key = createRuntimeConversationKey(target, conversationId)
  const current = latestSynchronization.get(key)
  if (current) return current

  const operation = initializeConversationMessageSync(
    target,
    conversationId,
    limit
  )
    .then(async (result) => {
      upsertRuntimeMessages(target, result.messages)
      runtimePageState.set(key, result.page)
      publishConversationMessagesChanged(target, conversationId, {
        page: createLatestRuntimePage(
          target,
          conversationId,
          result,
          limit
        ),
        type: "latest-page",
      })
    })
    .finally(() => {
      if (latestSynchronization.get(key) === operation) {
        latestSynchronization.delete(key)
      }
    })
  latestSynchronization.set(key, operation)
  return operation
}

async function catchUpAfter(
  target: AuthenticatedTarget,
  conversationId: string,
  afterSeq: number,
  limit: number
) {
  const result = await fetchAndPersistMessagesAfter(
    target,
    conversationId,
    afterSeq,
    limit
  )
  upsertRuntimeMessages(target, result.result.messages)
  publishConversationMessagesChanged(target, conversationId, {
    messages: result.result.messages,
    type: "upsert",
  })
  return result
}

async function writeMessages(
  target: AuthenticatedTarget,
  messages: ClientMessage[]
) {
  if (messages.length === 0) return

  await persistRealtimeMessages(target, messages).catch(() => undefined)
  upsertRuntimeMessages(target, messages)
  for (const conversationId of new Set(
    messages.map((message) => message.conversationId)
  )) {
    publishConversationMessagesChanged(target, conversationId, {
      messages: messages.filter(
        (message) => message.conversationId === conversationId
      ),
      type: "upsert",
    })
  }
}

async function sendText(
  target: AuthenticatedTarget,
  conversationId: string,
  input: SendTextInput
) {
  const message = await sendConversationTextMessage(
    target.url,
    conversationId,
    input
  )
  await writeMessages(target, [message])
  return message
}

function markRead(
  target: AuthenticatedTarget,
  conversationId: string,
  upToSeq: number
) {
  return markConversationRead(target.url, conversationId, upToSeq)
}

async function sendFile(
  target: AuthenticatedTarget,
  conversationId: string,
  input: SendUploadInput & { file: ClientMessageUpload }
) {
  const message = await sendConversationFileMessage(
    target.url,
    conversationId,
    input
  )
  await writeMessages(target, [message])
  return message
}

async function sendImage(
  target: AuthenticatedTarget,
  conversationId: string,
  input: SendUploadInput & { image: ClientMessageUpload }
) {
  const message = await sendConversationImageMessage(
    target.url,
    conversationId,
    input
  )
  await writeMessages(target, [message])
  return message
}

async function sendVoice(
  target: AuthenticatedTarget,
  conversationId: string,
  input: SendUploadInput & {
    durationMS: number
    voice: ClientMessageUpload
  }
) {
  const message = await sendConversationVoiceMessage(
    target.url,
    conversationId,
    input
  )
  await writeMessages(target, [message])
  return message
}

async function revokeMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string
) {
  const result = await revokeConversationMessage(
    target.url,
    conversationId,
    messageId
  )
  await writeMessages(target, [result.message, result.systemMessage])
  return result
}

async function forwardMessage(
  target: AuthenticatedTarget,
  sourceConversationId: string,
  input: {
    clientForwardId: string
    messageId: string
    targetConversationIds: string[]
  }
) {
  const result = await forwardConversationMessages(
    target.url,
    sourceConversationId,
    {
      clientForwardId: input.clientForwardId,
      messageIds: [input.messageId],
      targetConversationIds: input.targetConversationIds,
    }
  )
  await writeMessages(
    target,
    result.results.flatMap((item) =>
      item.status === "sent" ? item.messages : []
    )
  )
  return result
}

async function setReaction(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string,
  input: { reacted: boolean; text: string }
) {
  const snapshot = await setConversationMessageReaction(
    target.url,
    conversationId,
    messageId,
    input
  )
  await applyReactionSnapshot(target, snapshot)
  return snapshot
}

async function fetchReactionSnapshots(
  target: AuthenticatedTarget,
  conversationId: string,
  messageIds: string[]
) {
  return fetchConversationMessageReactionSnapshots(
    target.url,
    conversationId,
    messageIds
  )
}

async function applyReactionSnapshot(
  target: AuthenticatedTarget,
  snapshot: MessageReactionSnapshot
) {
  await persistMessageReactionSnapshot(target, snapshot).catch(
    () => undefined
  )
  const message = updateRuntimeMessage(
    target,
    snapshot.conversationId,
    snapshot.messageId,
    (message) => applyMessageReactionSnapshot(message, snapshot)
  )
  if (message) {
    publishConversationMessagesChanged(target, snapshot.conversationId, {
      messages: [message],
      type: "upsert",
    })
  }
}

async function applyReactionEvent(
  target: AuthenticatedTarget,
  event: MessageReactionsUpdatedEvent
) {
  const persistedStatus = await persistMessageReactionsEvent(
    target,
    event
  ).catch(() => "missing" as const)
  const runtimeResult: {
    status: "applied" | "gap" | "missing" | "stale"
  } = { status: "missing" }
  const message = updateRuntimeMessage(
    target,
    event.conversationId,
    event.messageId,
    (message) => {
      const result = applyMessageReactionsUpdate(message, event, target.userId)
      runtimeResult.status = result.status
      return result.message
    }
  )
  if (message) {
    publishConversationMessagesChanged(target, event.conversationId, {
      messages: [message],
      type: "upsert",
    })
  }
  return persistedStatus === "gap" || runtimeResult.status === "gap"
    ? "gap"
    : runtimeResult.status === "missing"
      ? persistedStatus
      : runtimeResult.status
}

async function updateMessageTopic(
  target: AuthenticatedTarget,
  input: {
    archived: boolean
    conversationId: string
    parentConversationId: string
    sourceMessageId: string
  }
) {
  await updateMessage(
    target,
    input.parentConversationId,
    input.sourceMessageId,
    (message) => ({
      ...message,
      topic: {
        archived: input.archived,
        conversationId: input.conversationId,
        recentReplies: message.topic?.recentReplies ?? [],
      },
    })
  )
}

async function updateTopicSourcePreview(
  target: AuthenticatedTarget,
  input: {
    message: ClientMessage
    parentConversationId: string
    sourceMessageId: string
  }
) {
  const { message } = input
  const senderType = message.sender.type
  if (senderType === "system") return
  const sender = { id: message.sender.id, type: senderType }

  await updateMessage(
    target,
    input.parentConversationId,
    input.sourceMessageId,
    (sourceMessage) => {
      if (!sourceMessage.topic) return sourceMessage

      const existingReplies = sourceMessage.topic.recentReplies.filter(
        (reply) => reply.id !== message.id
      )
      const recentReplies =
        message.body.type === "revoked"
          ? existingReplies
          : [
              ...existingReplies,
              {
                createdAt: message.createdAt,
                id: message.id,
                sender,
                summary: formatClientMessageBodySummary(
                  message.body,
                  () => undefined
                ),
              },
            ].slice(-3)

      return {
        ...sourceMessage,
        topic: { ...sourceMessage.topic, recentReplies },
      }
    }
  )
}

async function updateMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string,
  update: (message: ClientMessage) => ClientMessage
) {
  await updatePersistedMessage(
    target,
    conversationId,
    messageId,
    update
  ).catch(() => undefined)
  const message = updateRuntimeMessage(
    target,
    conversationId,
    messageId,
    update
  )
  if (message) {
    publishConversationMessagesChanged(target, conversationId, {
      messages: [message],
      type: "upsert",
    })
  }
}

async function clearConversation(
  target: AuthenticatedTarget,
  conversationId: string
) {
  await removeConversationMessageCache(target, conversationId).catch(
    () => undefined
  )
  runtimeMessages.delete(createRuntimeConversationKey(target, conversationId))
  runtimePageState.delete(createRuntimeConversationKey(target, conversationId))
  publishConversationMessagesChanged(target, conversationId, { type: "clear" })
}

async function clearServer(server: ServerTarget) {
  await removeServerMessageCache(server).catch(() => undefined)
  const keys = new Set([
    ...runtimeMessages.keys(),
    ...runtimePageState.keys(),
  ])
  for (const key of keys) {
    if (!runtimeKeyBelongsToServer(key, server)) continue

    runtimeMessages.delete(key)
    runtimePageState.delete(key)
  }
}

function upsertRuntimeMessages(
  target: AuthenticatedTarget,
  messages: ClientMessage[]
) {
  for (const incoming of messages) {
    const key = createRuntimeConversationKey(target, incoming.conversationId)
    const conversation = runtimeMessages.get(key) ?? new Map()
    const current = conversation.get(incoming.id)
    conversation.set(
      incoming.id,
      current
        ? preserveNewerMessageReactionState(current, incoming)
        : incoming
    )
    if (conversation.size > MAX_RUNTIME_MESSAGES_PER_CONVERSATION) {
      const retainedIds = new Set(
        Array.from(conversation.values())
          .sort((left, right) => right.seq - left.seq)
          .slice(0, MAX_RUNTIME_MESSAGES_PER_CONVERSATION)
          .map((message) => message.id)
      )
      for (const messageId of conversation.keys()) {
        if (!retainedIds.has(messageId)) conversation.delete(messageId)
      }
    }
    runtimeMessages.set(key, conversation)
  }
}

function updateRuntimeMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string,
  update: (message: ClientMessage) => ClientMessage
) {
  const conversation = runtimeMessages.get(
    createRuntimeConversationKey(target, conversationId)
  )
  const message = conversation?.get(messageId)
  if (!message) return null

  const next = update(message)
  conversation!.set(messageId, next)
  return next
}

function readRuntimeMessages(
  target: AuthenticatedTarget,
  conversationId: string
) {
  return Array.from(
    runtimeMessages.get(
      createRuntimeConversationKey(target, conversationId)
    )?.values() ?? []
  )
}

function createRuntimeConversationKey(
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

function runtimeKeyBelongsToServer(key: string, server: ServerTarget) {
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

function mergeMessages(messages: ClientMessage[]) {
  const byId = new Map<string, ClientMessage>()
  for (const message of messages) {
    const current = byId.get(message.id)
    byId.set(
      message.id,
      current
        ? preserveNewerMessageReactionState(current, message)
        : message
    )
  }
  return Array.from(byId.values()).sort((left, right) => right.seq - left.seq)
}

function createRuntimePage(
  messages: ClientMessage[],
  limit: number,
  page?: ClientMessagePage
): ClientMessageList {
  return {
    messages,
    page: {
      hasMoreAfter: page?.hasMoreAfter ?? false,
      hasMoreBefore: page?.hasMoreBefore ?? false,
      limit,
      newestSeq: messages[0]?.seq ?? page?.newestSeq ?? 0,
      oldestSeq:
        messages[messages.length - 1]?.seq ?? page?.oldestSeq ?? 0,
    },
  }
}

function updatePageRange(
  page: ClientMessageList["page"],
  messages: ClientMessage[]
) {
  return {
    ...page,
    newestSeq: messages[0]?.seq ?? page.newestSeq,
    oldestSeq: messages[messages.length - 1]?.seq ?? page.oldestSeq,
  }
}

function createLatestRuntimePage(
  target: AuthenticatedTarget,
  conversationId: string,
  result: ClientMessageList,
  limit: number
) {
  const messages = mergeMessages([
    ...result.messages,
    ...readRuntimeMessages(target, conversationId),
  ]).slice(0, limit)
  return {
    ...result,
    messages,
    page: updatePageRange(result.page, messages),
  }
}
