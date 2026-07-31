import { act, fireEvent, render, screen } from "@testing-library/react"
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(new Response("voice"))),
    )
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

  it("play Promise 尚未确认时保持加载按钮禁用，避免主动暂停打断启动", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(new Promise(() => undefined))
    render(<MessageVoice voice={voice} />)

    screen.getByRole("button", { name: "播放语音" }).click()
    const loadingButton = await screen.findByRole("button", { name: "正在加载语音" })

    expect(loadingButton).toBeDisabled()
    expect(screen.queryByRole("button", { name: "暂停语音" })).not.toBeInTheDocument()
    expect(toastError).not.toHaveBeenCalled()
  })

  it("播放成功后暂停和继续不会误报失败或重复下载", async () => {
    const user = userEvent.setup()
    render(<MessageVoice voice={voice} />)

    await user.click(screen.getByRole("button", { name: "播放语音" }))
    await screen.findByRole("button", { name: "暂停语音" })
    await user.click(screen.getByRole("button", { name: "暂停语音" }))

    expect(screen.getByRole("button", { name: "播放语音" })).toBeVisible()
    expect(toastError).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "播放语音" }))
    await screen.findByRole("button", { name: "暂停语音" })

    expect(fetch).toHaveBeenCalledOnce()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2)
    expect(toastError).not.toHaveBeenCalled()
  })

  it("播放结束后不主动 seek，并在再次播放前重新初始化同一媒体来源", async () => {
    const user = userEvent.setup()
    const { container } = render(<MessageVoice voice={voice} />)
    const audio = container.querySelector("audio")!

    await user.click(screen.getByRole("button", { name: "播放语音" }))
    await screen.findByRole("button", { name: "暂停语音" })
    audio.currentTime = 2
    fireEvent.ended(audio)

    expect(audio.currentTime).toBe(2)
    await user.click(screen.getByRole("button", { name: "播放语音" }))
    await screen.findByRole("button", { name: "暂停语音" })
    expect(fetch).toHaveBeenCalledOnce()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2)
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledOnce()
    expect(toastError).not.toHaveBeenCalled()
  })

  it("媒体源主动清理产生的 error 事件不会被误报为解码失败", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }))
    const { container } = render(<MessageVoice voice={voice} />)

    await user.click(screen.getByRole("button", { name: "播放语音" }))
    await screen.findByRole("button", { name: "重试语音" })
    fireEvent.error(container.querySelector("audio")!)

    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it("浏览器中止单次 play 启动时允许直接重试且不显示解码失败", async () => {
    const user = userEvent.setup()
    vi.mocked(HTMLMediaElement.prototype.play)
      .mockRejectedValueOnce(new DOMException("播放启动被中止", "AbortError"))
      .mockResolvedValueOnce(undefined)
    render(<MessageVoice voice={voice} />)

    await user.click(screen.getByRole("button", { name: "播放语音" }))
    await screen.findByRole("button", { name: "播放语音" })
    expect(toastError).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "播放语音" }))
    await screen.findByRole("button", { name: "暂停语音" })
    expect(fetch).toHaveBeenCalledOnce()
    expect(toastError).not.toHaveBeenCalled()
  })

  it("切换到另一条语音时正常停止旧语音且不显示失败", async () => {
    const user = userEvent.setup()
    render(
      <>
        <MessageVoice voice={voice} />
        <MessageVoice voice={{ ...voice, fileId: "voice-2", transcript: "另一条语音" }} />
      </>,
    )
    const playButtons = screen.getAllByRole("button", { name: "播放语音" })

    await user.click(playButtons[0]!)
    await screen.findByRole("button", { name: "暂停语音" })
    await user.click(playButtons[1]!)

    expect(await screen.findAllByRole("button", { name: "暂停语音" })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "播放语音" })).toHaveLength(1)
    expect(toastError).not.toHaveBeenCalled()
  })

  it("切换语音后旧 play Promise 的 AbortError 不会覆盖当前状态", async () => {
    const user = userEvent.setup()
    let rejectFirstPlay!: (error: unknown) => void
    vi.mocked(HTMLMediaElement.prototype.play)
      .mockReturnValueOnce(
        new Promise<void>((_resolve, reject) => {
          rejectFirstPlay = reject
        }),
      )
      .mockResolvedValueOnce(undefined)
    render(
      <>
        <MessageVoice voice={voice} />
        <MessageVoice voice={{ ...voice, fileId: "voice-2", transcript: "另一条语音" }} />
      </>,
    )

    screen.getAllByRole("button", { name: "播放语音" })[0]!.click()
    await screen.findByRole("button", { name: "正在加载语音" })
    await user.click(screen.getByRole("button", { name: "播放语音" }))
    await screen.findByRole("button", { name: "暂停语音" })

    await act(async () => {
      rejectFirstPlay(new DOMException("播放被暂停", "AbortError"))
      await Promise.resolve()
    })

    expect(screen.getByRole("button", { name: "暂停语音" })).toBeVisible()
    expect(screen.queryByRole("button", { name: "重试语音" })).not.toBeInTheDocument()
    expect(toastError).not.toHaveBeenCalled()
  })
})
