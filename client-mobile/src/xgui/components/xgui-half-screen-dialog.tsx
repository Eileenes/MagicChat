import { X } from "lucide-react-native"
import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIHalfScreenDialogProps = {
  children: ReactNode
  closeButtonPosition?: "left" | "right"
  contentStyle?: StyleProp<ViewStyle>
  dismissible?: boolean
  footer?: ReactNode
  headerAction?: ReactNode
  headerLeading?: ReactNode
  onAnimationComplete?: (open: boolean) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  title: string
}

export function XGUIHalfScreenDialog({
  children,
  closeButtonPosition = "right",
  contentStyle,
  dismissible = true,
  footer,
  headerAction,
  headerLeading,
  onAnimationComplete,
  onOpenChange,
  open,
  title,
}: XGUIHalfScreenDialogProps) {
  const { colors } = useXGUITheme()
  const insets = useSafeAreaInsets()
  const [backdropOpacity] = useState(() => new Animated.Value(0))
  const [panelTranslateY] = useState(() => new Animated.Value(480))
  const animationCompleteRef = useRef(onAnimationComplete)
  const openedRef = useRef(false)

  useEffect(() => {
    animationCompleteRef.current = onAnimationComplete
  }, [onAnimationComplete])

  useEffect(() => {
    if (!open) {
      if (openedRef.current) animationCompleteRef.current?.(false)
      openedRef.current = false
      return
    }

    openedRef.current = true
    backdropOpacity.setValue(0)
    panelTranslateY.setValue(480)
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        duration: 300,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(panelTranslateY, {
        duration: 300,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) animationCompleteRef.current?.(true)
    })
  }, [backdropOpacity, open, panelTranslateY])

  function requestClose() {
    if (dismissible) onOpenChange(false)
  }

  return (
    <Modal
      animationType="none"
      onRequestClose={requestClose}
      statusBarTranslucent
      transparent
      visible={open}
    >
      <View style={styles.modal}>
        <Animated.View
          style={[styles.backdrop, { opacity: backdropOpacity }]}
        >
          <Pressable
            accessibilityLabel={`关闭${title}`}
            accessibilityRole="button"
            disabled={!dismissible}
            onPress={requestClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.panel,
            {
              backgroundColor: colors.background2,
              paddingBottom: Math.max(insets.bottom, 12),
              transform: [{ translateY: panelTranslateY }],
            },
          ]}
        >
          <View style={styles.header}>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[styles.title, { color: colors.textPrimary }]}
            >
              {title}
            </Text>
            {headerLeading ? (
              <View style={styles.headerLeading}>{headerLeading}</View>
            ) : (
              <Pressable
                accessibilityLabel={`关闭${title}`}
                accessibilityRole="button"
                disabled={!dismissible}
                hitSlop={8}
                onPress={requestClose}
                style={({ pressed }) => [
                  styles.closeButton,
                  closeButtonPosition === "left"
                    ? styles.closeButtonLeft
                    : styles.closeButtonRight,
                  pressed ? { opacity: 0.5 } : null,
                ]}
              >
                <X color={colors.textPrimary} size={24} strokeWidth={1.8} />
              </Pressable>
            )}
            {headerAction ? (
              <View style={styles.headerAction}>{headerAction}</View>
            ) : null}
          </View>
          <View style={[styles.content, contentStyle]}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.6)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  closeButton: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    position: "absolute",
    top: 8,
    width: 48,
  },
  closeButtonLeft: {
    left: 12,
  },
  closeButtonRight: {
    right: 12,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  header: {
    alignItems: "center",
    height: 64,
    justifyContent: "center",
    paddingHorizontal: 64,
  },
  headerAction: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    position: "absolute",
    right: 12,
    top: 8,
  },
  headerLeading: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    left: 12,
    position: "absolute",
    top: 8,
  },
  modal: {
    flex: 1,
    justifyContent: "flex-end",
  },
  panel: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    height: "75%",
    overflow: "hidden",
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 24,
    textAlign: "center",
  },
})
