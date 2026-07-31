import type {
  ClientContacts,
  ClientConversation,
} from "@/core/models"
import {
  isConversationTopicVisibleInList,
  orderConversations,
} from "@/domain/conversations/conversation-order"
import { getContactDisplayName } from "@/domain/contacts/contact-display"
import {
  formatMentionTemplateText,
  type MessageMentionLabelResolver,
} from "@/domain/messages/message-mentions"

export type ConversationListItemModel = {
  conversation: ClientConversation
  description: string
  lastMessageTime: string
  nested: boolean
  pinnedBackground: boolean
  unreadAlertLabel: "[选择]" | "[有人 @ 我]" | null
}

export function buildConversationListItems({
  activeConversationId,
  contacts,
  conversations,
  currentUserId,
  keyword,
  now = new Date(),
}: {
  activeConversationId?: string
  contacts: ClientContacts
  conversations: ClientConversation[]
  currentUserId: string
  keyword: string
  now?: Date
}): ConversationListItemModel[] {
  const labels = createMentionLabels(contacts, conversations)
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()
  const rows = getConversationListRows({
    activeConversationId,
    conversations,
    now: now.getTime(),
  })

  const items = rows.map(({ conversation, nested, pinnedBackground }) => {
    const messageDescription = formatConversationDescription(
      conversation,
      labels,
      currentUserId
    )
    const unreadAlertLabel = getConversationUnreadAlertLabel(conversation)
    const description = formatConversationUnreadDescription(
      messageDescription,
      unreadAlertLabel
    )

    return {
      conversation,
      description,
      lastMessageTime: formatActivityTime(
        conversation.lastMessageAt ?? conversation.createdAt,
        now
      ),
      nested,
      pinnedBackground,
      unreadAlertLabel,
    }
  })

  if (!normalizedKeyword) {
    return items
  }

  const includedIds = new Set(
    items
      .filter(
        ({ conversation, description }) =>
          conversation.name.toLocaleLowerCase().includes(normalizedKeyword) ||
          description.toLocaleLowerCase().includes(normalizedKeyword)
      )
      .map(({ conversation }) => conversation.id)
  )

  for (const item of items) {
    if (item.nested && includedIds.has(item.conversation.id)) {
      const parentId = item.conversation.topic?.parentConversationId
      if (parentId) includedIds.add(parentId)
    }
  }

  return items.filter(({ conversation }) => includedIds.has(conversation.id))
}

function getConversationListRows({
  activeConversationId,
  conversations,
  now,
}: {
  activeConversationId?: string
  conversations: ClientConversation[]
  now: number
}) {
  const orderedConversations = orderConversations(conversations, now)
  const parentById = new Map(
    orderedConversations
      .filter((conversation) => conversation.type !== "topic")
      .map((conversation) => [conversation.id, conversation])
  )
  const topicsByParentId = new Map<string, ClientConversation[]>()

  for (const conversation of orderedConversations) {
    if (
      conversation.type !== "topic" ||
      !isConversationTopicVisibleInList(conversation, {
        activeConversationId,
        now,
      })
    ) {
      continue
    }

    const parentId = conversation.topic?.parentConversationId
    if (!parentId || !parentById.has(parentId)) {
      continue
    }

    const topics = topicsByParentId.get(parentId) ?? []
    topics.push(conversation)
    topicsByParentId.set(parentId, topics)
  }

  const rows: {
    conversation: ClientConversation
    nested: boolean
    pinnedBackground: boolean
  }[] = []
  for (const conversation of orderedConversations) {
    if (conversation.type === "topic") {
      continue
    }

    const pinnedBackground = conversation.pinned
    rows.push({ conversation, nested: false, pinnedBackground })
    rows.push(
      ...(topicsByParentId.get(conversation.id) ?? []).map((topic) => ({
        conversation: topic,
        nested: true,
        pinnedBackground,
      }))
    )
  }

  return rows
}

export function formatConversationUnreadDescription(
  description: string,
  unreadAlertLabel: ConversationListItemModel["unreadAlertLabel"]
) {
  return unreadAlertLabel === "[选择]"
    ? description.replace(/(^|：)\[选择\]\s*/, "$1")
    : description
}

export function getConversationUnreadAlertLabel(
  conversation: ClientConversation
): ConversationListItemModel["unreadAlertLabel"] {
  const hasUnreadChoice = conversation.lastChoiceSeq > conversation.lastReadSeq
  const hasUnreadMention =
    conversation.lastMentionedSeq > conversation.lastReadSeq
  if (
    hasUnreadChoice &&
    conversation.lastChoiceSeq >= conversation.lastMentionedSeq
  ) {
    return "[选择]"
  }
  return hasUnreadMention ? "[有人 @ 我]" : null
}

export function formatUnreadCount(count: number) {
  return count > 99 ? "99+" : String(count)
}

function createMentionLabels(
  contacts: ClientContacts,
  conversations: ClientConversation[]
) {
  const appLabels = new Map(
    contacts.apps.map((app) => [app.id.toLowerCase(), app.name] as const)
  )
  const userLabels = new Map(
    contacts.users.map(
      (user) =>
        [user.id.toLowerCase(), getContactDisplayName(user)] as const
    )
  )

  for (const conversation of conversations) {
    for (const member of conversation.members ?? []) {
      const labels = member.type === "app" ? appLabels : userLabels

      if (!labels.has(member.id.toLowerCase())) {
        labels.set(
          member.id.toLowerCase(),
          member.nickname.trim() || member.name.trim()
        )
      }
    }
  }

  return { appLabels, userLabels }
}

function formatConversationDescription(
  conversation: ClientConversation,
  labels: {
    appLabels: ReadonlyMap<string, string>
    userLabels: ReadonlyMap<string, string>
  },
  currentUserId: string
) {
  const summary = conversation.lastMessageSummary.trim()

  if (!summary) {
    return "暂无消息"
  }

  const resolveMentionLabel: MessageMentionLabelResolver = ({ id, type }) => {
    if (type === "all") return undefined
    return type === "app"
      ? labels.appLabels.get(id.toLowerCase())
      : labels.userLabels.get(id.toLowerCase())
  }

  const description = formatMentionTemplateText(summary, resolveMentionLabel)
  const showsSender =
    conversation.type === "group" ||
    (conversation.type === "topic" &&
      conversation.topic?.parentConversationType === "group")

  if (!showsSender) {
    return description
  }

  const senderName = getLastMessageSenderName(conversation, currentUserId)
  return senderName ? `${senderName}：${description}` : description
}

function getLastMessageSenderName(
  conversation: ClientConversation,
  currentUserId: string
) {
  const sender = conversation.lastMessageSender
  if (!sender) {
    return ""
  }

  if (sender.type === "system") {
    return "系统"
  }

  if (sender.type === "user" && sender.id === currentUserId) {
    return "我"
  }

  return sender.nickname.trim() || sender.name.trim()
}

function formatActivityTime(activityAt: string | null, now: Date) {
  if (!activityAt) {
    return ""
  }

  const date = new Date(activityAt)

  if (Number.isNaN(date.getTime())) {
    return ""
  }

  if (!isSameLocalDay(date, now)) {
    return `${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }).format(date)
}

function isSameLocalDay(date: Date, otherDate: Date) {
  return (
    date.getFullYear() === otherDate.getFullYear() &&
    date.getMonth() === otherDate.getMonth() &&
    date.getDate() === otherDate.getDate()
  )
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0")
}
