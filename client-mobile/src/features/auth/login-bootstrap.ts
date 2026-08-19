import type { QueryClient } from "@tanstack/react-query"

import type { ClientConversation } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { preSyncRecentConversationHistory } from "@/data/messages"
import {
  contactsQueryOptions,
  conversationsQueryOptions,
  currentUserQueryOptions,
  projectsQueryOptions,
} from "@/data/query"

export const LOGIN_BOOTSTRAP_MAX_ATTEMPTS = 3
export const LOGIN_BOOTSTRAP_REALTIME_TIMEOUT_MS = 5_000

export async function runLoginBootstrap({
  queryClient,
  target,
  waitForRealtime,
}: {
  queryClient: QueryClient
  target: AuthenticatedTarget
  waitForRealtime: (
    target: AuthenticatedTarget,
    options: { attempts: number; timeoutMs: number }
  ) => Promise<void>
}) {
  const realtimeReady = waitForRealtime(target, {
    attempts: LOGIN_BOOTSTRAP_MAX_ATTEMPTS,
    timeoutMs: LOGIN_BOOTSTRAP_REALTIME_TIMEOUT_MS,
  })
  const conversationsReady = fetchBootstrapConversations(queryClient, target)
  const historyReady = conversationsReady.then((conversations) =>
    preSyncRecentConversationHistory(target, conversations)
  )

  await Promise.all([
    realtimeReady,
    historyReady,
    queryClient.fetchQuery({
      ...currentUserQueryOptions(target),
      retry: LOGIN_BOOTSTRAP_MAX_ATTEMPTS - 1,
    }),
    queryClient.fetchQuery({
      ...contactsQueryOptions(target),
      retry: LOGIN_BOOTSTRAP_MAX_ATTEMPTS - 1,
    }),
    queryClient.fetchInfiniteQuery({
      ...projectsQueryOptions(target),
      retry: LOGIN_BOOTSTRAP_MAX_ATTEMPTS - 1,
    }),
  ])
}

async function fetchBootstrapConversations(
  queryClient: QueryClient,
  target: AuthenticatedTarget
): Promise<ClientConversation[]> {
  return queryClient.fetchQuery({
    ...conversationsQueryOptions(target),
    retry: LOGIN_BOOTSTRAP_MAX_ATTEMPTS - 1,
  })
}
