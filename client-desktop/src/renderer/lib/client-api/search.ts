import { ClientDataRequestError, createRequestError, readJson } from "./core"
import { normalizeMessage } from "./message-normalizers"
import type {
  ClientDataErrorEnvelope,
  ClientDataFetch,
  ClientDataSuccessEnvelope,
  ClientMessage,
  MessageResponse,
} from "./types"

export type ClientMessageSearchConversation = Readonly<{
  avatar: string
  id: string
  name: string
  type: "direct" | "group" | "app" | "topic"
}>

export type ClientMessageSearchResult = Readonly<{
  conversation: ClientMessageSearchConversation
  message: ClientMessage
  senderName: string
  summary: string
}>

export type SearchClientMessagesInput = Readonly<{
  conversationId?: string
  from?: string
  keyword: string
  senderId?: string
  signal?: AbortSignal
  to?: string
}>

type MessageSearchItemResponse = Readonly<{
  conversation?: Readonly<{ avatar?: string; id?: string; name?: string; type?: string }>
  message?: MessageResponse & { sender_name?: string; summary?: string }
}>

export async function searchClientMessages(
  input: SearchClientMessagesInput,
  fetcher: ClientDataFetch = fetch,
): Promise<ClientMessageSearchResult[]> {
  const params = new URLSearchParams({ keyword: input.keyword.trim() })
  for (const [key, value] of [
    ["conversation_id", input.conversationId],
    ["sender_id", input.senderId],
    ["from", input.from],
    ["to", input.to],
  ] as const) {
    if (value?.trim()) params.set(key, value.trim())
  }
  const response = await fetcher(`/api/client/search/messages?${params.toString()}`, {
    credentials: "include",
    method: "GET",
    signal: input.signal,
  })
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<{ items?: MessageSearchItemResponse[] }>
  >(response)
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "搜索聊天记录失败")
  }
  const items = (
    payload as ClientDataSuccessEnvelope<{ items?: MessageSearchItemResponse[] }> | undefined
  )?.data?.items
  if (!Array.isArray(items)) throw new ClientDataRequestError("聊天记录搜索响应格式不正确")
  return items.map(normalizeMessageSearchResult)
}

function normalizeMessageSearchResult(item: MessageSearchItemResponse): ClientMessageSearchResult {
  const conversation = item.conversation
  const type = normalizeConversationType(conversation?.type)
  if (
    !conversation?.id ||
    typeof conversation.name !== "string" ||
    typeof conversation.avatar !== "string" ||
    !type ||
    typeof item.message?.sender_name !== "string" ||
    typeof item.message.summary !== "string"
  ) {
    throw new ClientDataRequestError("聊天记录搜索响应格式不正确")
  }
  return {
    conversation: {
      avatar: conversation.avatar,
      id: conversation.id,
      name: conversation.name,
      type,
    },
    message: normalizeMessage(item.message),
    senderName: item.message.sender_name,
    summary: item.message.summary,
  }
}

function normalizeConversationType(value: string | undefined) {
  if (value === "direct" || value === "group" || value === "app" || value === "topic") return value
  return null
}
