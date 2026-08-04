import type { IncomingHttpHeaders } from "node:http"

export function assertAllowedOrigin(
  headers: IncomingHttpHeaders,
  allowedOrigins: ReadonlySet<string>
): void {
  const origin = singleHeader(headers.origin)
  if (!origin) throw new Error("missing-origin")

  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new Error("invalid-origin")
  }

  if (allowedOrigins.size > 0) {
    if (!allowedOrigins.has(parsed.origin)) throw new Error("origin-not-allowed")
    return
  }

  const forwardedHost = firstForwardedValue(headers["x-forwarded-host"])
  const requestHost = forwardedHost || singleHeader(headers.host)
  if (!requestHost || parsed.host !== requestHost) {
    throw new Error("origin-not-allowed")
  }
}

export function cookieValue(
  cookieHeader: string | null | undefined,
  name: string
): string | null {
  if (!cookieHeader) return null
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=")
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue
    const raw = item.slice(separator + 1).trim()
    try {
      return decodeURIComponent(raw)
    } catch {
      return null
    }
  }
  return null
}

function firstForwardedValue(value: string | string[] | undefined): string {
  return singleHeader(value)?.split(",", 1)[0]?.trim() || ""
}

function singleHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() || ""
  return value?.trim() || ""
}
