import { QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { UsersRound, X } from "lucide-react-native"
import type { ComponentProps } from "react"
import { FlatList, type ScrollViewProps, StyleSheet } from "react-native"
import { Avatar, Button, ListItem, Sheet, SizableText, YStack } from "tamagui"

import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import { ThemedIcon } from "@/components/icons/themed-icon"
import type { ServerTarget } from "@/core/server-target"
import type { MentionCandidate } from "@/features/conversation/composer/mention-model"

export function MentionPickerSheet({
  candidates,
  onAnimationComplete,
  onOpenChange,
  onSelect,
  open,
  server,
}: {
  candidates: MentionCandidate[]
  onAnimationComplete: (open: boolean) => void
  onOpenChange: (open: boolean) => void
  onSelect: (candidate: MentionCandidate) => void
  open: boolean
  server: ServerTarget
}) {
  const queryClient = useQueryClient()

  return (
    <Sheet
      dismissOnSnapToBottom
      modal
      onAnimationComplete={({ open: animationOpen }) =>
        onAnimationComplete(animationOpen)
      }
      onOpenChange={onOpenChange}
      open={open}
      snapPoints={[50]}
      unmountChildrenWhenHidden
    >
      <Sheet.Overlay bg="$shadow6" opacity={0.45} />
      <Sheet.Handle bg="$color6" />
      <Sheet.Frame bg="$background" overflow="hidden">
        <QueryClientProvider client={queryClient}>
          <YStack flex={1} minH={0}>
            <YStack
              borderBottomColor="$borderColor"
              borderBottomWidth={1}
              items="center"
              justify="center"
              minH={48}
              px="$4"
            >
              <SizableText fontWeight="600" size="$4">
                选择提醒的人
              </SizableText>
              <Button
                accessibilityLabel="关闭选择提醒的人"
                chromeless
                circular
                icon={<ThemedIcon icon={X} size={18} />}
                onPress={() => onOpenChange(false)}
                position="absolute"
                r="$3"
                size="$3"
              />
            </YStack>

            <FlatList
              contentContainerStyle={styles.content}
              data={candidates}
              initialNumToRender={12}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(candidate) =>
                `${candidate.targetType}:${candidate.id}`
              }
              maxToRenderPerBatch={12}
              renderScrollComponent={renderSheetScrollComponent}
              renderItem={({ item: candidate }) => (
                <ListItem
                  bg="transparent"
                  icon={
                    <MentionCandidateAvatar
                      candidate={candidate}
                      server={server}
                    />
                  }
                  onPress={() => onSelect(candidate)}
                  pressStyle={{ background: "$backgroundPress" }}
                  rounded="$3"
                  size="$4"
                  subTitle={
                    <SizableText color="$gray9" numberOfLines={1} size="$2">
                      {candidate.description}
                    </SizableText>
                  }
                  title={
                    <SizableText fontWeight="500" numberOfLines={1} size="$4">
                      {candidate.label}
                    </SizableText>
                  }
                />
              )}
              style={styles.list}
              windowSize={7}
            />
          </YStack>
        </QueryClientProvider>
      </Sheet.Frame>
    </Sheet>
  )
}

function renderSheetScrollComponent(props: ScrollViewProps) {
  return (
    <Sheet.ScrollView
      {...(props as ComponentProps<typeof Sheet.ScrollView>)}
    />
  )
}

const styles = StyleSheet.create({
  content: {
    padding: 8,
    paddingBottom: 20,
  },
  list: {
    flex: 1,
  },
})

function MentionCandidateAvatar({
  candidate,
  server,
}: {
  candidate: MentionCandidate
  server: ServerTarget
}) {
  const isAll = candidate.targetType === "all"

  return (
    <Avatar rounded="$2" size="$3" theme={isAll ? "teal" : undefined}>
      {!isAll ? (
        <CachedAvatarImage avatar={candidate.avatar} server={server} />
      ) : null}
      <Avatar.Fallback
        bg={isAll ? "$color9" : "$backgroundFocus"}
        items="center"
        justify="center"
      >
        {isAll ? (
          <ThemedIcon icon={UsersRound} size={16} />
        ) : (
          <SizableText fontWeight="600" size="$2">
            {Array.from(candidate.label.trim())[0]?.toUpperCase() ?? "?"}
          </SizableText>
        )}
      </Avatar.Fallback>
    </Avatar>
  )
}
