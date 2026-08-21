import {
  useCallback,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactElement,
} from "react"
import {
  Pressable,
  FlatList,
  PixelRatio,
  Platform,
  StyleSheet,
  View,
  type ViewToken,
} from "react-native"

import { ContentState } from "@/components/feedback/content-state"
import { InlineError } from "@/components/feedback/inline-error"
import { ListItemContent } from "@/components/lists/list-item-content"
import { ElasticOverscroll } from "@/components/layout/elastic-overscroll"
import type { ServerTarget } from "@/core/server-target"
import { getContactDisplayName } from "@/domain/contacts/contact-display"
import {
  ContactAlphabetIndex,
  type ContactAlphabetIndexHandle,
} from "@/features/contacts/contact-alphabet-index"
import { ContactDirectoryAvatar } from "@/features/contacts/contact-directory-avatar"
import {
  CONTACT_INDEX_LABELS,
  type DirectoryItem,
  type DirectorySection,
} from "@/features/contacts/contact-directory-model"
import { XGUIListCountFooter, useXGUITheme } from "@/xgui"

const CONTACT_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 10 }
const DIRECTORY_ROW_HEIGHT = PixelRatio.roundToNearestPixel(64)

type DirectoryListRow = {
  item: DirectoryItem
  sectionTitle: string | null
}

export function ContactDirectoryList({
  alphabetIndex = false,
  emptyLabel,
  emptyMessageColor,
  errorMessage,
  footerNoun,
  listHeader,
  onItemPress,
  sections,
  server,
}: {
  alphabetIndex?: boolean
  emptyLabel: string
  emptyMessageColor?: ComponentProps<typeof ContentState>["messageColor"]
  errorMessage?: string
  footerNoun: string
  listHeader?: ReactElement
  onItemPress: (item: DirectoryItem) => void
  sections: DirectorySection[]
  server: ServerTarget
}) {
  const { colors } = useXGUITheme()
  const listRef = useRef<FlatList<DirectoryListRow>>(null)
  const alphabetIndexRef = useRef<ContactAlphabetIndexHandle>(null)
  const indexDraggingRef = useRef(false)
  const listHeaderHeightRef = useRef(0)
  const pendingItemIndexRef = useRef<number | null>(null)
  const rows = useMemo(
    () =>
      sections.flatMap((section) =>
        section.data.map((item) => ({
          item,
          sectionTitle: section.title ?? null,
        }))
      ),
    [sections]
  )
  const indexedSections = useMemo(
    () =>
      sections.reduce<{ itemIndex: number; label: string }[]>(
        (indexed, section) => [
          ...indexed,
          {
            itemIndex:
              (indexed.at(-1)?.itemIndex ?? 0) +
              (sections[indexed.length - 1]?.data.length ?? 0),
            label: section.title ?? "#",
          },
        ],
        []
      ),
    [sections]
  )
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<DirectoryListRow>[] }) => {
      if (indexDraggingRef.current) return

      const firstVisibleLabel = viewableItems.find(
        (token) => token.isViewable && token.item?.sectionTitle
      )?.item?.sectionTitle
      if (firstVisibleLabel) {
        alphabetIndexRef.current?.setActiveLabel(firstVisibleLabel)
      }
    },
    []
  )

  const scrollToItem = useCallback((itemIndex: number) => {
    pendingItemIndexRef.current = itemIndex
    listRef.current?.scrollToIndex({
      animated: false,
      index: itemIndex,
      viewPosition: 0,
    })
  }, [])

  const handleIndexSelect = useCallback(
    (label: string) => {
      const requestedLabelIndex = CONTACT_INDEX_LABELS.indexOf(
        label as (typeof CONTACT_INDEX_LABELS)[number]
      )
      const target =
        indexedSections.find(
          (section) =>
            CONTACT_INDEX_LABELS.indexOf(
              section.label as (typeof CONTACT_INDEX_LABELS)[number]
            ) >= requestedLabelIndex
        ) ?? indexedSections[indexedSections.length - 1]

      if (target) scrollToItem(target.itemIndex)
    },
    [indexedSections, scrollToItem]
  )

  const handleScrollToIndexFailed = useCallback(
    ({ averageItemLength, index }: { averageItemLength: number; index: number }) => {
      listRef.current?.scrollToOffset({
        animated: false,
        offset: listHeaderHeightRef.current + averageItemLength * index,
      })
      const pendingItemIndex = pendingItemIndexRef.current
      if (pendingItemIndex !== null) {
        requestAnimationFrame(() => scrollToItem(pendingItemIndex))
      }
    },
    [scrollToItem]
  )

  return (
    <View style={styles.listContainer}>
      <ElasticOverscroll>
        {(elasticBindings) => <FlatList<DirectoryListRow>
        {...elasticBindings}
        alwaysBounceVertical
        bounces
        overScrollMode={Platform.OS === "android" ? "never" : "always"}
        ref={listRef}
        contentContainerStyle={
          rows.length === 0 && !listHeader
            ? [styles.content, styles.emptyContent]
            : styles.content
        }
        data={rows}
        getItemLayout={(_data, index) => ({
          index,
          length: styles.row.height,
          offset: listHeaderHeightRef.current + styles.row.height * index,
        })}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(row) => row.item.key}
        ListEmptyComponent={
          <ContentState
            message={`没有匹配的${emptyLabel}`}
            messageColor={emptyMessageColor}
          />
        }
        ListFooterComponent={
          rows.length > 0 ? (
            <XGUIListCountFooter count={rows.length} noun={footerNoun} />
          ) : null
        }
        ListHeaderComponent={
          <View
            onLayout={(event) => {
              listHeaderHeightRef.current = event.nativeEvent.layout.height
            }}
          >
            {listHeader}
            <InlineError message={errorMessage} />
          </View>
        }
        maxToRenderPerBatch={32}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        onViewableItemsChanged={handleViewableItemsChanged}
        removeClippedSubviews={false}
        renderItem={({ item: row }) => (
          <DirectoryListItem
            alphabetIndex={alphabetIndex}
            item={row.item}
            last={false}
            onPress={() => onItemPress(row.item)}
            server={server}
          />
        )}
        showsVerticalScrollIndicator={false}
        style={[styles.list, { backgroundColor: colors.background0 }]}
        updateCellsBatchingPeriod={16}
        viewabilityConfig={CONTACT_VIEWABILITY_CONFIG}
        windowSize={51}
      />}
      </ElasticOverscroll>
      {alphabetIndex && indexedSections.length > 0 ? (
        <ContactAlphabetIndex
          ref={alphabetIndexRef}
          activeLabel={indexedSections[0]?.label ?? null}
          onDragStateChange={(dragging) => {
            indexDraggingRef.current = dragging
          }}
          onSelect={handleIndexSelect}
        />
      ) : null}
    </View>
  )
}

