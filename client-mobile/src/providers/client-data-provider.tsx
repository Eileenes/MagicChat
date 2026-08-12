import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { isUnauthorizedError } from "@/data/api-client"
import {
  getClientDataPollingIntervals,
} from "@/data/query/fallback-polling"
import type {
  ClientContactDirectory,
  ClientContacts,
  ClientConversation,
  ClientProjectPage,
  ClientProjectSummary,
  ClientUser,
  ContactApp,
  ContactGroup,
  ContactUser,
  ResolvedClientUser,
} from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import {
  contactsQueryOptions,
  conversationsQueryOptions,
  currentUserQueryOptions,
  projectsQueryOptions,
  queryKeys,
} from "@/data/query"
import { useAuth } from "@/providers/auth-provider"
import { useRealtime } from "@/realtime/realtime-context"
import { resolveClientUsers } from "@/data/users/user-profiles-api"

const USER_PROFILE_CACHE_TTL_MS = 5 * 60 * 1_000
const UNAVAILABLE_USER_CACHE_TTL_MS = 30 * 1_000
const USER_RESOLVE_BATCH_SIZE = 100

type CachedUserProfile = {
  fetchedAt: number
  profile: ContactUser
  updatedAt: string
}

type UserProfileDeferred = {
  promise: Promise<void>
  reject: (error: unknown) => void
  resolve: () => void
}

const EMPTY_CONTACTS: ClientContacts = {
  apps: [],
  groups: [],
  users: [],
}

const INACTIVE_TARGET: AuthenticatedTarget = {
  id: "inactive",
  url: "http://inactive.invalid",
  userId: "inactive",
}

type ClientDataContextValue = {
  contacts: ClientContacts
  contactsError: Error | null
  conversations: ClientConversation[]
  conversationsError: Error | null
  currentUser: ClientUser | null
  currentUserError: Error | null
  error: Error | null
  hasMoreProjects: boolean
  isContactsRefreshing: boolean
  isConversationsRefreshing: boolean
  isProjectsLoading: boolean
  isProjectsLoadingMore: boolean
  isProjectsRefreshing: boolean
  isReady: boolean
  isRefreshing: boolean
  loadMoreProjects: () => Promise<void>
  personalProject: ClientProjectSummary | null
  projects: ClientProjectSummary[]
  projectsError: Error | null
  refresh: () => Promise<void>
  refreshContacts: () => Promise<void>
  refreshConversations: () => Promise<void>
  refreshProjects: () => Promise<void>
  ensureUsers: (userIds: string[]) => Promise<void>
  usersById: Readonly<Record<string, ContactUser>>
}

const ClientDataContext = createContext<ClientDataContextValue | null>(null)

export function ClientDataProvider({ children }: React.PropsWithChildren) {
  const { invalidateSession, session } = useAuth()
  const { ready: realtimeReady } = useRealtime()
  const target = session ?? INACTIVE_TARGET
  const targetKey = `${target.id}\u0000${target.url}\u0000${target.userId}`

  return (
    <TargetClientDataProvider
      enabled={session !== null}
      invalidateSession={invalidateSession}
      key={targetKey}
      realtimeReady={realtimeReady}
      target={target}
    >
      {children}
    </TargetClientDataProvider>
  )
}

