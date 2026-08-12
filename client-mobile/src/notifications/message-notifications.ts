import type { QueryClient } from "@tanstack/react-query"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

import type {
  ClientContactDirectory,
  ClientConversation,
  ClientMessage,
  ClientMessageSender,
  ClientUser,
  ContactUser,
} from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { queryKeys } from "@/data/query"
import {
  createMessageMentionLabelResolver,
  formatClientMessageBodySummary,
} from "@/domain/messages/message-presenter"

const MESSAGE_CHANNEL_ID = "messages"

let notificationsAllowed = false

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  })
}

export async function prepareMessageNotifications() {
  if (Platform.OS === "web") {
    return false
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(MESSAGE_CHANNEL_ID, {
      enableVibrate: true,
      importance: Notifications.AndroidImportance.HIGH,
      name: "消息通知",
      showBadge: true,
      sound: "default",
      vibrationPattern: [0, 250, 150, 250],
    })
  }

  let permission = await Notifications.getPermissionsAsync()
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync()
  }

  notificationsAllowed = permission.granted
  return notificationsAllowed
}

export async function showBackgroundMessageNotification(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  message: ClientMessage
) {
  if (Platform.OS === "web" || !notificationsAllowed) {
    return
  }

  const currentUser = queryClient.getQueryData<ClientUser>(
    queryKeys.currentUser(server)
  )
  if (currentUser && isMessageInitiatedByUser(message, currentUser.id)) {
    return
  }

  const contacts = queryClient.getQueryData<ClientContactDirectory>(
    queryKeys.contacts(server)
  )
  const usersById = queryClient.getQueryData<Record<string, ContactUser>>(
    queryKeys.userProfiles(server)
  )
  const conversations = queryClient.getQueryData<ClientConversation[]>(
    queryKeys.conversations(server)
  )
  const conversation = conversations?.find(
    (item) => item.id === message.conversationId
  )
  const profileContacts = contacts
    ? { ...contacts, users: Object.values(usersById ?? {}) }
    : undefined
  if (conversation?.notificationMuted) {
    return
  }
  const resolveMentionLabel =
    profileContacts && conversation && currentUser
      ? createMessageMentionLabelResolver({
          contacts: profileContacts,
          conversation,
          currentUser,
        })
      : () => undefined
  const summary = formatClientMessageBodySummary(
    message.body,
    resolveMentionLabel
  )
    .trim()
    .replace(/\s+/g, " ")
  const senderName = getSenderName(
    message.sender,
    contacts,
    conversation,
    currentUser,
    usersById
  )

  await Notifications.scheduleNotificationAsync({
    content: {
      body: `${senderName}: ${summary || "收到一条新消息"}`,
      data: {
        conversationId: message.conversationId,
        serverId: server.id,
      },
      sound: "default",
      title: conversation?.name || "MagicChat",
    },
    identifier: message.id,
    trigger:
      Platform.OS === "android" ? { channelId: MESSAGE_CHANNEL_ID } : null,
  })
}

function getSenderName(
  sender: ClientMessageSender,
  contacts: ClientContactDirectory | undefined,
  conversation: ClientConversation | undefined,
  currentUser: ClientUser | undefined,
  usersById: Readonly<Record<string, ContactUser>> | undefined
) {
  if (sender.type === "system") {
    return "系统"
  }
  if (sender.id === currentUser?.id) {
    return currentUser.nickname.trim() || currentUser.name
  }

  const contact =
    sender.type === "app"
      ? contacts?.apps.find((item) => item.id === sender.id)
      : usersById?.[sender.id]
  if (contact) {
    return "nickname" in contact
      ? contact.nickname.trim() || contact.name
      : contact.name
  }

  const member = conversation?.members?.find((item) => item.id === sender.id)
  return member
    ? member.nickname.trim() || member.name
    : sender.type === "app"
      ? "智能应用"
      : "新消息"
}

function isMessageInitiatedByUser(message: ClientMessage, userId: string) {
  if (message.sender.type === "user") {
    return message.sender.id === userId
  }
  if (message.body.type !== "system_event") {
    return false
  }
  if (message.body.event === "group_members_invited") {
    return message.body.inviter.id === userId
  }
  return message.body.actor.id === userId
}
