import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"

import {
  addGroupConversationMembers as addGroupConversationMembersRequest,
  createGroupConversation as createGroupConversationRequest,
  dismissConversation as dismissConversationRequest,
  dissolveGroupConversation as dissolveGroupConversationRequest,
  joinGroupConversation,
  leaveGroupConversation as leaveGroupConversationRequest,
  openAppConversation,
  openDirectConversation,
  setConversationMuted as setConversationMutedRequest,
  setConversationPinned as setConversationPinnedRequest,
  updateGroupConversationAnnouncement as updateGroupConversationAnnouncementRequest,
  updateGroupConversationName as updateGroupConversationNameRequest,
} from "@/data/conversations/conversations-api"
import type {
  ClientContactDirectory,
  ClientConversation,
  ClientTopicDetail,
} from "@/core/models"
import { messageManager } from "@/data/messages"
import type { AuthenticatedTarget } from "@/core/server-target"
import { queryKeys } from "@/data/query"

export type OpenEntityConversationInput = {
  id: string
  type: "user" | "app" | "group"
}

export function useOpenEntityConversation(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: OpenEntityConversationInput) => {
      if (input.type === "user") {
        return openDirectConversation(target.url, input.id)
      }
      if (input.type === "app") {
        return openAppConversation(target.url, input.id)
      }
      return joinGroupConversation(target.url, input.id)
    },
    onSuccess: (conversation, input) => {
      queryClient.setQueryData<ClientConversation[]>(
        queryKeys.conversations(target),
        (current) => upsertConversation(current, conversation)
      )

      if (input.type === "group") {
        queryClient.setQueryData<ClientContactDirectory>(
          queryKeys.contacts(target),
          (current) => markGroupJoined(current, conversation)
        )
        void queryClient.invalidateQueries({
          exact: true,
          queryKey: queryKeys.contacts(target),
        })
      }
    },
  })
}

export function useSetConversationPinned(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { conversationId: string; pinned: boolean }) =>
      setConversationPinnedRequest(
        target.url,
        input.conversationId,
        input.pinned
      ),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      })
      const previous = queryClient.getQueryData<ClientConversation[]>(
        queryKeys.conversations(target)
      )
      const previousTopic = queryClient.getQueryData<ClientTopicDetail>(
        queryKeys.conversationTopic(target, input.conversationId)
      )
      updateCachedConversation(queryClient, target, input.conversationId, {
        pinned: input.pinned,
      })
      return { previous, previousTopic }
    },
    onError: (_error, input, context) => {
      queryClient.setQueryData(
        queryKeys.conversations(target),
        context?.previous
      )
      queryClient.setQueryData(
        queryKeys.conversationTopic(target, input.conversationId),
        context?.previousTopic
      )
    },
    onSuccess: (result) => {
      updateCachedConversation(queryClient, target, result.conversationId, {
        pinned: result.pinned,
      })
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      }),
  })
}

export function useSetConversationMuted(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { conversationId: string; muted: boolean }) =>
      setConversationMutedRequest(
        target.url,
        input.conversationId,
        input.muted
      ),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      })
      const previous = queryClient.getQueryData<ClientConversation[]>(
        queryKeys.conversations(target)
      )
      const previousTopic = queryClient.getQueryData<ClientTopicDetail>(
        queryKeys.conversationTopic(target, input.conversationId)
      )
      updateCachedConversation(queryClient, target, input.conversationId, {
        notificationMuted: input.muted,
      })
      return { previous, previousTopic }
    },
    onError: (_error, input, context) => {
      queryClient.setQueryData(
        queryKeys.conversations(target),
        context?.previous
      )
      queryClient.setQueryData(
        queryKeys.conversationTopic(target, input.conversationId),
        context?.previousTopic
      )
    },
    onSuccess: (result) => {
      updateCachedConversation(queryClient, target, result.conversationId, {
        notificationMuted: result.muted,
      })
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      }),
  })
}

export function useAddGroupConversationMembers(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { conversationId: string; memberIds: string[] }) =>
      addGroupConversationMembersRequest(
        target.url,
        input.conversationId,
        input.memberIds
      ),
    onSuccess: (conversation) =>
      updateGroupConversationCache(queryClient, target, conversation),
  })
}

