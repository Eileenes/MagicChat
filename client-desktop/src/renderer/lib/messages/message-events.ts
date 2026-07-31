import type { ClientMessage } from "@/lib/client-data-api"
import type { HistoryWindowSnapshot } from "./history-window-store"

export type MessageManagerEvent =
  | Readonly<{ conversationId: string; kind: "messages-changed"; messages: ClientMessage[] }>
  | Readonly<{
      conversationId: string
      kind: "history-window-changed"
      snapshot: HistoryWindowSnapshot
    }>
  | Readonly<{ conversationId: string; kind: "conversation-cleared" }>
  | Readonly<{ conversationId: string; errorCode: string; kind: "sync-error" }>
  | Readonly<{ kind: "scope-cleared" }>

export type MessageManagerListener = (event: MessageManagerEvent) => void