function TargetClientDataProvider({
  children,
  enabled,
  invalidateSession,
  realtimeReady,
  target,
}: React.PropsWithChildren<{
  enabled: boolean
  invalidateSession: () => Promise<void>
  realtimeReady: boolean
  target: AuthenticatedTarget
}>) {
  const queryClient = useQueryClient()
  const pollingIntervals = getClientDataPollingIntervals(realtimeReady)
  const contactsQuery = useQuery({
    ...contactsQueryOptions(target, {
      refetchInterval: pollingIntervals.contacts,
    }),
    enabled,
  })
  const conversationsQuery = useQuery({
    ...conversationsQueryOptions(target, {
      refetchInterval: pollingIntervals.conversations,
    }),
    enabled,
  })
  const currentUserQuery = useQuery({
    ...currentUserQueryOptions(target),
    enabled,
  })
  const projectsQuery = useInfiniteQuery({
    ...projectsQueryOptions(target, {
      refetchInterval: pollingIntervals.projects,
    }),
    enabled,
  })
  const [manualRefresh, setManualRefresh] = useState({
    contacts: false,
    conversations: false,
    projects: false,
  })
  const [usersById, setUsersById] = useState<Record<string, ContactUser>>({})
  const [unavailableUserIds, setUnavailableUserIds] = useState<Set<string>>(
    () => new Set()
  )
  const [userProfilesError, setUserProfilesError] = useState<Error | null>(null)
  const userCacheRef = useRef<Map<string, CachedUserProfile>>(new Map())
  const unavailableUsersRef = useRef<Map<string, number>>(new Map())
  const pendingUserIdsRef = useRef<Set<string>>(new Set())
  const userDeferredsRef = useRef<Map<string, UserProfileDeferred>>(new Map())
  const userFlushScheduledRef = useRef(false)

  const cacheUserProfiles = useCallback((profiles: ResolvedClientUser[]) => {
    if (profiles.length === 0) return
    const now = Date.now()
    for (const profile of profiles) {
      const current = userCacheRef.current.get(profile.id)
      if (
        current?.updatedAt &&
        compareUserVersions(current.updatedAt, profile.updatedAt) > 0
      ) {
        continue
      }
      userCacheRef.current.set(profile.id, {
        fetchedAt: now,
        profile,
        updatedAt: profile.updatedAt,
      })
      unavailableUsersRef.current.delete(profile.id)
    }
    const resolvedIds = new Set(profiles.map((profile) => profile.id))
    setUnavailableUserIds((current) => {
      if (![...resolvedIds].some((id) => current.has(id))) return current
      return new Set([...current].filter((id) => !resolvedIds.has(id)))
    })
    const nextUsers = readCachedUsers(userCacheRef.current)
    setUsersById(nextUsers)
    queryClient.setQueryData(queryKeys.userProfiles(target), nextUsers)
  }, [queryClient, target])

  const flushPendingUsers = useCallback(async () => {
    userFlushScheduledRef.current = false
    const ids = Array.from(pendingUserIdsRef.current)
    pendingUserIdsRef.current.clear()

    for (let index = 0; index < ids.length; index += USER_RESOLVE_BATCH_SIZE) {
      const batch = ids.slice(index, index + USER_RESOLVE_BATCH_SIZE)
      try {
        const users = await resolveClientUsers(target.url, batch)
        cacheUserProfiles(users)
        const returnedIds = new Set(users.map((user) => user.id))
        const unavailableUntil = Date.now() + UNAVAILABLE_USER_CACHE_TTL_MS
        let cacheChanged = false
        const unavailableIds: string[] = []
        for (const id of batch) {
          if (!returnedIds.has(id)) {
            unavailableUsersRef.current.set(id, unavailableUntil)
            unavailableIds.push(id)
            cacheChanged = userCacheRef.current.delete(id) || cacheChanged
          }
          userDeferredsRef.current.get(id)?.resolve()
          userDeferredsRef.current.delete(id)
        }
        if (unavailableIds.length > 0) {
          setUnavailableUserIds((current) =>
            new Set([...current, ...unavailableIds])
          )
        }
        if (cacheChanged) {
          const nextUsers = readCachedUsers(userCacheRef.current)
          setUsersById(nextUsers)
          queryClient.setQueryData(queryKeys.userProfiles(target), nextUsers)
        }
        setUserProfilesError(null)
      } catch (error: unknown) {
        const requestError =
          error instanceof Error ? error : new Error("加载用户资料失败")
        setUserProfilesError(requestError)
        for (const id of batch) {
          userDeferredsRef.current.get(id)?.reject(requestError)
          userDeferredsRef.current.delete(id)
        }
      }
    }
  }, [cacheUserProfiles, queryClient, target])

  const ensureUsers = useCallback(
    async (rawUserIds: string[]) => {
      const now = Date.now()
      const promises: Promise<void>[] = []
      for (const id of new Set(rawUserIds.map((value) => value.trim()))) {
        if (!id) continue
        const cached = userCacheRef.current.get(id)
        if (cached && now - cached.fetchedAt < USER_PROFILE_CACHE_TTL_MS) {
          continue
        }
        if ((unavailableUsersRef.current.get(id) ?? 0) > now) continue
        let deferred = userDeferredsRef.current.get(id)
        if (!deferred) {
          let resolve!: () => void
          let reject!: (error: unknown) => void
          const promise = new Promise<void>((resolvePromise, rejectPromise) => {
            resolve = resolvePromise
            reject = rejectPromise
          })
          deferred = { promise, reject, resolve }
          userDeferredsRef.current.set(id, deferred)
          pendingUserIdsRef.current.add(id)
        }
        promises.push(deferred.promise)
      }
      if (pendingUserIdsRef.current.size > 0 && !userFlushScheduledRef.current) {
        userFlushScheduledRef.current = true
        queueMicrotask(() => void flushPendingUsers())
      }
      await Promise.all(promises)
    },
    [flushPendingUsers]
  )

  const rawContacts = enabled ? contactsQuery.data : undefined
  const rawConversations = useMemo(
    () => (enabled ? (conversationsQuery.data ?? []) : []),
    [conversationsQuery.data, enabled]
  )
  const requiredUserIds = useMemo(
    () => collectRequiredUserIds(rawContacts, rawConversations),
    [rawContacts, rawConversations]
  )
  useEffect(() => {
    if (enabled && requiredUserIds.length > 0) {
      void ensureUsers(requiredUserIds).catch(() => undefined)
    }
  }, [enabled, ensureUsers, requiredUserIds])

  const contacts = useMemo<ClientContacts>(() => {
    if (!rawContacts) return EMPTY_CONTACTS
    return {
      apps: rawContacts.apps,
      groups: hydrateContactGroupUsers(
        rawContacts.groups,
        rawContacts.apps,
        usersById
      ),
      users: rawContacts.userIds.flatMap((id) => {
        const user = usersById[id]
        return user ? [user] : []
      }),
    }
  }, [rawContacts, usersById])
  const conversations = useMemo(
    () => hydrateConversationUsers(rawConversations, contacts.apps, usersById),
    [contacts.apps, rawConversations, usersById]
  )
  const contactUserIds = collectContactUserIds(rawContacts)
  const userProfilesReady = contactUserIds.every(
    (id) => usersById[id] || unavailableUserIds.has(id)
  )
  const projectPages = enabled ? projectsQuery.data?.pages : undefined
  const projects = useMemo(() => mergeProjectPages(projectPages), [projectPages])
  const personalProject = projectPages?.[projectPages.length - 1]?.personalProject
  const error =
    currentUserQuery.error ??
    contactsQuery.error ??
    conversationsQuery.error ??
    projectsQuery.error ??
    userProfilesError

  useEffect(() => {
    if (isUnauthorizedError(error)) {
      void invalidateSession()
    }
  }, [error, invalidateSession])

  const refreshContacts = useCallback(async () => {
    setManualRefresh((current) => ({ ...current, contacts: true }))
    try {
      const result = await contactsQuery.refetch()

      if (result.error) {
        throw result.error
      }
      if (result.data) {
        await ensureUsers(collectContactUserIds(result.data))
      }
    } finally {
      setManualRefresh((current) => ({ ...current, contacts: false }))
    }
  }, [contactsQuery, ensureUsers])

  const refreshConversations = useCallback(async () => {
    setManualRefresh((current) => ({ ...current, conversations: true }))
    try {
      const result = await conversationsQuery.refetch()

      if (result.error) {
        throw result.error
      }
      if (result.data) {
        await ensureUsers(collectConversationUserIds(result.data))
      }
    } finally {
      setManualRefresh((current) => ({ ...current, conversations: false }))
    }
  }, [conversationsQuery, ensureUsers])

  const refreshProjects = useCallback(async () => {
    setManualRefresh((current) => ({ ...current, projects: true }))
    try {
      const result = await projectsQuery.refetch()

      if (result.error) {
        throw result.error
      }
    } finally {
      setManualRefresh((current) => ({ ...current, projects: false }))
    }
  }, [projectsQuery])

  const loadMoreProjects = useCallback(async () => {
    if (!projectsQuery.hasNextPage || projectsQuery.isFetchingNextPage) {
      return
    }

    const result = await projectsQuery.fetchNextPage()
    if (result.error) {
      throw result.error
    }
  }, [projectsQuery])

  const refresh = useCallback(async () => {
    await Promise.all([
      refreshContacts(),
      refreshConversations(),
      refreshProjects(),
    ])
  }, [refreshContacts, refreshConversations, refreshProjects])

  const value = useMemo(
    () => ({
      contacts: enabled ? contacts : EMPTY_CONTACTS,
      contactsError: enabled ? (contactsQuery.error ?? userProfilesError) : null,
      conversations: enabled ? conversations : [],
      conversationsError: enabled ? conversationsQuery.error : null,
      currentUser: enabled ? (currentUserQuery.data ?? null) : null,
      currentUserError: enabled ? currentUserQuery.error : null,
      error: enabled ? error : null,
      hasMoreProjects: enabled && projectsQuery.hasNextPage,
      isContactsRefreshing: enabled && manualRefresh.contacts,
      isConversationsRefreshing: enabled && manualRefresh.conversations,
      isProjectsLoading: enabled && projectsQuery.isLoading,
      isProjectsLoadingMore: enabled && projectsQuery.isFetchingNextPage,
      isProjectsRefreshing: enabled && manualRefresh.projects,
      isReady:
        enabled &&
        currentUserQuery.data !== undefined &&
        contactsQuery.data !== undefined &&
        conversationsQuery.data !== undefined &&
        userProfilesReady,
      isRefreshing:
        enabled &&
        (manualRefresh.contacts ||
          manualRefresh.conversations ||
          manualRefresh.projects),
      loadMoreProjects,
      personalProject: personalProject ?? null,
      projects,
      projectsError: enabled ? projectsQuery.error : null,
      refresh,
      refreshContacts,
      refreshConversations,
      refreshProjects,
      ensureUsers,
      usersById,
    }),
    [
      contacts,
      contactsQuery.data,
      contactsQuery.error,
      conversations,
      conversationsQuery.data,
      conversationsQuery.error,
      currentUserQuery.data,
      currentUserQuery.error,
      enabled,
      error,
      loadMoreProjects,
      manualRefresh.contacts,
      manualRefresh.conversations,
      manualRefresh.projects,
      personalProject,
      projects,
      projectsQuery.error,
      projectsQuery.hasNextPage,
      projectsQuery.isFetchingNextPage,
      projectsQuery.isLoading,
      refresh,
      refreshContacts,
      refreshConversations,
      refreshProjects,
      ensureUsers,
      userProfilesError,
      userProfilesReady,
      usersById,
    ]
  )

  return (
    <ClientDataContext.Provider value={value}>
      {children}
    </ClientDataContext.Provider>
  )
}

