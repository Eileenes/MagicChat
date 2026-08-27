import { useQueryClient } from "@tanstack/react-query"
import { Redirect, type Href, useLocalSearchParams, useRouter } from "expo-router"
import { useRef, useState } from "react"
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { YStack } from "tamagui"

import type { ServerConfig } from "@/core/server-model"
import { queryKeys } from "@/data/query"
import { ServerListItem } from "@/features/servers/server-list-item"
import { parseServerManagementMode } from "@/features/accounts/account-management-model"
import { useAuth } from "@/providers/auth-provider"
import { useServers } from "@/providers/server-provider"
import {
  XGUIActionSheet,
  XGUIButton,
  XGUIFooter,
  XGUIList,
  useXGUITheme,
} from "@/xgui"

export function ServerManagementScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ mode?: string }>()
  const mode = parseServerManagementMode(params.mode)
  const queryClient = useQueryClient()
  const { invalidateSession, isAuthenticated, session } = useAuth()
  const {
    recentServerId,
    removeServer,
    selectServer,
    servers,
  } = useServers()
  const { colors } = useXGUITheme()
  const { height: windowHeight } = useWindowDimensions()
  const [serverForActions, setServerForActions] =
    useState<ServerConfig | null>(null)
  const [serverToDelete, setServerToDelete] = useState<ServerConfig | null>(null)
  const closeOpenSwipeableRef = useRef<(() => void) | null>(null)
  const selectionAttemptRef = useRef(0)

  if (isAuthenticated && mode === "default") return <Redirect href="/messages" />

  function closeOpenSwipeable() {
    closeOpenSwipeableRef.current?.()
    closeOpenSwipeableRef.current = null
  }

  function handleSwipeableOpen(close: () => void) {
    if (closeOpenSwipeableRef.current !== close) {
      closeOpenSwipeableRef.current?.()
      closeOpenSwipeableRef.current = close
    }
  }

  function handleSwipeableClose(close: () => void) {
    if (closeOpenSwipeableRef.current === close) {
      closeOpenSwipeableRef.current = null
    }
  }

  function handleOpenEditor(server?: ServerConfig) {
    closeOpenSwipeable()
    setServerForActions(null)
    const href = server
      ? `/server-editor?serverId=${encodeURIComponent(server.id)}`
      : "/server-editor"
    router.push(href as Href)
  }

  function handleRequestActions(server: ServerConfig) {
    closeOpenSwipeable()
    setServerForActions(server)
  }

  function handleRequestDelete(server: ServerConfig) {
    closeOpenSwipeable()
    setServerForActions(null)
    setServerToDelete(server)
  }

  async function handleSelect(server: ServerConfig) {
    if (mode === "manage") { handleRequestActions(server); return }
    const attempt = ++selectionAttemptRef.current
    closeOpenSwipeable()
    if (!isAuthenticated) await invalidateSession()
    if (attempt !== selectionAttemptRef.current) return

    await queryClient.cancelQueries({
      exact: true,
      queryKey: queryKeys.appInfo(server),
    })
    if (attempt !== selectionAttemptRef.current) return

    queryClient.removeQueries({
      exact: true,
      queryKey: queryKeys.appInfo(server),
    })
    selectServer(server.id)
    if (mode === "add-account") router.push("/login?mode=add-account&returnTo=account-management" as Href)
    else router.replace("/login")
  }

  async function handleDelete(server: ServerConfig) {
    const deletesSessionServer = session?.id === server.id
    if (deletesSessionServer && !isAuthenticated) await invalidateSession()

    removeServer(server.id)
    setServerToDelete(null)
  }

  return (
    <YStack bg={colors.background0} flex={1}>
      <SafeAreaView
        edges={["top", "bottom"]}
        style={[styles.fill, { backgroundColor: colors.background0 }]}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <YStack grow={1} items="center" onPress={closeOpenSwipeable}>
            {mode !== "default" ? (
              <YStack maxW={440} pt="$3" px="$4" width="100%">
                <XGUIButton accessibilityLabel={mode === "add-account" ? "取消添加账号" : "返回账号设置"} onPress={() => router.back()} size="mini" variant="secondary">
                  返回
                </XGUIButton>
              </YStack>
            ) : null}
            <Text style={[styles.pageTitle, { color: colors.textPrimary }]}>
              {mode === "manage" ? "服务器管理" : mode === "add-account" ? "选择要添加账号的服务器" : "选择服务器"}
            </Text>
            <YStack maxW={440} mt={48} px="$4" width="100%">
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator
                style={{ maxHeight: windowHeight * 0.5 }}
              >
                <XGUIList variant="form-radio">
                {servers.map((server, index) => (
                  <ServerListItem
                    isRecentlyUsed={server.id === recentServerId}
                    key={server.id}
                    onDelete={() => handleRequestDelete(server)}
                    onEdit={() => handleOpenEditor(server)}
                    onRequestActions={() => handleRequestActions(server)}
                    onSelect={() => void handleSelect(server)}
                    onSwipeableClose={handleSwipeableClose}
                    onSwipeableOpen={handleSwipeableOpen}
                    separator={index > 0}
                    server={server}
                  />
                ))}
                </XGUIList>
              </ScrollView>
              <YStack pt="$4">
                <XGUIButton
                  accessibilityLabel="添加服务器"
                  onPress={() => handleOpenEditor()}
                  variant="secondary"
                >
                  添加服务器
                </XGUIButton>
              </YStack>
            </YStack>
            <YStack mt="auto" pb="$4" pt="$8">
              <XGUIFooter
                links={[
                  { label: "即应", url: "https://jiying.chat/" },
                  { label: "长亭科技", url: "https://chaitin.cn/" },
                ]}
                text="© 2026 北京长亭科技有限公司 版权所有"
              />
            </YStack>
          </YStack>
        </ScrollView>
      </SafeAreaView>

      <XGUIActionSheet
        actions={
          serverForActions
            ? [
                {
                  accessibilityLabel: `修改${serverForActions.name}`,
                  label: "修改",
                  onPress: () => handleOpenEditor(serverForActions),
                },
                {
                  accessibilityLabel: `删除${serverForActions.name}`,
                  destructive: true,
                  label: "删除",
                  onPress: () => handleRequestDelete(serverForActions),
                },
              ]
            : []
        }
        onOpenChange={(open) => {
          if (!open) setServerForActions(null)
        }}
        open={serverForActions !== null}
        title={serverForActions?.name}
      />

      <XGUIActionSheet
        actions={
          serverToDelete
            ? [
                {
                  accessibilityLabel: `确认删除${serverToDelete.name}`,
                  destructive: true,
                  label: "删除",
                  onPress: () => void handleDelete(serverToDelete),
                },
              ]
            : []
        }
        description={
          serverToDelete
            ? `确定删除“${serverToDelete.name}”吗？此操作无法撤销。`
            : undefined
        }
        onOpenChange={(open) => {
          if (!open) setServerToDelete(null)
        }}
        open={serverToDelete !== null}
        title="删除服务器"
      />
    </YStack>
  )
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: "500",
    lineHeight: 30,
    marginTop: 56,
    paddingHorizontal: 32,
    textAlign: "center",
  },
  scrollContent: {
    flexGrow: 1,
  },
})
