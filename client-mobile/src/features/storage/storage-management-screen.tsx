import { useCallback, useEffect, useState } from "react"
import { Alert, RefreshControl } from "react-native"
import { Card, Paragraph, ScrollView, SizableText, Spinner, XStack, YStack } from "tamagui"

import { AppButton } from "@/components/forms/app-button"
import { clearStorage, formatStorageSize, readStorageStats, type StorageStats } from "@/features/storage/storage-service"

export function StorageManagementScreen() {
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    try { setStats(await readStorageStats()) }
    catch { Alert.alert("统计失败", "暂时无法读取存储空间，请稍后重试。") }
  }, [])
  useEffect(() => {
    let active = true
    readStorageStats()
      .then((value) => {
        if (active) setStats(value)
      })
      .catch(() => {
        if (active) {
          Alert.alert("统计失败", "暂时无法读取存储空间，请稍后重试。")
        }
      })
    return () => {
      active = false
    }
  }, [])

  function confirm(parts: readonly ("media" | "messages")[], label: string) {
    if (busy) return
    Alert.alert(`清理${label}`, "本操作仅删除本机离线副本，不影响服务器数据，是否继续？", [
      { text: "取消", style: "cancel" },
      { text: "清理", style: "destructive", onPress: () => void runClear(parts, label) },
    ])
  }
  async function runClear(parts: readonly ("media" | "messages")[], label: string) {
    if (busy) return
    setBusy(true)
    try {
      const { failed } = await clearStorage(parts)
      await refresh()
      if (!failed.length) Alert.alert("清理完成", `${label}的本机离线副本已清理。`)
      else if (failed.length === parts.length) Alert.alert("清理失败", "未能清理所选内容，请稍后重试。")
      else Alert.alert("部分清理失败", `${failed.includes("media") ? "媒体与文件" : "离线消息"}未能清理，其余内容已清理。`)
    } finally { setBusy(false) }
  }

  return <ScrollView bg="$background" refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} />}>
    <YStack gap="$4" maxW={440} p="$4" self="center" width="100%">
      <SizableText fontWeight="700" size="$7">存储空间</SizableText>
      <Paragraph color="$gray10">以下为全局约值，不区分账号；清理只会删除本机离线副本。</Paragraph>
      <Card bg="$background" gap="$4" p="$4" rounded="$5">
        <StorageRow label="媒体与文件（约）" value={stats ? formatStorageSize(stats.mediaBytes) : "统计中…"} />
        <StorageRow label="离线消息（约）" value={stats ? formatStorageSize(stats.messageBytes) : "统计中…"} />
        <StorageRow label="总计（约）" value={stats ? formatStorageSize(stats.totalBytes) : "统计中…"} />
      </Card>
      <AppButton disabled={busy} onPress={() => confirm(["media"], "媒体与文件")} variant="outlined">清理媒体与文件</AppButton>
      <AppButton disabled={busy} onPress={() => confirm(["messages"], "离线消息")} variant="outlined">清理离线消息</AppButton>
      <AppButton disabled={busy} onPress={() => confirm(["media", "messages"], "全部内容")}>{busy ? <Spinner size="small" /> : "清理全部"}</AppButton>
    </YStack>
  </ScrollView>
}
function StorageRow({ label, value }: { label: string; value: string }) {
  return <XStack justify="space-between"><SizableText>{label}</SizableText><SizableText fontWeight="600">{value}</SizableText></XStack>
}
