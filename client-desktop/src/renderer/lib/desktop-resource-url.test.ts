import { describe, expect, it } from "vitest"
import type { ServerProfile } from "@shared/bridge"
import { resolveDesktopResourceUrl } from "@/lib/desktop-resource-url"

const profile: ServerProfile = {
  createdAt: "2026-07-23T00:00:00Z",
  displayName: "本地服务",
  id: "server-1",
  normalizedUrl: "https://chat.example.test",
}

describe("Desktop 资源地址", () => {
  it("通过隔离 Session 加载同一服务的客户端资源", () => {
    expect(resolveDesktopResourceUrl(profile, "/api/client/users/user-1/avatar?size=small")).toBe(
      "magicchat-media://asset/server-1/api/client/users/user-1/avatar?size=small",
    )
  })

  it("允许安全的内存资源和外部 HTTPS 图片", () => {
    expect(resolveDesktopResourceUrl(profile, "blob:https://chat.example.test/id")).toBe(
      "blob:https://chat.example.test/id",
    )
    expect(resolveDesktopResourceUrl(profile, "https://cdn.example.test/image.png")).toBe(
      "https://cdn.example.test/image.png",
    )
  })

  it("通过当前服务器加载内置头像和助手图标", () => {
    expect(resolveDesktopResourceUrl(profile, "/assets/avatars/builtin/17.webp")).toBe(
      "magicchat-media://asset/server-1/assets/avatars/builtin/17.webp",
    )
    expect(
      resolveDesktopResourceUrl(
        profile,
        "https://chat.example.test/assets/avatars/builtin/64.webp",
      ),
    ).toBe("magicchat-media://asset/server-1/assets/avatars/builtin/64.webp")
    expect(resolveDesktopResourceUrl(profile, "/assets/apps/assistant.webp")).toBe(
      "magicchat-media://asset/server-1/assets/apps/assistant.webp",
    )
  })

  it("开发环境的本地 HTTP Server 也通过媒体协议加载内置资源", () => {
    expect(
      resolveDesktopResourceUrl(
        { ...profile, normalizedUrl: "http://localhost:20080" },
        "/assets/avatars/builtin/01.webp",
      ),
    ).toBe("magicchat-media://asset/server-1/assets/avatars/builtin/01.webp")
  })

  it("拒绝非客户端路径和外部明文 HTTP", () => {
    expect(resolveDesktopResourceUrl(profile, "/api/admin/users")).toBe("")
    expect(resolveDesktopResourceUrl(profile, "/assets/avatars/builtin/65.webp")).toBe("")
    expect(resolveDesktopResourceUrl(profile, "/assets/apps/unknown.webp")).toBe("")
    expect(resolveDesktopResourceUrl(profile, "http://cdn.example.test/image.png")).toBe("")
  })
})
