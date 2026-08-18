import * as React from "react"

import { normalizeMessageCreatedEventPayload } from "@/lib/client-data-api"
import { useRealtime } from "@/lib/realtime-context"

const STATUS_TTL_MS = 5_000
const STATUS_HEARTBEAT_MS = 3_000

type StatusSender = { id: string; type: string }
type ConversationStatus = { status: string; sender: StatusSender }

function readStatus(payload: unknown) {
  if (!payload || typeof payload !== "object") return null
  const value = payload as Record<string, unknown>
  const sender = value.sender
  if (
    typeof value.conversation_id !== "string" ||
    typeof value.status !== "string" ||
    !sender ||
    typeof sender !== "object" ||
    typeof (sender as Record<string, unknown>).id !== "string" ||
    typeof (sender as Record<string, unknown>).type !== "string"
  )
    return null
  return {
    conversationId: value.conversation_id,
    status: value.status,
    sender: sender as StatusSender,
  }
}

export function useConversationStatus({
  conversationId,
  supported,
}: {
  conversationId: string
  supported: boolean
}) {
  const { ready, sendRealtimeRequest, subscribeRealtimeEvent } = useRealtime()
  const [statuses, setStatuses] = React.useState<
    Record<string, ConversationStatus>
  >({})
  const statusesRef = React.useRef(statuses)
  const expiryTimersRef = React.useRef(new Map<string, number>())
  const focusedRef = React.useRef(false)
  const heartbeatRef = React.useRef<number | null>(null)

  const clearStatus = React.useCallback((id: string) => {
    const timer = expiryTimersRef.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    expiryTimersRef.current.delete(id)
    if (!(id in statusesRef.current)) return
    const next = { ...statusesRef.current }
    delete next[id]
    statusesRef.current = next
    setStatuses(next)
  }, [])

  React.useEffect(() => {
    const unsubscribeStatus = subscribeRealtimeEvent(
      "conversation.status",
      (payload) => {
        const event = readStatus(payload)
        if (!event) return
        const oldTimer = expiryTimersRef.current.get(event.conversationId)
        if (oldTimer !== undefined) window.clearTimeout(oldTimer)
        const next = {
          ...statusesRef.current,
          [event.conversationId]: {
            status: event.status,
            sender: event.sender,
          },
        }
        statusesRef.current = next
        setStatuses(next)
        expiryTimersRef.current.set(
          event.conversationId,
          window.setTimeout(
            () => clearStatus(event.conversationId),
            STATUS_TTL_MS
          )
        )
      }
    )
    const unsubscribeMessage = subscribeRealtimeEvent(
      "message.created",
      (payload) => {
        try {
          const message = normalizeMessageCreatedEventPayload(payload)
          const current = statusesRef.current[message.conversationId]
          if (
            current &&
            current.sender.id === message.sender.id &&
            current.sender.type === message.sender.type
          ) {
            clearStatus(message.conversationId)
          }
        } catch {
          // Ignore malformed realtime events.
        }
      }
    )
    return () => {
      unsubscribeStatus()
      unsubscribeMessage()
    }
  }, [clearStatus, subscribeRealtimeEvent])

  const stopHeartbeat = React.useCallback(() => {
    if (heartbeatRef.current !== null)
      window.clearInterval(heartbeatRef.current)
    heartbeatRef.current = null
  }, [])

  const sendStatus = React.useCallback(() => {
    if (
      !supported ||
      !conversationId ||
      !ready ||
      document.visibilityState !== "visible"
    )
      return
    void sendRealtimeRequest("conversation.status", {
      conversation_id: conversationId,
      status: "正在输入",
    }).catch(() => undefined)
  }, [conversationId, ready, sendRealtimeRequest, supported])
  const sendStatusRef = React.useRef(sendStatus)
  React.useEffect(() => {
    sendStatusRef.current = sendStatus
  }, [sendStatus])

  const startHeartbeat = React.useCallback(() => {
    stopHeartbeat()
    if (
      !focusedRef.current ||
      !supported ||
      document.visibilityState !== "visible"
    )
      return
    sendStatusRef.current()
    heartbeatRef.current = window.setInterval(
      () => sendStatusRef.current(),
      STATUS_HEARTBEAT_MS
    )
  }, [stopHeartbeat, supported])

  React.useEffect(() => {
    focusedRef.current = false
    stopHeartbeat()
  }, [conversationId, stopHeartbeat, supported])

  React.useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") startHeartbeat()
      else stopHeartbeat()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [startHeartbeat, stopHeartbeat])

  React.useEffect(() => {
    if (!ready) {
      statusesRef.current = {}
      setStatuses({})
      expiryTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      expiryTimersRef.current.clear()
      stopHeartbeat()
    } else if (focusedRef.current) startHeartbeat()
  }, [ready, startHeartbeat, stopHeartbeat])

  React.useEffect(
    () => () => {
      stopHeartbeat()
      expiryTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      expiryTimersRef.current.clear()
    },
    [stopHeartbeat]
  )

  return {
    status: supported ? statuses[conversationId]?.status : undefined,
    onFocus: React.useCallback(() => {
      focusedRef.current = true
      startHeartbeat()
    }, [startHeartbeat]),
    onBlur: React.useCallback(() => {
      focusedRef.current = false
      stopHeartbeat()
    }, [stopHeartbeat]),
  }
}
