import { NavigationBar } from "expo-navigation-bar"
import { Redirect, useLocalSearchParams, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { Download } from "lucide-react-native"
import { useEffect, useMemo, useRef, useState } from "react"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  Button,
  SizableText,
  Spinner,
  useToastController,
  YStack,
} from "tamagui"

import type { AppToastTone } from "@/components/feedback/app-toast"
import type { AuthenticatedTarget } from "@/core/server-target"
import { useConversationMessages } from "@/data/messages/message-hooks"
import {
  ensureAttachmentResource,
  ensureAvatarResource,
  ensureImageUrlResource,
  invalidateAttachmentResource,
  invalidateAvatarResource,
  invalidateImageUrlResource,
  MediaLibraryPermissionError,
  saveImageToMediaLibrary,
  type ResolvedResource,
} from "@/data/resources"
import { useAuth } from "@/providers/auth-provider"
import { buildImagePreviewGallery } from "@/features/image-preview/image-preview-gallery"
import { ZoomableImage } from "@/features/image-preview/zoomable-image"
import {
  getImagePreviewSourceKey,
  parseImagePreviewGalleryContext,
  parseImagePreviewSource,
  type ImagePreviewGalleryContext,
  type ImagePreviewSource,
} from "@/navigation/image-preview"

export function ImagePreviewScreen() {
  const params = useLocalSearchParams<{
    conversationId?: string | string[]
    fileId?: string | string[]
    messageId?: string | string[]
    source?: string | string[]
    sourceType?: string | string[]
  }>()
  const { session } = useAuth()
  const {
    conversationId,
    fileId,
    messageId,
    source: sourceParam,
    sourceType,
  } = params
  const source = useMemo(
    () =>
      parseImagePreviewSource({
        fileId,
        source: sourceParam,
        sourceType,
      }),
    [fileId, sourceParam, sourceType]
  )
  const gallery = useMemo(
    () => parseImagePreviewGalleryContext({ conversationId, messageId }),
    [conversationId, messageId]
  )

  if (!session) return <Redirect href="/server-management" />

  if (source?.type === "attachment" && gallery) {
    return (
      <ConversationImagePreview
        gallery={gallery}
        initialSource={source}
        key={`${getImagePreviewSourceKey(source)}:${gallery.conversationId}:${gallery.messageId}`}
        session={session}
      />
    )
  }

  return (
    <AuthenticatedImagePreview
      key={getImagePreviewSourceKey(source)}
      session={session}
      source={source}
    />
  )
}

function ConversationImagePreview({
  gallery: galleryContext,
  initialSource,
  session,
}: {
  gallery: ImagePreviewGalleryContext
  initialSource: Extract<ImagePreviewSource, { type: "attachment" }>
  session: AuthenticatedTarget
}) {
  const messagesQuery = useConversationMessages(
    session,
    galleryContext.conversationId,
    { live: false }
  )
  const gallery = useMemo(
    () => buildImagePreviewGallery(messagesQuery.messages),
    [messagesQuery.messages]
  )
  const [currentMessageId, setCurrentMessageId] = useState(
    galleryContext.messageId
  )
  const findingOlderImageRef = useRef(false)
  const mountedRef = useRef(true)
  const currentIndex = gallery.findIndex(
    (item) => item.messageId === currentMessageId
  )
  const currentItem = currentIndex >= 0 ? gallery[currentIndex] : undefined
  const currentFileId = currentItem?.fileId ?? initialSource.value
  const currentSource = useMemo<ImagePreviewSource>(
    () => ({ type: "attachment", value: currentFileId }),
    [currentFileId]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (currentIndex < 0) return

    const controller = new AbortController()
    const adjacentItems = [gallery[currentIndex - 1], gallery[currentIndex + 1]]
    for (const item of adjacentItems) {
      if (!item) continue
      void ensureAttachmentResource(
        session,
        { fileId: item.fileId, kind: "image", type: "attachment" },
        { signal: controller.signal }
      ).catch(() => undefined)
    }
    return () => controller.abort()
  }, [currentIndex, gallery, session])

  async function showPreviousImage() {
    if (currentIndex > 0) {
      const previous = gallery[currentIndex - 1]
      if (previous) setCurrentMessageId(previous.messageId)
      return
    }
    if (!messagesQuery.hasOlder || findingOlderImageRef.current) return

    findingOlderImageRef.current = true
    try {
      let result = await messagesQuery.fetchOlder()

      while (mountedRef.current) {
        const loadedGallery = buildImagePreviewGallery(
          result.data?.pages.flatMap((page) => page.messages) ?? []
        )
        const loadedIndex = loadedGallery.findIndex(
          (item) => item.messageId === currentMessageId
        )
        const previous = loadedGallery[loadedIndex - 1]
        if (previous) {
          setCurrentMessageId(previous.messageId)
          return
        }
        if (!result.hasNextPage) return
        result = await messagesQuery.fetchOlder()
      }
    } finally {
      findingOlderImageRef.current = false
    }
  }

  function showNextImage() {
    const next = gallery[currentIndex + 1]
    if (next) setCurrentMessageId(next.messageId)
  }

  return (
    <AuthenticatedImagePreview
      key={getImagePreviewSourceKey(currentSource)}
      onSwipeLeft={gallery[currentIndex + 1] ? showNextImage : undefined}
      onSwipeRight={
        currentIndex > 0 || messagesQuery.hasOlder
          ? () => void showPreviousImage()
          : undefined
      }
      session={session}
      source={currentSource}
    />
  )
}

