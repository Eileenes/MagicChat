import { useQueryClient } from "@tanstack/react-query"
import { Redirect, useFocusEffect, useRouter } from "expo-router"
import { ChevronLeft } from "lucide-react-native"
import { useCallback, useEffect, useState } from "react"
import { BackHandler } from "react-native"
import { Image, Paragraph, XStack, YStack } from "tamagui"

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { PageHeader } from "@/components/navigation/page-header"
import type { AuthenticatedUser } from "@/core/models"
import { ApiRequestError } from "@/data/api-client"
import { useAppInfoQuery } from "@/data/auth/auth-hooks"
import { queryKeys } from "@/data/query"
import { runLoginBootstrap } from "@/features/auth/login-bootstrap"
import { LoginForm } from "@/features/auth/login-form"
import { useAuth } from "@/providers/auth-provider"
import { useServers } from "@/providers/server-provider"
import { useRealtime } from "@/realtime/realtime-context"
import { useXGUITheme, useXGUIToast } from "@/xgui"

const CONNECTION_TIMEOUT_MS = 5_000
const MIN_CONNECTION_TOAST_MS = 300

export function LoginScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const {
    beginSignIn,
    commitSignIn,
    isAuthenticated,
    isPreparingSignIn,
    rollbackSignIn,
  } = useAuth()
  const { waitUntilReady } = useRealtime()
  const {
    isHydrated,
    markServerAsRecentlyUsed,
    selectedServer,
  } = useServers()
  const { colors } = useXGUITheme()
  const { hide: hideToast, show: showToast } = useXGUIToast()
  const appInfoQuery = useAppInfoQuery(selectedServer, isHydrated)
  const serverKey = `${selectedServer.id}\u0000${selectedServer.url}`
  const [timedOutServerKey, setTimedOutServerKey] = useState<string | null>(
    null
  )
  const connectionTimedOut = timedOutServerKey === serverKey
  const connectionLoading =
    isHydrated && appInfoQuery.isFetching && !connectionTimedOut
  const returnToServerSelection = useCallback(() => {
    if (isPreparingSignIn) return

    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace("/server-management")
  }, [isPreparingSignIn, router])

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          returnToServerSelection()
          return true
        }
      )
      return () => subscription.remove()
    }, [returnToServerSelection])
  )

  useEffect(() => {
    if (isPreparingSignIn || !connectionLoading) return

    const timeout = setTimeout(() => {
      setTimedOutServerKey(serverKey)
      hideToast()
      void queryClient.cancelQueries({
        exact: true,
        queryKey: queryKeys.appInfo(selectedServer),
      })
    }, CONNECTION_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [
    connectionLoading,
    hideToast,
    isPreparingSignIn,
    queryClient,
    selectedServer,
    serverKey,
  ])

  useEffect(() => {
    if (isPreparingSignIn) return

    if (!connectionLoading) {
      hideToast()
      return
    }

    showToast({
      duration: 0,
      message: "正在连接服务器",
      type: "loading",
    })
    return hideToast
  }, [
    connectionLoading,
    hideToast,
    isPreparingSignIn,
    serverKey,
    showToast,
  ])

  if (isAuthenticated) {
    return <Redirect href="/messages" />
  }

  const appInfo = appInfoQuery.data
  const connectionReady =
    Boolean(appInfo) &&
    !appInfoQuery.isError &&
    !appInfoQuery.isFetching &&
    !connectionTimedOut
  const connectionFailed = appInfoQuery.isError || connectionTimedOut

  async function handleRetryConnection() {
    const toastStartedAt = Date.now()
    setTimedOutServerKey(null)
    showToast({
      duration: 0,
      message: "正在连接服务器",
      type: "loading",
    })

    try {
      await queryClient.cancelQueries({
        exact: true,
        queryKey: queryKeys.appInfo(selectedServer),
      })
      await appInfoQuery.refetch()
    } finally {
      const remainingToastMs =
        MIN_CONNECTION_TOAST_MS - (Date.now() - toastStartedAt)
      if (remainingToastMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingToastMs))
      }
      hideToast()
    }
  }

  async function handleLoginSuccess(user: AuthenticatedUser) {
    const authenticatedTarget = {
      id: selectedServer.id,
      url: selectedServer.url,
      userId: user.id,
    }
    beginSignIn(authenticatedTarget)

    try {
      await runLoginBootstrap({
        queryClient,
        target: authenticatedTarget,
        waitForRealtime: waitUntilReady,
      })
      markServerAsRecentlyUsed(selectedServer.id)
      await commitSignIn(authenticatedTarget)
      hideToast()
    } catch (error: unknown) {
      await rollbackSignIn(authenticatedTarget)
      throw new ApiRequestError(
        error instanceof Error ? error.message : "登录初始化失败"
      )
    }
  }

  return (
    <YStack bg={colors.background0} flex={1}>
      <PageHeader
        backDisabled={isPreparingSignIn}
        backIcon={ChevronLeft}
        backIconColor={colors.textPrimary}
        background={colors.background0}
        compactIconButtons
        onBackPress={returnToServerSelection}
        title=""
      />
      <KeyboardAwareScreen
        contentBackground={colors.background0}
        edges={["left", "right", "bottom"]}
        items="center"
        pb={128}
        pt="$2"
        px="$4"
      >
      <YStack grow={1} maxW={440} width="100%">
        <YStack gap={48} grow={1} justify="center">
          <XStack gap="$3" items="center" justify="center">
            <Image
              alt="即应 Logo"
              borderRadius={10}
              height="$5"
              src={require("../../../assets/images/icon.png")}
              width="$5"
            />
            {appInfo ? (
              <YStack gap="$1.5" shrink={1}>
                <Paragraph fontSize="$5" fontWeight="600" lineHeight="$6">
                  {appInfo.appName} 智能协作平台
                </Paragraph>
                <Paragraph color="$color10" fontSize="$3">
                  {appInfo.organizationName} 的工作空间
                </Paragraph>
              </YStack>
            ) : null}
          </XStack>

          <LoginForm
            connectionFailed={connectionFailed}
            connectionReady={connectionReady}
            emailCodeLoginEnabled={appInfo?.emailCodeLoginEnabled ?? true}
            onLoginSuccess={handleLoginSuccess}
            onRetryConnection={() => void handleRetryConnection()}
            passwordLoginEnabled={appInfo?.passwordLoginEnabled ?? true}
            server={selectedServer}
          />
        </YStack>
      </YStack>
      </KeyboardAwareScreen>
    </YStack>
  )
}
