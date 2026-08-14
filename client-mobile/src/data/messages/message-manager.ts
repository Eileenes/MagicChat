import {
  fetchConversationMessageChoiceSnapshots,
  fetchConversationMessageReactionSnapshots,
  forwardConversationMessages,
  markConversationRead,
  revokeConversationMessage,
  sendConversationFileMessage,
  sendConversationImageMessage,
  sendConversationTextMessage,
  sendConversationVoiceMessage,
  setConversationMessageReaction,
  submitConversationMessageChoiceResponse,
} from "@/data/messages/messages-api"
import type {
  ClientMessage,
  ClientMessageList,
  ClientMessagePage,
  MessageChoiceSnapshot,
  MessageChoiceUpdatedEvent,
  MessageReactionsUpdatedEvent,
  MessageReactionSnapshot,
} from "@/core/models"
import type { ClientMessageUpload } from "@/data/messages/message-upload"
import {
  getMessageSyncState,
  listMessageSyncStates,
  persistMessageChoiceEvent,
  persistMessageChoiceSnapshot,
  persistMessageReactionsEvent,
  persistMessageReactionSnapshot,
  persistRealtimeMessages,
  removeConversationMessageCache,
  removeServerMessageCache,
  updatePersistedMessage,
  waitForMessageCacheMaintenance,
} from "@/data/messages/message-cache-store"
import { clearGlobalMessageCache, getGlobalMessageCacheSize } from "@/data/messages/message-cache-database"
import { publishConversationMessagesChanged } from "@/data/messages/message-events"
import {
  applyChoiceMessageTombstone,
  clearAllMessageTombstones,
  clearConversationMessageTombstones,
  clearServerMessageTombstones,
  recordChoiceMessageTombstone,
} from "@/data/messages/message-tombstones"
import {
  fetchAndPersistMessagesAfter,
  fetchConversationMessagePage,
  initializeConversationMessageSync,
  loadCachedMessagePageBefore,
  loadLatestCachedMessagePage,
} from "@/data/messages/message-repository"
import type { AuthenticatedTarget, ServerTarget } from "@/core/server-target"
import {
  applyMessageChoiceEvent,
  applyMessageChoiceSnapshot,
} from "@/domain/messages/message-choices"
import {
  applyMessageReactionsUpdate,
  applyMessageReactionSnapshot,
  preserveNewerMessageState,
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
const activeMessageCacheWrites = new Set<Promise<unknown>>()
let messageCacheClearBarrier: Promise<void> | null = null
let messageCacheClearOperation: Promise<void> | null = null

function runMessageCacheWrite<T>(operation: () => Promise<T>): Promise<T> {
  if (messageCacheClearBarrier) {
    const barrier = messageCacheClearBarrier
    return barrier.then(() => runMessageCacheWrite(operation))
  }

  const task = Promise.resolve().then(operation)
  activeMessageCacheWrites.add(task)
  void task.then(
    () => activeMessageCacheWrites.delete(task),
    () => activeMessageCacheWrites.delete(task)
  )
  return task
}

export const messageManager = {
  clearAllOfflineMessages,
  getOfflineMessageSize: getGlobalMessageCacheSize,
  applyChoiceEvent,
  applyChoiceSnapshot,
  applyReactionEvent,
  applyReactionSnapshot,
  catchUpAfter,
  clearConversation,
  clearServer,
  fetchChoiceSnapshots,
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
  submitChoice,
  synchronizeLatest,
  updateMessageTopic,
  updateTopicSourcePreview,
  writeMessages,
}

function clearAllOfflineMessages() {
  if (messageCacheClearOperation) return messageCacheClearOperation

  let releaseBarrier: () => void = () => undefined
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve
  })
  messageCacheClearBarrier = barrier
  const activeWrites = Array.from(activeMessageCacheWrites)

  const operation = (async () => {
    await Promise.allSettled(activeWrites)
    await waitForMessageCacheMaintenance()
    await clearGlobalMessageCache()
    runtimeMessages.clear()
    runtimePageState.clear()
    clearAllMessageTombstones()
  })().finally(() => {
    if (messageCacheClearOperation === operation) {
      messageCacheClearOperation = null
      messageCacheClearBarrier = null
    }
    releaseBarrier()
  })
  messageCacheClearOperation = operation
  return operation
}

