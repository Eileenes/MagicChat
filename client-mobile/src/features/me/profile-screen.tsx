import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import * as ImagePicker from "expo-image-picker"
import { ChevronRight } from "lucide-react-native"
import { Alert } from "react-native"
import {
  Avatar,
  Card,
  Paragraph,
  Sheet,
  SizableText,
  Spinner,
  XStack,
  YStack,
} from "tamagui"

import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import { AppButton } from "@/components/forms/app-button"
import { AppInput } from "@/components/forms/app-input"
import { ThemedIcon } from "@/components/icons/themed-icon"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { queryKeys } from "@/data/query"
import { prepareAvatar } from "@/data/users/avatar-image"
import {
  updateCurrentUserNickname,
  uploadCurrentUserAvatar,
} from "@/data/users/current-user-api"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { useClientData } from "@/providers/client-data-provider"

export function ProfileScreen() {
  const session = useAuthenticatedSession()
  const { currentUser } = useClientData()
  const queryClient = useQueryClient()
  const [nicknameDraft, setNicknameDraft] = useState<string | null>(null)
  const [savingNickname, setSavingNickname] = useState(false)
  const [savingAvatar, setSavingAvatar] = useState(false)
  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false)
  const [nicknameSheetOpen, setNicknameSheetOpen] = useState(false)
  const nickname = nicknameDraft ?? currentUser?.nickname ?? ""
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

  function openNicknameEditor() {
    setNicknameDraft(currentUser?.nickname ?? "")
    setNicknameSheetOpen(true)
  }

  async function saveNickname() {
    setSavingNickname(true)
    try {
      await updateCurrentUserNickname(session.url, nickname)
      await refreshProfileQueries()
      setNicknameDraft(null)
      setNicknameSheetOpen(false)
    } catch (error) {
      Alert.alert(
        "修改昵称失败",
        error instanceof Error ? error.message : "请稍后重试"
      )
    } finally {
      setSavingNickname(false)
    }
  }

  async function chooseAvatar(source: "camera" | "library") {
    setAvatarSheetOpen(false)
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
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options)
      if (result.canceled) return
      setSavingAvatar(true)
      const prepared = await prepareAvatar(result.assets[0])
      try {
        await uploadCurrentUserAvatar(session.url, prepared.uri)
        await refreshProfileQueries()
      } finally {
        prepared.cleanup()
      }
    } catch (error) {
      Alert.alert(
        "修改头像失败",
        error instanceof Error ? error.message : "请稍后重试"
      )
    } finally {
      setSavingAvatar(false)
    }
  }

  return (
    <>
      <KeyboardAwareScreen contentBackground="$backgroundLight" edges={[]}>
        <YStack maxW={440} py="$4" self="center" width="100%">
          <Card bg="$background" overflow="hidden" rounded={0}>
            <ProfileRow
              label="头像"
              minHeight={96}
              onPress={() => setAvatarSheetOpen(true)}
            >
              <XStack gap="$3" items="center">
                <Avatar rounded="$4" size="$7">
                  <CachedAvatarImage
                    avatar={currentUser?.avatar ?? ""}
                    server={session}
                  />
                  <Avatar.Fallback bg="$color3" items="center" justify="center">
                    <SizableText fontWeight="600" size="$6">
                      {Array.from(displayName)[0] ?? "即"}
                    </SizableText>
                  </Avatar.Fallback>
                </Avatar>
                {savingAvatar ? (
                  <Spinner size="small" />
                ) : (
                  <ThemedIcon icon={ChevronRight} size={19} />
                )}
              </XStack>
            </ProfileRow>
            <ProfileRow label="昵称" onPress={openNicknameEditor}>
              <XStack gap="$2" items="center">
                <SizableText color="$gray10" maxW={220} numberOfLines={1} size="$4">
                  {displayName}
                </SizableText>
                <ThemedIcon icon={ChevronRight} size={19} />
              </XStack>
            </ProfileRow>
            <ProfileRow label="邮箱" last>
              <SizableText color="$gray10" maxW={240} numberOfLines={1} size="$4">
                {currentUser?.email ?? "未设置"}
              </SizableText>
            </ProfileRow>
          </Card>
        </YStack>
      </KeyboardAwareScreen>

      <Sheet
        dismissOnSnapToBottom
        modal
        onOpenChange={setNicknameSheetOpen}
        open={nicknameSheetOpen}
        snapPoints={[38]}
      >
        <Sheet.Overlay bg="$shadow6" opacity={0.45} />
        <Sheet.Frame gap="$4" p="$5">
          <Sheet.Handle />
          <YStack gap="$1">
            <SizableText fontWeight="700" size="$5">
              修改昵称
            </SizableText>
            <Paragraph color="$gray10" size="$3">
              昵称会显示在会话和成员列表中
            </Paragraph>
          </YStack>
          <AppInput
            accessibilityLabel="昵称"
            autoFocus
            disabled={savingNickname}
            maxLength={64}
            onChangeText={setNicknameDraft}
            placeholder="输入昵称"
            value={nickname}
          />
          <XStack gap="$3">
            <AppButton
              flex={1}
              onPress={() => setNicknameSheetOpen(false)}
              variant="outlined"
            >
              取消
            </AppButton>
            <AppButton
              disabled={
                savingNickname ||
                nickname.trim() === (currentUser?.nickname ?? "").trim()
              }
              flex={1}
              onPress={() => void saveNickname()}
            >
              {savingNickname ? "正在保存…" : "保存"}
            </AppButton>
          </XStack>
        </Sheet.Frame>
      </Sheet>

      <Sheet
        dismissOnSnapToBottom
        modal
        onOpenChange={setAvatarSheetOpen}
        open={avatarSheetOpen}
        snapPoints={[34]}
      >
        <Sheet.Overlay bg="$shadow6" opacity={0.45} />
        <Sheet.Frame gap="$3" p="$5">
          <Sheet.Handle />
          <YStack gap="$1" mb="$1">
            <SizableText fontWeight="700" size="$5">
              更换头像
            </SizableText>
            <Paragraph color="$gray10" size="$3">
              图片将裁剪并压缩为正方形头像
            </Paragraph>
          </YStack>
          <AppButton onPress={() => void chooseAvatar("camera")}>拍照</AppButton>
          <AppButton
            onPress={() => void chooseAvatar("library")}
            variant="outlined"
          >
            从相册选择
          </AppButton>
        </Sheet.Frame>
      </Sheet>
    </>
  )
}

function ProfileRow({
  children,
  label,
  last = false,
  minHeight = 68,
  onPress,
}: {
  children: React.ReactNode
  label: string
  last?: boolean
  minHeight?: number
  onPress?: () => void
}) {
  return (
    <XStack
      accessibilityLabel={label}
      accessibilityRole={onPress ? "button" : "text"}
      bg="$background"
      items="center"
      minH={minHeight}
      onPress={onPress}
      pressStyle={onPress ? { background: "$backgroundPress" } : undefined}
      px="$4"
    >
      <SizableText fontWeight="500" size="$4">
        {label}
      </SizableText>
      <XStack
        borderBottomColor="$borderColor"
        borderBottomWidth={last ? 0 : 1}
        flex={1}
        items="center"
        justify="flex-end"
        minH={minHeight}
      >
        {children}
      </XStack>
    </XStack>
  )
}
