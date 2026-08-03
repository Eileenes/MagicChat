import {
  infiniteQueryOptions,
  QueryClient,
  queryOptions,
} from "@tanstack/react-query"

import { fetchAppInfo } from "@/data/auth/app-info-api"
import { fetchContacts } from "@/data/contacts/contacts-api"
import { fetchConversations } from "@/data/conversations/conversations-api"
import { fetchCurrentUser } from "@/data/users/current-user-api"
import type { ClientProjectPage } from "@/core/models"
import { fetchProjects } from "@/data/projects/projects-api"
import type {
  AuthenticatedTarget,
  ServerTarget,
} from "@/core/server-target"

export const PROJECT_PAGE_SIZE = 100

type PeriodicQueryOptions = {
  refetchInterval?: false | number
}

function serverQueryKey(server: ServerTarget) {
  return ["server", server.id, server.url] as const
}

function authenticatedQueryKey(target: AuthenticatedTarget) {
  return [...serverQueryKey(target), "user", target.userId] as const
}

export const queryKeys = {
  server: serverQueryKey,
  appInfo: (server: ServerTarget) =>
    [...serverQueryKey(server), "app-info"] as const,
  authenticated: authenticatedQueryKey,
  authenticatedServer: (server: ServerTarget) =>
    [...serverQueryKey(server), "user"] as const,
  contacts: (target: AuthenticatedTarget) =>
    [...authenticatedQueryKey(target), "contacts"] as const,
  conversations: (target: AuthenticatedTarget) =>
    [...authenticatedQueryKey(target), "conversations"] as const,
  conversationMessages: (
    target: AuthenticatedTarget,
    conversationId: string
  ) =>
    [
      ...authenticatedQueryKey(target),
      "conversation",
      conversationId,
      "messages",
    ] as const,
  conversationTopic: (
    target: AuthenticatedTarget,
    conversationId: string
  ) =>
    [
      ...authenticatedQueryKey(target),
      "conversation",
      conversationId,
      "topic",
    ] as const,
  currentUser: (target: AuthenticatedTarget) =>
    [...authenticatedQueryKey(target), "current-user"] as const,
  projects: (target: AuthenticatedTarget) =>
    [...authenticatedQueryKey(target), "projects"] as const,
  avatarResource: (server: ServerTarget, sourceUrl: string) =>
    [...serverQueryKey(server), "resource", "avatar", sourceUrl] as const,
}

export function createClientQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 10_000,
      },
    },
  })
}

export function appInfoQueryOptions(server: ServerTarget) {
  return queryOptions({
    queryFn: ({ signal }) => fetchAppInfo(server.url, { signal }),
    queryKey: queryKeys.appInfo(server),
    retry: false,
    staleTime: 0,
  })
}

export function contactsQueryOptions(
  target: AuthenticatedTarget,
  options: PeriodicQueryOptions = {}
) {
  return queryOptions({
    queryFn: ({ signal }) => fetchContacts(target.url, { signal }),
    queryKey: queryKeys.contacts(target),
    refetchInterval: options.refetchInterval,
  })
}

export function currentUserQueryOptions(target: AuthenticatedTarget) {
  return queryOptions({
    queryFn: ({ signal }) => fetchCurrentUser(target.url, { signal }),
    queryKey: queryKeys.currentUser(target),
  })
}

export function conversationsQueryOptions(
  target: AuthenticatedTarget,
  options: PeriodicQueryOptions = {}
) {
  return queryOptions({
    queryFn: ({ signal }) => fetchConversations(target.url, { signal }),
    queryKey: queryKeys.conversations(target),
    refetchInterval: options.refetchInterval,
  })
}

export function projectsQueryOptions(
  target: AuthenticatedTarget,
  options: PeriodicQueryOptions = {}
) {
  return infiniteQueryOptions({
    getNextPageParam: (lastPage: ClientProjectPage) =>
      lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      fetchProjects(
        target.url,
        {
          cursor: pageParam ?? undefined,
          limit: PROJECT_PAGE_SIZE,
        },
        { signal }
      ),
    queryKey: queryKeys.projects(target),
    refetchInterval: options.refetchInterval,
  })
}
