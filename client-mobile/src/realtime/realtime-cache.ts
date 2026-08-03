import type { InfiniteData, QueryClient } from "@tanstack/react-query"

import { normalizeClientMessage } from "@/data/messages/message-normalizer"
import { messageManager } from "@/data/messages"
import type {
  ClientConversation,
  ClientMessage,
  ClientMessageList,
  ClientTopicDetail,
} from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { queryKeys } from "@/data/query"
import { formatClientMessageBodySummary } from "@/domain/messages/message-presenter"
import {
  applyRealtimeMessageChoiceEvent,
  synchronizeConversationMessageChoices,
} from "@/realtime/choice-sync"
import {
  applyRealtimeMessageReactionsEvent,
  synchronizeConversationMessageReactions,
} from "@/realtime/reaction-sync"
import { realtimeEvents } from "@/realtime/realtime-protocol"

type MessageInfiniteData = InfiniteData<ClientMessageList, number | null>

const CATCH_UP_PAGE_SIZE = 20

export async function applyRealtimeEvent(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  event: string,
  payload: unknown,
  options: { activeConversationId?: string; visible?: boolean } = {}
) {
  if (
    event === realtimeEvents.messageCreated ||
    event === realtimeEvents.messageUpdated
  ) {
    const message = normalizeMessageEventPayload(payload)
    await messageManager.writeMessages(server, [message])
    await persistTopicSourcePreview(queryClient, server, message)

    if (
      event === realtimeEvents.messageCreated &&
      options.visible &&
      options.activeConversationId === message.conversationId
    ) {
      const conversations = queryClient.getQueryData<ClientConversation[]>(
        queryKeys.conversations(server)
      )
      const hasConversation = conversations?.some(
        (conversation) => conversation.id === message.conversationId
      )

      queryClient.setQueryData<ClientConversation[]>(
        queryKeys.conversations(server),
        (current) => markActiveConversationMessageRead(current, message)
      )

      if (!hasConversation) {
        invalidateConversations(queryClient, server)
      }
    } else {
      invalidateConversations(queryClient, server)
    }
    return { message }
  }

  if (event === realtimeEvents.messageReactionsUpdated) {
    await applyRealtimeMessageReactionsEvent(queryClient, server, payload)
    return {}
  }

  if (event === realtimeEvents.messageChoiceUpdated) {
    await applyRealtimeMessageChoiceEvent(queryClient, server, payload)
    return {}
  }

  if (event === realtimeEvents.conversationRemoved) {
    const conversationId = normalizeConversationRemovedPayload(payload)

    await queryClient.cancelQueries({
      exact: true,
      queryKey: queryKeys.conversations(server),
    })

    queryClient.setQueryData<ClientConversation[]>(
      queryKeys.conversations(server),
      (current) =>
        current?.filter((conversation) => conversation.id !== conversationId)
    )
    queryClient.removeQueries({
      exact: true,
      queryKey: queryKeys.conversationMessages(server, conversationId),
    })
    await messageManager.clearConversation(server, conversationId)
    return {}
  }

  if (event === realtimeEvents.conversationMemberMentioned) {
    const mentioned = normalizeConversationMentionedPayload(payload)

    queryClient.setQueryData<ClientConversation[]>(
      queryKeys.conversations(server),
      (current) =>
        current?.map((conversation) =>
          conversation.id === mentioned.conversationId
            ? {
                ...conversation,
                lastMentionedSeq: Math.max(
                  conversation.lastMentionedSeq,
                  mentioned.lastMentionedSeq
                ),
              }
            : conversation
        )
    )
    return {}
  }

  if (event === realtimeEvents.conversationMemberChoiceReceived) {
    const choice = normalizeConversationChoiceReceivedPayload(payload)

    queryClient.setQueryData<ClientConversation[]>(
      queryKeys.conversations(server),
      (current) =>
        current?.map((conversation) =>
          conversation.id === choice.conversationId
            ? {
                ...conversation,
                lastChoiceSeq: Math.max(
                  conversation.lastChoiceSeq,
                  choice.lastChoiceSeq
                ),
              }
            : conversation
        )
    )
    return {}
  }

  if (event === realtimeEvents.conversationPinUpdated) {
    const pinUpdate = normalizeConversationPinUpdatedPayload(payload)

    queryClient.setQueryData<ClientConversation[]>(
      queryKeys.conversations(server),
      (current) =>
        current?.map((conversation) =>
          conversation.id === pinUpdate.conversationId
            ? { ...conversation, pinned: pinUpdate.pinned }
            : conversation
        )
    )
    return {}
  }

  if (event === realtimeEvents.conversationMuteUpdated) {
    const muteUpdate = normalizeConversationMuteUpdatedPayload(payload)

    queryClient.setQueryData<ClientConversation[]>(
      queryKeys.conversations(server),
      (current) =>
        current?.map((conversation) =>
          conversation.id === muteUpdate.conversationId
            ? {
                ...conversation,
                notificationMuted: muteUpdate.muted,
              }
            : conversation
        )
    )
    return {}
  }

  if (
    event === realtimeEvents.topicCreated ||
    event === realtimeEvents.topicParticipated ||
    event === realtimeEvents.topicArchived
  ) {
    const topic = normalizeTopicEventPayload(payload)

    await messageManager.updateMessageTopic(server, topic)
    queryClient.setQueryData<ClientTopicDetail>(
      queryKeys.conversationTopic(server, topic.conversationId),
      (current) =>
        current
          ? {
              ...current,
              canArchive: topic.archived ? false : current.canArchive,
              canParticipate: topic.archived
                ? false
                : current.canParticipate,
              conversation: current.conversation.topic
                ? {
                    ...current.conversation,
                    topic: {
                      ...current.conversation.topic,
                      archived: topic.archived,
                    },
                  }
                : current.conversation,
            }
          : current
    )
    queryClient.setQueryData<ClientConversation[]>(
      queryKeys.conversations(server),
      (current) =>
        topic.archived
          ? current?.filter(
              (conversation) => conversation.id !== topic.conversationId
            )
          : current?.map((conversation) =>
              conversation.id === topic.conversationId && conversation.topic
                ? {
                    ...conversation,
                    topic: { ...conversation.topic, archived: false },
                  }
                : conversation
            )
    )
    invalidateConversations(queryClient, server)
    return {}
  }

  return {}
}

