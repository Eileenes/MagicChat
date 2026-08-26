import { Dialog, Progress, SizableText, VisuallyHidden, XStack, YStack } from "tamagui"

import { AppButton } from "@/components/forms/app-button"
import type { AppRelease } from "@/features/updates/app-update-model"
import { XGUILoadingIcon, useXGUITheme } from "@/xgui"

export type AppUpdateDialogStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"

export function AppUpdateDialog({
  onCancel,
  onConfirm,
  progress,
  release,
  status,
}: {
  onCancel: () => void
  onConfirm: () => void
  progress: number
  release: AppRelease | null
  status: AppUpdateDialogStatus
}) {
  const { colors } = useXGUITheme()
  const open =
    Boolean(release) && (status === "downloading" || status === "installing")
  const busy = status === "downloading" || status === "installing"
  const percent = Math.round(progress * 100)

  return (
    <Dialog
      modal
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onCancel()
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay bg="$shadow6" opacity={0.5} />
        <Dialog.Content bordered elevate gap="$4" maxW={440} width="90%">
          <Dialog.Title fontSize="$4" lineHeight="$5">
            {status === "available" ? "发现新版本" : "正在更新"}
          </Dialog.Title>
          <VisuallyHidden>
            <Dialog.Description>
              下载新版本并调用 Android 系统安装器
            </Dialog.Description>
          </VisuallyHidden>

          {release ? (
            <SizableText color="$color11" size="$4">
              新版本 {release.version}
            </SizableText>
          ) : null}

          {status === "available" ? (
            <SizableText color="$gray10" size="$3">
              是否立即下载并安装？
            </SizableText>
          ) : null}

          {status === "downloading" ? (
            <YStack gap="$2">
              <XStack items="center" justify="space-between">
                <SizableText color="$gray10" size="$3">
                  正在下载安装包
                </SizableText>
                <SizableText color="$color10" size="$3">
                  {percent}%
                </SizableText>
              </XStack>
              <Progress bg="$color3" height={8} value={percent}>
                <Progress.Indicator bg="$color10" />
              </Progress>
            </YStack>
          ) : null}

          {status === "installing" ? (
            <XStack gap="$2" items="center">
              <XGUILoadingIcon color={colors.textPlaceholder} size={20} />
              <SizableText color="$gray10" size="$3">
                正在打开系统安装器…
              </SizableText>
            </XStack>
          ) : null}

          {status === "available" ? (
            <XStack gap="$3" width="100%">
              <AppButton
                accessibilityLabel="暂不更新"
                grow={1}
                onPress={onCancel}
                theme="gray"
              >
                取消
              </AppButton>
              <AppButton
                accessibilityLabel="下载并安装新版本"
                grow={1}
                onPress={onConfirm}
                theme="accent"
              >
                更新
              </AppButton>
            </XStack>
          ) : null}

          {status === "downloading" ? (
            <AppButton
              accessibilityLabel="取消下载"
              onPress={onCancel}
              theme="gray"
              width="100%"
            >
              取消下载
            </AppButton>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
