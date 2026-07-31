import type { ServerProfile } from "@shared/bridge"
import { isAllowedDesktopMediaPath } from "@shared/media-resource-path"

export function resolveDesktopResourceUrl(profile: ServerProfile, value: string): string {
  try {
    const resolved = new URL(value, `${profile.normalizedUrl}/`)
    if (["blob:", "data:"].includes(resolved.protocol)) return resolved.toString()
    const server = new URL(profile.normalizedUrl)
    if (resolved.origin === server.origin) {
      return isAllowedDesktopMediaPath(resolved.pathname)
        ? `magicchat-media://asset/${encodeURIComponent(profile.id)}${resolved.pathname}${resolved.search}`
        : ""
    }
    return resolved.protocol === "https:" ? resolved.toString() : ""
  } catch {
    return ""
  }
}
