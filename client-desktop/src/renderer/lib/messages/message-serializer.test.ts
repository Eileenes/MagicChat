import { describe, expect, it } from "vitest"
import type { ClientMessage } from "@/lib/client-data-api"
import { deserializeMessage, serializeMessage } from "./message-serializer"

describe("消息缓存序列化", () => {
  it("附件消息只保存引用和展示元数据，不包含二进制", () => {
    const message: ClientMessage = {
      body: { fileId: "file-1", name: "report.pdf", sizeBytes: 1024, type: "file" },
      clientMessageId: "client-1",
      conversationId: "conversation-1",
      createdAt: "2026-07-29T00:00:00Z",
      id: "message-1",
      reactionVersion: 0,
      reactions: [],
      sender: { id: "user-1", type: "user" },
      seq: 1,
    }
    const record = serializeMessage(message)
    expect(record.payloadJson).toContain('"fileId":"file-1"')
    expect(record.payloadJson).not.toMatch(/data:|base64|Uint8Array|ArrayBuffer/)
    expect(deserializeMessage(record)).toEqual(message)
  })

  it("拒绝身份字段与缓存索引不一致的 payload", () => {
    const record = serializeMessage({
      body: { content: "hello", type: "text" },
      clientMessageId: "client-1",
      conversationId: "conversation-1",
      createdAt: "2026-07-29T00:00:00Z",
      id: "message-1",
      reactionVersion: 0,
      reactions: [],
      sender: { id: "user-1", type: "user" },
      seq: 1,
    })
    expect(deserializeMessage({ ...record, conversationId: "conversation-2" })).toBeNull()
  })

  it("往返保留撤回消息的可编辑正文", () => {
    const message: ClientMessage = {
      body: {
        editableBody: { content: "**再次编辑**", type: "markdown" },
        type: "revoked",
      },
      clientMessageId: "client-2",
      conversationId: "conversation-1",
      createdAt: "2026-07-29T00:00:00Z",
      id: "message-2",
      reactionVersion: 0,
      reactions: [],
      revokedAt: "2026-07-29T00:01:00Z",
      sender: { id: "user-1", type: "user" },
      seq: 2,
    }

    expect(deserializeMessage(serializeMessage(message))).toEqual(message)
  })
})
