import * as Haptics from "expo-haptics"
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native"

import { CONTACT_INDEX_LABELS } from "@/features/contacts/contact-directory-model"
import { useXGUITheme } from "@/xgui"

export type ContactAlphabetIndexHandle = {
  setActiveLabel: (label: string) => void
}

export const ContactAlphabetIndex = forwardRef<
  ContactAlphabetIndexHandle,
  {
  activeLabel: string | null
  onDragStateChange: (dragging: boolean) => void
  onSelect: (label: string) => void
  }
>(function ContactAlphabetIndex(
  { activeLabel, onDragStateChange, onSelect },
  ref
) {
  const { colors } = useXGUITheme()
  const [displayedLabel, setDisplayedLabel] = useState(activeLabel)
  const containerHeightRef = useRef(0)
  const railHeightRef = useRef(0)
  const lastSelectedLabelRef = useRef<string | null>(null)
  const lastHapticAtRef = useRef(0)
  const pendingLabelRef = useRef<string | null>(null)

  useImperativeHandle(
    ref,
    () => ({ setActiveLabel: setDisplayedLabel }),
    []
  )

  const selectAtLocation = useCallback(
    (locationY: number) => {
      if (railHeightRef.current <= 0) return

      const railTop = Math.max(
        0,
        (containerHeightRef.current - railHeightRef.current) / 2
      )
      const railLocationY = locationY - railTop
      const index = Math.max(
        0,
        Math.min(
          CONTACT_INDEX_LABELS.length - 1,
          Math.floor(
            (railLocationY / railHeightRef.current) *
              CONTACT_INDEX_LABELS.length
          )
        )
      )
      const label = CONTACT_INDEX_LABELS[index]
      if (!label || label === lastSelectedLabelRef.current) return

      lastSelectedLabelRef.current = label
      setDisplayedLabel(label)
      pendingLabelRef.current = label
      const now = Date.now()
      if (now - lastHapticAtRef.current >= 40) {
        lastHapticAtRef.current = now
        void Haptics.selectionAsync().catch(() => undefined)
      }
    },
    []
  )
  const handleResponderGrant = useCallback(
    (event: GestureResponderEvent) => {
      lastSelectedLabelRef.current = null
      pendingLabelRef.current = null
      onDragStateChange(true)
      selectAtLocation(event.nativeEvent.locationY)
    },
    [onDragStateChange, selectAtLocation]
  )
  const handleResponderMove = useCallback(
    (event: GestureResponderEvent) => {
      selectAtLocation(event.nativeEvent.locationY)
    },
    [selectAtLocation]
  )
  const handleResponderEnd = useCallback(() => {
    const pendingLabel = pendingLabelRef.current
    if (pendingLabel) onSelect(pendingLabel)
    onDragStateChange(false)
  }, [onDragStateChange, onSelect])

  function handleLayout(event: LayoutChangeEvent) {
    const height = event.nativeEvent.layout.height
    railHeightRef.current = height
  }

  return (
    <View
      accessibilityLabel="联系人字母索引"
      accessibilityRole="adjustable"
      onLayout={(event) => {
        containerHeightRef.current = event.nativeEvent.layout.height
      }}
      onResponderGrant={handleResponderGrant}
      onResponderMove={handleResponderMove}
      onResponderRelease={handleResponderEnd}
      onResponderTerminate={handleResponderEnd}
      onResponderTerminationRequest={() => false}
      onStartShouldSetResponder={() => true}
      style={styles.container}
    >
      <View
        onLayout={handleLayout}
        pointerEvents="none"
        style={styles.rail}
      >
        {CONTACT_INDEX_LABELS.map((label) => {
          const active = label === displayedLabel

          return (
            <View key={label} pointerEvents="none" style={styles.item}>
              {active ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.activeIndicator,
                    { backgroundColor: colors.brand },
                  ]}
                />
              ) : null}
              <Text
                style={[
                  styles.label,
                  {
                    color: active
                      ? colors.background2
                      : colors.textSecondary,
                  },
                ]}
              >
                {label}
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  activeIndicator: {
    borderRadius: 8,
    height: 16,
    left: 0,
    position: "absolute",
    top: 0,
    width: 16,
  },
  container: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    position: "absolute",
    right: 0,
    top: 0,
    width: 32,
    zIndex: 2,
  },
  item: {
    alignItems: "center",
    height: 16,
    justifyContent: "center",
    width: 16,
  },
  label: {
    fontSize: 10,
    lineHeight: 12,
    textAlign: "center",
  },
  rail: {
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    width: 28,
  },
})
