import { Menu } from "lucide-react-native"
import type { ComponentProps } from "react"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { SizableText, XStack, YStack } from "tamagui"

import { CompactIconButton } from "@/components/buttons/compact-icon-button"
import { useXGUITheme } from "@/xgui"

export type HeaderAction = {
  icon: ComponentProps<typeof CompactIconButton>["icon"]
  iconColor?: string
  label: string
  onPress: () => void
  strokeWidth?: number
}

export function AppHeader({
  actions = [],
  onMenuPress,
  title,
  titleFontSize,
}: {
  actions?: HeaderAction[]
  onMenuPress?: () => void
  title: string
  titleFontSize?: number
}) {
  const insets = useSafeAreaInsets()
  const { colors } = useXGUITheme()

  return (
    <YStack bg={colors.background0} pt={insets.top}>
      <XStack height={52} items="center" px="$3">
        <XStack width={72}>
          {onMenuPress ? (
            <CompactIconButton
              accessibilityLabel="打开菜单"
              icon={Menu}
              iconSize={26}
              onPress={onMenuPress}
              strokeWidth={1.5}
            />
          ) : null}
        </XStack>

        <SizableText
          color={colors.textPrimary}
          flex={1}
          fontSize={titleFontSize}
          lineHeight={titleFontSize ? 24 : undefined}
          numberOfLines={1}
          size="$4"
          text="center"
        >
          {title}
        </SizableText>

        <XStack gap="$1" justify="flex-end" width={72}>
          {actions.slice(0, 2).map((action) => (
            <CompactIconButton
              accessibilityLabel={action.label}
              icon={action.icon}
              iconColor={action.iconColor}
              iconSize={26}
              key={action.label}
              onPress={action.onPress}
              strokeWidth={action.strokeWidth ?? 1.5}
            />
          ))}
        </XStack>
      </XStack>
    </YStack>
  )
}