async function readLatestPage(
  target: AuthenticatedTarget,
  conversationId: string,
  limit: number
): Promise<ClientMessageList> {
  const cached = await runMessageCacheWrite(() =>
    loadLatestCachedMessagePage(target, conversationId, limit)
  ).catch(() => null)
  const protectedCached = cached
    ? applyMessageListTombstones(target, cached)
    : null
  if (protectedCached) upsertRuntimeMessages(target, protectedCached.messages)
  const messages = mergeMessages([
    ...(protectedCached?.messages ?? []),
    ...readRuntimeMessages(target, conversationId),
  ]).slice(0, limit)

  return protectedCached
    ? {
        ...protectedCached,
        messages,
        page: updatePageRange(protectedCached.page, messages),
      }
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
  const beforeSeq = input.beforeSeq
  if (beforeSeq === undefined) {
    return readLatestPage(target, conversationId, input.limit)
  }

  const result = applyMessageListTombstones(
    target,
    await runMessageCacheWrite(() =>
      fetchConversationMessagePage(target, conversationId, input, options)
    )
  )
  upsertRuntimeMessages(target, result.messages)
  const persisted = await runMessageCacheWrite(() =>
    loadCachedMessagePageBefore(
      target,
      conversationId,
      beforeSeq,
      input.limit,
      result.page.hasMoreBefore
    )
  ).catch(() => null)
  return persisted ? applyMessageListTombstones(target, persisted) : result
}

