import type { Icon as TablerIcon } from "@tabler/icons-react-native"
import { BlurView } from "expo-blur"
import type { ReactNode, RefObject } from "react"
import { Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { XGUIBadge } from "@/xgui/components/xgui-badge"
import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

type XGUITabbarIcon = TablerIcon

export const XGUI_TABBAR_CONTENT_HEIGHT = 59

export type XGUITabbarProps = {
  blurTarget?: RefObject<View | null>
  children: ReactNode
}

export type XGUITabbarItemProps = {
  active?: boolean
  activeIcon: XGUITabbarIcon
  accessibilityLabel?: string
  icon: XGUITabbarIcon
  label: string
  onPress: () => void
  unreadCount?: number
}

export function XGUITabbar({ blurTarget, children }: XGUITabbarProps) {
  const insets = useSafeAreaInsets()
  const { colorScheme, colors } = useXGUITheme()

  return (
    <View
      style={[
        styles.tabbar,
        {
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {Platform.OS === "android" && blurTarget ? (
        <BlurView
          blurMethod="dimezisBlurView"
          blurReductionFactor={3}
          blurTarget={blurTarget}
          intensity={95}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          tint={colorScheme}
        />
      ) : Platform.OS === "ios" ? (
        <BlurView
          intensity={95}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          tint={colorScheme}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: withOpacity(colors.background1, 0.85) },
        ]}
      />
      {children}
    </View>
  )
}

export function XGUITabbarItem({
  active = false,
  activeIcon: ActiveIcon,
  accessibilityLabel,
  icon: Icon,
  label,
  onPress,
  unreadCount = 0,
}: XGUITabbarItemProps) {
  const { colors } = useXGUITheme()
  const color = active ? colors.brand : colors.textPrimary
  const LabelIcon = active ? ActiveIcon : Icon
  const resolvedAccessibilityLabel =
    unreadCount > 0
      ? `${accessibilityLabel ?? label}，${unreadCount} 条未读消息`
      : accessibilityLabel ?? label

  return (
    <Pressable
      accessibilityLabel={resolvedAccessibilityLabel}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.item,
        pressed && styles.itemPressed,
      ]}
    >
      <View style={styles.icon}>
        <LabelIcon color={color} size={26} strokeWidth={1} />
        <XGUIBadge count={unreadCount} style={styles.badge} />
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          { color: active ? colors.brand : colors.textPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function withOpacity(hexColor: string, opacity: number) {
  const red = Number.parseInt(hexColor.slice(1, 3), 16)
  const green = Number.parseInt(hexColor.slice(3, 5), 16)
  const blue = Number.parseInt(hexColor.slice(5, 7), 16)
  return `rgba(${red},${green},${blue},${opacity})`
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    right: -8,
    top: -1,
  },
  icon: {
    alignItems: "center",
    height: 30,
    justifyContent: "center",
    marginBottom: 0,
    width: 30,
  },
  item: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingBottom: 6,
    paddingTop: 6,
  },
  itemPressed: {
    opacity: 0.6,
  },
  label: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  tabbar: {
    bottom: 0,
    flexDirection: "row",
    left: 0,
    minHeight: XGUI_TABBAR_CONTENT_HEIGHT,
    position: "absolute",
    right: 0,
    zIndex: 500,
  },
})
