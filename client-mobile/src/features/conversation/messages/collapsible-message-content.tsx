import { ChevronDown } from "lucide-react-native"
import { type ReactNode, useId, useState } from "react"
import { Pressable, StyleSheet, View } from "react-native"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"
import { SizableText, XStack } from "tamagui"

import {
  type CollapsibleMessageVariant,
  getCollapsibleMessageLayout,
} from "@/features/conversation/messages/collapsible-message-layout"
import { useXGUITheme } from "@/xgui"

const EXPAND_LABEL_HEIGHT = 24
const EXPAND_LABEL_BOTTOM_OFFSET = 8
const FADE_CONTENT_OVERLAP_HEIGHT = 56
const FADE_LAYER_HEIGHT =
  FADE_CONTENT_OVERLAP_HEIGHT +
  EXPAND_LABEL_HEIGHT +
  EXPAND_LABEL_BOTTOM_OFFSET
const BUBBLE_HORIZONTAL_PADDING = 12
const EXPAND_HIT_AREA_HEIGHT = FADE_LAYER_HEIGHT
const FADE_END_OFFSET = FADE_CONTENT_OVERLAP_HEIGHT / FADE_LAYER_HEIGHT

export function CollapsibleMessageContent({
  children,
  tone,
  variant,
}: {
  children: ReactNode
  tone: "mine" | "other"
  variant: CollapsibleMessageVariant
}) {
  const { colors } = useXGUITheme()
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const { collapsed, viewportHeight } = getCollapsibleMessageLayout({
    contentHeight,
    expanded,
    variant,
  })
  const viewportStyle =
    viewportHeight === null ? undefined : { height: viewportHeight }
  const fadeColor = tone === "mine" ? colors.brand1 : colors.background2
  const actionColor = colors.textPrimary

  return (
    <View
      style={[
        styles.container,
        collapsed ? styles.containerCollapsed : undefined,
      ]}
    >
      <View style={[styles.contentViewport, viewportStyle]}>
        <View
          onLayout={(event) => {
            const nextHeight = event.nativeEvent.layout.height
            setContentHeight((current) =>
              current === null || nextHeight > current ? nextHeight : current
            )
          }}
          style={styles.content}
        >
          {children}
        </View>
      </View>

      {collapsed ? (
        <Pressable
          accessibilityLabel="展开"
          accessibilityRole="button"
          accessibilityState={{ expanded: false }}
          hitSlop={8}
          onPress={() => setExpanded(true)}
          style={styles.expandHitArea}
        >
          <Svg
            height={FADE_LAYER_HEIGHT}
            pointerEvents="none"
            style={styles.fade}
            width="100%"
          >
            <Defs>
              <LinearGradient
                id={gradientId}
                x1="0%"
                x2="0%"
                y1="0%"
                y2="100%"
              >
                <Stop offset="0" stopColor={fadeColor} stopOpacity={0} />
                <Stop
                  offset={FADE_END_OFFSET}
                  stopColor={fadeColor}
                  stopOpacity={1}
                />
                <Stop offset="100%" stopColor={fadeColor} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect
              fill={`url(#${gradientId})`}
              height={FADE_LAYER_HEIGHT}
              width="100%"
              x={0}
              y={0}
            />
          </Svg>
          <XStack
            b={EXPAND_LABEL_BOTTOM_OFFSET}
            height={EXPAND_LABEL_HEIGHT}
            gap="$1"
            items="center"
            justify="center"
            pointerEvents="none"
            position="absolute"
            width="100%"
          >
            <ChevronDown color={actionColor} size={14} />
            <SizableText
              color={colors.textPrimary}
              lineHeight={18}
              size="$3"
            >
              展开
            </SizableText>
          </XStack>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    maxWidth: "100%",
    minWidth: 0,
    position: "relative",
  },
  containerCollapsed: {
    marginBottom: -8,
  },
  content: {
    maxWidth: "100%",
    minWidth: 0,
  },
  contentViewport: {
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
  },
  expandHitArea: {
    alignItems: "center",
    bottom: 0,
    height: EXPAND_HIT_AREA_HEIGHT,
    justifyContent: "flex-end",
    left: -BUBBLE_HORIZONTAL_PADDING,
    position: "absolute",
    right: -BUBBLE_HORIZONTAL_PADDING,
    zIndex: 1,
  },
  fade: {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
})
