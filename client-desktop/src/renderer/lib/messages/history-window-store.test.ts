import { describe, expect, it } from "vitest"
import type { ClientMessage } from "@/lib/client-data-api"
import { HistoryWindowStore } from "./history-window-store"

describe("HistoryWindowStore", () => {
  it("returns a stable immutable empty snapshot per conversation", () => {
    const store = new HistoryWindowStore(3)
    const first = store.get("conversation-1")
    expect(store.get("conversation-1")).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.messages)).toBe(true)
  })

  it("isolates conversations, increments revisions and keeps page boundaries", () => {
    const store = new HistoryWindowStore(3)
    const snapshot = store.replace(
      "conversation-1",
      { messageId: "message-2", seq: 2 },
      [message(1), message(2), message(3)],
      { hasMoreAfter: true, hasMoreBefore: true },
    )
    expect(snapshot).toMatchObject({ newestSeq: 3, oldestSeq: 1, revision: 1 })
    expect(store.get("conversation-2").messages).toEqual([])
  })

  it("reclaims from the side away from the loaded reading direction", () => {
    const store = new HistoryWindowStore(3)
    store.replace(
      "conversation-1",
      { messageId: "message-3", seq: 3 },
      [message(2), message(3), message(4)],
      { hasMoreAfter: true, hasMoreBefore: true },
    )
    expect(store.mergeBefore("conversation-1", [message(1)], false).messages.map(seq)).toEqual([
      1, 2, 3,
    ])
    expect(
      store.mergeAfter("conversation-1", [message(4), message(5)], false).messages.map(seq),
    ).toEqual([3, 4, 5])
  })

  it("only applies realtime updates to existing history messages", () => {
    const store = new HistoryWindowStore(3)
    store.replace("conversation-1", { messageId: "message-2", seq: 2 }, [message(1), message(2)], {
      hasMoreAfter: true,
      hasMoreBefore: false,
    })
    expect(store.updateExisting("conversation-1", [message(3)])).toBeNull()
    expect(
      store
        .updateExisting("conversation-1", [
          message(2, {
            body: { editableBody: { content: "重发", type: "text" }, type: "revoked" },
          }),
        ])
        ?.messages.at(-1)?.body,
    ).toMatchObject({ type: "revoked" })
  })
})

function seq(value: ClientMessage) {
  return value.seq
}

function message(seq: number, patch: Partial<ClientMessage> = {}): ClientMessage {
  return {
    body: { content: `message-${seq}`, type: "text" },
    clientMessageId: `client-${seq}`,
    conversationId: "conversation-1",
    createdAt: "2026-07-31T00:00:00Z",
    id: `message-${seq}`,
    reactionVersion: 0,
    reactions: [],
    sender: { id: "user-1", type: "user" },
    seq,
    ...patch,
  } as ClientMessage
}
