import { describe, expect, it, vi } from "vitest"
import { createClientSearchService } from "./client-search"

const emptyInput = {
  apps: [],
  contacts: [],
  conversations: [],
  currentUserId: "user-1",
  groups: [],
}

describe("createClientSearchService", () => {
  it("空关键词和单个 Unicode 字符不调用远端消息搜索", async () => {
    const messageSearch = vi.fn().mockResolvedValue([])
    const service = createClientSearchService({ ...emptyInput, messageSearch })
    await expect(service.search({ keyword: " ", scope: "messages" })).resolves.toMatchObject({
      messages: [],
    })
    await expect(service.search({ keyword: "计", scope: "messages" })).resolves.toMatchObject({
      messages: [],
    })
    expect(messageSearch).not.toHaveBeenCalled()
  })

  it("综合和消息范围对两个 Unicode 字符调用可取消远端搜索", async () => {
    const messageSearch = vi.fn().mockResolvedValue([])
    const service = createClientSearchService({ ...emptyInput, messageSearch })
    const controller = new AbortController()
    await service.search({ keyword: "计划", scope: "all" }, { signal: controller.signal })
    await service.search({ keyword: "计划", scope: "messages" }, { signal: controller.signal })
    expect(messageSearch).toHaveBeenCalledTimes(2)
    expect(messageSearch).toHaveBeenLastCalledWith({ keyword: "计划", signal: controller.signal })
  })
})