export function useClientData() {
  const value = useContext(ClientDataContext)

  if (!value) {
    throw new Error("useClientData 必须在 ClientDataProvider 内使用")
  }

  return value
}

function readCachedUsers(cache: ReadonlyMap<string, CachedUserProfile>) {
  return Object.fromEntries(
    Array.from(cache, ([id, value]) => [id, value.profile])
  )
}

function compareUserVersions(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1
}

function collectRequiredUserIds(
  contacts: ClientContactDirectory | undefined,
  conversations: ClientConversation[]
) {
  return Array.from(
    new Set([
      ...collectContactUserIds(contacts),
      ...collectConversationUserIds(conversations),
    ])
  )
}

function collectContactUserIds(contacts: ClientContactDirectory | undefined) {
  if (!contacts) return []
  return [
    ...contacts.userIds,
    ...contacts.apps.flatMap((app) =>
      app.creatorUserId ? [app.creatorUserId] : []
    ),
    ...contacts.groups.flatMap((group) =>
      group.avatarMembers.flatMap((member) =>
        member.type === "user" ? [member.id] : []
      )
    ),
  ]
}

function collectConversationUserIds(conversations: ClientConversation[]) {
  const ids = new Set<string>()
  for (const conversation of conversations) {
    for (const member of conversation.members ?? []) {
      if (member.type === "user") ids.add(member.id)
    }
    if (conversation.lastMessageSender?.type === "user") {
      ids.add(conversation.lastMessageSender.id)
    }
    if (conversation.topic?.sourceSender.type === "user") {
      ids.add(conversation.topic.sourceSender.id)
    }
  }
  return Array.from(ids)
}

