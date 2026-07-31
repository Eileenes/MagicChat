import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DesktopBridge } from "@shared/bridge"
import type { ASREvent } from "@shared/asr-contract"
import { DesktopASRClient } from "./asr-client"
import { configureMessageCacheTarget } from "./messages"

describe("DesktopASRClient", () => {
  const close = vi.fn()
  const commit = vi.fn()
  const connect = vi.fn()
  const sendFrame = vi.fn()
  let listener: ((event: ASREvent) => void) | null = null
  let clearTarget: () => void = () => undefined

  beforeEach(() => {
    close.mockReset().mockResolvedValue(undefined)
    commit.mockReset().mockResolvedValue(undefined)
    connect.mockReset().mockResolvedValue({ sessionId: "11111111-1111-1111-1111-111111111111" })
    sendFrame.mockReset().mockResolvedValue(undefined)
    listener = null
    clearTarget = configureMessageCacheTarget({
      id: "server-1",
      normalizedUrl: "https://chat.example.com",
      userId: "user-1",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        asr: {
          close,
          commit,
          connect,
          sendFrame,
          subscribe(nextListener: (event: ASREvent) => void) {
            listener = nextListener
            return () => {
              listener = null
            }
          },
        },
      } as unknown as DesktopBridge,
    })
  })

  afterEach(() => clearTarget())

  it("不会丢失 connect IPC 返回前到达的 ready 事件", async () => {
    connect.mockImplementationOnce(async () => {
      listener?.({ sessionId: "11111111-1111-1111-1111-111111111111", type: "ready" })
      return { sessionId: "11111111-1111-1111-1111-111111111111" }
    })
    const client = new DesktopASRClient()

    await expect(client.connect()).resolves.toBeUndefined()
    expect(client.getState()).toBe("ready")
  })

  it("按顺序发送帧、提交并丢弃其他会话事件", async () => {
    const onTranscript = vi.fn()
    const client = new DesktopASRClient({ onTranscript })
    const connecting = client.connect()
    await vi.waitFor(() => expect(listener).not.toBeNull())
    listener?.({ sessionId: "11111111-1111-1111-1111-111111111111", type: "ready" })
    await connecting

    listener?.({
      sessionId: "22222222-2222-2222-2222-222222222222",
      text: "旧结果",
      type: "transcript",
    })
    listener?.({
      sessionId: "11111111-1111-1111-1111-111111111111",
      text: "新结果",
      type: "transcript",
    })
    await client.sendAudio(new Uint8Array([1, 0]).buffer)
    await client.commit()

    expect(onTranscript).toHaveBeenCalledWith("新结果")
    expect(onTranscript).toHaveBeenCalledTimes(1)
    expect(sendFrame).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      new Uint8Array([1, 0]),
    )
    expect(commit).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111")
  })

  it("关闭连接时取消订阅并关闭 Main 会话", async () => {
    const client = new DesktopASRClient()
    const connecting = client.connect()
    listener?.({ sessionId: "11111111-1111-1111-1111-111111111111", type: "ready" })
    await connecting
    client.close()

    expect(listener).toBeNull()
    expect(close).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111")
    expect(client.getState()).toBe("closed")
  })
})