export function useCreateGroupConversation(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (memberIds: string[]) =>
      createGroupConversationRequest(target.url, memberIds),
    onSuccess: (conversation) => {
      queryClient.setQueryData<ClientConversation[]>(
        queryKeys.conversations(target),
        (current) => upsertConversation(current, conversation)
      )
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.contacts(target),
      })
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      })
    },
  })
}

export function useUpdateGroupConversationName(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { conversationId: string; name: string }) =>
      updateGroupConversationNameRequest(
        target.url,
        input.conversationId,
        input.name
      ),
    onSuccess: (conversation) =>
      updateGroupConversationCache(queryClient, target, conversation),
  })
}

export function useUpdateGroupConversationAnnouncement(
  target: AuthenticatedTarget
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { announcement: string; conversationId: string }) =>
      updateGroupConversationAnnouncementRequest(
        target.url,
        input.conversationId,
        input.announcement
      ),
    onSuccess: (conversation) =>
      updateGroupConversationCache(queryClient, target, conversation),
  })
}

export function useLeaveGroupConversation(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      leaveGroupConversationRequest(target.url, conversationId),
    onSuccess: async (result) => {
      await removeConversationFromCache(queryClient, target, result.conversationId)
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.contacts(target),
      })
    },
  })
}

export function useDissolveGroupConversation(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      dissolveGroupConversationRequest(target.url, conversationId),
    onSuccess: async (result) => {
      await removeConversationFromCache(queryClient, target, result.conversationId)
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.contacts(target),
      })
    },
  })
}

export function useDismissConversation(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      dismissConversationRequest(target.url, conversationId),
    onSuccess: (result) =>
      removeConversationFromCache(queryClient, target, result.conversationId),
  })
}

function updateGroupConversationCache(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversation: ClientConversation
) {
  queryClient.setQueryData<ClientConversation[]>(
    queryKeys.conversations(target),
    (current) => upsertConversation(current, conversation)
  )
  void queryClient.invalidateQueries({
    exact: true,
    queryKey: queryKeys.contacts(target),
  })
  void queryClient.invalidateQueries({
    exact: true,
    queryKey: queryKeys.conversationMessages(target, conversation.id),
  })
  void queryClient.invalidateQueries({
    exact: true,
    queryKey: queryKeys.conversations(target),
  })
}

async function removeConversationFromCache(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversationId: string
) {
  await messageManager.clearConversation(target, conversationId)
  queryClient.setQueryData<ClientConversation[]>(
    queryKeys.conversations(target),
    (current) =>
      current?.filter((conversation) => conversation.id !== conversationId)
  )
  queryClient.removeQueries({
    exact: true,
    queryKey: queryKeys.conversationMessages(target, conversationId),
  })
  void queryClient.invalidateQueries({
    exact: true,
    queryKey: queryKeys.conversations(target),
  })
}

function upsertConversation(
  conversations: ClientConversation[] | undefined,
  conversation: ClientConversation
) {
  const currentConversation = conversations?.find(
    (item) => item.id === conversation.id
  )
  const nextConversation =
    conversation.projects === undefined && currentConversation?.projects
      ? { ...conversation, projects: currentConversation.projects }
      : conversation

  return [
    nextConversation,
    ...(conversations ?? []).filter((item) => item.id !== conversation.id),
  ]
}

function updateCachedConversation(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversationId: string,
  updates: Partial<Pick<ClientConversation, "notificationMuted" | "pinned">>
) {
  queryClient.setQueryData<ClientConversation[]>(
    queryKeys.conversations(target),
    (current) =>
      current?.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, ...updates }
          : conversation
      )
  )
  queryClient.setQueryData<ClientTopicDetail>(
    queryKeys.conversationTopic(target, conversationId),
    (current) =>
      current
        ? {
            ...current,
            conversation: { ...current.conversation, ...updates },
          }
        : current
  )
}

function markGroupJoined(
  contacts: ClientContactDirectory | undefined,
  conversation: ClientConversation
) {
  if (!contacts) return contacts

  return {
    ...contacts,
    groups: contacts.groups.map((group) =>
      group.id === conversation.id
        ? {
            ...group,
            joined: true,
            memberCount: conversation.memberCount || group.memberCount,
          }
        : group
    ),
  }
}
