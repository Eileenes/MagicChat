import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MessageVoice } from "./message-voice"

const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: toastError } }))

const voice = {
  contentType: "audio/mp4",
  durationMS: 2_000,
  fileId: "voice-1",
  sizeBytes: 10,
  transcript: "会议结论",
  type: "voice" as const,
}

describe("MessageVoice", () => {
  beforeEach(() => {
    toastError.mockReset()
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("voice")))
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:voice-1"),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("提供可访问的转写展开和收起", async () => {
    const user = userEvent.setup()
    render(<MessageVoice voice={voice} />)

    const toggle = screen.getByRole("button", { name: "语音转写" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    await user.click(toggle)
    expect(screen.getByText("会议结论")).toBeVisible()
    expect(toggle).toHaveAttribute("aria-expanded", "true")
  })

  it("加载失败后清理来源、提示错误并允许重试", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }))
    const { unmount } = render(<MessageVoice voice={voice} />)

    await user.click(screen.getByRole("button", { name: "播放语音" }))
    await screen.findByRole("button", { name: "重试语音" })
    expect(toastError).toHaveBeenCalledWith("语音加载或解码失败，请重试")

    await user.click(screen.getByRole("button", { name: "重试语音" }))
    await screen.findByRole("button", { name: "暂停语音" })
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:voice-1")
  })

  it("播放启动超过 15 秒时退出加载状态", async () => {
    vi.useFakeTimers()
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(new Promise(() => undefined))
    render(<MessageVoice voice={voice} />)

    screen.getByRole("button", { name: "播放语音" }).click()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(15_000))

    expect(screen.getByRole("button", { name: "重试语音" })).toBeVisible()
    expect(toastError).toHaveBeenCalledWith("语音加载或解码失败，请重试")
  })
})
