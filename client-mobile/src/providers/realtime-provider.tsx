import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AppState, Platform, type AppStateStatus } from "react-native"

import { isUnauthorizedError } from "@/data/api-client"
import { fetchCurrentUser } from "@/data/users/current-user-api"
import type { AuthenticatedTarget } from "@/core/server-target"
import { useAuth } from "@/providers/auth-provider"
import {
  prepareMessageNotifications,
  showBackgroundMessageNotification,
} from "@/notifications/message-notifications"
import {
  applyRealtimeEvent,
  refreshClientDataOnForeground,
  synchronizeRealtimeData,
} from "@/realtime/realtime-cache"
import {
  buildRealtimeWebSocketUrl,
  RealtimeClient,
  type RealtimeSnapshot,
} from "@/realtime/realtime-client"
import {
  DISCONNECTED_REALTIME_SNAPSHOT,
  RealtimeContext,
} from "@/realtime/realtime-context"
import { realtimeEvents } from "@/realtime/realtime-protocol"

export function RealtimeProvider({ children }: React.PropsWithChildren) {
  const queryClient = useQueryClient()
  const { invalidateSession, isPreparingSignIn, session } = useAuth()
  const [snapshot, setSnapshot] = useState<RealtimeSnapshot>(
    DISCONNECTED_REALTIME_SNAPSHOT
  )
  const activeConversationIdRef = useRef("")
  const clientRef = useRef<{
    client: RealtimeClient
    targetKey: string
  } | null>(null)
  const activateConversation = useCallback((conversationId: string) => {
    activeConversationIdRef.current = conversationId

    return () => {
      if (activeConversationIdRef.current === conversationId) {
        activeConversationIdRef.current = ""
      }
    }
  }, [])
  const waitUntilReady = useCallback(
    async (
      target: AuthenticatedTarget,
      options: { attempts: number; timeoutMs: number }
    ) => {
      const targetKey = createTargetKey(target)
      const client = await waitForRealtimeClient(
        clientRef,
        targetKey,
        options.timeoutMs
      )

      let lastError: unknown
      for (let attempt = 0; attempt < options.attempts; attempt += 1) {
        if (attempt > 0) {
          client.disconnect()
          client.connect()
        }

        try {
          await waitForClientReady(client, options.timeoutMs)
          return
        } catch (error) {
          lastError = error
        }
      }

      throw lastError
    },
    []
  )
  const server = useMemo<AuthenticatedTarget | null>(
    () =>
      session
        ? { id: session.id, url: session.url, userId: session.userId }
        : null,
    [session]
  )
  const realtimeEnabled =
    server !== null && canConnectFromCurrentPlatform(server.url)

  useEffect(() => {
    if (!realtimeEnabled || !server) {
      return
    }

    const activeServer = server
    let isActive = true
    let synchronization = Promise.resolve()
    let currentAppState = AppState.currentState
    const client = new RealtimeClient({
      authCheck: async () => {
        try {
          await fetchCurrentUser(activeServer.url)
          return true
        } catch (error: unknown) {
          if (isUnauthorizedError(error)) {
            return false
          }
          throw error
        }
      },
      onUnauthorized: () => {
        void invalidateSession()
      },
      reconnectDelaysMs: isPreparingSignIn ? [30_000] : undefined,
      url: buildRealtimeWebSocketUrl(activeServer.url),
    })
    const clientRecord = {
      client,
      targetKey: createTargetKey(activeServer),
    }
    clientRef.current = clientRecord

    const unsubscribeSnapshot = client.subscribe(() => {
      if (isActive) {
        setSnapshot(client.getSnapshot())
      }
    })
    const unsubscribeEvents = client.subscribeEvent((event, payload) => {
      if (event === realtimeEvents.systemReady) {
        if (!isPreparingSignIn) {
          enqueueSynchronization(() =>
            synchronizeRealtimeData(queryClient, activeServer, {
              activeConversationId: activeConversationIdRef.current,
            })
          )
        }
        return
      }

      void applyRealtimeEvent(queryClient, activeServer, event, payload, {
        activeConversationId: activeConversationIdRef.current,
        visible: currentAppState === "active",
      })
        .then(({ message }) => {
          if (
            event === realtimeEvents.messageCreated &&
            message &&
            currentAppState !== "active"
          ) {
            void showBackgroundMessageNotification(
              queryClient,
              activeServer,
              message
            ).catch(() => undefined)
          }
        })
        .catch(handleRealtimeDataError)
    })

    function enqueueSynchronization(task: () => Promise<void>) {
      synchronization = synchronization
        .catch(() => undefined)
        .then(task)
        .catch(handleRealtimeDataError)
    }

    function handleRealtimeDataError(error: unknown) {
      if (isActive && isUnauthorizedError(error)) {
        void invalidateSession()
      }
    }

    function handleAppStateChange(status: AppStateStatus) {
      const wasActive = currentAppState === "active"
      currentAppState = status

      if (status === "active" && !wasActive) {
        client.connect()
        void prepareMessageNotifications().catch(() => undefined)
        enqueueSynchronization(() =>
          refreshClientDataOnForeground(queryClient, activeServer, {
            activeConversationId: activeConversationIdRef.current,
          })
        )
      }
    }

    const appStateSubscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    )
    client.connect()
    if (currentAppState === "active") {
      void prepareMessageNotifications().catch(() => undefined)
    }

    return () => {
      isActive = false
      if (clientRef.current === clientRecord) {
        clientRef.current = null
      }
      activeConversationIdRef.current = ""
      appStateSubscription.remove()
      unsubscribeEvents()
      unsubscribeSnapshot()
      client.disconnect()
    }
  }, [
    invalidateSession,
    isPreparingSignIn,
    queryClient,
    realtimeEnabled,
    server,
  ])

  const value = useMemo(() => {
    if (!realtimeEnabled) {
      return {
        ...DISCONNECTED_REALTIME_SNAPSHOT,
        activateConversation,
        waitUntilReady,
      }
    }

    return {
      activateConversation,
      ready: snapshot.ready,
      status: snapshot.status,
      waitUntilReady,
    }
  }, [
    activateConversation,
    realtimeEnabled,
    snapshot.ready,
    snapshot.status,
    waitUntilReady,
  ])

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  )
}

