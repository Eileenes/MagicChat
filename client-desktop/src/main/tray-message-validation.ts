import { MAX_TRAY_MESSAGES, type TrayMessage } from "@shared/bridge"

export function parseTrayMessages(value: unknown): TrayMessage[] {
  if (!Array.isArray(value)) throw new Error("菜单栏消息无效")
  if (value.length > MAX_TRAY_MESSAGES) throw new Error("菜单栏消息过多")

  return Array.from(value, (item) => {
    if (!item || typeof item !== "object") throw new Error("菜单栏消息无效")
    const message = item as Record<string, unknown>
    return {
      conversationId: asId(message.conversationId),
      name: asString(message.name, 80),
      serverId: asId(message.serverId),
      summary: asString(message.summary, 160),
      unreadCount: asCount(message.unreadCount),
    }
  })
}

function asString(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    /[\u0000]/.test(value)
  ) {
    throw new Error("参数格式无效")
  }
  return value
}

function asId(value: unknown): string {
  const result = asString(value, 128)
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new Error("标识无效")
  return result
}

function asCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("角标数量无效")
  return Math.max(0, Math.min(9999, Math.trunc(value)))
}
