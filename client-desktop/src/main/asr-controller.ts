import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import WebSocket from "ws"
import { HttpsProxyAgent } from "https-proxy-agent"
import { ASR_LIMITS, type ASRErrorCode, type ASREvent } from "@shared/asr-contract"
import { targetKey, type AuthenticatedTarget } from "@shared/client-contract"
import { ServerProfiles } from "@main/server-profiles"
import { SessionController } from "@main/session-controller"
import type { ProxyAuthPrompt } from "@main/proxy-auth"
import {
  resolveProxy,
  systemCertificateAuthorities,
  withProxyCredentials,
} from "@main/realtime-controller"

type ASRSession = {
  commitRequested: boolean
  connectTimer: NodeJS.Timeout
  flushTimer?: NodeJS.Timeout
  ownerId: number
  queue: Buffer[]
  queuedBytes: number
  sessionId: string
  socket: WebSocket
  state: "connecting" | "ready" | "committed" | "closed"
  target: AuthenticatedTarget
}

export class ASRController extends EventEmitter {
  private readonly sessionsById = new Map<string, ASRSession>()

  constructor(
    private readonly profiles: ServerProfiles,
    private readonly sessions: SessionController,
    private readonly proxyAuth?: ProxyAuthPrompt,
  ) {
    super()
  }

  async connect(ownerId: number, target: AuthenticatedTarget): Promise<{ sessionId: string }> {
    const profile = this.profiles.require(target.id)
    if (profile.normalizedUrl !== target.normalizedUrl || profile.lastUserId !== target.userId) {
      throw new Error("认证目标已失效")
    }
    const networkSession = this.sessions.for(profile)
    const cookies = await networkSession.cookies.get({ url: profile.normalizedUrl })
    const url = new URL("/api/client/asr/realtime", `${profile.normalizedUrl}/`)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    const proxy = await resolveProxy(networkSession, url)
    const agent = proxy
      ? new HttpsProxyAgent(
          withProxyCredentials(proxy, this.proxyAuth?.getCredentials(new URL(proxy).hostname)),
        )
      : undefined
    const socket = new WebSocket(url, {
      agent,
      ca: systemCertificateAuthorities(),
      headers: {
        Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
        Origin: profile.normalizedUrl,
      },
      perMessageDeflate: false,
      rejectUnauthorized: true,
    })
    const sessionId = randomUUID()
    const session: ASRSession = {
      commitRequested: false,
      connectTimer: setTimeout(
        () => this.fail(sessionId, "asr_timeout", "语音识别连接超时"),
        ASR_LIMITS.connectTimeoutMs,
      ),
      ownerId,
      queue: [],
      queuedBytes: 0,
      sessionId,
      socket,
      state: "connecting",
      target,
    }
    this.sessionsById.set(sessionId, session)
    socket.on("ping", (data) => socket.pong(data))
    socket.on("message", (data, binary) => {
      const size = Array.isArray(data)
        ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
        : data.byteLength
      if (binary || size > 64 * 1024) {
        this.fail(sessionId, "asr_invalid_event", "语音识别服务返回了无效数据")
        return
      }
      this.handleServerEvent(session, data.toString())
    })
    socket.on("error", (error) => {
      const code: ASRErrorCode = /certificate|tls|ssl/i.test(error.message)
        ? "asr_tls"
        : "asr_network"
      this.fail(sessionId, code, code === "asr_tls" ? "服务器证书验证失败" : "语音识别连接失败")
    })
    socket.on("close", () => {
      if (this.sessionsById.has(sessionId)) this.fail(sessionId, "asr_closed", "语音识别连接已断开")
    })
    return { sessionId }
  }

  sendFrame(ownerId: number, sessionId: string, value: unknown): void {
    const session = this.requireOwned(ownerId, sessionId)
    if (session.state !== "ready") throw new Error("语音识别尚未准备好")
    if (
      !(value instanceof Uint8Array) ||
      value.byteLength === 0 ||
      value.byteLength % 2 !== 0 ||
      value.byteLength > ASR_LIMITS.frameBytes
    ) {
      throw new Error("语音数据格式错误")
    }
    const frame = Buffer.from(value)
    if (session.queue.length > 0 || session.socket.bufferedAmount > ASR_LIMITS.backpressureBytes) {
      if (session.queuedBytes + frame.byteLength > ASR_LIMITS.maxQueueBytes) {
        this.fail(sessionId, "asr_backpressure", "语音识别发送速度过慢")
        throw new Error("语音识别发送速度过慢")
      }
      session.queue.push(frame)
      session.queuedBytes += frame.byteLength
      this.scheduleFlush(session)
      return
    }
    session.socket.send(frame)
  }

