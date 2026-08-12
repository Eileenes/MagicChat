import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useMemo } from "react"
import { Alert } from "react-native"
import { Card, Paragraph, ScrollView, XStack, YStack } from "tamagui"

import { ContentState } from "@/components/feedback/content-state"
import { PageHeader } from "@/components/navigation/page-header"
import { ApiRequestError } from "@/data/api-client"
import { useOpenEntityConversation } from "@/data/conversations/conversation-hooks"
import type { ServerTarget } from "@/core/server-target"
import {
  isEntityType,
  resolveEntityProfile,
  type EntityProfile,
  type EntityType,
} from "@/domain/entities/entity-profile"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { EntityDetailAction } from "@/features/entity-details/entity-detail-action"
import { EntityDetailAvatar } from "@/features/entity-details/entity-detail-avatar"
import { EntityDetailFields } from "@/features/entity-details/entity-detail-fields"
import { useClientData } from "@/providers/client-data-provider"
import { buildConversationHref } from "@/navigation/conversations"
import { buildAvatarImagePreviewHref } from "@/navigation/image-preview"

export function EntityDetailScreen() {
  const params = useLocalSearchParams<{
    entityId: string
    entityType: string
  }>()
  const router = useRouter()
  const session = useAuthenticatedSession()
  const {
    contacts,
    conversations,
    currentUser,
    ensureUsers,
    isReady,
    usersById,
  } = useClientData()
  const openConversationMutation = useOpenEntityConversation(session)
  const entityId = getFirstParam(params.entityId)
  const entityTypeParam = getFirstParam(params.entityType)
  const entityType = isEntityType(entityTypeParam) ? entityTypeParam : null
  useEffect(() => {
    if (entityType === "user" && entityId) {
      void ensureUsers([entityId]).catch(() => undefined)
    }
  }, [ensureUsers, entityId, entityType])
  const profileContacts = useMemo(
    () => ({ ...contacts, users: Object.values(usersById) }),
    [contacts, usersById]
  )
  const isResolvingUserProfile =
    entityType === "user" && Boolean(entityId) && !usersById[entityId]
  const profile = useMemo(
    () =>
      entityType && entityId
        ? resolveEntityProfile({
            contacts: profileContacts,
            conversations,
            currentUser,
            reference: { id: entityId, type: entityType },
          })
        : null,
    [conversations, currentUser, entityId, entityType, profileContacts]
  )

  async function handlePrimaryAction() {
    if (!profile || openConversationMutation.isPending) return

    if (profile.type === "group" && profile.joined) {
      router.push(buildConversationHref(profile.id))
      return
    }

    try {
      const conversation = await openConversationMutation.mutateAsync({
        id: profile.id,
        type: profile.type,
      })
      router.push(buildConversationHref(conversation.id))
    } catch (error: unknown) {
      Alert.alert(
        getActionErrorTitle(profile),
        error instanceof ApiRequestError ? error.message : "操作失败，请重试。"
      )
    }
  }

  function handleAvatarPress() {
    if (!profile?.avatar.trim()) return
    router.push(buildAvatarImagePreviewHref(profile.avatar))
  }

  return (
    <YStack bg="$background" flex={1}>
      <PageHeader
        onBackPress={() => router.back()}
        title={getPageTitle(entityType)}
      />

      {(!isReady || isResolvingUserProfile) && entityType ? (
        <ContentState loading message="正在加载资料" />
      ) : profile ? (
        <EntityProfileContent
          currentUserId={currentUser?.id ?? null}
          isActionPending={openConversationMutation.isPending}
          onActionPress={() => void handlePrimaryAction()}
          onAvatarPress={profile.avatar.trim() ? handleAvatarPress : undefined}
          profile={profile}
          server={session}
        />
      ) : (
        <ContentState message="资料不存在或已不可访问" />
      )}
    </YStack>
  )
}

function EntityProfileContent({
  currentUserId,
  isActionPending,
  onActionPress,
  onAvatarPress,
  profile,
  server,
}: {
  currentUserId: string | null
  isActionPending: boolean
  onActionPress: () => void
  onAvatarPress?: () => void
  profile: EntityProfile
  server: ServerTarget
}) {
  return (
    <ScrollView>
      <YStack gap="$4" maxW={440} p="$4" self="center" width="100%">
        <Card size="$5">
          <XStack gap="$4" items="center">
            <EntityDetailAvatar
              onPress={onAvatarPress}
              profile={profile}
              server={server}
            />
            <YStack flex={1} gap="$1">
              <Paragraph
                fontSize="$5"
                fontWeight="600"
                lineHeight="$6"
                numberOfLines={2}
              >
                {profile.displayName}
              </Paragraph>
              <Paragraph color="$color10" numberOfLines={3} size="$3">
                {getProfileDescription(profile)}
              </Paragraph>
            </YStack>
          </XStack>
        </Card>

        <EntityDetailFields profile={profile} />
        <EntityDetailAction
          currentUserId={currentUserId}
          isPending={isActionPending}
          onPress={onActionPress}
          profile={profile}
        />
      </YStack>
    </ScrollView>
  )
}

function getProfileDescription(profile: EntityProfile) {
  if (profile.type === "user") return "用户资料"
  if (profile.type === "group") return "群聊资料"
  return profile.description.trim() || "应用资料"
}

function getPageTitle(type: EntityType | null) {
  if (type === "app") return "应用详情"
  if (type === "group") return "群组详情"
  return "联系人详情"
}

function getActionErrorTitle(profile: EntityProfile) {
  if (profile.type === "user") return "无法发起私聊"
  if (profile.type === "app") return "无法发起应用会话"
  return "无法加入群聊"
}

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}
