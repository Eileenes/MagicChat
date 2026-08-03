import { useCallback, useEffect, useRef, useState } from "react"
import { useToastController } from "tamagui"

import type { AppToastTone } from "@/components/feedback/app-toast"
import type { PreparedClientMessageUpload } from "@/data/messages/message-upload"

type UploadPicker = () => Promise<PreparedClientMessageUpload | null>

export function useComposerUpload({
  disabled,
  onSend,
}: {
  disabled: boolean
  onSend: (selection: PreparedClientMessageUpload) => Promise<boolean>
}) {
  const toast = useToastController()
  const mountedRef = useRef(true)
  const selectedRef = useRef<PreparedClientMessageUpload | null>(null)
  const uploadInFlightRef = useRef(false)
  const [preparing, setPreparing] = useState(false)
  const [selected, setSelected] =
    useState<PreparedClientMessageUpload | null>(null)

  const replaceSelected = useCallback(
    (selection: PreparedClientMessageUpload | null) => {
      if (selectedRef.current !== selection) {
        selectedRef.current?.cleanup?.()
      }
      selectedRef.current = selection
      if (mountedRef.current) setSelected(selection)
    },
    []
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (!uploadInFlightRef.current) {
        selectedRef.current?.cleanup?.()
        selectedRef.current = null
      }
    }
  }, [])

  const pick = useCallback(
    async (picker: UploadPicker) => {
      setPreparing(true)

      try {
        const selection = await picker()
        if (selection) {
          if (mountedRef.current) replaceSelected(selection)
          else selection.cleanup?.()
        }
      } catch (error: unknown) {
        toast.show("无法选择文件", {
          customData: { tone: "error" satisfies AppToastTone },
          duration: 4000,
          message: error instanceof Error ? error.message : "请稍后重试",
        })
      } finally {
        if (mountedRef.current) setPreparing(false)
      }
    },
    [replaceSelected, toast]
  )

  const confirm = useCallback(async () => {
    if (!selected || disabled) return

    const selection = selected
    uploadInFlightRef.current = true
    try {
      if (await onSend(selection)) replaceSelected(null)
    } finally {
      uploadInFlightRef.current = false
      if (!mountedRef.current && selectedRef.current === selection) {
        replaceSelected(null)
      }
    }
  }, [disabled, onSend, replaceSelected, selected])

  const cancel = useCallback(() => replaceSelected(null), [replaceSelected])

  return { cancel, confirm, pick, preparing, selected }
}
