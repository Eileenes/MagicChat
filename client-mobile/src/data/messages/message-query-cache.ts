import type { InfiniteData, QueryClient } from "@tanstack/react-query"

import type { ClientMessage, ClientMessageList } from "@/data/models"
import type { ConversationMessagesChangedEvent } from "@/data/messages/message-events"
import { messageManager } from "@/data/messages/message-manager"
import { queryKeys, type AuthenticatedTarget } from "@/data/query"
import { preserveNewerMessageReactionState } from "@/domain/messages/message-reactions"

type ConversationMessagesData = InfiniteData<
  ClientMessageList,
  number | null
>

export async function hydrateConversationMessagesQuery(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversationId: string,
  limit: number
) {
  const queryKey = queryKeys.conversationMessages(target, conversationId)
  const current = queryClient.getQueryData<ConversationMessagesData>(queryKey)
  if (current !== undefined) {
    if (current.pages.length > 1) {
      queryClient.setQueryData<ConversationMessagesData>(
        queryKey,
        compactConversationMessagesData
      )
      return true
    }
    return false
  }

  const page = await messageManager.readLatestPage(
    target,
    conversationId,
    limit
  )
  if (page.messages.length === 0) return false

  let hydrated = false
  queryClient.setQueryData<ConversationMessagesData>(
    queryKey,
    (latest) => {
      if (latest !== undefined) return latest

      hydrated = true
      return { pageParams: [null], pages: [page] }
    }
  )
  return hydrated
}

export function compactConversationMessagesQuery(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversationId: string
) {
  queryClient.setQueryData<ConversationMessagesData>(
    queryKeys.conversationMessages(target, conversationId),
    compactConversationMessagesData
  )
}

export function applyConversationMessagesChangedEvent(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversationId: string,
  event: ConversationMessagesChangedEvent
) {
  const queryKey = queryKeys.conversationMessages(target, conversationId)
  if (event.type === "clear") {
    queryClient.removeQueries({ exact: true, queryKey })
    return
  }

  queryClient.setQueryData<ConversationMessagesData>(queryKey, (current) => {
    if (event.type === "latest-page") {
      return current
        ? replaceLatestConversationPage(current, event.page)
        : { pageParams: [null], pages: [event.page] }
    }
    if (!current || event.messages.length === 0) return current
    return upsertConversationMessages(current, event.messages)
  })
}

function compactConversationMessagesData(
  current: ConversationMessagesData | undefined
) {
  const latestPage = current?.pages[0]
  if (!current || !latestPage) return current
  return {
    pageParams: [null],
    pages: [latestPage],
  }
}

function upsertConversationMessages(
  current: ConversationMessagesData,
  messages: ClientMessage[]
) {
  const updates = new Map(messages.map((message) => [message.id, message]))
  const found = new Set<string>()
  const pages = current.pages.map((page) => ({
    ...page,
    messages: page.messages.map((message) => {
      const update = updates.get(message.id)
      if (!update) return message

      found.add(message.id)
      return preserveNewerMessageReactionState(message, update)
    }),
  }))
  const latestPage = pages[0]
  if (!latestPage) return current

  const missingLatestMessages = messages.filter(
    (message) =>
      !found.has(message.id) &&
      (latestPage.messages.length === 0 ||
        message.seq >= latestPage.page.oldestSeq)
  )
  if (missingLatestMessages.length === 0) {
    return { ...current, pages }
  }

  return repageConversationMessages(
    current,
    mergeMessages([
      ...pages.flatMap((page) => page.messages),
      ...missingLatestMessages,
    ]),
    latestPage.page
  )
}

function replaceLatestConversationPage(
  current: ConversationMessagesData,
  latestPage: ClientMessageList
) {
  const currentLatestPage = current.pages[0]
  if (
    currentLatestPage &&
    currentLatestPage.messages.length === latestPage.messages.length &&
    currentLatestPage.messages.every(
      (message, index) => message.id === latestPage.messages[index]?.id
    )
  ) {
    const messages = latestPage.messages.map((message, index) => {
      const currentMessage = currentLatestPage.messages[index]
      return currentMessage
        ? preserveNewerMessageReactionState(currentMessage, message)
        : message
    })
    return {
      ...current,
      pages: [
        { ...latestPage, messages },
        ...current.pages.slice(1),
      ],
    }
  }

  return repageConversationMessages(
    current,
    mergeMessages([
      ...latestPage.messages,
      ...current.pages.flatMap((page) => page.messages),
    ]),
    latestPage.page
  )
}

function repageConversationMessages(
  current: ConversationMessagesData,
  messages: ClientMessage[],
  latestPage: ClientMessageList["page"]
) {
  const pageSize = latestPage.limit
  const chunks: ClientMessage[][] = []
  for (let index = 0; index < messages.length; index += pageSize) {
    chunks.push(messages.slice(index, index + pageSize))
  }
  if (chunks.length === 0) chunks.push([])

  const previousOldestPage = current.pages[current.pages.length - 1]?.page
  const pages = chunks.map((chunk, index) => ({
    messages: chunk,
    page: {
      hasMoreAfter: index > 0,
      hasMoreBefore:
        index < chunks.length - 1
          ? true
          : current.pages.length > 1
            ? (previousOldestPage?.hasMoreBefore ?? true)
            : latestPage.hasMoreBefore,
      limit: pageSize,
      newestSeq: chunk[0]?.seq ?? latestPage.newestSeq,
      oldestSeq: chunk[chunk.length - 1]?.seq ?? latestPage.oldestSeq,
    },
  }))
  const pageParams: (number | null)[] = [null]
  for (let index = 1; index < pages.length; index += 1) {
    pageParams.push(pages[index - 1]?.page.oldestSeq ?? null)
  }

  return {
    pageParams,
    pages,
  }
}

function mergeMessages(messages: ClientMessage[]) {
  const messagesById = new Map<string, ClientMessage>()
  for (const message of messages) {
    const current = messagesById.get(message.id)
    messagesById.set(
      message.id,
      current
        ? preserveNewerMessageReactionState(current, message)
        : message
    )
  }
  return Array.from(messagesById.values()).sort(
    (left, right) => right.seq - left.seq
  )
}