function markActiveConversationMessageRead(
  conversations: ClientConversation[] | undefined,
  message: ClientMessage
) {
  if (!conversations) return conversations

  const conversation = conversations.find(
    (item) => item.id === message.conversationId
  )
  if (!conversation) return conversations

  const isLatestMessage = message.seq >= conversation.lastMessageSeq
  const updatedConversation: ClientConversation = {
    ...conversation,
    ...(isLatestMessage
      ? {
          lastMessageAt: message.createdAt,
          lastMessageId: message.id,
          lastMessageSeq: message.seq,
          lastMessageSender: getLastMessageSender(conversation, message),
          lastMessageSummary: formatClientMessageBodySummary(
            message.body,
            () => undefined
          ),
        }
      : {}),
    lastReadSeq: Math.max(conversation.lastReadSeq, message.seq),
    unreadCount: 0,
  }

  return [
    updatedConversation,
    ...conversations.filter((item) => item.id !== message.conversationId),
  ]
}

function getLastMessageSender(
  conversation: ClientConversation,
  message: ClientMessage
): ClientConversation["lastMessageSender"] {
  if (message.sender.type === "system") {
    return {
      id: message.sender.id,
      name: "系统",
      nickname: "",
      type: "system",
    }
  }

  const member = conversation.members?.find(
    (item) =>
      item.id === message.sender.id && item.type === message.sender.type
  )

  return {
    id: message.sender.id,
    name: member?.name ?? "",
    nickname: member?.nickname ?? "",
    type: message.sender.type,
  }
}

function invalidateConversations(
  queryClient: QueryClient,
  server: AuthenticatedTarget
) {
  void queryClient.invalidateQueries(
    {
      exact: true,
      queryKey: queryKeys.conversations(server),
    },
    { cancelRefetch: false }
  )
}

function persistTopicSourcePreview(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  message: ClientMessage
) {
  const topic = queryClient
    .getQueryData<ClientConversation[]>(queryKeys.conversations(target))
    ?.find(
      (conversation) =>
        conversation.id === message.conversationId &&
        conversation.type === "topic"
    )?.topic
  if (!topic) return Promise.resolve()

  return messageManager.updateTopicSourcePreview(target, {
    message,
    parentConversationId: topic.parentConversationId,
    sourceMessageId: topic.sourceMessageId,
  })
}

