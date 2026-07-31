import type { AuthenticatedTarget } from "@shared/client-contract"

export const ASR_LIMITS = Object.freeze({
  backpressureBytes: 256 * 1024,
  connectTimeoutMs: 10_000,
  frameBytes: 256 * 1024,
  maxQueueBytes: 2 * 1024 * 1024,
})

export type ASRErrorCode =
  | "asr_auth"
  | "asr_backpressure"
  | "asr_closed"
  | "asr_invalid_event"
  | "asr_invalid_frame"
  | "asr_network"
  | "asr_state"
  | "asr_timeout"
  | "asr_tls"

export type ASREvent = Readonly<{
  code?: ASRErrorCode
  message?: string
  sessionId: string
  text?: string
  type: "completed" | "error" | "ready" | "transcript"
}>

export interface ASRBridge {
  close(sessionId: string): Promise<void>
  commit(sessionId: string): Promise<void>
  connect(target: AuthenticatedTarget): Promise<{ sessionId: string }>
  sendFrame(sessionId: string, frame: Uint8Array): Promise<void>
  subscribe(listener: (event: ASREvent) => void): () => void
}
