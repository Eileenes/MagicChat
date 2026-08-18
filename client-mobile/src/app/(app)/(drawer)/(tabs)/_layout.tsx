import { Tabs as RouterTabs, useRouter } from "expo-router"
import type { Href } from "expo-router"
import {
  BriefcaseBusiness,
  ContactRound,
  MessageCircleMore,
  Search,
  UserRound,
  type LucideIcon,
} from "lucide-react-native"
import type { ComponentProps } from "react"
import { useState } from "react"
import { SizableText, Tabs, YStack } from "tamagui"

import { AppHeader } from "@/components/navigation/app-header"
import { useXGUITheme } from "@/xgui"

const TAB_ITEMS: Record<string, { icon: LucideIcon; label: string }> = {
  contacts: { icon: ContactRound, label: "通讯录" },
  me: { icon: UserRound, label: "我" },
  messages: { icon: MessageCircleMore, label: "消息" },
  projects: { icon: BriefcaseBusiness, label: "项目" },
}

type AppTabBarProps = Parameters<
  NonNullable<ComponentProps<typeof RouterTabs>["tabBar"]>
>[0]

export default function AppTabsLayout() {
  const router = useRouter()
  const { colors } = useXGUITheme()

  return (
    <RouterTabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: true,
        sceneStyle: {
          backgroundColor: colors.background0,
        },
        tabBarHideOnKeyboard: true,
      }}
    >
      <RouterTabs.Screen
        name="messages"
        options={{
          header: () => (
            <AppHeader
              actions={[
                {
                  icon: Search,
                  label: "搜索",
                  onPress: () => router.push("/search" as Href),
                },
              ]}
              title="消息"
            />
          ),
          title: "消息",
        }}
      />
      <RouterTabs.Screen
        name="contacts"
        options={{
          header: () => <AppHeader title="通讯录" />,
          title: "通讯录",
        }}
      />
      <RouterTabs.Screen
        name="projects"
        options={{
          header: () => <AppHeader title="项目" />,
          title: "项目",
        }}
      />
      <RouterTabs.Screen
        name="me"
        options={{
          header: () => <AppHeader title="我" />,
          title: "我",
        }}
      />
    </RouterTabs>
  )
}

function AppTabBar({ insets, navigation, state }: AppTabBarProps) {
  const activeRouteName = state.routes[state.index]?.name ?? "messages"
  const { colors } = useXGUITheme()

  function handleValueChange(routeName: string) {
    const route = state.routes.find((item) => item.name === routeName)
    if (!route) return

    const event = navigation.emit({
      canPreventDefault: true,
      target: route.key,
      type: "tabPress",
    })

    if (!event.defaultPrevented && route.name !== activeRouteName) {
      navigation.navigate(route.name, route.params)
    }
  }

  return (
    <YStack bg={colors.background2} pb={insets.bottom}>
      <Tabs
        onValueChange={handleValueChange}
        size="$5"
        value={activeRouteName}
        width="100%"
      >
        <Tabs.List
          bg="transparent"
          borderWidth={0}
          height={56}
          rounded={0}
          width="100%"
        >
          {state.routes.map((route) => {
            const item = TAB_ITEMS[route.name]
            if (!item) return null

            const focused = route.name === activeRouteName

            return (
              <AppTabItem
                focused={focused}
                item={item}
                key={route.key}
                routeName={route.name}
              />
            )
          })}
        </Tabs.List>
      </Tabs>
    </YStack>
  )
}

function AppTabItem({
  focused,
  item,
  routeName,
}: {
  focused: boolean
  item: { icon: LucideIcon; label: string }
  routeName: string
}) {
  const { colors } = useXGUITheme()
  const [pressed, setPressed] = useState(false)
  const color = pressed
    ? colors.textSecondary
    : focused
      ? colors.brand
      : colors.textSecondary
  const Icon = item.icon

  return (
    <Tabs.Tab
      accessibilityLabel={item.label}
      bg="transparent"
      flex={1}
      height="100%"
      items="center"
      justify="center"
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      unstyled
      value={routeName}
    >
      <YStack gap="$0.5" items="center">
        <Icon color={color} size={20} />
        <SizableText color={color} size="$2">
          {item.label}
        </SizableText>
      </YStack>
    </Tabs.Tab>
  )
}
