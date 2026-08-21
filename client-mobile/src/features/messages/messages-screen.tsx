import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { isUnauthorizedError } from "@/data/api-client"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import {
  useDismissConversation,
  useSetConversationMuted,
  useSetConversationPinned,
} from "@/data/conversations/conversation-hooks"
import type { ClientConversation } from "@/core/models"
import { hydrateConversationMessagesQuery } from "@/data/messages"
import {
  useAuth,
  useAuthenticatedSession,
} from "@/providers/auth-provider"
import {
  ConversationActionSheet,
  type ConversationAction,
} from "@/features/messages/conversation-action-sheet"
import { ConversationList } from "@/features/messages/conversation-list"
import {
  buildConversationListItems,
  type ConversationListItemModel,
} from "@/features/messages/conversation-list-model"
import { DismissConversationActionSheet } from "@/features/messages/dismiss-conversation-dialog"
import { NetworkFailureDialog } from "@/features/messages/network-failure-dialog"
import { subscribeToMessagesTabReselected } from "@/features/messages/messages-tab-reselect"
import { useClientData } from "@/providers/client-data-provider"
import { useXGUITheme, useXGUIToast } from "@/xgui"
import { buildConversationHref } from "@/navigation/conversations"

const MESSAGE_PAGE_SIZE = 20
const PREWARM_CONVERSATION_COUNT = 30
const CONVERSATION_LIST_CLOCK_INTERVAL_MS = 60_000

