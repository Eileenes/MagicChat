import {
  type EventSubscription,
  requireOptionalNativeModule,
} from "expo-modules-core"
import { Platform } from "react-native"

import {
  normalizeJPushNotificationResponse,
  type JPushNotificationResponse,
  type NativeJPushNotificationResponse,
} from "@/notifications/jpush-notification-response"

type JPushRegistrationNativeModule = {
  addListener: (
    eventName: "onNotificationResponse",
    listener: (response: NativeJPushNotificationResponse) => void
  ) => EventSubscription
  clearLastNotificationResponseAsync: () => Promise<void>
  getLastNotificationResponseAsync: () => Promise<NativeJPushNotificationResponse | null>
  getRegistrationIdAsync: () => Promise<string>
  initializeAsync: (privacyAccepted: boolean) => Promise<boolean>
  isConfiguredAsync: () => Promise<boolean>
  stopAsync: () => Promise<void>
}

const nativeModule = requireOptionalNativeModule<JPushRegistrationNativeModule>(
  "MagicChatJPushRegistration"
)

export async function isJPushConfigured() {
  return (
    Platform.OS === "android" &&
    Boolean(nativeModule) &&
    Boolean(await nativeModule?.isConfiguredAsync())
  )
}

export async function readJPushRegistrationID(privacyAccepted: boolean) {
  if (Platform.OS !== "android" || !nativeModule || !privacyAccepted) return ""
  if (!(await nativeModule.initializeAsync(true))) return ""
  return (await nativeModule.getRegistrationIdAsync()).trim()
}

export async function stopJPush() {
  if (Platform.OS !== "android" || !nativeModule) return
  await nativeModule.stopAsync()
}

export function addJPushNotificationResponseListener(
  listener: (response: JPushNotificationResponse) => void
) {
  if (Platform.OS !== "android" || !nativeModule) return null
  return nativeModule.addListener("onNotificationResponse", (response) => {
    const normalized = normalizeJPushNotificationResponse(response)
    if (normalized) listener(normalized)
  })
}

export async function getLastJPushNotificationResponse() {
  if (Platform.OS !== "android" || !nativeModule) return null
  return normalizeJPushNotificationResponse(
    await nativeModule.getLastNotificationResponseAsync()
  )
}

export async function clearLastJPushNotificationResponse() {
  if (Platform.OS !== "android" || !nativeModule) return
  await nativeModule.clearLastNotificationResponseAsync()
}
