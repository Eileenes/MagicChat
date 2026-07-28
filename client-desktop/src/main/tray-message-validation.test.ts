import { describe, expect, it } from "vitest"

import { parseTrayMessages } from "@main/tray-message-validation"
import { MAX_TRAY_MESSAGES } from "@shared/bridge"

describe("菜单栏消息 IPC 校验", () => {
  it("接受不超过上限的合法未读消息", () => {
    const messages = Array.from({ length: MAX_TRAY_MESSAGES }, (_, index) => ({
      conversationId: `conversation-${index}`,
      name: `会话 ${index}`,
      serverId: "server-1",
      summary: `消息 ${index}`,
      unreadCount: 1,
    }))

    expect(parseTrayMessages(messages)).toHaveLength(MAX_TRAY_MESSAGES)
  })

  it("拒绝超过上限的未读消息", () => {
    const messages = Array.from({ length: MAX_TRAY_MESSAGES + 1 }, (_, index) => ({
      conversationId: `conversation-${index}`,
      name: `会话 ${index}`,
      serverId: "server-1",
      summary: `消息 ${index}`,
      unreadCount: 1,
    }))

    expect(() => parseTrayMessages(messages)).toThrow("菜单栏消息过多")
  })

  it("仍然拒绝无效的消息字段", () => {
    expect(() =>
      parseTrayMessages([
        {
          conversationId: "conversation with spaces",
          name: "会话",
          serverId: "server-1",
          summary: "消息",
          unreadCount: 1,
        },
      ]),
    ).toThrow("标识无效")

    expect(() => parseTrayMessages("not-an-array")).toThrow("菜单栏消息无效")
  })

  it("拒绝包含空槽位的稀疏数组", () => {
    expect(() => parseTrayMessages(new Array(1))).toThrow("菜单栏消息无效")
  })
})
