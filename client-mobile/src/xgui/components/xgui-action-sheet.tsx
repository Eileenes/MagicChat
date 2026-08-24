import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Sheet } from "tamagui"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIActionSheetAction = {
  accessibilityLabel?: string
  closeOnPress?: boolean
  destructive?: boolean
  disabled?: boolean
  deferUntilClosed?: boolean
  label: string
  onBeforePress?: () => void
  onPress: () => void
}

export type XGUIActionSheetProps = {
  actions: readonly XGUIActionSheetAction[]
  cancelDisabled?: boolean
  cancelDestructive?: boolean
  cancelLabel?: string
  children?: ReactNode
  description?: string
  descriptionNumberOfLines?: number
  maxContentHeight?: number
  onAnimationComplete?: (open: boolean) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  title?: string
  titleNumberOfLines?: number
}

export function XGUIActionSheet({
  actions,
  cancelDisabled = false,
  cancelDestructive = false,
  cancelLabel = "取消",
  children,
  description,
  descriptionNumberOfLines,
  maxContentHeight,
  onAnimationComplete,
  onOpenChange,
  open,
  title,
  titleNumberOfLines,
}: XGUIActionSheetProps) {
  const insets = useSafeAreaInsets()
  const { colors } = useXGUITheme()
  const pendingActionRef = useRef<(() => void) | null>(null)
  const keyboardVisible = useSyncExternalStore(
    subscribeToKeyboardVisibility,
    () => Keyboard.isVisible(),
    () => false
  )
  const presentationOpen = open && !keyboardVisible

  useEffect(() => {
    if (open && keyboardVisible) Keyboard.dismiss()
  }, [keyboardVisible, open])

  useEffect(() => {
    if (!open) return

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!cancelDisabled) onOpenChange(false)
        return true
      }
    )
    return () => subscription.remove()
  }, [cancelDisabled, onOpenChange, open])

  return (
    <Sheet
      dismissOnOverlayPress={!cancelDisabled}
      dismissOnSnapToBottom={!cancelDisabled}
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
      open={presentationOpen}
      snapPointsMode="fit"
    >
      <Sheet.Overlay backgroundColor="rgba(0,0,0,0.5)" />
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
          {children}
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            style={
              maxContentHeight
                ? {
                    maxHeight: Math.max(
                      0,
                      maxContentHeight - (title || description ? 56 : 0)
                    ),
                  }
                : undefined
            }
          >
          {actions.map((action, index) => (
            <Pressable
              accessibilityLabel={action.accessibilityLabel ?? action.label}
              accessibilityRole="button"
              accessibilityState={{ disabled: action.disabled }}
              disabled={action.disabled}
              key={`${action.label}-${index}`}
              onPress={() => {
                action.onBeforePress?.()
                if (action.closeOnPress === false) {
                  action.onPress()
                  return
                }
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
          </ScrollView>
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
            accessibilityState={{ disabled: cancelDisabled }}
            disabled={cancelDisabled}
            onPress={() => onOpenChange(false)}
            style={({ pressed }) => [
              styles.action,
              {
                backgroundColor: pressed
                  ? colors.background1
                  : colors.background2,
                opacity: cancelDisabled ? 0.4 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.actionText,
                {
                  color: cancelDestructive
                    ? colors.destructive
                    : colors.textPrimary,
                },
              ]}
            >
              {cancelLabel}
            </Text>
          </Pressable>
        </View>
      </Sheet.Frame>
    </Sheet>
  )
}

function subscribeToKeyboardVisibility(onChange: () => void) {
  const showSubscription = Keyboard.addListener("keyboardDidShow", onChange)
  const hideSubscription = Keyboard.addListener("keyboardDidHide", onChange)
  return () => {
    showSubscription.remove()
    hideSubscription.remove()
  }
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
