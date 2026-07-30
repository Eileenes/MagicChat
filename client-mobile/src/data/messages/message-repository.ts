import { fetchConversationMessages } from "@/data/messages-api"
import type { ClientMessageList } from "@/data/models"
import type { AuthenticatedTarget } from "@/data/query"
import {
  getMessageSyncState,
  persistAfterHttpPage,
  persistBeforeHttpPage,
  persistLatestHttpPage,
  readCachedMessagesBefore,
  readLatestCachedMessages,
} from "@/data/messages/message-cache-store"

export async function loadLatestCachedMessagePage(
  target: AuthenticatedTarget,
  conversationId: string,
  limit: number
): Promise<ClientMessageList | null> {
  const [messages, state] = await Promise.all([
    readLatestCachedMessages(target, conversationId, limit),
    getMessageSyncState(target, conversationId),
  ])
  if (messages.length === 0) return null

  return createCachedPage(messages, limit, state?.hasMoreBefore ?? true)
}

export async function loadCachedMessagePageBefore(
  target: AuthenticatedTarget,
  conversationId: string,
  beforeSeq: number,
  limit: number,
  fallbackHasMoreBefore?: boolean
): Promise<ClientMessageList | null> {
  const [messages, state] = await Promise.all([
    readCachedMessagesBefore(
      target,
      conversationId,
      beforeSeq,
      limit
    ),
    getMessageSyncState(target, conversationId),
  ])
  if (messages.length === 0) {
    return state?.hasMoreBefore === false
      ? createCachedPage([], limit, false, true, beforeSeq)
      : null
  }

  return createCachedPage(
    messages,
    limit,
    messages.length >= limit
      ? true
      : (fallbackHasMoreBefore ?? state?.hasMoreBefore ?? true),
    true,
    beforeSeq
  )
}

export async function fetchConversationMessagePage(
  target: AuthenticatedTarget,
  conversationId: string,
  input: { beforeSeq?: number; limit: number },
  options: { signal?: AbortSignal } = {}
) {
  if (input.beforeSeq !== undefined) {
    const state = await getMessageSyncState(target, conversationId).catch(
      () => null
    )
    const canReadContiguousCache =
      state !== null &&
      state.httpSyncedThroughSeq > 0 &&
      input.beforeSeq <= state.httpSyncedThroughSeq + 1
    const messages = canReadContiguousCache
      ? await readCachedMessagesBefore(
          target,
          conversationId,
          input.beforeSeq,
          input.limit
        ).catch(() => [])
      : []
    if (
      messages.length > 0 ||
      (canReadContiguousCache && state.hasMoreBefore === false)
    ) {
      return createCachedPage(
        messages,
        input.limit,
        messages.length > 0
          ? messages.length >= input.limit || state?.hasMoreBefore !== false
          : false,
        true,
        input.beforeSeq
      )
    }
  }

  const result = await fetchConversationMessages(
    target.url,
    conversationId,
    input,
    options
  )
  if (input.beforeSeq === undefined) {
    await persistLatestHttpPage(target, conversationId, result).catch(
      () => undefined
    )
  } else {
    await persistBeforeHttpPage(
      target,
      conversationId,
      input.beforeSeq!,
      result
    ).catch(() => undefined)
  }
  return result
}

export async function initializeConversationMessageSync(
  target: AuthenticatedTarget,
  conversationId: string,
  limit: number
) {
  const result = await fetchConversationMessages(target.url, conversationId, {
    limit,
  })
  await persistLatestHttpPage(target, conversationId, result).catch(
    () => undefined
  )
  return result
}

export async function fetchAndPersistMessagesAfter(
  target: AuthenticatedTarget,
  conversationId: string,
  afterSeq: number,
  limit: number
) {
  const result = await fetchConversationMessages(target.url, conversationId, {
    afterSeq,
    limit,
  })
  const committedSeq = await persistAfterHttpPage(
    target,
    conversationId,
    afterSeq,
    result
  ).catch(() =>
    result.messages.reduce(
      (newest, message) => Math.max(newest, message.seq),
      afterSeq
    )
  )
  return { committedSeq, result }
}

function createCachedPage(
  messages: ClientMessageList["messages"],
  limit: number,
  hasMoreBefore: boolean,
  hasMoreAfter = false,
  fallbackSeq = 0
): ClientMessageList {
  const seqs = messages.map((message) => message.seq)
  return {
    messages,
    page: {
      hasMoreAfter,
      hasMoreBefore,
      limit,
      newestSeq: seqs.length > 0 ? Math.max(...seqs) : fallbackSeq,
      oldestSeq: seqs.length > 0 ? Math.min(...seqs) : fallbackSeq,
    },
  }
}