  commit(ownerId: number, sessionId: string): void {
    const session = this.requireOwned(ownerId, sessionId)
    if (session.state !== "ready" || session.commitRequested)
      throw new Error("语音识别不能重复提交")
    session.state = "committed"
    session.commitRequested = true
    this.flush(session)
  }

  close(ownerId: number, sessionId: string): void {
    const session = this.sessionsById.get(sessionId)
    if (!session || session.ownerId !== ownerId) return
    this.dispose(session)
  }

  closeOwner(ownerId: number): void {
    for (const session of [...this.sessionsById.values()])
      if (session.ownerId === ownerId) this.dispose(session)
  }

  closeTarget(target: AuthenticatedTarget): void {
    const key = targetKey(target)
    for (const session of [...this.sessionsById.values()])
      if (targetKey(session.target) === key) this.dispose(session)
  }

  closeServer(serverId: string): void {
    for (const session of [...this.sessionsById.values()])
      if (session.target.id === serverId) this.dispose(session)
  }

  closeAll(): void {
    for (const session of [...this.sessionsById.values()]) this.dispose(session)
  }

  private handleServerEvent(session: ASRSession, raw: string): void {
    let value: { message?: unknown; text?: unknown; type?: unknown }
    try {
      value = JSON.parse(raw) as typeof value
    } catch {
      this.fail(session.sessionId, "asr_invalid_event", "语音识别服务返回了无效数据")
      return
    }
    if (value.type === "ready" && session.state === "connecting") {
      clearTimeout(session.connectTimer)
      session.state = "ready"
      this.publish(session, { sessionId: session.sessionId, type: "ready" })
      return
    }
    if (value.type === "transcript" && typeof value.text === "string") {
      this.publish(session, { sessionId: session.sessionId, text: value.text, type: "transcript" })
      return
    }
    if (value.type === "completed" && typeof value.text === "string") {
      this.publish(session, { sessionId: session.sessionId, text: value.text, type: "completed" })
      this.dispose(session)
      return
    }
    if (value.type === "error") {
      this.fail(
        session.sessionId,
        "asr_network",
        typeof value.message === "string" ? value.message : "语音识别失败",
      )
      return
    }
    this.fail(session.sessionId, "asr_invalid_event", "语音识别服务返回了无效数据")
  }

  private flush(session: ASRSession): void {
    if (session.socket.readyState !== WebSocket.OPEN) return
    while (
      session.queue.length > 0 &&
      session.socket.bufferedAmount <= ASR_LIMITS.backpressureBytes
    ) {
      const frame = session.queue.shift()!
      session.queuedBytes -= frame.byteLength
      session.socket.send(frame)
    }
    if (session.queue.length > 0) return this.scheduleFlush(session)
    if (session.commitRequested) {
      session.commitRequested = false
      session.socket.send(JSON.stringify({ type: "commit" }))
    }
  }

  private scheduleFlush(session: ASRSession): void {
    if (session.flushTimer) return
    session.flushTimer = setTimeout(() => {
      session.flushTimer = undefined
      this.flush(session)
    }, 20)
  }

  private requireOwned(ownerId: number, sessionId: string): ASRSession {
    if (!/^[0-9a-f-]{36}$/.test(sessionId)) throw new Error("语音识别会话无效")
    const session = this.sessionsById.get(sessionId)
    if (!session || session.ownerId !== ownerId) throw new Error("语音识别会话无效")
    return session
  }

  private fail(sessionId: string, code: ASRErrorCode, message: string): void {
    const session = this.sessionsById.get(sessionId)
    if (!session) return
    this.publish(session, { code, message, sessionId, type: "error" })
    this.dispose(session)
  }

  private publish(session: ASRSession, event: ASREvent): void {
    this.emit("event", session.ownerId, event)
  }

  private dispose(session: ASRSession): void {
    if (!this.sessionsById.delete(session.sessionId)) return
    clearTimeout(session.connectTimer)
    if (session.flushTimer) clearTimeout(session.flushTimer)
    session.queue = []
    session.queuedBytes = 0
    session.state = "closed"
    if (
      session.socket.readyState === WebSocket.OPEN ||
      session.socket.readyState === WebSocket.CONNECTING
    ) {
      session.socket.close(1000, "session closed")
    }
    session.socket.removeAllListeners()
  }
}
