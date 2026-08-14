import { useRouter, type Href } from "expo-router"
import { Bug, LogOut, PackageSearch } from "lucide-react-native"
import { Alert } from "react-native"
import {
  Avatar,
  Card,
  Image,
  Paragraph,
  SizableText,
  Spinner,
  Text,
  XStack,
  YStack,
} from "tamagui"

import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import { AppButton } from "@/components/forms/app-button"
import { ThemedIcon } from "@/components/icons/themed-icon"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { appConfig } from "@/config/app-config"
import { ApiRequestError } from "@/data/api-client"
import { useCachedAppInfo } from "@/data/auth/auth-hooks"
import { SelectedServerButton } from "@/features/servers/selected-server-button"
import { AppUpdateDialog } from "@/features/updates/app-update-dialog"
import { useAppUpdate } from "@/features/updates/use-app-update"
import {
  useAuth,
  useAuthenticatedSession,
} from "@/providers/auth-provider"
import { useClientData } from "@/providers/client-data-provider"

export function MeScreen() {
  const router = useRouter()
  const session = useAuthenticatedSession()
  const appInfoQuery = useCachedAppInfo(session)
  const { currentUser } = useClientData()
  const { isSigningOut, signOut } = useAuth()
  const appUpdate = useAppUpdate()
  const appName = appInfoQuery.data?.appName ?? appConfig.name
  const organizationName =
    appInfoQuery.data?.organizationName ?? appConfig.organizationName
  const currentUserName =
    currentUser?.nickname.trim() ||
    currentUser?.name.trim() ||
    currentUser?.email ||
    "当前账号"
  function openThemeDebug() {
    router.push("/theme-debug" as Href)
  }

  async function handleLogout() {
    try {
      await signOut()
      router.replace("/init")
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
      <KeyboardAwareScreen contentBackground="$color1" edges={[]}>
        <YStack gap="$4" maxW={440} p="$4" self="center" width="100%">
          <Card bg="$background" p="$4" rounded="$5">
            <XStack gap="$4" items="center">
              <Avatar circular size="$6">
                <CachedAvatarImage
                  avatar={currentUser?.avatar ?? ""}
                  server={session}
                />
                <Avatar.Fallback bg="$color3" items="center" justify="center">
                  <Text fontSize="$6">
                    {Array.from(currentUserName)[0] ?? "即"}
                  </Text>
                </Avatar.Fallback>
              </Avatar>
              <YStack flex={1} gap="$1" minW={0}>
                <SizableText fontWeight="600" numberOfLines={1} size="$5">
                  {currentUserName}
                </SizableText>
                <Paragraph color="$gray10" numberOfLines={1} size="$3">
                  {currentUser?.email ?? "未设置邮箱"}
                </Paragraph>
                <Paragraph color="$gray9" numberOfLines={1} size="$2">
                  {session.url}
                </Paragraph>
              </YStack>
            </XStack>
          </Card>

          <Card bg="$background" p="$4" rounded="$5">
            <XStack gap="$3" items="center">
              <Image
                alt={`${appName} Logo`}
                borderRadius={10}
                height="$5"
                src={require("../../../assets/images/icon.png")}
                width="$5"
              />
              <YStack flex={1} gap="$1" minW={0}>
                <SizableText fontWeight="600" numberOfLines={1} size="$4">
                  {appName}
                </SizableText>
                <Paragraph color="$color10" numberOfLines={1} size="$2">
                  {organizationName} 的工作空间
                </Paragraph>
              </YStack>
            </XStack>
          </Card>

          <YStack gap="$2">
            <SizableText color="$gray10" fontWeight="600" px="$1" size="$2">
              服务器
            </SizableText>
            <SelectedServerButton />
          </YStack>

          <YStack gap="$2">
            <SizableText color="$gray10" fontWeight="600" px="$1" size="$2">
              关于
            </SizableText>
            <Card bg="$background" gap="$4" p="$4" rounded="$5">
              <XStack items="center" justify="space-between">
                <YStack gap="$1">
                  <SizableText fontWeight="600" size="$3">
                    当前版本
                  </SizableText>
                  <Paragraph color="$gray9" size="$2">
                    {appUpdate.installedVersion.label}
                  </Paragraph>
                </YStack>
                <ThemedIcon icon={PackageSearch} size={24} />
              </XStack>
              <AppButton
                accessibilityLabel="检查更新"
                disabled={appUpdate.status !== "idle"}
                icon={
                  appUpdate.status === "checking" ? (
                    <Spinner size="small" />
                  ) : undefined
                }
                onPress={() => void appUpdate.checkForUpdates()}
                variant="outlined"
                width="100%"
              >
                {appUpdate.status === "checking" ? "正在检查…" : "检查更新"}
              </AppButton>
            </Card>
          </YStack>

          {__DEV__ ? (
            <AppButton
              accessibilityLabel="打开调试页面"
              icon={<ThemedIcon icon={Bug} size={20} />}
              onPress={openThemeDebug}
              variant="outlined"
              width="100%"
            >
              调试
            </AppButton>
          ) : null}

          <AppButton
            accessibilityLabel="退出登录"
            disabled={isSigningOut}
            icon={isSigningOut ? <Spinner /> : <ThemedIcon icon={LogOut} />}
            onPress={() => void handleLogout()}
            theme="red"
            variant="outlined"
            width="100%"
          >
            {isSigningOut ? "正在退出…" : "退出登录"}
          </AppButton>
        </YStack>
      </KeyboardAwareScreen>

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
