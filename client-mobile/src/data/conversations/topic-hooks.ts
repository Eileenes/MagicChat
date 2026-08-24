import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  archiveConversationTopic,
  createConversationTopic,
  fetchConversationTopic,
} from "@/data/conversations/conversations-api"
import { messageManager } from "@/data/messages"
import type {
  ClientConversation,
  ClientTopicDetail,
} from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { queryKeys } from "@/data/query"

export function useConversationTopic(
  target: AuthenticatedTarget,
  conversationId: string,
  enabled: boolean
) {
  return useQuery({
    enabled: enabled && conversationId.length > 0,
    queryFn: ({ signal }) =>
      fetchConversationTopic(target.url, conversationId, { signal }),
    queryKey: queryKeys.conversationTopic(target, conversationId),
  })
}

export function useCreateConversationTopic(
  target: AuthenticatedTarget,
  conversationId: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (messageId: string) =>
      createConversationTopic(target.url, conversationId, messageId),
    onSuccess: ({ conversation }, messageId) => {
      const topic = conversation.topic
      if (topic) {
        void messageManager.updateMessageTopic(target, {
          archived: false,
          conversationId: conversation.id,
          parentConversationId: conversationId,
          sourceMessageId: messageId,
        })
      }
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      })
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversationMessages(target, conversationId),
      })
    },
  })
}

export function useArchiveConversationTopic(
  target: AuthenticatedTarget,
  conversationId: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => archiveConversationTopic(target.url, conversationId),
    onSuccess: (conversation) => {
      const topic = conversation.topic

      queryClient.setQueryData<ClientTopicDetail>(
        queryKeys.conversationTopic(target, conversationId),
        (current) =>
          current
            ? {
                ...current,
                canArchive: false,
                canParticipate: false,
                conversation,
              }
            : {
                canArchive: false,
                canParticipate: false,
                conversation,
              }
      )
      queryClient.setQueryData<ClientConversation[]>(
        queryKeys.conversations(target),
        (current) =>
          current?.filter((item) => item.id !== conversationId)
      )

      if (topic) {
        void messageManager.updateMessageTopic(target, {
          archived: true,
          conversationId,
          parentConversationId: topic.parentConversationId,
          sourceMessageId: topic.sourceMessageId,
        })
      }

      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      })
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversationMessages(target, conversationId),
      })
    },
  })
}
