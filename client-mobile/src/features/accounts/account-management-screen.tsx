import { useRouter, type Href } from "expo-router"
import { useMemo, useRef, useState } from "react"
import { Pressable, ScrollView } from "react-native"
import { Paragraph, SizableText, XStack, YStack } from "tamagui"

import { AppAvatar } from "@/components/avatar/app-avatar"
import { ContentState } from "@/components/feedback/content-state"
import { AppHeader } from "@/components/navigation/app-header"
import { ApiRequestError } from "@/data/api-client"
import { accountLoginHref, AccountActionSingleFlight, addAccountServerHref, buildAccountListItems, performAccountLogout, performAccountSwitch } from "@/features/accounts/account-management-model"
import { useAuth } from "@/providers/auth-provider"
import { useServers } from "@/providers/server-provider"
import { XGUIActionSheet, XGUIButton, XGUIList, useXGUITheme, useXGUIToast } from "@/xgui"

export function AccountManagementScreen() {
  const router = useRouter()
  const toast = useXGUIToast()
  const { colors } = useXGUITheme()
  const { addServer, servers, selectServer } = useServers()
  const { accounts, active, isHydrated, phase, signOutAccount, switchAccount } = useAuth()
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)
  const [actionError, setActionError] = useState("")
  const [logoutAccountId, setLogoutAccountId] = useState<string | null>(null)
  const flight = useRef(new AccountActionSingleFlight())
  const retryActionRef = useRef<(() => void) | null>(null)
  const serverNames = useMemo(() => new Map(servers.map((server) => [server.id, server.name])), [servers])
  const items = useMemo(() => buildAccountListItems(accounts, active?.accountId ?? null, serverNames), [accounts, active?.accountId, serverNames])
  const logoutItem = items.find((item) => item.accountId === logoutAccountId)
  const globallyBusy = phase === "switching" || phase === "signing-out" || phase === "preparing"

  async function runAccountAction(accountId: string, operation: () => Promise<void>) {
    retryActionRef.current = () => { void runAccountAction(accountId, operation).catch(() => undefined) }
    const result = await flight.current.run(accountId, async () => {
      setBusyAccountId(accountId)
      setActionError("")
      try { await operation() }
      catch (error) {
        const message = error instanceof ApiRequestError || error instanceof Error ? error.message : "账号操作失败，请稍后重试"
        setActionError(message)
        toast.show({ message, modal: false, type: "error" })
        throw error
      } finally { setBusyAccountId(null) }
    })
    return result
  }

  function openLogin(accountId: string) {
    const item = items.find((candidate) => candidate.accountId === accountId)
    if (!item) return
    const existingServer = servers.find((server) => server.id === item.target.id || server.url === item.target.url)
    if (existingServer) selectServer(existingServer.id)
    else {
      const added = addServer(item.serverLabel, item.target.url)
      if (added.status !== "added") {
        toast.show({ message: "无法恢复账号服务器，请先在服务器管理中添加", modal: false, type: "error" })
        return
      }
      selectServer(added.server.id)
    }
    router.push(accountLoginHref(accountId) as Href)
  }

  function handleAccountPress(accountId: string) {
    const item = items.find((candidate) => candidate.accountId === accountId)
    if (!item || globallyBusy || busyAccountId) return
    if (item.status === "reauth-required") { openLogin(accountId); return }
    if (item.isCurrent) return
    void runAccountAction(accountId, async () => {
      await performAccountSwitch({ accountId, currentAccountId: active?.accountId ?? null,
        switchAccount, navigate: () => router.replace("/messages") })
    }).catch(() => undefined)
  }

  function confirmLogout() {
    const accountId = logoutAccountId
    setLogoutAccountId(null)
    if (!accountId) return
    void runAccountAction(accountId, async () => {
      await performAccountLogout({ accountId, signOutAccount, navigate: () => {
        const remaining = accounts.filter((account) => account.id !== accountId)
        router.replace((remaining.length ? "/account-management" : "/login") as Href)
      } })
    }).catch(() => undefined)
  }

  if (!isHydrated) return <ContentState loading message="正在加载账号" />

  return (
    <YStack bg={colors.background0} flex={1}>
      <AppHeader onBackPress={() => router.back()} title="账号管理" />
      {actionError ? (
        <YStack gap="$2" px="$4" py="$2">
          <Paragraph accessibilityLiveRegion="polite" color={colors.destructive}>{actionError}</Paragraph>
          <XGUIButton accessibilityLabel="重试账号操作" disabled={globallyBusy || busyAccountId !== null} onPress={() => retryActionRef.current?.()} size="mini" variant="secondary">重试</XGUIButton>
        </YStack>
      ) : null}
      {globallyBusy || busyAccountId ? (
        <Paragraph accessibilityLiveRegion="polite" accessibilityRole="progressbar" color={colors.textSecondary} px="$4" py="$2">
          {phase === "signing-out" ? "正在退出账号…" : "正在切换账号…"}
        </Paragraph>
      ) : null}
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}>
        <YStack maxW={440} self="center" width="100%">
          {items.length ? (
            <XGUIList>
              {items.map((item, index) => {
                const disabled = globallyBusy || busyAccountId !== null
                return (
                  <XStack borderTopWidth={index ? 1 : 0} borderColor={colors.separator} key={item.accountId} minH={72}>
                    <Pressable
                      accessibilityLabel={item.accessibilityLabel}
                      accessibilityRole="button"
                      accessibilityState={{ busy: busyAccountId === item.accountId, disabled, selected: item.isCurrent }}
                      disabled={disabled}
                      onPress={() => handleAccountPress(item.accountId)}
                      style={({ pressed }) => ({ flex: 1, minHeight: 72, opacity: pressed ? 0.72 : 1 })}
                    >
                      <XStack gap="$3" items="center" minH={72} px="$4" py="$3">
                        <AppAvatar accessibilityLabel={`${item.name}头像`} server={item.target} size={44} type="user" />
                        <YStack flex={1} gap="$1">
                          <XStack gap="$2" items="center">
                            <SizableText color={colors.textPrimary} flex={1} fontWeight="600" numberOfLines={1}>{item.name}</SizableText>
                            <SizableText color={item.status === "reauth-required" ? colors.destructive : colors.brand} size="$2">
                              {item.status === "current" ? "当前" : item.status === "reauth-required" ? "需重新登录" : "切换"}
                            </SizableText>
                          </XStack>
                          {item.email ? <Paragraph color={colors.textSecondary} numberOfLines={1}>{item.email}</Paragraph> : null}
                          <Paragraph color={colors.textPlaceholder} numberOfLines={1}>{item.serverLabel}</Paragraph>
                        </YStack>
                      </XStack>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`退出账号${item.name}`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled }}
                      disabled={disabled}
                      onPress={() => setLogoutAccountId(item.accountId)}
                      style={{ alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 64 }}
                    >
                      <SizableText color={colors.destructive} size="$3">退出</SizableText>
                    </Pressable>
                  </XStack>
                )
              })}
            </XGUIList>
          ) : (
            <ContentState message="本机还没有账号" />
          )}
          <YStack gap="$3" p="$4">
            <XGUIButton accessibilityLabel="添加账号" disabled={globallyBusy || busyAccountId !== null} onPress={() => router.push(addAccountServerHref() as Href)}>
              添加账号
            </XGUIButton>
            <XGUIButton accessibilityLabel="管理服务器" disabled={globallyBusy || busyAccountId !== null} onPress={() => router.push("/server-management?mode=manage" as Href)} variant="secondary">
              服务器管理
            </XGUIButton>
          </YStack>
        </YStack>
      </ScrollView>
      <XGUIActionSheet
        actions={logoutItem ? [{ accessibilityLabel: `确认退出账号${logoutItem.name}`, destructive: true, label: "退出登录", onPress: confirmLogout }] : []}
        description={logoutItem ? `确定退出“${logoutItem.name}”吗？网络失败时账号会保留在本机。` : undefined}
        onOpenChange={(open) => { if (!open) setLogoutAccountId(null) }}
        open={Boolean(logoutItem)}
        title="退出账号"
      />
    </YStack>
  )
}
