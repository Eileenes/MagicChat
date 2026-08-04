import { Fragment } from "react"
import { Linking } from "react-native"
import { Text } from "tamagui"

import type { EntityReference } from "@/domain/entities/entity-profile"
import {
  parseMessageMentionTemplate,
  type MessageMentionLabelResolver,
} from "@/domain/messages/message-mentions"
import { linkifyMessageText } from "@/domain/messages/message-links"

export function MessageMentionText({
  content,
  currentUserId,
  onMentionPress,
  resolveMentionLabel,
}: {
  content: string
  currentUserId: string
  onMentionPress: (target: EntityReference) => void
  resolveMentionLabel: MessageMentionLabelResolver
}) {
  const parts = parseMessageMentionTemplate(content, resolveMentionLabel)

  return parts.map((part, index) => {
    if (part.type === "text") {
      return (
        <Fragment key={`text:${index}`}>
          {linkifyMessageText(part.text).map((textPart, textIndex) =>
            textPart.type === "link" ? (
              <Text
                color="$blue10"
                fontWeight="600"
                key={`link:${textIndex}:${textPart.value}`}
                onPress={() => void openMessageLink(textPart.href)}
              >
                {textPart.value}
              </Text>
            ) : (
              <Fragment key={`plain:${textIndex}`}>{textPart.value}</Fragment>
            )
          )}
        </Fragment>
      )
    }

    const mentionsCurrentUser =
      part.targetType === "all" ||
      (part.targetType === "user" &&
        part.id.toLowerCase() === currentUserId.toLowerCase())
    const target =
      part.targetType === "all"
        ? null
        : ({ id: part.id, type: part.targetType } satisfies EntityReference)

    return (
      <Text
        color={mentionsCurrentUser ? "$orange10" : "$blue10"}
        fontWeight="600"
        key={`${part.targetType}:${part.id}:${index}`}
        onPress={target ? () => onMentionPress(target) : undefined}
      >
        {part.label}
      </Text>
    )
  })
}

async function openMessageLink(url: string) {
  try {
    await Linking.openURL(url)
  } catch {
    // Invalid or unsupported links stay inert inside the message.
  }
}
