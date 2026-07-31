import { describe, expect, it } from "vitest"

import { createDraftFromMessageContent } from "./conversation-composer"

describe("createDraftFromMessageContent", () => {
  it("restores mention labels and exact editable ranges", () => {
    const draft = createDraftFromMessageContent(
      "你好 {(@user/12345678-1234-1234-1234-123456789abc)} 和 {(@user/all)}",
      (target) => (target.id === "12345678-1234-1234-1234-123456789abc" ? "张三" : undefined),
    )

    expect(draft.text).toBe("你好 @张三 和 @所有人")
    expect(draft.mentions).toEqual([
      {
        end: 6,
        id: "12345678-1234-1234-1234-123456789abc",
        label: "张三",
        start: 3,
        targetType: "user",
      },
      { end: 13, id: "all", label: "所有人", start: 9, targetType: "all" },
    ])
  })

  it("uses stable fallback labels for missing mention targets", () => {
    const draft = createDraftFromMessageContent(
      "{(@app/12345678-1234-1234-1234-123456789abc)} 后继续输入",
      () => undefined,
    )
    expect(draft.text).toBe("@应用 后继续输入")
    expect(draft.mentions[0]).toMatchObject({ end: 3, label: "应用", start: 0 })
  })
})