function createTargetKey(target: AuthenticatedTarget) {
  return `${target.id}\u0000${target.url}\u0000${target.userId}`
}

function waitForRealtimeClient(
  clientRef: {
    current: { client: RealtimeClient; targetKey: string } | null
  },
  targetKey: string,
  timeoutMs: number
) {
  const current = clientRef.current
  if (current?.targetKey === targetKey) {
    return Promise.resolve(current.client)
  }

  return new Promise<RealtimeClient>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      const next = clientRef.current
      if (next?.targetKey === targetKey) {
        resolve(next.client)
        return
      }
      if (Date.now() >= deadline) {
        reject(new Error("实时连接初始化超时"))
        return
      }
      setTimeout(check, 25)
    }
    check()
  })
}

function waitForClientReady(client: RealtimeClient, timeoutMs: number) {
  if (client.getSnapshot().ready) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    const unsubscribe = client.subscribe(() => {
      if (!client.getSnapshot().ready) return
      clearTimeout(timeout)
      unsubscribe()
      resolve()
    })
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error("实时连接超时"))
    }, timeoutMs)
  })
}

function canConnectFromCurrentPlatform(serverUrl: string) {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return true
  }

  // Browsers control the Origin header and the current server only permits
  // same-origin websocket upgrades. Native Android/iOS connections are not
  // subject to this browser restriction.
  try {
    return new URL(serverUrl).origin === window.location.origin
  } catch {
    return false
  }
}
