import { Redirect, Stack } from "expo-router"

import { useAuth } from "@/providers/auth-provider"

export default function AppStackLayout() {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return <Redirect href="/init" />
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
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
