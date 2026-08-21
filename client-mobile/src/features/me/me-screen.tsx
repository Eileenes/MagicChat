import { useEffect, useRef, useState } from "react"
// eslint-disable-next-line import/no-unresolved
import IconDatabase from "@tabler/icons-react-native/IconDatabase"
// eslint-disable-next-line import/no-unresolved
import IconDeviceDesktop from "@tabler/icons-react-native/IconDeviceDesktop"
// eslint-disable-next-line import/no-unresolved
import IconLogout from "@tabler/icons-react-native/IconLogout"
// eslint-disable-next-line import/no-unresolved
import IconMoon from "@tabler/icons-react-native/IconMoon"
// eslint-disable-next-line import/no-unresolved
import IconPalette from "@tabler/icons-react-native/IconPalette"
// eslint-disable-next-line import/no-unresolved
import IconRefresh from "@tabler/icons-react-native/IconRefresh"
// eslint-disable-next-line import/no-unresolved
import IconSwitchHorizontal from "@tabler/icons-react-native/IconSwitchHorizontal"
// eslint-disable-next-line import/no-unresolved
import IconChevronRight from "@tabler/icons-react-native/IconChevronRight"
// eslint-disable-next-line import/no-unresolved
import IconSun from "@tabler/icons-react-native/IconSun"
import { useRouter, type Href } from "expo-router"
import { Alert, Pressable } from "react-native"
import {
  Card,
  Paragraph,
  SizableText,
  XStack,
  YStack,
} from "tamagui"

import { AppAvatar } from "@/components/avatar/app-avatar"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { appConfig } from "@/config/app-config"
import type { ThemePreference } from "@/config/theme-preference"
import { ApiRequestError } from "@/data/api-client"
import { useCachedAppInfo } from "@/data/auth/auth-hooks"
import { AppUpdateDialog } from "@/features/updates/app-update-dialog"
import { useAppUpdate } from "@/features/updates/use-app-update"
import {
  useAuth,
  useAuthenticatedSession,
} from "@/providers/auth-provider"
import { useAppTheme } from "@/providers/app-theme-provider"
import { useClientData } from "@/providers/client-data-provider"
import { XGUIActionSheet, XGUIList, XGUIListItem, XGUIPicker, useXGUITheme, useXGUIToast, type XGUIPickerItem } from "@/xgui"

const THEME_OPTIONS = [
  { icon: ({ color, size, strokeWidth }) => <IconDeviceDesktop color={color} size={size} strokeWidth={strokeWidth} />, label: "跟随系统", value: "system" },
  { icon: ({ color, size, strokeWidth }) => <IconSun color={color} size={size} strokeWidth={strokeWidth} />, label: "浅色主题", value: "light" },
  { icon: ({ color, size, strokeWidth }) => <IconMoon color={color} size={size} strokeWidth={strokeWidth} />, label: "深色主题", value: "dark" },
] satisfies readonly XGUIPickerItem<ThemePreference>[]

const THEME_LABELS: Record<ThemePreference, string> = {
  dark: "深色主题",
  light: "浅色主题",
  system: "跟随系统",
}

