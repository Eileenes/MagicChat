import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  class FakeWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSED = 3

    bufferedAmount = 0
    readyState = FakeWebSocket.CONNECTING
    readonly sent: Array<Buffer | string> = []
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()

    constructor(
      readonly url: URL,
      readonly options: { headers?: Record<string, string> },
    ) {
      sockets.push(this)
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED
    }

    emit(name: string, ...args: unknown[]) {
      this.listeners.get(name)?.forEach((listener) => listener(...args))
    }

    on(name: string, listener: (...args: never[]) => void) {
      const listeners = this.listeners.get(name) ?? []
      listeners.push(listener as (...args: unknown[]) => void)
      this.listeners.set(name, listeners)
      return this
    }

    pong() {}

    removeAllListeners() {
      this.listeners.clear()
    }

    send(value: Buffer | string) {
      this.sent.push(value)
    }
  }

  const sockets: FakeWebSocket[] = []
  return { FakeWebSocket, resolveProxy: vi.fn(), sockets }
})

vi.mock("ws", () => ({ default: mocks.FakeWebSocket }))
vi.mock("https-proxy-agent", () => ({ HttpsProxyAgent: class {} }))
vi.mock("@main/realtime-controller", () => ({
  resolveProxy: mocks.resolveProxy,
  systemCertificateAuthorities: () => [Buffer.from("ca")],
  withProxyCredentials: (url: string) => url,
}))

import { ASRController } from "@main/asr-controller"
import type { ServerProfiles } from "@main/server-profiles"
import type { SessionController } from "@main/session-controller"
import { ASR_LIMITS, type ASREvent } from "@shared/asr-contract"
import type { AuthenticatedTarget } from "@shared/client-contract"

const target: AuthenticatedTarget = {
  id: "server-1",
  normalizedUrl: "https://chat.example.com",
  userId: "user-1",
}

describe("ASRController", () => {
  beforeEach(() => {
    mocks.sockets.length = 0
    mocks.resolveProxy.mockReset().mockResolvedValue(null)
    vi.useRealTimers()
  })

  it("只连接当前认证目标的固定 ASR 路径并附带 Session Cookie", async () => {
    const controller = createController()
    const events: Array<[number, ASREvent]> = []
    controller.on("event", (ownerId, event) => events.push([ownerId, event]))

    const { sessionId } = await controller.connect(7, target)
    const socket = mocks.sockets[0]!
    expect(socket.url.toString()).toBe("wss://chat.example.com/api/client/asr/realtime")
    expect(socket.options.headers).toMatchObject({
      Cookie: "session=secret",
      Origin: "https://chat.example.com",
    })

    socket.readyState = mocks.FakeWebSocket.OPEN
    socket.emit("message", Buffer.from('{"type":"ready"}'), false)
    expect(events).toEqual([[7, { sessionId, type: "ready" }]])

    controller.sendFrame(7, sessionId, new Uint8Array([1, 0]))
    expect(socket.sent[0]).toEqual(Buffer.from([1, 0]))
    controller.commit(7, sessionId)
    expect(socket.sent[1]).toBe('{"type":"commit"}')
    expect(() => controller.commit(7, sessionId)).toThrow("不能重复提交")
  })

  it("拒绝跨 owner 会话、非法帧和非法服务端事件", async () => {
    const controller = createController()
    const events: ASREvent[] = []
    controller.on("event", (_ownerId, event) => events.push(event))
    const { sessionId } = await controller.connect(3, target)
    const socket = mocks.sockets[0]!
    socket.readyState = mocks.FakeWebSocket.OPEN
    socket.emit("message", Buffer.from('{"type":"ready"}'), false)

    expect(() => controller.sendFrame(4, sessionId, new Uint8Array([1, 0]))).toThrow("会话无效")
    expect(() => controller.sendFrame(3, sessionId, new Uint8Array([1]))).toThrow("数据格式错误")
    socket.emit("message", Buffer.from('{"type":"unknown"}'), false)
    expect(events.at(-1)).toMatchObject({ code: "asr_invalid_event", type: "error" })
    expect(() => controller.sendFrame(3, sessionId, new Uint8Array([1, 0]))).toThrow("会话无效")
  })

  it("在背压队列超过 2MiB 时终止会话", async () => {
    const controller = createController()
    const events: ASREvent[] = []
    controller.on("event", (_ownerId, event) => events.push(event))
    const { sessionId } = await controller.connect(3, target)
    const socket = mocks.sockets[0]!
    socket.readyState = mocks.FakeWebSocket.OPEN
    socket.emit("message", Buffer.from('{"type":"ready"}'), false)
    socket.bufferedAmount = ASR_LIMITS.backpressureBytes + 1
    const frame = new Uint8Array(ASR_LIMITS.frameBytes)
    for (let index = 0; index < ASR_LIMITS.maxQueueBytes / frame.byteLength; index += 1) {
      controller.sendFrame(3, sessionId, frame)
    }

    expect(() => controller.sendFrame(3, sessionId, frame)).toThrow("发送速度过慢")
    expect(events.at(-1)).toMatchObject({ code: "asr_backpressure", type: "error" })
  })

  it("连接超时、TLS 错误和 owner 生命周期关闭都会释放会话", async () => {
    vi.useFakeTimers()
    const controller = createController()
    const events: ASREvent[] = []
    controller.on("event", (_ownerId, event) => events.push(event))
    const first = await controller.connect(1, target)
    await vi.advanceTimersByTimeAsync(ASR_LIMITS.connectTimeoutMs)
    expect(events.at(-1)).toMatchObject({ code: "asr_timeout", sessionId: first.sessionId })

    const second = await controller.connect(2, target)
    mocks.sockets[1]!.emit("error", new Error("TLS certificate failed"))
    expect(events.at(-1)).toMatchObject({ code: "asr_tls", sessionId: second.sessionId })

    const third = await controller.connect(9, target)
    controller.closeOwner(9)
    expect(() => controller.commit(9, third.sessionId)).toThrow("会话无效")
  })

  it("认证目标失效或代理解析失败时不创建 ASR 会话", async () => {
    const invalidProfiles = {
      require: vi.fn().mockReturnValue({
        id: target.id,
        lastUserId: "another-user",
        normalizedUrl: target.normalizedUrl,
      }),
    } as unknown as ServerProfiles
    const sessions = createSessions()
    await expect(new ASRController(invalidProfiles, sessions).connect(1, target)).rejects.toThrow(
      "认证目标已失效",
    )
    expect(mocks.sockets).toHaveLength(0)

    mocks.resolveProxy.mockRejectedValueOnce(new Error("proxy unavailable"))
    await expect(createController().connect(1, target)).rejects.toThrow("proxy unavailable")
    expect(mocks.sockets).toHaveLength(0)
  })
})

function createController() {
  const profiles = {
    require: vi.fn().mockReturnValue({
      id: target.id,
      lastUserId: target.userId,
      normalizedUrl: target.normalizedUrl,
    }),
  } as unknown as ServerProfiles
  return new ASRController(profiles, createSessions())
}

function createSessions() {
  return {
    for: vi.fn().mockReturnValue({
      cookies: {
        get: vi.fn().mockResolvedValue([{ name: "session", value: "secret" }]),
      },
    }),
  } as unknown as SessionController
}
