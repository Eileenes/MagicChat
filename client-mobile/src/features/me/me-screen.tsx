import { type ReactNode, useState } from "react"
import { useRouter, type Href } from "expo-router"
import {
  Bug,
  Check,
  ChevronRight,
  HardDrive,
  Info,
  LogOut,
  Moon,
  PackageSearch,
  Server,
  type LucideIcon,
} from "lucide-react-native"
import { Alert } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  Avatar,
  Card,
  Paragraph,
  Sheet,
  SizableText,
  Spinner,
  Text,
  XStack,
  YStack,
} from "tamagui"

import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import { ThemedIcon } from "@/components/icons/themed-icon"
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
import { useServers } from "@/providers/server-provider"
import { XGUI_TABBAR_CONTENT_HEIGHT, useXGUITheme } from "@/xgui"

const THEME_LABELS: Record<ThemePreference, string> = {
  dark: "深色",
  light: "浅色",
  system: "跟随系统",
}

export function MeScreen() {
  const insets = useSafeAreaInsets()
  const { colors } = useXGUITheme()
  const router = useRouter()
  const session = useAuthenticatedSession()
  const { selectedServer } = useServers()
  const appInfoQuery = useCachedAppInfo(session)
  const { currentUser } = useClientData()
  const { isSigningOut, signOut } = useAuth()
  const appUpdate = useAppUpdate()
  const {
    preference: themePreference,
    setPreference: setThemePreference,
  } = useAppTheme()
  const [themeSheetOpen, setThemeSheetOpen] = useState(false)

  const appName = appInfoQuery.data?.appName ?? appConfig.name
  const organizationName =
    appInfoQuery.data?.organizationName ?? appConfig.organizationName
  const currentUserName =
    currentUser?.nickname.trim() ||
    currentUser?.name.trim() ||
    currentUser?.email ||
    "当前账号"

  function selectTheme(value: ThemePreference) {
    setThemePreference(value)
    setThemeSheetOpen(false)
  }

  function confirmLogout() {
    Alert.alert("退出登录", "确定要退出当前账号吗？", [
      { style: "cancel", text: "取消" },
      {
        onPress: () => void handleLogout(),
        style: "destructive",
        text: "退出登录",
      },
    ])
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

  return (
    <>
      <KeyboardAwareScreen contentBackground={colors.background0} edges={[]}>
        <YStack
          gap="$4"
          maxW={440}
          pb={XGUI_TABBAR_CONTENT_HEIGHT + insets.bottom + 16}
          pt="$4"
          self="center"
          width="100%"
        >
          <Card bg="$background" overflow="hidden" rounded={0}>
            <XStack
              accessibilityLabel="个人信息"
              accessibilityRole="button"
              gap="$4"
              items="center"
              minH={116}
              onPress={() => router.push("/profile" as Href)}
              pressStyle={{ background: "$backgroundPress" }}
              px="$4"
              py="$4"
            >
              <Avatar rounded="$4" size="$7">
                <CachedAvatarImage
                  avatar={currentUser?.avatar ?? ""}
                  server={session}
                />
                <Avatar.Fallback bg="$color3" items="center" justify="center">
                  <Text fontSize="$7" fontWeight="600">
                    {Array.from(currentUserName)[0] ?? "即"}
                  </Text>
                </Avatar.Fallback>
              </Avatar>
              <YStack flex={1} gap="$2" justify="center">
                <SizableText fontWeight="700" numberOfLines={1} size="$6">
                  {currentUserName}
                </SizableText>
                <Paragraph color="$gray10" numberOfLines={1} size="$3">
                  {currentUser?.email ?? "未设置邮箱"}
                </Paragraph>
              </YStack>
              <ThemedIcon icon={ChevronRight} size={20} />
            </XStack>
          </Card>

          <YStack gap="$4">
            <SettingsSection title="账号">
              <SettingsRow
                detail={session.url}
                icon={Server}
                onPress={() => router.push("/server-management")}
                testID="login-server"
                title="当前服务器"
                value={selectedServer.name}
              />
            </SettingsSection>

            <SettingsSection title="偏好设置">
              <SettingsRow
                detail="跟随你的使用习惯调整界面"
                icon={Moon}
                onPress={() => setThemeSheetOpen(true)}
                title="外观主题"
                value={THEME_LABELS[themePreference]}
              />
              <SettingsRow
                detail="媒体文件与离线消息"
                icon={HardDrive}
                last
                onPress={() => router.push("/storage" as Href)}
                title="存储空间"
              />
            </SettingsSection>

            <SettingsSection title="应用">
              <SettingsRow
                detail={`当前版本 ${appUpdate.installedVersion.label}`}
                icon={PackageSearch}
                onPress={
                  appUpdate.status === "idle"
                    ? () => void appUpdate.checkForUpdates()
                    : undefined
                }
                title={
                  appUpdate.status === "checking" ? "正在检查更新…" : "检查更新"
                }
                trailing={
                  appUpdate.status === "checking" ? <Spinner size="small" /> : undefined
                }
              />
              <SettingsRow
                detail={`${organizationName} 的工作空间`}
                icon={Info}
                last={!__DEV__}
                title={appName}
              />
              {__DEV__ ? (
                <SettingsRow
                  icon={Bug}
                  last
                  onPress={() => router.push("/theme-debug" as Href)}
                  title="界面调试"
                />
              ) : null}
            </SettingsSection>

            <Card bg="$background" overflow="hidden" rounded={0}>
              <SettingsRow
                danger
                icon={LogOut}
                last
                onPress={isSigningOut ? undefined : confirmLogout}
                title={isSigningOut ? "正在退出…" : "退出登录"}
                trailing={isSigningOut ? <Spinner size="small" /> : undefined}
              />
            </Card>
          </YStack>
        </YStack>
      </KeyboardAwareScreen>

      <Sheet
        dismissOnSnapToBottom
        modal
        onOpenChange={setThemeSheetOpen}
        open={themeSheetOpen}
        snapPoints={[42]}
      >
        <Sheet.Overlay bg="$shadow6" opacity={0.45} />
        <Sheet.Frame gap="$3" p="$5">
          <Sheet.Handle />
          <YStack gap="$1" mb="$1">
            <SizableText fontWeight="700" size="$5">
              外观主题
            </SizableText>
            <Paragraph color="$gray10" size="$3">
              选择你偏好的界面显示方式
            </Paragraph>
          </YStack>
          {(["system", "light", "dark"] as const).map((value) => (
            <XStack
              bg={themePreference === value ? "$color3" : "$background"}
              borderColor={themePreference === value ? "$color7" : "$borderColor"}
              borderWidth={1}
              gap="$3"
              items="center"
              key={value}
              minH={52}
              onPress={() => selectTheme(value)}
              px="$4"
              rounded="$4"
            >
              <SizableText flex={1} fontWeight="600" size="$4">
                {THEME_LABELS[value]}
              </SizableText>
              {themePreference === value ? <ThemedIcon icon={Check} /> : null}
            </XStack>
          ))}
        </Sheet.Frame>
      </Sheet>

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

function SettingsSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <YStack gap="$2">
      <SizableText color="$gray10" fontWeight="600" px="$4" size="$2">
        {title}
      </SizableText>
      <Card bg="$background" overflow="hidden" rounded={0}>
        {children}
      </Card>
    </YStack>
  )
}

function SettingsRow({
  danger = false,
  detail,
  icon,
  last = false,
  onPress,
  testID,
  title,
  trailing,
  value,
}: {
  danger?: boolean
  detail?: string
  icon: LucideIcon
  last?: boolean
  onPress?: () => void
  testID?: string
  title: string
  trailing?: ReactNode
  value?: string
}) {
  return (
    <XStack
      accessibilityLabel={title}
      accessibilityRole={onPress ? "button" : "text"}
      bg="$background"
      gap="$3"
      items="center"
      minH={68}
      onPress={onPress}
      opacity={onPress === undefined && trailing ? 0.7 : 1}
      pressStyle={onPress ? { background: "$backgroundPress" } : undefined}
      px="$4"
      testID={testID}
    >
      <YStack
        bg={danger ? "$red3" : "$color3"}
        height={38}
        items="center"
        justify="center"
        rounded={999}
        theme={danger ? "red" : undefined}
        width={38}
      >
        <ThemedIcon icon={icon} size={19} />
      </YStack>
      <YStack
        borderBottomColor="$borderColor"
        borderBottomWidth={last ? 0 : 1}
        flex={1}
        justify="center"
        minH={68}
        py="$2"
      >
        <XStack gap="$2" items="center">
          <SizableText
            color={danger ? "$red10" : "$color"}
            flex={1}
            fontWeight="600"
            size="$3"
          >
            {title}
          </SizableText>
          {value ? (
            <SizableText color="$gray10" maxW="45%" numberOfLines={1} size="$3">
              {value}
            </SizableText>
          ) : null}
          {trailing}
          {onPress ? <ThemedIcon icon={ChevronRight} size={18} /> : null}
        </XStack>
        {detail ? (
          <Paragraph color="$gray9" mt="$1" numberOfLines={1} size="$2">
            {detail}
          </Paragraph>
        ) : null}
      </YStack>
    </XStack>
  )
}