export function MeScreen() {
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const router = useRouter()
  const session = useAuthenticatedSession()
  const appInfoQuery = useCachedAppInfo(session)
  const { currentUser } = useClientData()
  const { isSigningOut, signOut } = useAuth()
  const appUpdate = useAppUpdate()
  const updateConfirmedRef = useRef(false)
  const themeSwitchFrameRef = useRef<number | null>(null)
  const {
    preference: themePreference,
    setPreference: setThemePreference,
  } = useAppTheme()
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const [logoutSheetOpen, setLogoutSheetOpen] = useState(false)
  const [pendingTheme, setPendingTheme] = useState<ThemePreference>(themePreference)

  const organizationName =
    appInfoQuery.data?.organizationName ?? appConfig.organizationName
  const currentUserName =
    currentUser?.nickname.trim() ||
    currentUser?.name.trim() ||
    currentUser?.email ||
    "当前账号"

  function openThemePicker() {
    setPendingTheme(themePreference)
    setThemePickerOpen(true)
  }

  function handleThemeConfirm(value: ThemePreference) {
    if (value === themePreference) return

    toast.show({ duration: 0, message: "正在切换主题", type: "loading" })
    themeSwitchFrameRef.current = requestAnimationFrame(() => {
      setThemePreference(value)
      themeSwitchFrameRef.current = requestAnimationFrame(() => {
        themeSwitchFrameRef.current = null
        toast.hide()
      })
    })
  }

  useEffect(
    () => () => {
      if (themeSwitchFrameRef.current !== null) {
        cancelAnimationFrame(themeSwitchFrameRef.current)
        themeSwitchFrameRef.current = null
        toast.hide()
      }
    },
    [toast]
  )

  function confirmLogout() {
    setLogoutSheetOpen(true)
  }

  async function handleLogout() {
    try {
      await signOut()
      router.replace("/server-management")
    } catch (error: unknown) {
      Alert.alert(
        "退出登录失败",
        error instanceof ApiRequestError
          ? error.message
          : "暂时无法退出登录，请稍后重试。"
      )
    }
  }

  async function handleCheckForUpdates() {
    toast.show({ duration: 0, message: "正在检查更新", type: "loading" })
    try {
      const release = await appUpdate.checkForUpdates()
      toast.hide()
      if (!release) toast.show({ message: "已经是最新版本", type: "success" })
    } catch (error: unknown) {
      toast.show({
        message: error instanceof Error ? error.message : "检查更新失败",
        type: "error",
      })
    }
  }

  function startAvailableUpdate() {
    if (appUpdate.platform === "ios") {
      appUpdate.cancelUpdate()
      toast.show({ message: "iOS 暂不支持应用内安装，请联系管理员更新", type: "text" })
      return
    }
    void appUpdate.startUpdate()
  }

  return (
    <>
      <KeyboardAwareScreen
        contentBackground={colors.background0}
        edges={[]}
        elastic
      >
        <YStack maxW={440} pb="$4" pt="$2" self="center" width="100%">
          <Card bg="$background" overflow="hidden" rounded={0}>
            <Pressable
              accessibilityLabel="个人信息"
              accessibilityRole="button"
              onPress={() => router.push("/profile" as Href)}
              style={({ pressed }) => ({
                backgroundColor: pressed
                  ? colors.background1
                  : colors.background2,
              })}
            >
              <XStack gap="$4" items="center" minH={116} px="$4" py="$4">
                <AppAvatar accessibilityLabel={currentUserName} avatar={currentUser?.avatar} server={session} size="$7" type="user" />
                <YStack flex={1} gap="$2" justify="center">
                  <SizableText
                    color={colors.textPrimary}
                    fontWeight="700"
                    numberOfLines={1}
                    size="$6"
                  >
                    {currentUserName}
                  </SizableText>
                  <Paragraph color="$gray10" numberOfLines={1} size="$3">
                    {organizationName}
                  </Paragraph>
                </YStack>
                <IconChevronRight
                  color={colors.textPlaceholder}
                  size={18}
                  strokeWidth={1}
                />
              </XStack>
            </Pressable>
          </Card>

          <YStack>
            <XGUIList size="large">
              <XGUIListItem
                icon={({ size, strokeWidth }) => <IconPalette color={colors.yellow} size={size} strokeWidth={strokeWidth} />}
                onPress={openThemePicker}
                title="外观主题"
                value={THEME_LABELS[themePreference]}
              />
              <XGUIListItem
                icon={({ size, strokeWidth }) => <IconDatabase color={colors.blue} size={size} strokeWidth={strokeWidth} />}
                onPress={() => router.push("/storage" as Href)}
                separator
                title="存储空间"
              />
            </XGUIList>

            <XGUIList size="large">
              <XGUIListItem
                disabled={appUpdate.status !== "idle"}
                icon={({ size, strokeWidth }) => <IconRefresh color={colors.brand} size={size} strokeWidth={strokeWidth} />}
                onPress={
                  appUpdate.status === "idle"
                    ? () => void handleCheckForUpdates()
                    : undefined
                }
                title="检查更新"
                value={appUpdate.installedVersion.label}
              />
            </XGUIList>

            <XGUIList size="large">
              <XGUIListItem
                centerContent
                destructive
                icon={({ color, size, strokeWidth }) => <IconSwitchHorizontal color={color} size={size} strokeWidth={strokeWidth} />}
                onPress={() => router.push("/server-management")}
                title="切换账号"
              />
            </XGUIList>

            <XGUIList size="large">
              <XGUIListItem
                centerContent
                destructive
                disabled={isSigningOut}
                icon={({ color, size, strokeWidth }) => <IconLogout color={color} size={size} strokeWidth={strokeWidth} />}
                onPress={isSigningOut ? undefined : confirmLogout}
                title={isSigningOut ? "正在退出…" : "退出登录"}
              />
            </XGUIList>
          </YStack>
        </YStack>
      </KeyboardAwareScreen>

      <XGUIPicker
        columns={[THEME_OPTIONS]}
        onChange={([value]) => {
          if (value) setPendingTheme(value)
        }}
        onConfirm={([value]) => {
          if (value) handleThemeConfirm(value)
        }}
        onOpenChange={setThemePickerOpen}
        open={themePickerOpen}
        title="外观主题"
        value={[pendingTheme]}
      />

      <XGUIActionSheet
        actions={[
          {
            destructive: true,
            label: "退出登录",
            onPress: () => void handleLogout(),
          },
        ]}
        description="确定要退出当前账号吗？"
        onOpenChange={setLogoutSheetOpen}
        open={logoutSheetOpen}
        title="退出登录"
      />

      <XGUIActionSheet
        actions={[
          {
            label: "更新",
            onBeforePress: () => {
              updateConfirmedRef.current = true
            },
            onPress: startAvailableUpdate,
          },
        ]}
        description={
          appUpdate.release
            ? `当前版本 ${appUpdate.installedVersion.version}，最新版本 ${appUpdate.release.version}`
            : undefined
        }
        onOpenChange={(open) => {
          if (!open && appUpdate.status === "available") {
            if (updateConfirmedRef.current) updateConfirmedRef.current = false
            else appUpdate.cancelUpdate()
          }
        }}
        open={appUpdate.status === "available"}
        title="发现新版本，是否更新？"
      />

      <AppUpdateDialog
        onCancel={appUpdate.cancelUpdate}
        onConfirm={() => void appUpdate.startUpdate()}
        progress={appUpdate.progress}
        release={appUpdate.release}
        status={appUpdate.status}
      />
    </>
  )
}
