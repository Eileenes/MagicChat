import { useRouter } from "expo-router"
import { useCallback, useEffect, useRef } from "react"
import { BackHandler } from "react-native"

import {
  buildConversationHref,
  buildTopicConversationHref,
} from "@/navigation/conversations"

export function useConversationNavigation({
  activateConversation,
  archivePending,
  conversationId,
  isFocused,
  onCloseArchiveDialog,
  parentConversationId,
  topicArchiveDialogOpen,
}: {
  activateConversation: (conversationId: string) => (() => void) | undefined
  archivePending: boolean
  conversationId: string
  isFocused: boolean
  onCloseArchiveDialog: () => void
  parentConversationId: string
  topicArchiveDialogOpen: boolean
}) {
  const router = useRouter()
  const openingTopicRef = useRef(false)

  useEffect(() => {
    if (!isFocused || !conversationId) return
    return activateConversation(conversationId)
  }, [activateConversation, conversationId, isFocused])

  useEffect(() => {
    if (isFocused) openingTopicRef.current = false
  }, [isFocused])

  useEffect(() => {
    if (!isFocused || !parentConversationId) return

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (topicArchiveDialogOpen) {
          if (!archivePending) onCloseArchiveDialog()
          return true
        }
        router.dismissTo(buildConversationHref(parentConversationId))
        return true
      }
    )
    return () => subscription.remove()
  }, [
    archivePending,
    isFocused,
    onCloseArchiveDialog,
    parentConversationId,
    router,
    topicArchiveDialogOpen,
  ])

  const openTopic = useCallback(
    (topicConversationId: string) => {
      if (openingTopicRef.current) return

      openingTopicRef.current = true
      router.push(
        buildTopicConversationHref(conversationId, topicConversationId)
      )
    },
    [conversationId, router]
  )

  const goBack = useCallback(() => {
    if (parentConversationId) {
      router.dismissTo(buildConversationHref(parentConversationId))
      return
    }
    router.back()
  }, [parentConversationId, router])

  return { goBack, openTopic }
}
