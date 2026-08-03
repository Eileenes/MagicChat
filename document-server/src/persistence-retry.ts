import { setTimeout as delay } from "node:timers/promises"

export type PersistenceRetryOptions = {
  initialDelayMs: number
  maximumDelayMs: number
  onRetry?: (error: unknown, retryInMs: number) => void
}

export class PersistenceRetry {
  private readonly abortController = new AbortController()
  private failingOperations = 0

  constructor(private readonly options: PersistenceRetryOptions) {}

  get healthy(): boolean {
    return this.failingOperations === 0
  }

  async run(operation: () => Promise<void>): Promise<void> {
    let failing = false
    let retryInMs = this.options.initialDelayMs
    try {
      while (!this.abortController.signal.aborted) {
        try {
          await operation()
          return
        } catch (error) {
          if (this.abortController.signal.aborted) throw error
          if (!failing) {
            failing = true
            this.failingOperations += 1
          }
          this.options.onRetry?.(error, retryInMs)
          await delay(retryInMs, undefined, {
            signal: this.abortController.signal,
          })
          retryInMs = Math.min(retryInMs * 2, this.options.maximumDelayMs)
        }
      }
      throw new Error("persistence-retry-stopped")
    } finally {
      if (failing) this.failingOperations -= 1
    }
  }

  stop(): void {
    this.abortController.abort()
  }
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