export async function synchronizeRealtimeData(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  options: { activeConversationId?: string } = {}
) {
  await queryClient.invalidateQueries(
    {
      exact: true,
      queryKey: queryKeys.conversations(server),
    },
    { cancelRefetch: false }
  )

  const conversations =
    queryClient.getQueryData<ClientConversation[]>(
      queryKeys.conversations(server)
    ) ?? []
  const conversationById = new Map(
    conversations.map((conversation) => [conversation.id, conversation])
  )
  const syncStates = await messageManager.listSyncStates(server).catch(
    () => []
  )
  const syncStateConversationIds = new Set(
    syncStates.map((state) => state.conversationId)
  )
  const prioritizedStates = [...syncStates].sort((left, right) =>
    compareCatchUpPriority(
      left.conversationId,
      right.conversationId,
      conversationById,
      options.activeConversationId
    )
  )

  for (const state of prioritizedStates) {
    const conversation = conversationById.get(state.conversationId)
    const isActive = state.conversationId === options.activeConversationId
    if (!conversation && !isActive) continue

    if (state.httpSyncedThroughSeq === 0) {
      await messageManager.synchronizeLatest(
        server,
        state.conversationId,
        CATCH_UP_PAGE_SIZE
      )
      continue
    }

    if (
      isActive ||
      (conversation?.lastMessageSeq ?? 0) > state.httpSyncedThroughSeq
    ) {
      await catchUpConversationMessages(
        server,
        state.conversationId,
        state.httpSyncedThroughSeq
      )
    }
  }

  const loadedConversationQueries =
    queryClient.getQueriesData<MessageInfiniteData>({
      queryKey: [...queryKeys.authenticated(server), "conversation"],
    })

  for (const [queryKey, data] of loadedConversationQueries) {
    const conversationId = getConversationIdFromMessageQueryKey(queryKey)
    if (
      !conversationId ||
      !data ||
      syncStateConversationIds.has(conversationId)
    ) {
      continue
    }

    const newestSeq = getNewestMessageSeq(data)
    if (newestSeq > 0) {
      await catchUpConversationMessages(
        server,
        conversationId,
        newestSeq
      )
    }
  }

  await Promise.all(
    loadedConversationQueries.flatMap(([queryKey, data]) => {
      const conversationId = getConversationIdFromMessageQueryKey(queryKey)
      const messageIds = data ? getLoadedMessageIds(data) : []
      if (!conversationId || messageIds.length === 0) return []

      const operations: Promise<void>[] = [
        synchronizeConversationMessageReactions(
          queryClient,
          server,
          conversationId,
          messageIds
        ),
      ]
      const choiceMessageIds = data ? getLoadedChoiceMessageIds(data) : []
      if (choiceMessageIds.length > 0) {
        operations.push(
          synchronizeConversationMessageChoices(
            queryClient,
            server,
            conversationId,
            choiceMessageIds
          )
        )
      }
      return operations
    })
  )
}

export async function refreshClientDataOnForeground(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  options: { activeConversationId?: string } = {}
) {
  await Promise.all([
    queryClient.invalidateQueries(
      {
        exact: true,
        queryKey: queryKeys.contacts(server),
      },
      { cancelRefetch: false }
    ),
    queryClient.invalidateQueries(
      {
        exact: true,
        queryKey: queryKeys.currentUser(server),
      },
      { cancelRefetch: false }
    ),
    queryClient.invalidateQueries(
      {
        exact: true,
        queryKey: queryKeys.projects(server),
      },
      { cancelRefetch: false }
    ),
    synchronizeRealtimeData(queryClient, server, options),
  ])
}

async function catchUpConversationMessages(
  server: AuthenticatedTarget,
  conversationId: string,
  initialAfterSeq: number
) {
  let afterSeq = initialAfterSeq

  for (let pageIndex = 0; ; pageIndex += 1) {
    const { committedSeq, result } = await messageManager.catchUpAfter(
      server,
      conversationId,
      afterSeq,
      CATCH_UP_PAGE_SIZE
    )

    if (!result.page.hasMoreAfter) {
      return
    }

    if (committedSeq <= afterSeq) {
      throw new Error("消息增量同步游标没有向前推进")
    }
    afterSeq = committedSeq

    if (pageIndex > 0 && pageIndex % 10 === 0) {
      await yieldToEventLoop()
    }
  }
}

function compareCatchUpPriority(
  leftId: string,
  rightId: string,
  conversations: ReadonlyMap<string, ClientConversation>,
  activeConversationId: string | undefined
) {
  const left = conversations.get(leftId)
  const right = conversations.get(rightId)
  const leftPriority = catchUpPriority(leftId, left, activeConversationId)
  const rightPriority = catchUpPriority(rightId, right, activeConversationId)
  return rightPriority - leftPriority
}

