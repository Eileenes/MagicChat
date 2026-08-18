import { createContext, type ReactNode, useContext } from "react"
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewProps,
} from "react-native"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIListVariant = "default" | "form-radio"

export type XGUIListProps = {
  children: ReactNode
  title?: string
  variant?: XGUIListVariant
}

export type XGUIListItemProps = {
  accessibilityLabel?: string
  description?: string
  disabled?: boolean
  link?: boolean
  onLongPress?: () => void
  onPress?: () => void
  onPressIn?: () => void
  radio?: boolean
  separator?: boolean
  title: string
  value?: string
}

const XGUIListVariantContext = createContext<XGUIListVariant>("default")

export function XGUIList({
  children,
  title,
  variant = "default",
}: XGUIListProps) {
  const { colors } = useXGUITheme()
  const formRadio = variant === "form-radio"

  return (
    <View>
      {title ? (
        <Text style={[styles.listTitle, { color: colors.textSecondary }]}>
          {title}
        </Text>
      ) : null}
      <XGUIListVariantContext.Provider value={variant}>
        <View
          style={[
            styles.list,
            !title && styles.listWithoutTitle,
            formRadio && styles.formRadioList,
            {
              backgroundColor: colors.background2,
            },
          ]}
        >
          {!formRadio ? (
            <View
              pointerEvents="none"
              style={[
                styles.outerSeparator,
                styles.topSeparator,
                { backgroundColor: colors.separator },
              ]}
            />
          ) : null}
          {children}
          {!formRadio ? (
            <View
              pointerEvents="none"
              style={[
                styles.outerSeparator,
                styles.bottomSeparator,
                { backgroundColor: colors.separator },
              ]}
            />
          ) : null}
        </View>
      </XGUIListVariantContext.Provider>
    </View>
  )
}

export function XGUIListItem({
  accessibilityLabel,
  description,
  disabled = false,
  link = false,
  onLongPress,
  onPress,
  onPressIn,
  radio = false,
  separator = false,
  title,
  value,
}: XGUIListItemProps) {
  const { colors } = useXGUITheme()
  const formRadio = useContext(XGUIListVariantContext) === "form-radio"
  const accessibilityRole: ViewProps["accessibilityRole"] = radio
    ? "radio"
    : onPress
      ? "button"
      : undefined

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onLongPress={onLongPress}
      onPress={onPress}
      onPressIn={onPressIn}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.item,
            formRadio && styles.formRadioItem,
            {
              backgroundColor: colors.background2,
            },
          ]}
        >
          {separator ? (
            <View
              pointerEvents="none"
              style={[
                styles.separator,
                formRadio && styles.formItemSeparator,
                { backgroundColor: colors.separator },
              ]}
            />
          ) : null}
          <View style={styles.body}>
            <Text
              numberOfLines={1}
              style={[
                styles.itemTitle,
                { color: link ? colors.link : colors.textPrimary },
              ]}
            >
              {title}
            </Text>
            {description ? (
              <Text
                numberOfLines={1}
                style={[styles.description, { color: colors.textSecondary }]}
              >
                {description}
              </Text>
            ) : null}
          </View>
          {value ? (
            <Text style={[styles.value, { color: colors.textSecondary }]}>
              {value}
            </Text>
          ) : null}
          {pressed ? (
            <View
              pointerEvents="none"
              style={[styles.activeMask, { backgroundColor: colors.separator }]}
            />
          ) : null}
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  activeMask: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  bottomSeparator: {
    bottom: 0,
  },
  description: {
    fontSize: 12,
    lineHeight: 17,
    paddingTop: 4,
  },
  formItemSeparator: {
    left: 16,
    right: 16,
  },
  formRadioItem: {
    paddingHorizontal: 16,
  },
  formRadioList: {
    borderRadius: 8,
  },
  item: {
    alignItems: "center",
    flexDirection: "row",
    padding: 16,
    position: "relative",
  },
  itemTitle: {
    fontSize: 17,
    lineHeight: 24,
  },
  list: {
    overflow: "hidden",
    position: "relative",
  },
  listTitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 3,
    marginTop: 16,
    paddingHorizontal: 16,
  },
  listWithoutTitle: {
    marginTop: 8,
  },
  outerSeparator: {
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    left: 16,
    position: "absolute",
    right: 0,
    top: 0,
  },
  topSeparator: {
    top: 0,
  },
  value: {
    fontSize: 14,
    lineHeight: 20,
    marginLeft: 16,
  },
})
