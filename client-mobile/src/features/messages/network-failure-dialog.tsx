import { AlertDialog, Spinner } from "tamagui"

import { AppButton } from "@/components/forms/app-button"

export function NetworkFailureDialog({
  onRetry,
  open,
  retrying,
}: {
  onRetry: () => void
  open: boolean
  retrying: boolean
}) {
  return (
    <AlertDialog onOpenChange={() => undefined} open={open}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay bg="$shadow6" opacity={0.5} />
        <AlertDialog.Content bordered elevate gap="$4" maxW={440} width="90%">
          <AlertDialog.Title fontSize="$4" lineHeight="$5">
            网络链接失败
          </AlertDialog.Title>
          <AppButton
            accessibilityLabel="重新加载对话数据"
            disabled={retrying}
            icon={retrying ? <Spinner /> : undefined}
            onPress={onRetry}
            theme="teal"
            width="100%"
          >
            {retrying ? "重试中…" : "重试"}
          </AppButton>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  )
}