function hydrateContactGroupUsers(
  groups: ContactGroup[],
  apps: ContactApp[],
  usersById: Readonly<Record<string, ContactUser>>
) {
  const appsById = Object.fromEntries(apps.map((app) => [app.id, app]))
  return groups.map((group) => ({
    ...group,
    avatarMembers: group.avatarMembers.map((member) => {
      const profile = getIdentityProfile(
        member.type,
        member.id,
        usersById,
        appsById
      )
      return profile
        ? {
            ...member,
            avatar: profile.avatar,
            name: profile.name,
            nickname: profile.nickname,
          }
        : member
    }),
  }))
}

function hydrateConversationUsers(
  conversations: ClientConversation[],
  apps: ContactApp[],
  usersById: Readonly<Record<string, ContactUser>>
) {
  return conversations.map((conversation) =>
    hydrateClientConversationUsers(conversation, apps, usersById)
  )
}

export function hydrateClientConversationUsers(
  conversation: ClientConversation,
  apps: ContactApp[],
  usersById: Readonly<Record<string, ContactUser>>
): ClientConversation {
  const appsById = Object.fromEntries(apps.map((app) => [app.id, app]))
  const members = conversation.members?.map((member) => {
    const profile = getIdentityProfile(
      member.type,
      member.id,
      usersById,
      appsById
    )
    return profile
      ? {
          ...member,
          avatar: profile.avatar,
          email: profile.email,
          name: profile.name,
          nickname: profile.nickname,
          phone: profile.phone,
        }
      : member
  })
  const sender = conversation.lastMessageSender
  const senderProfile = sender
    ? getIdentityProfile(sender.type, sender.id, usersById, appsById)
    : undefined
  const lastMessageSender =
    sender && senderProfile
      ? {
          ...sender,
          name: senderProfile.name,
          nickname: senderProfile.nickname,
        }
      : sender
  const topicSender = conversation.topic?.sourceSender
  const topicProfile = topicSender
    ? getIdentityProfile(
        topicSender.type,
        topicSender.id,
        usersById,
        appsById
      )
    : undefined
  const topic =
    conversation.topic && topicProfile
      ? {
          ...conversation.topic,
          sourceSender: {
            ...conversation.topic.sourceSender,
            avatar: topicProfile.avatar,
            name: topicProfile.name,
          },
        }
      : conversation.topic

  return { ...conversation, lastMessageSender, members, topic }
}

function getIdentityProfile(
  type: "app" | "system" | "user",
  id: string,
  usersById: Readonly<Record<string, ContactUser>>,
  appsById: Readonly<Record<string, ContactApp>>
) {
  if (type === "user") {
    const user = usersById[id]
    return user
      ? {
          avatar: user.avatar,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          phone: user.phone,
        }
      : undefined
  }
  if (type === "app") {
    const app = appsById[id]
    return app
      ? {
          avatar: app.avatar,
          email: "",
          name: app.name,
          nickname: "",
          phone: "",
        }
      : undefined
  }
  return undefined
}

function mergeProjectPages(pages: ClientProjectPage[] | undefined) {
  const projectsById = new Map<string, ClientProjectSummary>()

  for (const page of pages ?? []) {
    for (const project of page.projects) {
      projectsById.set(project.id, project)
    }
  }

  return Array.from(projectsById.values())
}
