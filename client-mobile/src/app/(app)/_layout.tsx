import { Redirect, Stack } from "expo-router"

import { useAuth } from "@/providers/auth-provider"
import { useXGUITheme } from "@/xgui"

export default function AppStackLayout() {
  const { isAuthenticated, isHydrated } = useAuth()
  const { colors } = useXGUITheme()

  if (!isHydrated) return null

  if (!isAuthenticated) {
    return <Redirect href="/server-management" />
  }

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background0 },
        headerShown: false,
      }}
    >
      <Stack.Screen name="(drawer)" />
      <Stack.Screen name="conversation/[conversationId]" />
      <Stack.Screen
        name="conversation/[parentConversationId]/topic/[conversationId]"
      />
      <Stack.Screen name="entity/[entityType]/[entityId]" />
      <Stack.Screen name="search" />
      <Stack.Screen
        name="profile"
        options={{ headerShown: true, title: "个人信息" }}
      />
      <Stack.Screen name="storage" />
      <Stack.Screen name="theme-debug" />
    </Stack>
  )
}