function AuthenticatedImagePreview({
  onSwipeLeft,
  onSwipeRight,
  session,
  source,
}: {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  session: AuthenticatedTarget
  source: ImagePreviewSource | null
}) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const toast = useToastController()
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<Error | null>(() =>
    source ? null : new Error("图片信息不存在")
  )
  const [imageReady, setImageReady] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [resource, setResource] = useState<ResolvedResource | null>(null)

  useEffect(() => {
    if (!source) return

    const controller = new AbortController()

    void ensurePreviewResource(session, source, controller.signal)
      .then(setResource)
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setError(
          loadError instanceof Error ? loadError : new Error("图片加载失败")
        )
      })

    return () => controller.abort()
  }, [attempt, session, source])

  async function handleRetry() {
    if (!source) return
    setError(null)
    setImageReady(false)
    setResource(null)
    await invalidatePreviewResource(session, source).catch(() => undefined)
    setAttempt((current) => current + 1)
  }

  async function handleSave() {
    if (!resource || isSaving) return
    setIsSaving(true)

    try {
      await saveImageToMediaLibrary(resource)
      toast.show("图片已保存", {
        customData: { tone: "success" satisfies AppToastTone },
        message: "已保存到系统相册",
      })
    } catch (saveError: unknown) {
      toast.show("保存失败", {
        customData: { tone: "error" satisfies AppToastTone },
        duration: 4000,
        message:
          saveError instanceof MediaLibraryPermissionError
            ? "请在系统设置中允许即应访问相册"
            : saveError instanceof Error
              ? saveError.message
              : "请稍后重试",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <YStack bg="#000" flex={1}>
      <StatusBar hidden />
      <NavigationBar hidden={false} style="dark" />

      {resource ? (
        <ZoomableImage
          onError={() => setError(new Error("图片无法显示，请重新加载"))}
          onLoad={() => setImageReady(true)}
          onPress={() => router.back()}
          onSwipeLeft={onSwipeLeft}
          onSwipeRight={onSwipeRight}
          uri={resource.uri}
        />
      ) : null}

      {!resource || !imageReady ? (
        <YStack
          b={0}
          gap="$4"
          items="center"
          justify="center"
          l={0}
          position="absolute"
          r={0}
          t={0}
        >
          {error ? (
            <>
              <SizableText color="#fff" maxW={280} text="center">
                {error.message}
              </SizableText>
              <Button onPress={() => void handleRetry()} theme="teal">
                重新加载
              </Button>
            </>
          ) : (
            <Spinner color="#fff" size="large" />
          )}
        </YStack>
      ) : null}

      {resource && imageReady ? (
        <Button
          accessibilityLabel="保存图片到相册"
          bg="rgba(0, 0, 0, 0.45)"
          borderColor="rgba(255, 255, 255, 0.2)"
          borderWidth={1}
          b={Math.max(insets.bottom, 16)}
          circular
          disabled={isSaving}
          icon={
            isSaving ? (
              <Spinner color="#fff" />
            ) : (
              <Download color="#fff" size={22} />
            )
          }
          onPress={() => void handleSave()}
          position="absolute"
          pressStyle={{ bg: "rgba(255, 255, 255, 0.16)" }}
          r={16}
          size="$5"
        />
      ) : null}
    </YStack>
  )
}

async function ensurePreviewResource(
  session: AuthenticatedTarget,
  source: ImagePreviewSource,
  signal: AbortSignal
) {
  if (source.type === "attachment") {
    return ensureAttachmentResource(
      session,
      { fileId: source.value, kind: "image", type: "attachment" },
      { signal }
    )
  }

  if (source.type === "url") {
    return ensureImageUrlResource(session, source.value, { signal })
  }

  const resource = await ensureAvatarResource(
    session,
    { type: "avatar", url: source.value },
    { signal }
  )
  if (!resource) throw new Error("头像不存在")
  return resource
}

function invalidatePreviewResource(
  session: AuthenticatedTarget,
  source: ImagePreviewSource
) {
  if (source.type === "attachment") {
    return invalidateAttachmentResource(session, {
      fileId: source.value,
      kind: "image",
      type: "attachment",
    })
  }
  if (source.type === "url") {
    return invalidateImageUrlResource(session, source.value)
  }
  return invalidateAvatarResource(session, source.value)
}
