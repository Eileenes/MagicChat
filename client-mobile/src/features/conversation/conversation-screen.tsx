import {
  useIsFocused,
  useLocalSearchParams,
  useRouter,
} from "expo-router"
import { Ellipsis } from "lucide-react-native"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { SizableText, useToastController, YStack } from "tamagui"

import type { AppToastTone } from "@/components/feedback/app-toast"
import { ContentState } from "@/components/feedback/content-state"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import {
  PAGE_HEADER_HEIGHT,
  PageHeader,
} from "@/components/navigation/page-header"
import { ApiRequestError, isUnauthorizedError } from "@/data/api-client"
import {
  useConversationMessages,
  useMarkConversationRead,
} from "@/data/messages/message-hooks"
import {
  openResourceExternally,
  useMessageResources,
} from "@/data/resources"
import {
  useArchiveConversationTopic,
  useConversationTopic,
} from "@/data/conversations/topic-hooks"
import {
  type EntityReference,
  getConversationEntityReference,
} from "@/domain/entities/entity-profile"
import {
  buildPresentedMessages,
  collectMessageResources,
  collectMessageUserIds,
  createMessageMentionLabelResolver,
  type MessageMentionLabelResolver,
} from "@/domain/messages/message-presenter"
import { shouldShowMessageChoiceResponseCounts } from "@/domain/messages/message-choices"
import {
  MessageComposer,
  type MessageComposerHandle,
} from "@/features/conversation/composer/message-composer"
import { ForwardMessageSheet } from "@/features/conversation/forward-message-sheet"
import { MessageList } from "@/features/conversation/messages/message-list"
import { createMentionCandidates } from "@/features/conversation/composer/mention-model"
import { TopicArchiveDialog } from "@/features/conversation/topic/topic-archive-dialog"
import { useConversationReadSync } from "@/features/conversation/use-conversation-read-sync"
import { useConversationNavigation } from "@/features/conversation/use-conversation-navigation"
import {
  type ScopedMessageActionTarget,
  useMessageSelectionActions,
} from "@/features/conversation/messages/use-message-selection-actions"
import { useConversationMessageActions } from "@/features/conversation/messages/use-conversation-message-actions"
import {
  useAuth,
  useAuthenticatedSession,
} from "@/providers/auth-provider"
import { buildEntityDetailHref } from "@/navigation/entity-details"
import { buildAttachmentImagePreviewHref } from "@/navigation/image-preview"
import {
  hydrateClientConversationUsers,
  useClientData,
} from "@/providers/client-data-provider"
import { useRealtime } from "@/realtime/realtime-context"

const EMPTY_MENTION_RESOLVER: MessageMentionLabelResolver = () => undefined

