import type { ASREvent } from "@shared/asr-contract"
import { getMessageCacheTarget } from "@/lib/messages"

export type ASRClientState = "closed" | "committed" | "connecting" | "failed" | "ready"

export class DesktopASRClient {
  private sessionId = ""
  private state: ASRClientState = "closed"
  private unsubscribe: (() => void) | null = null
  private connectResolve: (() => void) | null = null
  private connectReject: ((error: Error) => void) | null = null
  private pendingEvents: ASREvent[] = []

  constructor(
    private readonly callbacks: {
      onCompleted?: (text: string) => void
      onError?: (message: string) => void
      onTranscript?: (text: string) => void
    } = {},
  ) {}

  async connect(): Promise<void> {
    if (this.state !== "closed") throw new Error("语音识别连接已经建立")
    const target = getMessageCacheTarget()
    if (!target) throw new Error("认证目标不可用")
    this.state = "connecting"
    this.unsubscribe = window.desktop.asr.subscribe((event) => this.handleEvent(event))
    return new Promise((resolve, reject) => {
      this.connectResolve = resolve
      this.connectReject = reject
      void window.desktop.asr
        .connect(target)
        .then(({ sessionId }) => {
          if (this.state !== "connecting") return
          this.sessionId = sessionId
          const pendingEvents = this.pendingEvents
          this.pendingEvents = []
          pendingEvents.forEach((event) => this.handleEvent(event))
        })
        .catch((error: unknown) => {
          this.state = "failed"
          this.connectReject?.(error instanceof Error ? error : new Error("语音识别连接失败"))
          this.clearConnectPromise()
          this.releaseSubscription()
        })
    })
  }

  async sendAudio(frame: ArrayBuffer): Promise<void> {
    if (this.state !== "ready" || !this.sessionId) throw new Error("语音识别尚未准备好")
    await window.desktop.asr.sendFrame(this.sessionId, new Uint8Array(frame))
  }

  async commit(): Promise<void> {
    if (this.state !== "ready" || !this.sessionId) throw new Error("语音识别不能重复提交")
    this.state = "committed"
    await window.desktop.asr.commit(this.sessionId)
  }

  close(): void {
    const sessionId = this.sessionId
    this.sessionId = ""
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.state === "connecting") this.connectReject?.(new Error("语音识别连接已关闭"))
    this.clearConnectPromise()
    this.state = "closed"
    this.pendingEvents = []
    if (sessionId) void window.desktop.asr.close(sessionId).catch(() => undefined)
  }

  getState() {
    return this.state
  }

  private handleEvent(event: ASREvent): void {
    if (!this.sessionId) {
      if (this.state === "connecting") this.pendingEvents.push(event)
      return
    }
    if (event.sessionId !== this.sessionId) return
    if (event.type === "ready" && this.state === "connecting") {
      this.state = "ready"
      this.connectResolve?.()
      this.clearConnectPromise()
      return
    }
    if (event.type === "transcript") {
      this.callbacks.onTranscript?.(event.text ?? "")
      return
    }
    if (event.type === "completed") {
      this.state = "closed"
      this.callbacks.onCompleted?.(event.text ?? "")
      this.releaseSubscription()
      return
    }
    if (event.type === "error") {
      const message = event.message || "语音识别失败"
      this.state = "failed"
      this.connectReject?.(new Error(message))
      this.clearConnectPromise()
      this.callbacks.onError?.(message)
      this.releaseSubscription()
    }
  }

  private releaseSubscription(): void {
    this.sessionId = ""
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private clearConnectPromise(): void {
    this.connectResolve = null
    this.connectReject = null
  }
}
