import type { ClientMessage } from "@/lib/client-data-api"
import { mergeManagedMessages } from "./message-state"

export type HistoryWindowTarget = Readonly<{ messageId: string; seq: number }>

export type HistoryWindowSnapshot = Readonly<{
  conversationId: string
  hasMoreAfter: boolean
  hasMoreBefore: boolean
  messages: ReadonlyArray<ClientMessage>
  newestSeq: number
  oldestSeq: number
  revision: number
  target: HistoryWindowTarget | null
}>

export class HistoryWindowStore {
  private readonly snapshots = new Map<string, HistoryWindowSnapshot>()
  private readonly emptySnapshots = new Map<string, HistoryWindowSnapshot>()

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("历史窗口上限无效")
  }

  get(conversationId: string): HistoryWindowSnapshot {
    const current = this.snapshots.get(conversationId)
    if (current) return current
    let empty = this.emptySnapshots.get(conversationId)
    if (!empty) {
      empty = freezeSnapshot(conversationId, [], null, false, false, 0)
      this.emptySnapshots.set(conversationId, empty)
    }
    return empty
  }

  replace(
    conversationId: string,
    target: HistoryWindowTarget,
    messages: ReadonlyArray<ClientMessage>,
    boundaries: Readonly<{ hasMoreAfter: boolean; hasMoreBefore: boolean }>,
  ): HistoryWindowSnapshot {
    return this.set(
      conversationId,
      trimMessages(mergeManagedMessages([], messages), this.limit, "after"),
      target,
      boundaries.hasMoreBefore,
      boundaries.hasMoreAfter,
    )
  }

  mergeBefore(
    conversationId: string,
    messages: ReadonlyArray<ClientMessage>,
    hasMoreBefore: boolean,
  ): HistoryWindowSnapshot {
    const current = this.get(conversationId)
    return this.set(
      conversationId,
      trimMessages(mergeManagedMessages(current.messages, messages), this.limit, "before"),
      current.target,
      hasMoreBefore,
      current.hasMoreAfter,
    )
  }

  mergeAfter(
    conversationId: string,
    messages: ReadonlyArray<ClientMessage>,
    hasMoreAfter: boolean,
  ): HistoryWindowSnapshot {
    const current = this.get(conversationId)
    return this.set(
      conversationId,
      trimMessages(mergeManagedMessages(current.messages, messages), this.limit, "after"),
      current.target,
      current.hasMoreBefore,
      hasMoreAfter,
    )
  }

  updateExisting(
    conversationId: string,
    messages: ReadonlyArray<ClientMessage>,
  ): HistoryWindowSnapshot | null {
    const current = this.snapshots.get(conversationId)
    if (!current) return null
    const existingIds = new Set(current.messages.map((message) => message.id))
    const matching = messages.filter((message) => existingIds.has(message.id))
    if (matching.length === 0) return null
    return this.set(
      conversationId,
      mergeManagedMessages(current.messages, matching),
      current.target,
      current.hasMoreBefore,
      current.hasMoreAfter,
    )
  }

  update(
    conversationId: string,
    messageId: string,
    updater: (message: ClientMessage) => ClientMessage,
  ): HistoryWindowSnapshot | null {
    const current = this.snapshots.get(conversationId)
    if (!current || !current.messages.some((message) => message.id === messageId)) return null
    return this.set(
      conversationId,
      current.messages.map((message) => (message.id === messageId ? updater(message) : message)),
      current.target,
      current.hasMoreBefore,
      current.hasMoreAfter,
    )
  }

  remove(conversationId: string, messageId: string): HistoryWindowSnapshot | null {
    const current = this.snapshots.get(conversationId)
    if (!current || !current.messages.some((message) => message.id === messageId)) return null
    return this.set(
      conversationId,
      current.messages.filter((message) => message.id !== messageId),
      current.target,
      current.hasMoreBefore,
      current.hasMoreAfter,
    )
  }

  clearConversation(conversationId: string): HistoryWindowSnapshot {
    const current = this.snapshots.get(conversationId)
    this.snapshots.delete(conversationId)
    if (!current) return this.get(conversationId)
    const next = freezeSnapshot(conversationId, [], null, false, false, current.revision + 1)
    this.emptySnapshots.set(conversationId, next)
    return next
  }

  clear(): void {
    this.snapshots.clear()
    this.emptySnapshots.clear()
  }

  private set(
    conversationId: string,
    messages: ReadonlyArray<ClientMessage>,
    target: HistoryWindowTarget | null,
    hasMoreBefore: boolean,
    hasMoreAfter: boolean,
  ) {
    const next = freezeSnapshot(
      conversationId,
      messages,
      target,
      hasMoreBefore,
      hasMoreAfter,
      this.get(conversationId).revision + 1,
    )
    this.snapshots.set(conversationId, next)
    return next
  }
}

function trimMessages(
  messages: ClientMessage[],
  limit: number,
  loadedDirection: "after" | "before",
) {
  if (messages.length <= limit) return messages
  return loadedDirection === "before" ? messages.slice(0, limit) : messages.slice(-limit)
}

function freezeSnapshot(
  conversationId: string,
  messages: ReadonlyArray<ClientMessage>,
  target: HistoryWindowTarget | null,
  hasMoreBefore: boolean,
  hasMoreAfter: boolean,
  revision: number,
): HistoryWindowSnapshot {
  const immutableMessages = Object.freeze([...messages])
  return Object.freeze({
    conversationId,
    hasMoreAfter,
    hasMoreBefore,
    messages: immutableMessages,
    newestSeq: immutableMessages.at(-1)?.seq ?? 0,
    oldestSeq: immutableMessages[0]?.seq ?? 0,
    revision,
    target: target ? Object.freeze({ ...target }) : null,
  })
}
