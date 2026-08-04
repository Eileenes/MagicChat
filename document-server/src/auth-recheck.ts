import type { DocumentConnectionContext } from "./auth.js"

export type AuthorizationRecheckConnection = {
  close: (event: { code: number; reason: string }) => void
  onClose: (callback: () => void) => unknown
}

export type AuthorizationRechecker = {
  reauthorize: (context: DocumentConnectionContext) => Promise<void>
}

export function scheduleAuthorizationRecheck(
  authorizer: AuthorizationRechecker,
  connection: AuthorizationRecheckConnection,
  context: DocumentConnectionContext,
  intervalMs: number
): void {
  let checking = false
  let closed = false
  const timer = setInterval(async () => {
    if (checking || closed) return
    checking = true
    try {
      await authorizer.reauthorize(context)
    } catch {
      closed = true
      clearInterval(timer)
      connection.close({ code: 4403, reason: "permission-denied" })
    } finally {
      checking = false
    }
  }, intervalMs)
  timer.unref()

  connection.onClose(() => {
    closed = true
    clearInterval(timer)
  })
}