function synchronizeLatest(
  target: AuthenticatedTarget,
  conversationId: string,
  limit: number
): Promise<void> {
  const key = createRuntimeConversationKey(target, conversationId)
  const current = latestSynchronization.get(key)
  if (current) return current

  const operation = runMessageCacheWrite(() =>
    initializeConversationMessageSync(target, conversationId, limit)
  )
    .then(async (rawResult) => {
      const result = applyMessageListTombstones(target, rawResult)
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
  const result = await runMessageCacheWrite(() =>
    fetchAndPersistMessagesAfter(target, conversationId, afterSeq, limit)
  )
  const protectedResult = applyMessageListTombstones(target, result.result)
  upsertRuntimeMessages(target, protectedResult.messages)
  publishConversationMessagesChanged(target, conversationId, {
    messages: protectedResult.messages,
    type: "upsert",
  })
  return { ...result, result: protectedResult }
}

async function writeMessages(
  target: AuthenticatedTarget,
  messages: ClientMessage[]
) {
  const protectedMessages = applyMessageTombstones(target, messages)
  if (protectedMessages.length === 0) return

  await runMessageCacheWrite(() =>
    persistRealtimeMessages(target, protectedMessages)
  ).catch(() => undefined)
  upsertRuntimeMessages(target, protectedMessages)
  for (const conversationId of new Set(
    protectedMessages.map((message) => message.conversationId)
  )) {
    publishConversationMessagesChanged(target, conversationId, {
      messages: protectedMessages.filter(
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
    transcript?: string
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

async function submitChoice(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string,
  optionIds: string[]
) {
  const result = await submitConversationMessageChoiceResponse(
    target.url,
    conversationId,
    messageId,
    optionIds
  )
  await applyChoiceSnapshot(target, {
    choice: result.choice,
    conversationId: result.conversationId,
    messageId: result.messageId,
    status: "active",
  })
  return result
}

function fetchChoiceSnapshots(
  target: AuthenticatedTarget,
  conversationId: string,
  messageIds: string[]
) {
  return fetchConversationMessageChoiceSnapshots(
    target.url,
    conversationId,
    messageIds
  )
}

async function applyChoiceSnapshot(
  target: AuthenticatedTarget,
  snapshot: MessageChoiceSnapshot
) {
  recordChoiceMessageTombstone(target, snapshot)
  await runMessageCacheWrite(() =>
    persistMessageChoiceSnapshot(target, snapshot)
  ).catch(() => undefined)
  if (snapshot.status === "deleted") {
    removeRuntimeMessage(
      target,
      snapshot.conversationId,
      snapshot.messageId
    )
    publishConversationMessagesChanged(target, snapshot.conversationId, {
      snapshot,
      type: "choice-snapshot",
    })
    return
  }

  updateRuntimeMessage(
    target,
    snapshot.conversationId,
    snapshot.messageId,
    (current) => applyMessageChoiceSnapshot(current, snapshot) ?? current
  )
  // Runtime is updated for future page construction. Query subscribers apply
  // the snapshot itself so messages outside the 3,000-item runtime window are
  // updated too.
  publishConversationMessagesChanged(target, snapshot.conversationId, {
    snapshot,
    type: "choice-snapshot",
  })
}

async function applyChoiceEvent(
  target: AuthenticatedTarget,
  event: MessageChoiceUpdatedEvent
) {
  await runMessageCacheWrite(() =>
    persistMessageChoiceEvent(target, event)
  ).catch(() => undefined)
  updateRuntimeMessage(
    target,
    event.conversationId,
    event.messageId,
    (current) => applyMessageChoiceEvent(current, event, target.userId)
  )
  publishConversationMessagesChanged(target, event.conversationId, {
    event,
    type: "choice-event",
  })
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
  await runMessageCacheWrite(() =>
    persistMessageReactionSnapshot(target, snapshot)
  ).catch(() => undefined)
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
  const persistedStatus = await runMessageCacheWrite(() =>
    persistMessageReactionsEvent(target, event)
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
  await runMessageCacheWrite(() =>
    updatePersistedMessage(target, conversationId, messageId, update)
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
  await runMessageCacheWrite(() =>
    removeConversationMessageCache(target, conversationId)
  ).catch(() => undefined)
  runtimeMessages.delete(createRuntimeConversationKey(target, conversationId))
  runtimePageState.delete(createRuntimeConversationKey(target, conversationId))
  clearConversationMessageTombstones(target, conversationId)
  publishConversationMessagesChanged(target, conversationId, { type: "clear" })
}

async function clearServer(server: ServerTarget) {
  await runMessageCacheWrite(() => removeServerMessageCache(server)).catch(
    () => undefined
  )
  const keys = new Set([
    ...runtimeMessages.keys(),
    ...runtimePageState.keys(),
  ])
  for (const key of keys) {
    if (!runtimeKeyBelongsToServer(key, server)) continue

    runtimeMessages.delete(key)
    runtimePageState.delete(key)
  }
  clearServerMessageTombstones(server)
}

function upsertRuntimeMessages(
  target: AuthenticatedTarget,
  messages: ClientMessage[]
) {
  for (const candidate of messages) {
    const incoming = applyChoiceMessageTombstone(target, candidate)
    const key = createRuntimeConversationKey(target, candidate.conversationId)
    if (!incoming) {
      runtimeMessages.get(key)?.delete(candidate.id)
      continue
    }
    const conversation = runtimeMessages.get(key) ?? new Map()
    const current = conversation.get(incoming.id)
    conversation.set(
      incoming.id,
      current
        ? preserveNewerMessageState(current, incoming)
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

function applyMessageTombstones(
  target: AuthenticatedTarget,
  messages: ClientMessage[]
) {
  return messages.flatMap((message) => {
    const protectedMessage = applyChoiceMessageTombstone(target, message)
    return protectedMessage ? [protectedMessage] : []
  })
}

function applyMessageListTombstones(
  target: AuthenticatedTarget,
  list: ClientMessageList
) {
  const messages = applyMessageTombstones(target, list.messages)
  return {
    ...list,
    messages,
    page: updatePageRange(list.page, messages),
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

function removeRuntimeMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string
) {
  return runtimeMessages
    .get(createRuntimeConversationKey(target, conversationId))
    ?.delete(messageId)
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
        ? preserveNewerMessageState(current, message)
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
