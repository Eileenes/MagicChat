import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useToastController } from "tamagui"

import type { AppToastTone } from "@/components/feedback/app-toast"
import { isUnauthorizedError } from "@/data/api-client"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import {
  useDismissConversation,
  useSetConversationMuted,
  useSetConversationPinned,
} from "@/data/conversations/conversation-hooks"
import type { ClientConversation } from "@/core/models"
import { hydrateConversationMessagesQuery } from "@/data/messages"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import {
  ConversationActionSheet,
  type ConversationAction,
} from "@/features/messages/conversation-action-sheet"
import { ConversationList } from "@/features/messages/conversation-list"
import {
  buildConversationListItems,
  type ConversationListItemModel,
} from "@/features/messages/conversation-list-model"
import { DismissConversationDialog } from "@/features/messages/dismiss-conversation-dialog"
import { NetworkFailureDialog } from "@/features/messages/network-failure-dialog"
import { useClientData } from "@/providers/client-data-provider"
import { buildConversationHref } from "@/navigation/conversations"

const MESSAGE_PAGE_SIZE = 20
const PREWARM_CONVERSATION_COUNT = 30
const CONVERSATION_LIST_CLOCK_INTERVAL_MS = 60_000

export function MessagesScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const toast = useToastController()
  const session = useAuthenticatedSession()
  const pinMutation = useSetConversationPinned(session)
  const muteMutation = useSetConversationMuted(session)
  const dismissMutation = useDismissConversation(session)
  const pendingDismissCandidateRef = useRef<ClientConversation | null>(null)
  const conversationPreparationRef = useRef(
    new Map<string, Promise<boolean>>()
  )
  const prepareConversationMessages = useCallback(
    (conversationId: string) => {
      const current = conversationPreparationRef.current.get(conversationId)
      if (current) return current

      const preparation = hydrateConversationMessagesQuery(
        queryClient,
        session,
        conversationId,
        MESSAGE_PAGE_SIZE
      ).catch(() => false)
      conversationPreparationRef.current.set(conversationId, preparation)
      void preparation.finally(() => {
        if (
          conversationPreparationRef.current.get(conversationId) ===
          preparation
        ) {
          conversationPreparationRef.current.delete(conversationId)
        }
      })
      return preparation
    },
    [queryClient, session]
  )
  const [actionItem, setActionItem] =
    useState<ConversationListItemModel | null>(null)
  const [actionSheetOpen, setActionSheetOpen] = useState(false)
  const [dismissCandidate, setDismissCandidate] =
    useState<ClientConversation | null>(null)
  const [listNow, setListNow] = useState(() => new Date())
  const {
    contacts,
    contactsError,
    conversations,
    conversationsError,
    currentUser,
    currentUserError,
    isBootstrapRefreshing,
    isConversationsRefreshing,
    refreshBootstrap,
    refreshConversations,
  } = useClientData()
  const bootstrapError =
    currentUserError ?? contactsError ?? conversationsError
  const networkFailure =
    bootstrapError !== null && !isUnauthorizedError(bootstrapError)
  const items = useMemo(
    () =>
      buildConversationListItems({
        contacts,
        conversations,
        currentUserId: currentUser?.id ?? session.userId,
        keyword: "",
        now: listNow,
      }),
    [contacts, conversations, currentUser?.id, listNow, session.userId]
  )

  useEffect(() => {
    const interval = setInterval(
      () => setListNow(new Date()),
      CONVERSATION_LIST_CLOCK_INTERVAL_MS
    )
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    for (const item of items.slice(0, PREWARM_CONVERSATION_COUNT)) {
      void prepareConversationMessages(item.conversation.id)
    }
  }, [items, prepareConversationMessages])

  function handleRefresh() {
    void refreshConversations().catch(() => undefined)
  }

  function handleConversationPress(conversationId: string) {
    void prepareConversationMessages(conversationId)
    router.push(buildConversationHref(conversationId))
  }

  function handleConversationPressIn(conversationId: string) {
    void prepareConversationMessages(conversationId)
  }

  function handleConversationLongPress(item: ConversationListItemModel) {
    if (item.conversation.type === "topic") return

    pendingDismissCandidateRef.current = null
    setActionItem(item)
    setActionSheetOpen(true)
  }

  function handleActionSheetAnimationComplete(open: boolean) {
    if (open) return

    setActionItem(null)
    const pendingDismissCandidate = pendingDismissCandidateRef.current
    pendingDismissCandidateRef.current = null
    if (pendingDismissCandidate) {
      setDismissCandidate(pendingDismissCandidate)
    }
  }

  async function handlePinnedChange(pinned: boolean) {
    if (
      !actionItem ||
      actionItem.conversation.type === "topic" ||
      pinMutation.isPending ||
      muteMutation.isPending
    ) {
      return
    }

    try {
      await pinMutation.mutateAsync({
        conversationId: actionItem.conversation.id,
        pinned,
      })
      showSuccessToast(toast, pinned ? "会话已置顶" : "已取消置顶")
      setActionSheetOpen(false)
    } catch (error: unknown) {
      showErrorToast(
        toast,
        pinned ? "置顶会话失败" : "取消置顶失败",
        error
      )
    }
  }

  async function handleMutedChange(muted: boolean) {
    if (!actionItem || pinMutation.isPending || muteMutation.isPending) return

    try {
      await muteMutation.mutateAsync({
        conversationId: actionItem.conversation.id,
        muted,
      })
      showSuccessToast(
        toast,
        muted ? "已开启消息免打扰" : "已取消消息免打扰"
      )
      setActionSheetOpen(false)
    } catch (error: unknown) {
      showErrorToast(
        toast,
        muted ? "开启消息免打扰失败" : "取消消息免打扰失败",
        error
      )
    }
  }

  function handleRequestDismiss() {
    if (!actionItem || pinMutation.isPending || muteMutation.isPending) return

    pendingDismissCandidateRef.current = actionItem.conversation
    setActionSheetOpen(false)
  }

  async function handleDismissConversation() {
    if (!dismissCandidate || dismissMutation.isPending) return

    try {
      await dismissMutation.mutateAsync(dismissCandidate.id)
      setDismissCandidate(null)
      showSuccessToast(toast, "对话已删除")
    } catch (error: unknown) {
      showErrorToast(toast, "删除对话失败", error)
    }
  }

  const activeAction: ConversationAction = pinMutation.isPending
    ? "pin"
    : muteMutation.isPending
      ? "mute"
      : null

  return (
    <>
      <KeyboardAwareScreen
        contentBackground="$color1"
        edges={[]}
        scrollable={false}
      >
        <ConversationList
          hasKeyword={false}
          isRefreshing={isConversationsRefreshing}
          items={items}
          onConversationLongPress={handleConversationLongPress}
          onConversationPress={handleConversationPress}
          onConversationPressIn={handleConversationPressIn}
          onRefresh={handleRefresh}
          server={session}
        />
      </KeyboardAwareScreen>

      <ConversationActionSheet
        activeAction={activeAction}
        item={actionItem}
        onAnimationComplete={handleActionSheetAnimationComplete}
        onDelete={handleRequestDismiss}
        onMutedChange={(muted) => void handleMutedChange(muted)}
        onOpenChange={setActionSheetOpen}
        onPinnedChange={(pinned) => void handlePinnedChange(pinned)}
        open={actionSheetOpen}
        server={session}
      />

      <NetworkFailureDialog
        onRetry={() => void refreshBootstrap().catch(() => undefined)}
        open={networkFailure}
        retrying={isBootstrapRefreshing}
      />

      <DismissConversationDialog
        conversationName={dismissCandidate?.name ?? ""}
        deleting={dismissMutation.isPending}
        onConfirm={() => void handleDismissConversation()}
        onOpenChange={(open) => {
          if (!open) setDismissCandidate(null)
        }}
        open={dismissCandidate !== null}
      />
    </>
  )
}

function showSuccessToast(
  toast: ReturnType<typeof useToastController>,
  title: string
) {
  toast.show(title, {
    customData: { tone: "success" satisfies AppToastTone },
  })
}

function showErrorToast(
  toast: ReturnType<typeof useToastController>,
  title: string,
  error: unknown
) {
  toast.show(title, {
    customData: { tone: "error" satisfies AppToastTone },
    duration: 4000,
    message: error instanceof Error ? error.message : title,
  })
}
