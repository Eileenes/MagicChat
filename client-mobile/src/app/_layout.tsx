import { Stack } from "expo-router"

import { AppProviders } from "@/providers/app-providers"

export default function RootLayout() {
  return (
    <AppProviders>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="init" />
        <Stack.Screen name="login" />
        <Stack.Screen name="server-management" />
        <Stack.Screen name="(app)" />
        <Stack.Screen
          name="image-preview"
          options={{ animation: "fade", presentation: "fullScreenModal" }}
        />
      </Stack>
    </AppProviders>
  )
}
