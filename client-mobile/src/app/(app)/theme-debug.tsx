import { Redirect } from "expo-router"

import { ThemeDebugScreen } from "@/features/debug/theme-debug-screen"

export default function ThemeDebugRoute() {
  if (!__DEV__) {
    return <Redirect href="/messages" />
  }

  return <ThemeDebugScreen />
}
