import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import * as ImagePicker from "expo-image-picker"
import * as MediaLibrary from "expo-media-library/legacy"
import { useRouter, type Href } from "expo-router"
import { StyleSheet, View } from "react-native"
import {
  Spinner,
  XStack,
  YStack,
} from "tamagui"

import { AppAvatar } from "@/components/avatar/app-avatar"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { AppHeader } from "@/components/navigation/app-header"
import { queryKeys } from "@/data/query"
import { prepareAvatar } from "@/data/users/avatar-image"
import { uploadCurrentUserAvatar } from "@/data/users/current-user-api"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { useClientData } from "@/providers/client-data-provider"
import { createMediaPickerRequest } from "@/features/media-picker/media-picker-registry"
import {
  XGUIActionSheet,
  XGUIList,
  XGUIListItem,
  useXGUITheme,
  useXGUIToast,
} from "@/xgui"

export function ProfileScreen() {
  const router = useRouter()
  const session = useAuthenticatedSession()
  const { currentUser } = useClientData()
  const queryClient = useQueryClient()
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const [savingAvatar, setSavingAvatar] = useState(false)
  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false)
  const displayName =
    currentUser?.nickname.trim() ||
    currentUser?.name.trim() ||
    currentUser?.email ||
    "当前账号"

  async function refreshProfileQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.currentUser(session) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts(session) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(session) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.userProfiles(session) }),
    ])
  }

  async function chooseAvatar(source: "camera" | "library") {
    if (savingAvatar) return
    setAvatarSheetOpen(false)
    if (source === "library") {
      const requestId = createMediaPickerRequest({
        confirmLabel: "确定",
        mode: "single",
        onSelect: async ([asset]) => {
          if (!asset) return
          const info = await MediaLibrary.getAssetInfoAsync(asset)
          await saveAvatar({
            fileName: asset.filename,
            height: asset.height,
            mimeType: mimeTypeForName(asset.filename),
            uri: info.localUri ?? info.uri,
            width: asset.width,
          })
        },
      })
      router.push({ pathname: "/media-picker", params: { requestId } } as unknown as Href)
      return
    }
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync()
        if (!permission.granted) throw new Error("请先允许相机权限")
      }
      const options: ImagePicker.ImagePickerOptions = {
        allowsEditing: true,
        aspect: [1, 1],
        mediaTypes: ["images"],
        quality: 1,
      }
      const result = await ImagePicker.launchCameraAsync(options)
      if (result.canceled) return
      setSavingAvatar(true)
      const prepared = await prepareAvatar(result.assets[0])
      try {
        await uploadCurrentUserAvatar(session.url, prepared.uri)
        await refreshProfileQueries()
        toast.show({ message: "头像已更新", type: "success" })
      } finally {
        prepared.cleanup()
      }
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "修改头像失败，请稍后重试",
        type: "error",
      })
    } finally {
      setSavingAvatar(false)
    }
  }

  async function saveAvatar(source: Parameters<typeof prepareAvatar>[0]) {
    if (savingAvatar) return
    setSavingAvatar(true)
    try {
      const prepared = await prepareAvatar(source)
      try {
        await uploadCurrentUserAvatar(session.url, prepared.uri)
        await refreshProfileQueries()
        toast.show({ message: "头像已更新", type: "success" })
      } finally { prepared.cleanup() }
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : "修改头像失败，请稍后重试", type: "error" })
    } finally { setSavingAvatar(false) }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background0 }]}>
      <AppHeader onBackPress={router.back} title="个人信息" />
      <KeyboardAwareScreen contentBackground={colors.background0} edges={[]}>
        <YStack maxW={440} self="center" width="100%">
          <XGUIList size="large">
            <XGUIListItem
              disabled={savingAvatar}
              minHeight={96}
              onPress={() => setAvatarSheetOpen(true)}
              title="头像"
              trailing={
                <XStack gap="$3" items="center">
                  <AppAvatar accessibilityLabel={displayName} avatar={currentUser?.avatar} server={session} size="$7" type="user" />
                  {savingAvatar ? <Spinner size="small" /> : null}
                </XStack>
              }
            />
          </XGUIList>
          <XGUIList size="large">
            <XGUIListItem
              onPress={() => router.push("/profile-nickname" as Href)}
              title="昵称"
              value={currentUser?.nickname.trim() || "未设置"}
              valuePlaceholder={!currentUser?.nickname.trim()}
            />
            <XGUIListItem
              separator
              title="姓名"
              value={currentUser?.name.trim() || "未设置"}
              valuePlaceholder={!currentUser?.name.trim()}
            />
            <XGUIListItem
              separator
              title="邮箱"
              value={currentUser?.email.trim() || "未设置"}
              valuePlaceholder={!currentUser?.email.trim()}
            />
            <XGUIListItem
              separator
              title="手机"
              value={currentUser?.phone.trim() || "未设置"}
              valuePlaceholder={!currentUser?.phone.trim()}
            />
          </XGUIList>
        </YStack>
      </KeyboardAwareScreen>

      <XGUIActionSheet
        actions={[
          {
            deferUntilClosed: true,
            disabled: savingAvatar,
            label: "拍照",
            onPress: () => void chooseAvatar("camera"),
          },
          {
            deferUntilClosed: true,
            disabled: savingAvatar,
            label: "从相册选择",
            onPress: () => void chooseAvatar("library"),
          },
        ]}
        onOpenChange={setAvatarSheetOpen}
        open={avatarSheetOpen}
        title="修改头像"
      />
    </View>
  )
}

function mimeTypeForName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase()
  if (extension === "png") return "image/png"
  if (extension === "webp") return "image/webp"
  if (extension === "heic" || extension === "heif") return "image/heic"
  return "image/jpeg"
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
})
