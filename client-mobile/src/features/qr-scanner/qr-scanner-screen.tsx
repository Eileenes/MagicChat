import {
  CameraView,
  type BarcodeScanningResult,
  type CameraMountError,
  useCameraPermissions,
} from "expo-camera"
import { type Href, useIsFocused, useRouter } from "expo-router"
import { useEffect, useRef, useState } from "react"
import { Linking, StyleSheet, Text, View } from "react-native"

import { AppHeader } from "@/components/navigation/app-header"
import { classifyQrContent } from "@/features/qr-scanner/qr-content-classifier"
import { XGUIActionSheet, XGUILoadingIcon, useXGUITheme } from "@/xgui"

export function QrScannerScreen() {
  const router = useRouter()
  const isFocused = useIsFocused()
  const { colors } = useXGUITheme()
  const [permission, requestPermission] = useCameraPermissions()
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [permissionSheetOpen, setPermissionSheetOpen] = useState(false)
  const permissionPromptedRef = useRef(false)
  const scanLockedRef = useRef(false)

  useEffect(() => {
    if (
      !isFocused ||
      !permission ||
      permission.granted ||
      permissionPromptedRef.current
    ) {
      return
    }

    permissionPromptedRef.current = true
    setPermissionSheetOpen(true)
  }, [isFocused, permission])

  function handleBarcodeScanned({ data, type }: BarcodeScanningResult) {
    if (scanLockedRef.current || type !== "qr") return

    scanLockedRef.current = true
    const result = classifyQrContent(data)
    const href = (
      result.kind === "web"
        ? { pathname: "/qr-webview", params: { url: result.url } }
        : { pathname: "/qr-result", params: { content: result.content } }
    ) as unknown as Href
    router.replace(href)
  }

  function handleMountError(error: CameraMountError) {
    setCameraError(error.message || "相机启动失败，请稍后重试")
  }

  let content
  if (!permission) {
    content = <XGUILoadingIcon color={colors.textPlaceholder} size={40} />
  } else if (!permission.granted) {
    content = (
      <View style={styles.messagePanel}>
        <Text style={[styles.messageTitle, { color: colors.textPrimary }]}>需要相机权限</Text>
        <Text style={[styles.messageBody, { color: colors.textSecondary }]}>允许即应使用相机扫描二维码</Text>
      </View>
    )
  } else if (cameraError) {
    content = (
      <View style={styles.messagePanel}>
        <Text style={[styles.messageTitle, { color: colors.textPrimary }]}>无法使用相机</Text>
        <Text style={[styles.messageBody, { color: colors.textSecondary }]}>{cameraError}</Text>
      </View>
    )
  } else if (isFocused) {
    content = (
      <View style={styles.cameraContainer}>
        <CameraView
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          facing="back"
          onBarcodeScanned={handleBarcodeScanned}
          onMountError={handleMountError}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.scanFrame} />
          <Text style={styles.hint}>将二维码放入框内，即可自动扫描</Text>
        </View>
      </View>
    )
  } else {
    content = null
  }

  return (
    <>
      <View style={[styles.screen, { backgroundColor: colors.background0 }]}>
        <AppHeader onBackPress={() => router.back()} title="扫一扫" />
        <View style={styles.content}>{content}</View>
      </View>
      <XGUIActionSheet
        actions={[
          {
            deferUntilClosed: true,
            label: permission?.canAskAgain ? "允许使用相机" : "前往系统设置",
            onPress: () =>
              void (permission?.canAskAgain
                ? requestPermission()
                : Linking.openSettings()),
          },
        ]}
        description="相机仅用于扫描二维码"
        onOpenChange={setPermissionSheetOpen}
        open={permissionSheetOpen}
        title="需要相机权限"
      />
    </>
  )
}

const styles = StyleSheet.create({
  cameraContainer: { alignSelf: "stretch", flex: 1, width: "100%" },
  content: { alignItems: "center", flex: 1, justifyContent: "center" },
  hint: { color: "#FFFFFF", fontSize: 15, marginTop: 24, textAlign: "center" },
  messageBody: { fontSize: 15, lineHeight: 22, marginTop: 8, textAlign: "center" },
  messagePanel: { alignItems: "center", paddingHorizontal: 32 },
  messageTitle: { fontSize: 20, fontWeight: "600" },
  overlay: { alignItems: "center", bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  scanFrame: { borderColor: "#FFFFFF", borderRadius: 8, borderWidth: 2, height: 240, width: 240 },
  screen: { flex: 1 },
})
