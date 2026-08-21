import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useState,
} from "react"
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  calculateXGUIPopoverLayout,
  type XGUIPopoverLayout,
  type XGUIPopoverPlacement,
} from "@/xgui/components/xgui-popover-menu-model"
import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIPopoverAnchor = {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void
}

export type XGUIPopoverMenuItem = {
  accessibilityLabel?: string
  destructive?: boolean
  disabled?: boolean
  icon?: (props: { color: string; size: number; strokeWidth: number }) => ReactNode
  label: string
  onPress: () => void
}

export type XGUIPopoverMenuProps = {
  anchorRef: RefObject<XGUIPopoverAnchor | null>
  backgroundColor?: string
  foregroundColor?: string
  items: readonly XGUIPopoverMenuItem[]
  onOpenChange: (open: boolean) => void
  open: boolean
  placement?: XGUIPopoverPlacement
  width?: number
}

const ANIMATION_DURATION = 150
const ARROW_HEIGHT = 8
const ARROW_WIDTH = 10
const ITEM_HEIGHT = 48

export function XGUIPopoverMenu({
  anchorRef,
  backgroundColor,
  foregroundColor,
  items,
  onOpenChange,
  open,
  placement = "bottom-end",
  width = 220,
}: XGUIPopoverMenuProps) {
  const { colors } = useXGUITheme()
  const menuBackground = backgroundColor ?? colors.background4
  const menuForeground = foregroundColor ?? colors.textOnColor
  const insets = useSafeAreaInsets()
  const [mounted, setMounted] = useState(open)
  const [layout, setLayout] = useState<XGUIPopoverLayout | null>(null)
  const [progress] = useState(() => new Animated.Value(0))

  const measure = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) {
      onOpenChange(false)
      return
    }
    anchor.measureInWindow((x, y, anchorWidth, anchorHeight) => {
      if (anchorWidth <= 0 || anchorHeight <= 0) {
        onOpenChange(false)
        return
      }
      const window = Dimensions.get("window")
      setLayout(
        calculateXGUIPopoverLayout({
          anchor: { height: anchorHeight, width: anchorWidth, x, y },
          insets,
          menuHeight: items.length * ITEM_HEIGHT,
          menuWidth: width,
          placement,
          windowHeight: window.height,
          windowWidth: window.width,
        })
      )
    })
  }, [anchorRef, insets, items.length, onOpenChange, placement, width])

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => {
        setMounted(true)
        measure()
      })
      return () => cancelAnimationFrame(frame)
    }
    if (!mounted) return
    Animated.timing(progress, {
      duration: ANIMATION_DURATION,
      toValue: 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false)
        setLayout(null)
      }
    })
  }, [measure, mounted, open, progress])

  useEffect(() => {
    if (!open || !layout) return
    progress.setValue(0)
    Animated.timing(progress, {
      duration: ANIMATION_DURATION,
      toValue: 1,
      useNativeDriver: true,
    }).start()
  }, [layout, open, progress])

  useEffect(() => {
    if (!open) return
    const subscription = Dimensions.addEventListener("change", measure)
    return () => subscription.remove()
  }, [measure, open])

  const close = () => onOpenChange(false)
  const pressItem = (item: XGUIPopoverMenuItem) => {
    if (item.disabled) return
    close()
    setTimeout(item.onPress, ANIMATION_DURATION)
  }

  if (!mounted) return null

  const isBottom = layout?.placement.startsWith("bottom")
  return (
    <Modal
      animationType="none"
      onRequestClose={close}
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      <View accessibilityViewIsModal style={styles.fill}>
        <Pressable accessibilityRole="button" onPress={close} style={styles.fill} />
        {layout ? (
          <Animated.View
            style={[
              styles.positioned,
              {
                left: layout.menuX,
                opacity: progress,
                paddingBottom: isBottom ? 0 : ARROW_HEIGHT,
                paddingTop: isBottom ? ARROW_HEIGHT : 0,
                top: layout.menuY - (isBottom ? ARROW_HEIGHT : 0),
                width,
              },
            ]}
          >
            <View
              pointerEvents="none"
              style={[
                styles.arrow,
                {
                  borderBottomColor: isBottom
                    ? menuBackground
                    : "transparent",
                  borderBottomWidth: isBottom ? ARROW_HEIGHT : 0,
                  borderTopColor: isBottom
                    ? "transparent"
                    : menuBackground,
                  borderTopWidth: isBottom ? 0 : ARROW_HEIGHT,
                  left: layout.arrowX,
                  [isBottom ? "top" : "bottom"]: 0,
                },
              ]}
            />
            <View
              accessibilityRole="menu"
              style={[styles.menu, { backgroundColor: menuBackground }]}
            >
              {items.map((item, index) => {
                const color = item.destructive ? colors.destructive : menuForeground
                return (
                  <Pressable
                    accessibilityLabel={item.accessibilityLabel ?? item.label}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: item.disabled }}
                    disabled={item.disabled}
                    key={`${item.label}-${index}`}
                    onPress={() => pressItem(item)}
                    style={({ pressed }) => [
                      styles.item,
                      item.disabled && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    {item.icon?.({ color, size: 24, strokeWidth: 2 })}
                    <Text numberOfLines={1} style={[styles.label, { color }]}>
                      {item.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  arrow: {
    borderLeftColor: "transparent",
    borderLeftWidth: ARROW_WIDTH / 2,
    borderRightColor: "transparent",
    borderRightWidth: ARROW_WIDTH / 2,
    height: 0,
    position: "absolute",
    width: 0,
    zIndex: 1,
  },
  disabled: { opacity: 0.4 },
  fill: StyleSheet.absoluteFill,
  item: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    height: ITEM_HEIGHT,
    paddingHorizontal: 16,
  },
  label: { flex: 1, fontSize: 18, lineHeight: 24 },
  menu: {
    borderRadius: 4,
    elevation: 8,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 8,
  },
  positioned: { position: "absolute" },
  pressed: { backgroundColor: "rgba(255,255,255,0.12)" },
})
