import { Bot } from "lucide-react-native"
import {
  Avatar,
  type ColorTokens,
  SizableText,
  Text,
  XStack,
  YStack,
} from "tamagui"

import { GroupAvatar } from "@/components/avatar/group-avatar"
import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import { ThemedIcon } from "@/components/icons/themed-icon"
import type { ClientConversation } from "@/core/models"
import type { ServerTarget } from "@/core/server-target"
import {
  getConversationAvatarName,
  getConversationAvatarType,
  type ConversationAvatarType,
} from "@/domain/conversations/conversation-avatar"
import { formatUnreadCount } from "@/features/messages/conversation-list-model"

export function ConversationAvatar({
  conversation,
  server,
  surroundingBackground = "$color1",
  topicSourceOnly = false,
}: {
  conversation: ClientConversation
  server: ServerTarget
  surroundingBackground?: ColorTokens
  topicSourceOnly?: boolean
}) {
  const avatarName = getConversationAvatarName(conversation)
  const avatarType = getConversationAvatarType(conversation)
  const sourceSender =
    conversation.type === "topic" ? conversation.topic?.sourceSender : undefined
  const usesTopicSourceAvatar = Boolean(topicSourceOnly && sourceSender)

  return (
    <YStack
      height={usesTopicSourceAvatar ? 32 : "$4"}
      width={usesTopicSourceAvatar ? 32 : "$4"}
    >
      {usesTopicSourceAvatar && sourceSender ? (
        <TopicSourceAvatar server={server} sourceSender={sourceSender} />
      ) : (
        <BaseConversationAvatar
          avatarName={avatarName}
          avatarType={avatarType}
          conversation={conversation}
          server={server}
        />
      )}

      {sourceSender && !usesTopicSourceAvatar ? (
        <YStack
          accessibilityLabel={`话题来源：${sourceSender.name}`}
          b={-4}
          bg={surroundingBackground}
          p={1}
          position="absolute"
          r={-4}
          rounded="$10"
          z={1}
        >
          <Avatar rounded="$10" size={18}>
            <CachedAvatarImage avatar={sourceSender.avatar} server={server} />
            <Avatar.Fallback
              bg="$backgroundFocus"
              items="center"
              justify="center"
            >
              {sourceSender.type === "app" ? (
                <ThemedIcon icon={Bot} size={10} />
              ) : (
                <SizableText fontSize={9} fontWeight="600" lineHeight={11}>
                  {getConversationInitial(sourceSender.name)}
                </SizableText>
              )}
            </Avatar.Fallback>
          </Avatar>
        </YStack>
      ) : null}

      {conversation.unreadCount > 0 ? (
        <XStack
          accessibilityLabel={`${conversation.unreadCount} 条未读消息`}
          bg="$red10"
          height={18}
          items="center"
          justify="center"
          minW={18}
          position="absolute"
          px="$1"
          r={-7}
          rounded="$10"
          t={-7}
          z={1}
        >
          <SizableText color="$white" size="$1">
            {formatUnreadCount(conversation.unreadCount)}
          </SizableText>
        </XStack>
      ) : null}
    </YStack>
  )
}

function TopicSourceAvatar({
  server,
  sourceSender,
}: {
  server: ServerTarget
  sourceSender: NonNullable<ClientConversation["topic"]>["sourceSender"]
}) {
  return (
    <Avatar
      accessibilityLabel={`话题来源：${sourceSender.name}`}
      rounded="$10"
      size={32}
    >
      <CachedAvatarImage avatar={sourceSender.avatar} server={server} />
      <Avatar.Fallback bg="$backgroundFocus" items="center" justify="center">
        {sourceSender.type === "app" ? (
          <ThemedIcon icon={Bot} size={14} />
        ) : (
          <SizableText fontSize={13} fontWeight="600" lineHeight={16}>
            {getConversationInitial(sourceSender.name)}
          </SizableText>
        )}
      </Avatar.Fallback>
    </Avatar>
  )
}

function BaseConversationAvatar({
  avatarName,
  avatarType,
  conversation,
  server,
}: {
  avatarName: string
  avatarType: ConversationAvatarType
  conversation: ClientConversation
  server: ServerTarget
}) {
  if (avatarType === "group") {
    return (
      <GroupAvatar
        avatar={conversation.avatar}
        members={conversation.members}
        name={avatarName}
        server={server}
      />
    )
  }

  return (
    <Avatar rounded="$2" size="$4">
      <CachedAvatarImage avatar={conversation.avatar} server={server} />
      <Avatar.Fallback bg="$backgroundFocus" items="center" justify="center">
        {avatarType === "app" ? (
          <ThemedIcon icon={Bot} size={18} />
        ) : (
          <Text fontWeight="600">{getConversationInitial(avatarName)}</Text>
        )}
      </Avatar.Fallback>
    </Avatar>
  )
}

function getConversationInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}
