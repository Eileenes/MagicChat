import { Pressable, StyleSheet, Text, View } from "react-native"
import Svg, { Path } from "react-native-svg"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIFilledSearchBarProps = {
  accessibilityLabel?: string
  onPress: () => void
  placeholder?: string
}

export function XGUIFilledSearchBar({
  accessibilityLabel,
  onPress,
  placeholder = "搜索",
}: XGUIFilledSearchBarProps) {
  const { colors } = useXGUITheme()

  return (
    <View style={[styles.searchBar, { backgroundColor: colors.background0 }]}>
      <Pressable
        accessibilityLabel={accessibilityLabel ?? placeholder}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.form,
          {
            backgroundColor: pressed
              ? colors.background1
              : colors.background2,
          },
        ]}
      >
        <WeUISearchIcon color={colors.textPlaceholder} />
        <Text style={[styles.label, { color: colors.textPlaceholder }]}>
          {placeholder}
        </Text>
      </Pressable>
    </View>
  )
}

function WeUISearchIcon({ color }: { color: string }) {
  return (
    <Svg height={24} viewBox="0 0 24 24" width={24}>
      <Path
        d="M16.31 15.561l4.114 4.115-.848.848-4.123-4.123a7 7 0 1 1 .857-.84zM16.8 11a5.8 5.8 0 1 0-11.6 0 5.8 5.8 0 0 0 11.6 0z"
        fill={color}
        fillRule="evenodd"
      />
    </Svg>
  )
}

const styles = StyleSheet.create({
  form: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    height: 36,
    justifyContent: "center",
    minWidth: 0,
  },
  label: {
    fontSize: 17,
    lineHeight: 24,
    marginLeft: 4,
  },
  searchBar: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
})
