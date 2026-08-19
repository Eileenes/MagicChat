// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconBook from "@tabler/icons-react-native/IconBook"
// eslint-disable-next-line import/no-unresolved
import IconBookFilled from "@tabler/icons-react-native/IconBookFilled"
// eslint-disable-next-line import/no-unresolved
import IconBriefcase from "@tabler/icons-react-native/IconBriefcase"
// eslint-disable-next-line import/no-unresolved
import IconBriefcaseFilled from "@tabler/icons-react-native/IconBriefcaseFilled"
// eslint-disable-next-line import/no-unresolved
import IconMessageCircle from "@tabler/icons-react-native/IconMessageCircle"
// eslint-disable-next-line import/no-unresolved
import IconMessageCircleFilled from "@tabler/icons-react-native/IconMessageCircleFilled"
// eslint-disable-next-line import/no-unresolved
import IconCirclePlus from "@tabler/icons-react-native/IconCirclePlus"
// eslint-disable-next-line import/no-unresolved
import IconSettings from "@tabler/icons-react-native/IconSettings"
// eslint-disable-next-line import/no-unresolved
import IconSettingsFilled from "@tabler/icons-react-native/IconSettingsFilled"
import { BlurTargetView } from "expo-blur"
import { Tabs as RouterTabs } from "expo-router"
import {
  type ComponentProps,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { StyleSheet, View } from "react-native"

import { AppHeader } from "@/components/navigation/app-header"
import { notifyMessagesTabReselected } from "@/features/messages/messages-tab-reselect"
import { formatUnreadCount } from "@/features/messages/conversation-list-model"
import { useClientData } from "@/providers/client-data-provider"
import { XGUITabbar, XGUITabbarItem, useXGUITheme } from "@/xgui"

const TAB_ITEMS = {
  contacts: {
    activeIcon: IconBookFilled,
    icon: IconBook,
    label: "通讯录",
  },
  me: {
    activeIcon: IconSettingsFilled,
    icon: IconSettings,
    label: "设置",
  },
  messages: {
    activeIcon: IconMessageCircleFilled,
    icon: IconMessageCircle,
    label: "消息",
  },
  projects: {
    activeIcon: IconBriefcaseFilled,
    icon: IconBriefcase,
    label: "项目",
  },
}

type AppTabBarProps = Parameters<
  NonNullable<ComponentProps<typeof RouterTabs>["tabBar"]>
>[0]

type CapturedAppTabBarProps = Pick<AppTabBarProps, "navigation" | "state">

type RenderedAppTabBarProps = CapturedAppTabBarProps & {
  blurTarget: RefObject<View | null>
  unreadMessageCount: number
}

export default function AppTabsLayout() {
  const { conversations } = useClientData()
  const { colors } = useXGUITheme()
  const blurTarget = useRef<View>(null)
  const [tabBarProps, setTabBarProps] =
    useState<CapturedAppTabBarProps | null>(null)
  const captureTabBarProps = useCallback((next: CapturedAppTabBarProps) => {
    setTabBarProps((current) =>
      current?.navigation === next.navigation && current.state === next.state
        ? current
        : next
    )
  }, [])
  const renderTabBar = useCallback(
    (props: AppTabBarProps) => (
      <AppTabBarCapture
        navigation={props.navigation}
        onCapture={captureTabBarProps}
        state={props.state}
      />
    ),
    [captureTabBarProps]
  )
  const unreadMessageCount = conversations.reduce(
    (total, conversation) =>
      conversation.notificationMuted
        ? total
        : total + conversation.unreadCount,
    0
  )
  const messageTitle =
    unreadMessageCount > 0
      ? `消息(${formatUnreadCount(unreadMessageCount)})`
      : "消息"

  return (
    <View style={styles.fill}>
      <BlurTargetView ref={blurTarget} style={styles.fill}>
        <RouterTabs
          tabBar={renderTabBar}
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
                      icon: IconCirclePlus,
                      iconColor: colors.textPrimary,
                      label: "新增",
                      onPress: () => undefined,
                      strokeWidth: 1,
                    },
                  ]}
                  title={messageTitle}
                  titleFontSize={18}
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
              header: () => <AppHeader title="设置" />,
              title: "设置",
            }}
          />
        </RouterTabs>
      </BlurTargetView>
      {tabBarProps ? (
        <AppTabBar
          blurTarget={blurTarget}
          navigation={tabBarProps.navigation}
          state={tabBarProps.state}
          unreadMessageCount={unreadMessageCount}
        />
      ) : null}
    </View>
  )
}

function AppTabBarCapture({
  navigation,
  onCapture,
  state,
}: CapturedAppTabBarProps & {
  onCapture: (props: CapturedAppTabBarProps) => void
}) {
  useLayoutEffect(() => {
    onCapture({ navigation, state })
  }, [navigation, onCapture, state])

  return null
}

function AppTabBar({
  blurTarget,
  navigation,
  state,
  unreadMessageCount,
}: RenderedAppTabBarProps) {
  const activeRouteName = state.routes[state.index]?.name ?? "messages"

  function handlePress(routeName: string) {
    const route = state.routes.find((item) => item.name === routeName)
    if (!route) return

    const event = navigation.emit({
      canPreventDefault: true,
      target: route.key,
      type: "tabPress",
    })

    if (event.defaultPrevented) return

    if (route.name === activeRouteName) {
      if (route.name === "messages" && unreadMessageCount > 0) {
        notifyMessagesTabReselected()
      }
      return
    }

    navigation.navigate(route.name, route.params)
  }

  return (
    <XGUITabbar blurTarget={blurTarget}>
      {state.routes.map((route) => {
        const item = TAB_ITEMS[route.name as keyof typeof TAB_ITEMS]
        if (!item) return null

        return (
          <XGUITabbarItem
            active={route.name === activeRouteName}
            activeIcon={item.activeIcon}
            icon={item.icon}
            key={route.key}
            label={item.label}
            onPress={() => handlePress(route.name)}
            unreadCount={
              route.name === "messages" ? unreadMessageCount : undefined
            }
          />
        )
      })}
    </XGUITabbar>
  )
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
})