export function ConversationScreen() {
  const params = useLocalSearchParams<{
    conversationId: string
    parentConversationId?: string
    topic?: string
  }>()
  const conversationId = Array.isArray(params.conversationId)
    ? (params.conversationId[0] ?? "")
    : (params.conversationId ?? "")
  const parentConversationId = Array.isArray(params.parentConversationId)
    ? (params.parentConversationId[0] ?? "")
    : (params.parentConversationId ?? "")
  const router = useRouter()
  const toast = useToastController()
  const isFocused = useIsFocused()
  const insets = useSafeAreaInsets()
  const { invalidateSession } = useAuth()
  const { activateConversation, ready: realtimeReady } = useRealtime()
  const session = useAuthenticatedSession()
  const composerRef = useRef<MessageComposerHandle>(null)
  const [forwardMessageState, setForwardMessage] =
    useState<ScopedMessageActionTarget | null>(null)
  const [forwardSheetOpen, setForwardSheetOpen] = useState(false)
  const [replyTargetState, setReplyTarget] =
    useState<ScopedMessageActionTarget | null>(null)
  const forwardMessage =
    forwardMessageState?.conversationId === conversationId
      ? forwardMessageState
      : null
  const replyTarget =
    replyTargetState?.conversationId === conversationId
      ? replyTargetState
      : null
  const requestForwardSheetClose = useCallback(() => {
    setForwardSheetOpen(false)
  }, [])
  const [topicArchiveDialogOpen, setTopicArchiveDialogOpen] = useState(false)
  const {
    contacts,
    conversations,
    currentUser,
    currentUserError,
    ensureUsers,
    isReady,
    usersById,
  } = useClientData()
  const listedConversation = conversations.find(
    (item) => item.id === conversationId
  )
  const expectsTopic =
    Boolean(parentConversationId) ||
    params.topic === "1" ||
    listedConversation?.type === "topic"
  const topicQuery = useConversationTopic(
    session,
    conversationId,
    expectsTopic
  )
  const conversationSource = topicQuery.data?.conversation ?? listedConversation
  const conversationUserIds = useMemo(
    () =>
      conversationSource
        ? [
            ...(conversationSource.members ?? []).flatMap((member) =>
              member.type === "user" ? [member.id] : []
            ),
            ...(conversationSource.lastMessageSender?.type === "user"
              ? [conversationSource.lastMessageSender.id]
              : []),
            ...(conversationSource.topic?.sourceSender.type === "user"
              ? [conversationSource.topic.sourceSender.id]
              : []),
          ]
        : [],
    [conversationSource]
  )
  const conversationUserIdsKey = conversationUserIds.slice().sort().join("\u0000")
  useEffect(() => {
    const ids = conversationUserIdsKey ? conversationUserIdsKey.split("\u0000") : []
    if (ids.length > 0) void ensureUsers(ids).catch(() => undefined)
  }, [conversationUserIdsKey, ensureUsers])
  const conversation = useMemo(
    () =>
      conversationSource
        ? hydrateClientConversationUsers(
            conversationSource,
            contacts.apps,
            usersById
          )
        : undefined,
    [contacts.apps, conversationSource, usersById]
  )
  const isTopicConversation = expectsTopic || conversation?.type === "topic"
  const topicArchived = Boolean(conversation?.topic?.archived)
  const archiveTopicMutation = useArchiveConversationTopic(
    session,
    conversationId
  )
  const conversationEntity =
    conversation && currentUser && conversation.type !== "topic"
      ? getConversationEntityReference(conversation, currentUser.id)
      : null
  const mentionCandidates = useMemo(
    () =>
      conversation?.type === "group" ||
      conversation?.topic?.parentConversationType === "group"
        ? createMentionCandidates(conversation.members ?? [])
        : [],
    [conversation]
  )
  const messagesQuery = useConversationMessages(session, conversationId, {
    fallbackPollingEnabled: !realtimeReady,
  })
  const { mutateAsync: markRead } = useMarkConversationRead(
    session,
    conversationId
  )
  const messageResources = useMemo(
    () => collectMessageResources(messagesQuery.messages),
    [messagesQuery.messages]
  )
  const messageUserIds = useMemo(
    () => collectMessageUserIds(messagesQuery.messages),
    [messagesQuery.messages]
  )
  const messageUserIdsKey = messageUserIds.slice().sort().join("\u0000")
  useEffect(() => {
    const ids = messageUserIdsKey ? messageUserIdsKey.split("\u0000") : []
    if (ids.length > 0) void ensureUsers(ids).catch(() => undefined)
  }, [ensureUsers, messageUserIdsKey])
  const profileContacts = useMemo(
    () => ({ ...contacts, users: Object.values(usersById) }),
    [contacts, usersById]
  )
  const resources = useMessageResources(session, messageResources)
  const resolveMentionLabel = useMemo(
    () =>
      conversation && currentUser
        ? createMessageMentionLabelResolver({
            contacts: profileContacts,
            conversation,
            currentUser,
          })
        : EMPTY_MENTION_RESOLVER,
    [conversation, currentUser, profileContacts]
  )
  const presentedMessages = useMemo(
    () =>
      conversation && currentUser
        ? buildPresentedMessages({
            contacts: profileContacts,
            conversation,
            currentUser,
            messages: messagesQuery.messages,
            resolveMentionLabel,
          })
        : [],
    [
      conversation,
      currentUser,
      messagesQuery.messages,
      profileContacts,
      resolveMentionLabel,
    ]
  )

  const handleSelectionReply = useCallback(
    (target: ScopedMessageActionTarget) => {
      setReplyTarget(target)
      requestAnimationFrame(() => composerRef.current?.focus())
    },
    []
  )
  const handleSelectionForward = useCallback(
    (target: ScopedMessageActionTarget) => {
      setForwardMessage(target)
      setForwardSheetOpen(true)
      composerRef.current?.dismissAccessory()
    },
    []
  )
  const handleMessageRevoked = useCallback((messageId: string) => {
    setReplyTarget((current) =>
      current?.id === messageId ? null : current
    )
  }, [])
  const handleReplySent = useCallback((messageId: string) => {
    setReplyTarget((current) =>
      current?.id === messageId ? null : current
    )
  }, [])
  const closeTopicArchiveDialog = useCallback(
    () => setTopicArchiveDialogOpen(false),
    []
  )
  const { goBack, openTopic } = useConversationNavigation({
    activateConversation,
    archivePending: archiveTopicMutation.isPending,
    conversationId,
    isFocused,
    onCloseArchiveDialog: closeTopicArchiveDialog,
    parentConversationId,
    topicArchiveDialogOpen,
  })
  useMessageSelectionActions({
    conversationId,
    isFocused,
    messages: presentedMessages,
    onForward: handleSelectionForward,
    onReply: handleSelectionReply,
    onRevoked: handleMessageRevoked,
    resolveMentionLabel,
    server: session,
    topicArchived,
  })
  const messageActions = useConversationMessageActions({
    conversationId,
    forwardMessageId: forwardMessage?.id,
    onReplySent: handleReplySent,
    replyToMessageId: replyTarget?.id,
    server: session,
  })

  useEffect(() => {
    const error = messagesQuery.error ?? topicQuery.error ?? currentUserError
    if (isUnauthorizedError(error)) {
      void invalidateSession()
      router.replace("/init")
    }
  }, [
    currentUserError,
    invalidateSession,
    messagesQuery.error,
    router,
    topicQuery.error,
  ])

  useEffect(() => {
    if (isReady && !conversation && !expectsTopic) {
      router.replace("/messages")
    }
  }, [conversation, expectsTopic, isReady, router])

  useConversationReadSync({
    conversation,
    conversationId,
    isFocused,
    markRead,
    messages: messagesQuery.messages,
  })

  function handleRetryMessages() {
    void messagesQuery.refetch()
  }

  function handleLoadOlder() {
    if (!messagesQuery.hasOlder || messagesQuery.isFetchingOlder) return
    void messagesQuery.fetchOlder()
  }

  function handleAvatarPress(sender: EntityReference) {
    router.push(buildEntityDetailHref(sender))
  }

  function handleConversationDetails() {
    if (!conversationEntity) return
    router.push(buildEntityDetailHref(conversationEntity))
  }

  async function handleArchiveTopic() {
    if (archiveTopicMutation.isPending) return

    try {
      await archiveTopicMutation.mutateAsync()
      setTopicArchiveDialogOpen(false)
      toast.show("话题已关闭", {
        customData: { tone: "success" satisfies AppToastTone },
      })
    } catch (error: unknown) {
      Alert.alert(
        "关闭话题失败",
        error instanceof ApiRequestError ? error.message : "请稍后重试。"
      )
    }
  }

  function handleAvatarLongPress(sender: EntityReference) {
    if (
      (conversation?.type !== "group" &&
        conversation?.topic?.parentConversationType !== "group") ||
      sender.type === "group"
    ) {
      return
    }

    const label = resolveMentionLabel({
      id: sender.id,
      type: sender.type,
    })?.trim()
    if (!label) return

    composerRef.current?.insertMention({
      id: sender.id,
      label,
      targetType: sender.type,
    })
  }

  async function handleResourcePress(fileId: string) {
    try {
      const resource = await resources.ensure(fileId)
      await openResourceExternally(resource)
    } catch (error: unknown) {
      Alert.alert(
        "无法打开文件",
        error instanceof Error ? error.message : "文件下载失败，请重试。"
      )
    }
  }

  function handleImagePress(fileId: string, messageId: string) {
    router.push(
      buildAttachmentImagePreviewHref(fileId, { conversationId, messageId })
    )
  }

  async function handleVoiceResourcePress(fileId: string) {
    try {
      await resources.ensure(fileId)
    } catch (error: unknown) {
      Alert.alert(
        "无法播放语音",
        error instanceof Error ? error.message : "语音下载失败，请重试。"
      )
    }
  }

  return (
    <YStack bg="$background" flex={1}>
      <PageHeader
        actionLabel={isTopicConversation ? "关闭话题" : "查看对话详情"}
        compactActionIcon={Ellipsis}
        compactIconButtons
        onActionPress={
          isTopicConversation
            ? topicQuery.data?.canArchive && !topicArchived
              ? () => setTopicArchiveDialogOpen(true)
              : undefined
            : conversationEntity
              ? handleConversationDetails
              : undefined
        }
        onBackPress={goBack}
        title={conversation?.name ?? "对话"}
      />

      <YStack bg="$background" flex={1} pb={insets.bottom}>
        <KeyboardAwareScreen
          contentBackground="$backgroundLight"
          edges={[]}
          keyboardVerticalOffset={insets.top + PAGE_HEADER_HEIGHT}
          scrollable={false}
        >
          {!conversation ? (
            <ContentState
              loading={expectsTopic && topicQuery.isLoading}
              message={
                expectsTopic
                  ? topicQuery.error?.message ?? "正在加载话题"
                  : "该会话不存在或已被移除"
              }
              tone={topicQuery.error ? "error" : undefined}
            />
          ) : !currentUser ? (
            <ContentState loading message="正在加载用户信息" />
          ) : (
            <>
              <MessageList
              canAddReaction={!topicArchived}
              canRespondToChoice={conversation.canSend && !topicArchived}
              conversationId={conversation.id}
              currentUserId={currentUser.id}
              error={messagesQuery.error}
              hasOlder={messagesQuery.hasOlder}
              isFetchingOlder={messagesQuery.isFetchingOlder}
              isLoading={messagesQuery.isLoading}
              messages={presentedMessages}
              onAvatarLongPress={
                conversation.type === "group"
                  ? handleAvatarLongPress
                  : undefined
              }
              onAvatarPress={handleAvatarPress}
              onContentTouch={() =>
                composerRef.current?.dismissAccessory()
              }
              onImagePress={handleImagePress}
              onLoadOlder={handleLoadOlder}
              onRetry={handleRetryMessages}
              onResourceError={(fileId) =>
                void resources.reload(fileId).catch(() => undefined)
              }
              onResourcePress={(fileId) => void handleResourcePress(fileId)}
              onRespondChoice={messageActions.respondChoice}
              onSetReaction={messageActions.setReaction}
              onVoiceResourcePress={(fileId) =>
                void handleVoiceResourcePress(fileId)
              }
              onMentionPress={handleAvatarPress}
              onOpenTopic={openTopic}
              resolveMentionLabel={resolveMentionLabel}
              resourceStates={resources.states}
              server={session}
              showChoiceResponseCounts={
                shouldShowMessageChoiceResponseCounts(conversation)
              }
              />
              {topicArchived ? (
                <YStack bg="$background" items="center" p="$4">
                  <SizableText color="$color10" size="$3">
                    话题已关闭，无法继续发言
                  </SizableText>
                </YStack>
              ) : (
                <MessageComposer
                  disabled={messageActions.isSending || !conversation.canSend}
                  mentionCandidates={mentionCandidates}
                  onClearReply={() => setReplyTarget(null)}
                  onSend={messageActions.sendText}
                  onSendUpload={messageActions.sendUpload}
                  onSendVoice={messageActions.sendVoice}
                  ref={composerRef}
                  replyTarget={replyTarget}
                  server={session}
                />
              )}
            </>
          )}
        </KeyboardAwareScreen>
      </YStack>

      <TopicArchiveDialog
        onConfirm={() => void handleArchiveTopic()}
        onOpenChange={setTopicArchiveDialogOpen}
        open={topicArchiveDialogOpen}
        saving={archiveTopicMutation.isPending}
      />
      {forwardMessage ? (
        <ForwardMessageSheet
          conversations={conversations}
          onAnimationComplete={(open) => {
            if (!open) setForwardMessage(null)
          }}
          onForward={messageActions.forward}
          onRequestClose={requestForwardSheetClose}
          open={forwardSheetOpen}
          server={session}
          source={forwardMessage}
        />
      ) : null}
    </YStack>
  )
}