function catchUpPriority(
  conversationId: string,
  conversation: ClientConversation | undefined,
  activeConversationId: string | undefined
) {
  const active = conversationId === activeConversationId ? 1e16 : 0
  const unread = (conversation?.unreadCount ?? 0) > 0 ? 1e15 : 0
  const recent = conversation?.lastMessageAt
    ? Date.parse(conversation.lastMessageAt)
    : 0
  return active + unread + (Number.isFinite(recent) ? recent : 0)
}

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function getLoadedMessageIds(data: MessageInfiniteData) {
  return data.pages.flatMap((page) =>
    page.messages.map((message) => message.id)
  )
}

function getLoadedChoiceMessageIds(data: MessageInfiniteData) {
  return data.pages.flatMap((page) =>
    page.messages.flatMap((message) =>
      message.body.type === "choice" ? [message.id] : []
    )
  )
}

function getNewestMessageSeq(data: MessageInfiniteData) {
  return data.pages.reduce(
    (newest, page) =>
      page.messages.reduce(
        (pageNewest, message) => Math.max(pageNewest, message.seq),
        newest
      ),
    0
  )
}

function getConversationIdFromMessageQueryKey(queryKey: readonly unknown[]) {
  return queryKey.length === 8 &&
    queryKey[0] === "server" &&
    queryKey[3] === "user" &&
    queryKey[5] === "conversation" &&
    typeof queryKey[6] === "string" &&
    queryKey[7] === "messages"
    ? queryKey[6]
    : null
}

function normalizeMessageEventPayload(payload: unknown) {
  const value = asRecord(payload)
  if (!value || !("message" in value)) {
    throw new Error("实时消息格式不正确")
  }
  return normalizeClientMessage(value.message)
}

function normalizeConversationRemovedPayload(payload: unknown) {
  const value = asRecord(payload)
  if (!value || typeof value.conversation_id !== "string") {
    throw new Error("实时会话移除事件格式不正确")
  }
  return value.conversation_id
}

function normalizeConversationMentionedPayload(payload: unknown) {
  const value = asRecord(payload)
  if (
    !value ||
    typeof value.conversation_id !== "string" ||
    typeof value.last_mentioned_seq !== "number" ||
    !Number.isFinite(value.last_mentioned_seq) ||
    value.last_mentioned_seq <= 0
  ) {
    throw new Error("实时会话提醒事件格式不正确")
  }

  return {
    conversationId: value.conversation_id,
    lastMentionedSeq: value.last_mentioned_seq,
  }
}

function normalizeConversationChoiceReceivedPayload(payload: unknown) {
  const value = asRecord(payload)
  if (
    !value ||
    typeof value.conversation_id !== "string" ||
    value.conversation_id.length === 0 ||
    typeof value.last_choice_seq !== "number" ||
    !Number.isSafeInteger(value.last_choice_seq) ||
    value.last_choice_seq <= 0
  ) {
    throw new Error("实时选择消息提醒事件格式不正确")
  }
  return {
    conversationId: value.conversation_id,
    lastChoiceSeq: value.last_choice_seq,
  }
}

function normalizeConversationPinUpdatedPayload(payload: unknown) {
  const value = asRecord(payload)
  if (
    !value ||
    typeof value.conversation_id !== "string" ||
    value.conversation_id.trim() === "" ||
    typeof value.pinned !== "boolean"
  ) {
    throw new Error("实时会话置顶事件格式不正确")
  }

  return {
    conversationId: value.conversation_id,
    pinned: value.pinned,
  }
}

function normalizeConversationMuteUpdatedPayload(payload: unknown) {
  const value = asRecord(payload)
  if (
    !value ||
    typeof value.conversation_id !== "string" ||
    value.conversation_id.trim() === "" ||
    typeof value.muted !== "boolean"
  ) {
    throw new Error("实时会话免打扰事件格式不正确")
  }

  return {
    conversationId: value.conversation_id,
    muted: value.muted,
  }
}

function normalizeTopicEventPayload(payload: unknown) {
  const value = asRecord(payload)
  if (
    !value ||
    typeof value.conversation_id !== "string" ||
    typeof value.parent_conversation_id !== "string" ||
    typeof value.source_message_id !== "string"
  ) {
    throw new Error("实时话题事件格式不正确")
  }

  return {
    archived: Boolean(value.archived),
    conversationId: value.conversation_id,
    parentConversationId: value.parent_conversation_id,
    sourceMessageId: value.source_message_id,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
