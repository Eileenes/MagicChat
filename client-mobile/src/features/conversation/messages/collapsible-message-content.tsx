import { ChevronDown } from "lucide-react-native"
import { type ReactNode, useId, useState } from "react"
import { Pressable, StyleSheet, View } from "react-native"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"
import { SizableText, useTheme, XStack } from "tamagui"

const COLLAPSED_HEIGHTS = {
  markdown: 240,
  text: 192,
} as const

const EXPAND_LABEL_HEIGHT = 28
const FADE_HEIGHT = 52
const EXPAND_HIT_AREA_HEIGHT = EXPAND_LABEL_HEIGHT + FADE_HEIGHT

export function CollapsibleMessageContent({
  bubblePressed,
  children,
  tone,
  variant,
}: {
  bubblePressed: boolean
  children: ReactNode
  tone: "mine" | "other"
  variant: keyof typeof COLLAPSED_HEIGHTS
}) {
  const theme = useTheme()
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const [contentHeight, setContentHeight] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const maxHeight = COLLAPSED_HEIGHTS[variant]
  const canExpand = contentHeight > maxHeight + 1
  const collapsed = canExpand && !expanded
  const fadeColor = String(
    tone === "mine"
      ? bubblePressed
        ? theme.color5.val
        : theme.color4.val
      : bubblePressed
        ? theme.color2.val
        : theme.color1.val
  )
  const actionColor = String(theme.color10.val)

  return (
    <View
      style={[
        styles.container,
        collapsed ? styles.containerCollapsed : undefined,
      ]}
    >
      <View
        style={[styles.contentViewport, !expanded ? { maxHeight } : undefined]}
      >
        <View
          onLayout={(event) =>
            setContentHeight(event.nativeEvent.layout.height)
          }
          style={styles.content}
        >
          {children}
        </View>
      </View>

      {collapsed ? (
        <Pressable
          accessibilityLabel="展开全文"
          accessibilityRole="button"
          accessibilityState={{ expanded: false }}
          onPress={() => setExpanded(true)}
          style={styles.expandHitArea}
        >
          <Svg
            height={FADE_HEIGHT}
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
                <Stop offset="1" stopColor={fadeColor} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect
              fill={`url(#${gradientId})`}
              height={FADE_HEIGHT}
              width="100%"
              x={0}
              y={0}
            />
          </Svg>
          <XStack
            height={EXPAND_LABEL_HEIGHT}
            gap="$1"
            items="center"
            justify="center"
            pointerEvents="none"
            width="100%"
          >
            <ChevronDown color={actionColor} size={15} />
            <SizableText color="$color10" fontWeight="600" size="$2">
              展开全文
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
    paddingBottom: EXPAND_LABEL_HEIGHT,
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
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 1,
  },
  fade: {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
})
