import { describe, expect, it, vi } from "vitest"
import { searchClientMessages } from "./search"

describe("searchClientMessages", () => {
  it("传递可选过滤参数和 AbortSignal 并严格归一化结果", async () => {
    const controller = new AbortController()
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          items: [
            {
              conversation: { avatar: "", id: "conversation-1", name: "项目群", type: "group" },
              message: {
                body: { content: "发布计划", type: "text" },
                conversation_id: "conversation-1",
                created_at: "2026-07-31T00:00:00Z",
                id: "message-1",
                sender: { id: "user-2", type: "user" },
                sender_name: "Alice",
                seq: 8,
                summary: "发布计划",
              },
            },
          ],
        },
        success: true,
      }),
    )
    await expect(
      searchClientMessages(
        {
          conversationId: "conversation-1",
          from: "2026-07-01",
          keyword: " 计划 ",
          senderId: "user-2",
          signal: controller.signal,
          to: "2026-08-01",
        },
        fetcher,
      ),
    ).resolves.toMatchObject([{ message: { id: "message-1", seq: 8 }, senderName: "Alice" }])
    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/search/messages?keyword=%E8%AE%A1%E5%88%92&conversation_id=conversation-1&sender_id=user-2&from=2026-07-01&to=2026-08-01",
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it("保留错误 envelope 并拒绝格式错误结果", async () => {
    await expect(
      searchClientMessages(
        { keyword: "计划" },
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ error: { code: "denied", message: "无权搜索" }, success: false }, 403),
          ),
      ),
    ).rejects.toMatchObject({ code: "denied", message: "无权搜索", status: 403 })
    await expect(
      searchClientMessages(
        { keyword: "计划" },
        vi.fn().mockResolvedValue(jsonResponse({ data: { items: [{}] }, success: true })),
      ),
    ).rejects.toThrow("聊天记录搜索响应格式不正确")
  })
})

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}
