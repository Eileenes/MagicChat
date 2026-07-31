import { Check } from "lucide-react-native"
import { useState } from "react"
import { Pressable, StyleSheet } from "react-native"
import {
  Checkbox,
  Paragraph,
  RadioGroup,
  Separator,
  SizableText,
  useTheme,
  useToastController,
  XStack,
  YStack,
} from "tamagui"

import type { AppToastTone } from "@/components/feedback/app-toast"
import { AppButton } from "@/components/forms/app-button"
import type {
  ClientChoiceMessageBody,
  ClientMessageChoiceState,
} from "@/data/models"
import type { EntityReference } from "@/domain/entities/entity-profile"
import type { MessageMentionLabelResolver } from "@/domain/messages/message-presenter"
import {
  isMessageChoiceAnswered,
  updateMessageChoiceDraft,
} from "@/domain/messages/message-choices"
import { MarkdownMessage } from "@/features/conversation/markdown-message"
import { MessageMentionText } from "@/features/conversation/message-mention-text"

export function MessageChoice({
  body,
  canRespond,
  choice,
  currentUserId,
  onMentionPress,
  onRespond,
  resolveMentionLabel,
  serverUrl,
  showResponseCounts,
}: {
  body: ClientChoiceMessageBody
  canRespond: boolean
  choice?: ClientMessageChoiceState
  currentUserId: string
  onMentionPress: (target: EntityReference) => void
  onRespond?: (optionIds: string[]) => Promise<void>
  resolveMentionLabel: MessageMentionLabelResolver
  serverUrl: string
  showResponseCounts: boolean
}) {
  const toast = useToastController()
  const [draftOptionIds, setDraftOptionIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const answered = isMessageChoiceAnswered(choice)
  const selectedOptionIds = answered
    ? (choice?.myOptionIds ?? [])
    : draftOptionIds
  const disabled = !canRespond || answered || submitting
  const hasSubmittableSelection =
    canRespond && Boolean(onRespond) && selectedOptionIds.length > 0
  const countsByOptionId = new Map(
    choice?.options.map((option) => [option.id, option.responseCount]) ?? []
  )

  function selectSingle(optionId: string) {
    if (!disabled) {
      setDraftOptionIds((current) =>
        updateMessageChoiceDraft(body, current, optionId)
      )
    }
  }

  function toggleMultiple(optionId: string) {
    if (disabled) return
    setDraftOptionIds((current) =>
      updateMessageChoiceDraft(body, current, optionId)
    )
  }

  async function submitResponse() {
    if (
      !onRespond ||
      answered ||
      submitting ||
      selectedOptionIds.length === 0
    ) {
      return
    }
    setSubmitting(true)
    try {
      await onRespond(selectedOptionIds)
    } catch (error: unknown) {
      toast.show(error instanceof Error ? error.message : "提交选择失败", {
        customData: { tone: "error" satisfies AppToastTone },
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <YStack gap="$3" width="100%">
      {body.contentType === "markdown" ? (
        <MarkdownMessage
          content={body.content}
          currentUserId={currentUserId}
          onMentionPress={onMentionPress}
          resolveMentionLabel={resolveMentionLabel}
          serverUrl={serverUrl}
        />
      ) : (
        <Paragraph selectable>
          <MessageMentionText
            content={body.content}
            currentUserId={currentUserId}
            onMentionPress={onMentionPress}
            resolveMentionLabel={resolveMentionLabel}
          />
        </Paragraph>
      )}

      {body.selection === "single" ? (
        <RadioGroup
          disabled={disabled}
          gap="$2"
          onValueChange={selectSingle}
          orientation="vertical"
          value={selectedOptionIds[0] ?? ""}
        >
          {body.options.map((option) => (
            <ChoiceOptionRow
              control={
                <RadioGroup.Item
                  accessible={false}
                  disabled={disabled}
                  pointerEvents="none"
                  size="$3"
                  value={option.id}
                >
                  <RadioGroup.Indicator />
                </RadioGroup.Item>
              }
              count={countsByOptionId.get(option.id) ?? 0}
              disabled={disabled}
              key={option.id}
              label={option.label}
              onPress={() => selectSingle(option.id)}
              selected={selectedOptionIds.includes(option.id)}
              showResponseCount={showResponseCounts}
              type="radio"
            />
          ))}
        </RadioGroup>
      ) : (
        <YStack gap="$2">
          {body.options.map((option) => (
            <ChoiceOptionRow
              control={
                <ChoiceCheckbox
                  checked={selectedOptionIds.includes(option.id)}
                  disabled={disabled}
                />
              }
              count={countsByOptionId.get(option.id) ?? 0}
              disabled={disabled}
              key={option.id}
              label={option.label}
              onPress={() => toggleMultiple(option.id)}
              selected={selectedOptionIds.includes(option.id)}
              showResponseCount={showResponseCounts}
              type="checkbox"
            />
          ))}
        </YStack>
      )}

      {!answered ? (
        <YStack gap="$3">
          <Separator borderColor="$borderColor" />
          <AppButton
            accessibilityLabel="提交选择"
            bg={hasSubmittableSelection ? "$color9" : "transparent"}
            borderColor={
              hasSubmittableSelection ? "$color9" : "$borderColor"
            }
            color={hasSubmittableSelection ? "$white" : "$color"}
            disabled={!hasSubmittableSelection || submitting}
            disabledStyle={{
              opacity: hasSubmittableSelection ? 0.72 : 0.45,
            }}
            onPress={() => void submitResponse()}
            pressStyle={
              hasSubmittableSelection
                ? { bg: "$color10", borderColor: "$color10" }
                : undefined
            }
            size="$3"
            theme={hasSubmittableSelection ? "teal" : "gray"}
            variant={hasSubmittableSelection ? undefined : "outlined"}
            width="100%"
          >
            {submitting ? "提交中…" : "提交"}
          </AppButton>
        </YStack>
      ) : null}
    </YStack>
  )
}

function ChoiceCheckbox({
  checked,
  disabled,
}: {
  checked: boolean
  disabled: boolean
}) {
  const theme = useTheme()
  return (
    <Checkbox
      accessible={false}
      checked={checked}
      disabled={disabled}
      pointerEvents="none"
      size="$3"
    >
      <Checkbox.Indicator>
        <Check color={String(theme.color.val)} size={14} strokeWidth={2.5} />
      </Checkbox.Indicator>
    </Checkbox>
  )
}

function ChoiceOptionRow({
  control,
  count,
  disabled,
  label,
  onPress,
  selected,
  showResponseCount,
  type,
}: {
  control: React.ReactNode
  count: number
  disabled: boolean
  label: string
  onPress: () => void
  selected: boolean
  showResponseCount: boolean
  type: "checkbox" | "radio"
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole={type}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.optionPressable}
    >
      {({ pressed }) => (
        <XStack
          bg={selected ? "$color3" : pressed ? "$backgroundPress" : "transparent"}
          borderColor={selected ? "$color8" : "$borderColor"}
          borderWidth={1}
          gap="$2"
          items="center"
          minH={44}
          opacity={disabled && !selected ? 0.65 : 1}
          px="$3"
          py="$2"
          rounded="$3"
          width="100%"
        >
          {control}
          <SizableText flex={1}>{label}</SizableText>
          {showResponseCount ? (
            <XStack bg="$backgroundPress" minW={24} px="$2" py={2} rounded="$10">
              <SizableText color="$color10" size="$1" text="center" width="100%">
                {count}
              </SizableText>
            </XStack>
          ) : null}
        </XStack>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  optionPressable: {
    alignSelf: "stretch",
  },
})
