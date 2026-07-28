import { describe, expect, it } from "vitest"

import { isAllowedDesktopMediaPath } from "@shared/media-resource-path"

describe("Desktop 媒体资源路径", () => {
  it.each([
    "/api/client/users/user-1/avatar",
    "/assets/avatars/builtin/01.webp",
    "/assets/avatars/builtin/64.webp",
    "/assets/apps/assistant.webp",
  ])("允许受支持的服务端资源：%s", (pathname) => {
    expect(isAllowedDesktopMediaPath(pathname)).toBe(true)
  })

  it.each([
    "/api/admin/users",
    "/assets/avatars/builtin/00.webp",
    "/assets/avatars/builtin/65.webp",
    "/assets/avatars/builtin/01.png",
    "/assets/apps/unknown.webp",
    "/assets/../index.html",
  ])("拒绝未授权的服务端资源：%s", (pathname) => {
    expect(isAllowedDesktopMediaPath(pathname)).toBe(false)
  })
})
