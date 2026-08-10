import {
  isDocumentUuid,
  isServerId,
  type DocumentWindowErrorCode,
  type DocumentWindowOpenResponse,
  type DocumentWindowOpenStatus,
} from "@shared/document-window-contract"
import type { TranslationKey } from "@/lib/i18n"

export type DocumentWindowRouteContext = Readonly<{
  documentId: string
  mode: "document"
  serverId: string
}>

type DocumentNavigationLocation = Readonly<Pick<Location, "hash" | "pathname" | "search">>

let lastNonDocumentRoute: string | undefined

export type DocumentWindowRouteState =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "document"; context: DocumentWindowRouteContext }>
  | Readonly<{ kind: "invalid"; messageKey: TranslationKey }>

export function isDocumentRoutePath(pathname: string): boolean {
  return pathname === "/documents/document" || pathname.startsWith("/documents/document/")
}

export function rememberLastNonDocumentRoute(location: DocumentNavigationLocation): void {
  if (isDocumentRoutePath(location.pathname)) return

  const route = `${location.pathname}${location.search}${location.hash}`
  if (!isRememberableRoute(route)) {
    lastNonDocumentRoute = undefined
    return
  }
  lastNonDocumentRoute = route
}

export function getDocumentReturnPath(fallback: string): string {
  return lastNonDocumentRoute && isRememberableRoute(lastNonDocumentRoute)
    ? lastNonDocumentRoute
    : fallback
}

export class DocumentWindowOpenError extends Error {
  readonly code: DocumentWindowErrorCode | "bridge_unavailable"

  constructor(code: DocumentWindowErrorCode | "bridge_unavailable", message: string) {
    super(message)
    this.name = "DocumentWindowOpenError"
    this.code = code
  }
}

export function parseDocumentWindowLocation(
  location: Pick<Location, "pathname" | "search"> = window.location,
): DocumentWindowRouteState {
  const prefix = "/documents/document/"
  if (!location.pathname.startsWith(prefix)) return { kind: "none" }

  const windowMode = new URLSearchParams(location.search).get("window")
  if (windowMode !== "document") {
    return windowMode === null
      ? { kind: "none" }
      : { kind: "invalid", messageKey: "documentWindow.startup.invalidMode" }
  }

  const encodedDocumentId = location.pathname.slice(prefix.length)
  if (!encodedDocumentId || encodedDocumentId.includes("/"))
    return { kind: "invalid", messageKey: "documentWindow.startup.invalidParams" }

  let documentId: string
  try {
    documentId = decodeURIComponent(encodedDocumentId).toLowerCase()
  } catch {
    return { kind: "invalid", messageKey: "documentWindow.startup.invalidEncoding" }
  }

  const serverId = new URLSearchParams(location.search).get("serverId") ?? ""
  if (!isDocumentUuid(documentId) || !isServerId(serverId))
    return { kind: "invalid", messageKey: "documentWindow.startup.invalidTarget" }

  return Object.freeze({
    context: Object.freeze({ documentId, mode: "document" as const, serverId }),
    kind: "document" as const,
  })
}

export async function requestDocumentWindow(
  documentId: string,
  serverId: string,
): Promise<{ status: DocumentWindowOpenStatus }> {
  let response: DocumentWindowOpenResponse
  try {
    response = await window.desktop.navigation.openDocumentWindow(documentId, serverId)
  } catch (error) {
    if (error instanceof DocumentWindowOpenError) throw error
    throw new DocumentWindowOpenError(
      "bridge_unavailable",
      error instanceof Error ? error.message : "文档窗口服务暂不可用",
    )
  }

  if (!response.ok) throw new DocumentWindowOpenError(response.error.code, response.error.message)
  return response.result
}

export function documentNavigationPath(documentId: string, serverId: string): string {
  const path = `/documents/document/${encodeURIComponent(documentId)}`
  const current = parseDocumentWindowLocation()
  if (current.kind !== "document" || current.context.serverId !== serverId) return path
  return documentWindowPath(documentId, serverId)
}

export function documentWindowPath(documentId: string, serverId: string): string {
  return `/documents/document/${encodeURIComponent(documentId)}?serverId=${encodeURIComponent(serverId)}&window=document`
}

function isInternalRoute(route: string): boolean {
  return route.startsWith("/") && !route.startsWith("//")
}

function isRememberableRoute(route: string): boolean {
  if (!isInternalRoute(route)) return false
  const pathname = route.split(/[?#]/, 1)[0]
  return ["/chat", "/contacts", "/projects"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export function documentWindowFeedbackKey(code: DocumentWindowOpenError["code"]): TranslationKey {
  switch (code) {
    case "window_limit":
      return "documentWindow.error.windowLimit"
    case "not_authenticated":
      return "documentWindow.error.notAuthenticated"
    case "server_not_found":
      return "documentWindow.error.serverNotFound"
    case "target_mismatch":
      return "documentWindow.error.targetMismatch"
    case "invalid_request":
      return "documentWindow.error.invalidRequest"
    case "disposed":
      return "documentWindow.error.disposed"
    case "load_failed":
      return "documentWindow.error.loadFailed"
    default:
      return "documentWindow.error.unavailable"
  }
}