function DirectoryListItem({
  alphabetIndex,
  item,
  last,
  onPress,
  server,
}: {
  alphabetIndex: boolean
  item: DirectoryItem
  last: boolean
  onPress: () => void
  server: ServerTarget
}) {
  const { colors } = useXGUITheme()
  let avatar: ReactElement
  let accessibilityLabel: string
  let subtitle: string
  let title: string

  if (item.type === "user") {
    const displayName = getContactDisplayName(item.value)
    accessibilityLabel = `查看联系人 ${displayName}`
    title = displayName
    subtitle = item.value.email
    avatar = (
      <ContactDirectoryAvatar
        avatar={item.value.avatar}
        name={displayName}
        online={item.value.online}
        server={server}
        type="user"
      />
    )
  } else if (item.type === "app") {
    accessibilityLabel = `查看应用 ${item.value.name}`
    title = item.value.name
    subtitle = item.value.description || "智能应用"
    avatar = (
      <ContactDirectoryAvatar
        avatar={item.value.avatar}
        name={item.value.name}
        online={item.value.online}
        server={server}
        type="app"
      />
    )
  } else {
    accessibilityLabel = `查看群组 ${item.value.name}`
    title = item.value.name
    subtitle = `${item.value.memberCount} 人 · ${
      item.value.joined ? "已加入" : "公开群组"
    }`
    avatar = (
      <ContactDirectoryAvatar
        avatar={item.value.avatar}
        members={item.value.avatarMembers}
        name={item.value.name}
        server={server}
        type="group"
      />
    )
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        alphabetIndex && styles.indexedRow,
        {
          backgroundColor: pressed ? colors.background1 : colors.background2,
        },
      ]}
    >
      <View style={styles.avatar}>{avatar}</View>
      <View style={styles.rowContent}>
        <ListItemContent subtitle={subtitle} title={title} />
      </View>
      {!last ? (
        <View
          pointerEvents="none"
          style={[styles.separator, { backgroundColor: colors.separator }]}
        />
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    marginRight: 10,
    width: 44,
  },
  content: {
    flexGrow: 1,
  },
  emptyContent: {
    justifyContent: "center",
  },
  list: {
    flex: 1,
  },
  listContainer: {
    flex: 1,
    position: "relative",
  },
  indexedRow: {
    paddingRight: 36,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    height: DIRECTORY_ROW_HEIGHT,
    paddingHorizontal: 16,
    position: "relative",
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  separator: {
    bottom: StyleSheet.hairlineWidth,
    height: StyleSheet.hairlineWidth,
    left: 68,
    position: "absolute",
    right: 16,
  },
})
