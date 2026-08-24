import { FileText } from "lucide-react-native"
import { Image, StyleSheet, Text, View } from "react-native"

import type { PreparedClientMessageUpload } from "@/data/messages/message-upload"
import { formatFileSize } from "@/domain/messages/message-presenter"
import { XGUIActionSheet, useXGUITheme } from "@/xgui"

export function MessageUploadDialog({
  onCancel,
  onConfirm,
  selections,
  sending,
}: {
  onCancel: () => void
  onConfirm: () => void
  selections: readonly PreparedClientMessageUpload[]
  sending: boolean
}) {
  const { colors } = useXGUITheme()
  if (selections.length === 0) return null

  const isImage = selections.every((selection) => selection.kind === "image")
  const firstSelection = selections[0]
  if (!firstSelection) return null
  const title = isImage
    ? selections.length > 1
      ? `发送 ${selections.length} 张图片`
      : "发送图片"
    : "发送文件"

  return (
    <XGUIActionSheet
      actions={[
        {
          accessibilityLabel: title,
          closeOnPress: false,
          disabled: sending,
          label: sending ? "发送中…" : "发送",
          onPress: onConfirm,
        },
      ]}
      cancelDisabled={sending}
      onOpenChange={(open) => {
        if (!open && !sending) onCancel()
      }}
      open
      title={title}
    >
      <View style={styles.content}>
        {isImage ? (
          <View style={styles.imageRow}>
            {selections.map((selection, index) => (
              <Image
                accessibilityLabel={`待发送图片 ${index + 1}`}
                key={`${selection.upload.uri}-${index}`}
                resizeMode="contain"
                source={{ uri: selection.upload.uri }}
                style={[
                  selections.length === 1 ? styles.image : styles.thumbnail,
                  { backgroundColor: colors.background1 },
                ]}
              />
            ))}
          </View>
        ) : (
          <View
            style={[
              styles.file,
              {
                backgroundColor: colors.background1,
                borderColor: colors.separator,
              },
            ]}
          >
            <FileText color={colors.textSecondary} size={24} />
            <View style={styles.fileText}>
              <Text
                numberOfLines={1}
                style={[styles.fileName, { color: colors.textPrimary }]}
              >
                {firstSelection.upload.name}
              </Text>
              <Text style={[styles.fileSize, { color: colors.textPlaceholder }]}>
                {formatFileSize(firstSelection.upload.sizeBytes)}
              </Text>
            </View>
          </View>
        )}
      </View>
    </XGUIActionSheet>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  file: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  fileName: {
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 22,
  },
  fileSize: {
    fontSize: 13,
    lineHeight: 18,
  },
  fileText: {
    flex: 1,
    minWidth: 0,
  },
  image: {
    borderRadius: 8,
    height: 180,
    width: "100%",
  },
  imageRow: {
    flexDirection: "row",
    gap: 4,
  },
  thumbnail: {
    borderRadius: 4,
    flex: 1,
    height: 80,
  },
})
