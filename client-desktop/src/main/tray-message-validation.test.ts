import { describe, expect, it } from "vitest"

import { parseTrayMessages } from "@main/tray-message-validation"

describe("菜单栏消息 IPC 校验", () => {
  it("接受超过 1000 条的合法未读消息", () => {
    const messages = Array.from({ length: 1001 }, (_, index) => ({
      conversationId: `conversation-${index}`,
      name: `会话 ${index}`,
      serverId: "server-1",
      summary: `消息 ${index}`,
      unreadCount: 1,
    }))

    expect(parseTrayMessages(messages)).toHaveLength(1001)
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
})
