import { useEffect, useRef } from "react"
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Sheet } from "tamagui"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIActionSheetAction = {
  accessibilityLabel?: string
  destructive?: boolean
  disabled?: boolean
  deferUntilClosed?: boolean
  label: string
  onBeforePress?: () => void
  onPress: () => void
}

export type XGUIActionSheetProps = {
  actions: readonly XGUIActionSheetAction[]
  cancelLabel?: string
  description?: string
  descriptionNumberOfLines?: number
  onAnimationComplete?: (open: boolean) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  title?: string
  titleNumberOfLines?: number
}

export function XGUIActionSheet({
  actions,
  cancelLabel = "取消",
  description,
  descriptionNumberOfLines,
  onAnimationComplete,
  onOpenChange,
  open,
  title,
  titleNumberOfLines,
}: XGUIActionSheetProps) {
  const insets = useSafeAreaInsets()
  const { colors } = useXGUITheme()
  const pendingActionRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!open) return

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        onOpenChange(false)
        return true
      }
    )
    return () => subscription.remove()
  }, [onOpenChange, open])

  return (
    <Sheet
      dismissOnOverlayPress
      dismissOnSnapToBottom
      modal
      onAnimationComplete={({ open: animationOpen }) => {
        onAnimationComplete?.(animationOpen)
        if (!animationOpen && pendingActionRef.current) {
          const pendingAction = pendingActionRef.current
          pendingActionRef.current = null
          pendingAction()
        }
      }}
      onOpenChange={onOpenChange}
      open={open}
      snapPointsMode="fit"
    >
      <Sheet.Overlay bg="$shadow6" opacity={0.5} />
      <Sheet.Frame bg={colors.background0} overflow="hidden">
        <View style={{ backgroundColor: colors.background2 }}>
          {title || description ? (
            <View style={styles.header}>
              {title ? (
                <Text
                  ellipsizeMode="tail"
                  numberOfLines={titleNumberOfLines}
                  style={[styles.title, { color: colors.textSecondary }]}
                >
                  {title}
                </Text>
              ) : null}
              {description ? (
                <Text
                  ellipsizeMode="tail"
                  numberOfLines={descriptionNumberOfLines}
                  style={[styles.description, { color: colors.textSecondary }]}
                >
                  {description}
                </Text>
              ) : null}
            </View>
          ) : null}
          {actions.map((action, index) => (
            <Pressable
              accessibilityLabel={action.accessibilityLabel ?? action.label}
              accessibilityRole="button"
              accessibilityState={{ disabled: action.disabled }}
              disabled={action.disabled}
              key={`${action.label}-${index}`}
              onPress={() => {
                action.onBeforePress?.()
                if (action.deferUntilClosed) {
                  pendingActionRef.current = action.onPress
                }
                onOpenChange(false)
                if (!action.deferUntilClosed) {
                  setTimeout(action.onPress, 0)
                }
              }}
              style={({ pressed }) => [
                styles.action,
                index > 0 || title || description
                  ? {
                      borderTopColor: colors.separator,
                      borderTopWidth: StyleSheet.hairlineWidth,
                    }
                  : null,
                {
                  backgroundColor: pressed
                    ? colors.background1
                    : colors.background2,
                  opacity: action.disabled ? 0.4 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.actionText,
                  {
                    color: action.destructive
                      ? colors.destructive
                      : colors.textPrimary,
                  },
                ]}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.menuGap} />

        <View
          style={{
            backgroundColor: colors.background2,
            paddingBottom: insets.bottom,
          }}
        >
          <Pressable
            accessibilityLabel={cancelLabel}
            accessibilityRole="button"
            onPress={() => onOpenChange(false)}
            style={({ pressed }) => [
              styles.action,
              {
                backgroundColor: pressed
                  ? colors.background1
                  : colors.background2,
              },
            ]}
          >
            <Text style={[styles.actionText, { color: colors.textPrimary }]}>
              {cancelLabel}
            </Text>
          </Pressable>
        </View>
      </Sheet.Frame>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: 16,
  },
  actionText: {
    fontSize: 17,
    lineHeight: 24,
    textAlign: "center",
  },
  description: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    textAlign: "center",
  },
  header: {
    alignItems: "center",
    minHeight: 56,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  menuGap: {
    height: 8,
  },
  title: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
})