export function MessagesScreen() {
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const router = useRouter()
  const { invalidateSession } = useAuth()
  const queryClient = useQueryClient()
  const session = useAuthenticatedSession()
  const pinMutation = useSetConversationPinned(session)
  const muteMutation = useSetConversationMuted(session)
  const dismissMutation = useDismissConversation(session)
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
  const [scrollToUnreadRequest, setScrollToUnreadRequest] = useState(0)
  const [listNow, setListNow] = useState(() => new Date())
  const {
    contacts,
    contactsError,
    conversations,
    conversationsError,
    currentUser,
    currentUserError,
    isBootstrapRefreshing,
    refreshBootstrap,
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

  useEffect(
    () =>
      subscribeToMessagesTabReselected(() => {
        setScrollToUnreadRequest((request) => request + 1)
      }),
    []
  )

  useEffect(() => {
    for (const item of items.slice(0, PREWARM_CONVERSATION_COUNT)) {
      void prepareConversationMessages(item.conversation.id)
    }
  }, [items, prepareConversationMessages])

  function handleConversationPress(conversationId: string) {
    void prepareConversationMessages(conversationId)
    router.push(buildConversationHref(conversationId))
  }

  function handleConversationPressIn(conversationId: string) {
    void prepareConversationMessages(conversationId)
  }

  function handleConversationLongPress(item: ConversationListItemModel) {
    if (item.conversation.type === "topic") return

    setActionItem(item)
    setActionSheetOpen(true)
  }

  async function handleNetworkRetry() {
    if (isBootstrapRefreshing) return
    toast.show({
      duration: 0,
      message: "正在刷新",
      type: "loading",
    })
    try {
      await refreshBootstrap()
    } catch {
      // The persisted query error reopens the network failure dialog.
    } finally {
      toast.hide()
    }
  }

  async function handleNetworkRelogin() {
    toast.hide()
    await invalidateSession()
    router.replace("/login")
  }

  function handleActionSheetAnimationComplete(open: boolean) {
    if (open) return

    setActionItem(null)
  }

  async function handlePinnedChange(
    item: ConversationListItemModel,
    pinned: boolean
  ) {
    if (
      item.conversation.type === "topic" ||
      pinMutation.isPending ||
      muteMutation.isPending
    ) {
      return
    }

    try {
      showLoadingToast(toast, pinned ? "正在置顶" : "正在取消置顶")
      await pinMutation.mutateAsync({
        conversationId: item.conversation.id,
        pinned,
      })
      toast.hide()
      setActionSheetOpen(false)
    } catch (error: unknown) {
      showErrorToast(
        toast,
        pinned ? "置顶会话失败" : "取消置顶失败",
        error
      )
    }
  }

  async function handleMutedChange(
    item: ConversationListItemModel,
    muted: boolean
  ) {
    if (pinMutation.isPending || muteMutation.isPending) return

    try {
      showLoadingToast(
        toast,
        muted ? "正在开启免打扰" : "正在取消免打扰"
      )
      await muteMutation.mutateAsync({
        conversationId: item.conversation.id,
        muted,
      })
      toast.hide()
      setActionSheetOpen(false)
    } catch (error: unknown) {
      showErrorToast(
        toast,
        muted ? "开启消息免打扰失败" : "取消消息免打扰失败",
        error
      )
    }
  }

  function handleRequestDismiss(item: ConversationListItemModel) {
    if (pinMutation.isPending || muteMutation.isPending) return

    setActionSheetOpen(false)
    setDismissCandidate(item.conversation)
  }

  async function handleDismissConversation() {
    if (!dismissCandidate || dismissMutation.isPending) return

    try {
      showLoadingToast(toast, "正在删除")
      await dismissMutation.mutateAsync(dismissCandidate.id)
      setDismissCandidate(null)
      toast.hide()
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
        contentBackground={colors.background0}
        edges={[]}
        scrollable={false}
      >
        <ConversationList
          hasKeyword={false}
          items={items}
          onConversationDelete={handleRequestDismiss}
          onConversationLongPress={handleConversationLongPress}
          onConversationMutedChange={(item, muted) =>
            void handleMutedChange(item, muted)
          }
          onConversationPinnedChange={(item, pinned) =>
            void handlePinnedChange(item, pinned)
          }
          onConversationPress={handleConversationPress}
          onConversationPressIn={handleConversationPressIn}
          onSearchPress={() => router.push("/search")}
          scrollToUnreadRequest={scrollToUnreadRequest}
          server={session}
        />
      </KeyboardAwareScreen>

      <ConversationActionSheet
        activeAction={activeAction}
        item={actionItem}
        onAnimationComplete={handleActionSheetAnimationComplete}
        onDelete={() => {
          if (actionItem) handleRequestDismiss(actionItem)
        }}
        onMutedChange={(muted) => {
          if (actionItem) void handleMutedChange(actionItem, muted)
        }}
        onMutedChangeStart={(muted) =>
          showLoadingToast(
            toast,
            muted ? "正在开启免打扰" : "正在取消免打扰"
          )
        }
        onOpenChange={setActionSheetOpen}
        onPinnedChange={(pinned) => {
          if (actionItem) void handlePinnedChange(actionItem, pinned)
        }}
        onPinnedChangeStart={(pinned) =>
          showLoadingToast(toast, pinned ? "正在置顶" : "正在取消置顶")
        }
        open={actionSheetOpen}
      />

      <NetworkFailureDialog
        onRelogin={() => void handleNetworkRelogin()}
        onRetry={() => void handleNetworkRetry()}
        open={networkFailure && !isBootstrapRefreshing}
      />

      <DismissConversationActionSheet
        conversationName={dismissCandidate?.name ?? ""}
        deleting={dismissMutation.isPending}
        onBeforeConfirm={() => showLoadingToast(toast, "正在删除")}
        onConfirm={() => void handleDismissConversation()}
        onOpenChange={(open) => {
          if (!open) setDismissCandidate(null)
        }}
        open={dismissCandidate !== null}
      />
    </>
  )
}

function showLoadingToast(
  toast: ReturnType<typeof useXGUIToast>,
  message: string
) {
  toast.show({ duration: 0, message, type: "loading" })
}

function showErrorToast(
  toast: ReturnType<typeof useXGUIToast>,
  title: string,
  error: unknown
) {
  const detail = error instanceof Error ? error.message.trim() : ""
  toast.show({
    duration: 2000,
    message: detail && detail !== title ? `${title}\n${detail}` : title,
    type: "error",
  })
}
