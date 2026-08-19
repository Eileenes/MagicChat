import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIBadgeProps = {
  accessibilityLabel?: string
  count: number
  style?: StyleProp<ViewStyle>
}

export function XGUIBadge({
  accessibilityLabel,
  count,
  style,
}: XGUIBadgeProps) {
  const { colors } = useXGUITheme()

  if (count <= 0) return null

  return (
    <View
      accessibilityElementsHidden={!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessible={Boolean(accessibilityLabel)}
      importantForAccessibility={
        accessibilityLabel ? "auto" : "no-hide-descendants"
      }
      style={[styles.badge, { backgroundColor: colors.destructive }, style]}
    >
      <Text style={styles.text}>{count > 99 ? "99+" : count}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    borderRadius: 18,
    justifyContent: "center",
    minHeight: 18,
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  text: {
    color: "#FFFFFF",
    fontSize: 12,
    lineHeight: 14,
    textAlign: "center",
  },
})
