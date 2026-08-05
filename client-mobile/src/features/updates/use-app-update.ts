import { useEffect, useRef, useState } from "react"
import { useToastController } from "tamagui"

import type { AppToastTone } from "@/components/feedback/app-toast"
import {
  hasNewAppVersion,
  type AppRelease,
} from "@/features/updates/app-update-model"
import type { AppUpdateDialogStatus } from "@/features/updates/app-update-dialog"
import {
  createAndroidUpdateDownload,
  fetchLatestAppRelease,
  getInstalledAppVersion,
  getMobileUpdatePlatform,
  installAndroidUpdate,
  type AndroidUpdateDownload,
} from "@/features/updates/app-update-service"

export function useAppUpdate() {
  const toast = useToastController()
  const installedVersion = getInstalledAppVersion()
  const platform = getMobileUpdatePlatform()
  const activeDownloadRef = useRef<AndroidUpdateDownload | null>(null)
  const operationRef = useRef(0)
  const [progress, setProgress] = useState(0)
  const [release, setRelease] = useState<AppRelease | null>(null)
  const [status, setStatus] = useState<AppUpdateDialogStatus>("idle")

  useEffect(() => {
    return () => {
      operationRef.current += 1
      void activeDownloadRef.current?.cancel()
      activeDownloadRef.current = null
    }
  }, [])

  async function checkForUpdates() {
    if (status !== "idle") return

    const operation = ++operationRef.current
    setStatus("checking")

    try {
      const latestRelease = await fetchLatestAppRelease(platform)
      if (operation !== operationRef.current) return

      if (installedVersion.build === null) {
        throw new Error("无法读取当前应用的构建版本")
      }

      if (!hasNewAppVersion(installedVersion.build, latestRelease)) {
        setStatus("idle")
        toast.show("已是最新版本", {
          customData: { tone: "success" satisfies AppToastTone },
          message: `当前版本 ${installedVersion.version}`,
        })
        return
      }

      if (platform === "ios") {
        setStatus("idle")
        toast.show("发现新版本", {
          customData: { tone: "success" satisfies AppToastTone },
          message: `当前版本 ${installedVersion.version}，最新版本 ${latestRelease.version}`,
        })
        return
      }

      setRelease(latestRelease)
      setStatus("available")
    } catch (error: unknown) {
      if (operation !== operationRef.current) return
      setStatus("idle")
      toast.show("检查更新失败", {
        customData: { tone: "error" satisfies AppToastTone },
        duration: 4000,
        message: getUpdateErrorMessage(error),
      })
    }
  }

  async function startUpdate() {
    if (status !== "available" || !release) return

    const operation = ++operationRef.current
    setProgress(0)
    setStatus("downloading")

    try {
      const download = createAndroidUpdateDownload(release, (nextProgress) => {
        if (operation === operationRef.current) setProgress(nextProgress)
      })
      activeDownloadRef.current = download

      const fileUri = await download.start()
      if (operation !== operationRef.current) return

      activeDownloadRef.current = null
      setStatus("installing")
      await installAndroidUpdate(fileUri)
      if (operation !== operationRef.current) return

      setRelease(null)
      setStatus("idle")
    } catch (error: unknown) {
      if (operation !== operationRef.current) return
      activeDownloadRef.current = null
      setRelease(null)
      setStatus("idle")
      toast.show("更新失败", {
        customData: { tone: "error" satisfies AppToastTone },
        duration: 4000,
        message: getUpdateErrorMessage(error),
      })
    }
  }

  function cancelUpdate() {
    operationRef.current += 1
    const download = activeDownloadRef.current
    activeDownloadRef.current = null
    setProgress(0)
    setRelease(null)
    setStatus("idle")
    void download?.cancel()
  }

  return {
    cancelUpdate,
    checkForUpdates,
    installedVersion,
    progress,
    release,
    startUpdate,
    status,
  }
}

function getUpdateErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "暂时无法完成更新，请稍后重试。"
}
