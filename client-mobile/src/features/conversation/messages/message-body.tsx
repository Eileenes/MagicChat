import {
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileText,
  ImageOff,
  Link as LinkIcon,
  MessagesSquare,
} from "lucide-react-native"
import { useRef, useState } from "react"
import { Alert, Linking, Pressable } from "react-native"
import {
  Button,
  Card,
  Image,
  Paragraph,
  Separator,
  SizableText,
  Spinner,
  XStack,
  YStack,
} from "tamagui"

import { ThemedIcon } from "@/components/icons/themed-icon"
import type { ClientMessageBody } from "@/core/models"
import type { ResourceLoadState } from "@/data/resources"
import type { EntityReference } from "@/domain/entities/entity-profile"
import {
  formatClientMessageBodySummary,
  formatFileSize,
  type MessageMentionLabelResolver,
} from "@/domain/messages/message-presenter"
import { MarkdownMessage } from "@/features/conversation/messages/markdown-message"
import { MessageChart } from "@/features/conversation/messages/message-chart"
import { MessageMentionText } from "@/features/conversation/messages/message-mention-text"
import { VoiceMessagePlayer } from "@/features/conversation/voice/voice-message-player"

export function MessageBody({
  body,
  currentUserId,
  flushImage,
  onImagePress,
  onMentionPress,
  onResourceError,
  onResourcePress,
  onVoiceResourcePress,
  resolveMentionLabel,
  resourceStates,
  serverUrl,
}: {
  body: ClientMessageBody
  currentUserId: string
  flushImage: boolean
  onImagePress: (fileId: string) => void
  onMentionPress: (target: EntityReference) => void
  onResourceError: (fileId: string) => void
  onResourcePress: (fileId: string) => void
  onVoiceResourcePress: (fileId: string) => void
  resolveMentionLabel: MessageMentionLabelResolver
  resourceStates: ReadonlyMap<string, ResourceLoadState>
  serverUrl: string
}) {
  const retriedImageIds = useRef(new Set<string>())

  if (body.type === "text") {
    return (
      <Paragraph selectable>
        <MessageMentionText
          content={body.content}
          currentUserId={currentUserId}
          onMentionPress={onMentionPress}
          resolveMentionLabel={resolveMentionLabel}
        />
      </Paragraph>
    )
  }

  if (body.type === "markdown") {
    return (
      <MarkdownMessage
        content={body.content}
        currentUserId={currentUserId}
        onMentionPress={onMentionPress}
        resolveMentionLabel={resolveMentionLabel}
        serverUrl={serverUrl}
      />
    )
  }

  if (body.type === "link") {
    return (
      <MessageLinkCard
        description={body.url}
        icon={LinkIcon}
        onPress={() => void openExternalUrl(body.url)}
        title={body.title || "链接"}
      />
    )
  }

  if (body.type === "card") {
    return (
      <MessageLinkCard
        description={body.description}
        icon={ExternalLink}
        onPress={body.url.trim() ? () => void openExternalUrl(body.url) : undefined}
        title={body.title}
      />
    )
  }

  if (body.type === "chart") {
    return <MessageChart chart={body} />
  }

  if (body.type === "file") {
    const state = resourceStates.get(body.fileId)
    const isLoading = state?.status === "loading"
    return (
      <XStack gap="$3" items="center" width="100%">
        <ThemedIcon icon={FileText} size={24} />
        <YStack flex={1}>
          <SizableText fontWeight="600" numberOfLines={1}>
            {body.name}
          </SizableText>
          <SizableText color="$color10" size="$2">
            {formatFileSize(body.sizeBytes)}
          </SizableText>
        </YStack>
        <Button
          accessibilityLabel={`打开文件 ${body.name}`}
          chromeless
          circular
          disabled={isLoading}
          icon={
            isLoading ? (
              <Spinner />
            ) : (
              <ThemedIcon icon={Download} size={18} />
            )
          }
          onPress={() => onResourcePress(body.fileId)}
          size="$3"
        />
      </XStack>
    )
  }

  if (body.type === "image") {
    const state = resourceStates.get(body.fileId)
    const size = getImageDisplaySize(body.width, body.height)
    const image = (
      <MessageImageThumbnail
        captioned={Boolean(body.caption)}
        onError={() => {
          if (retriedImageIds.current.has(body.fileId)) return
          retriedImageIds.current.add(body.fileId)
          onResourceError(body.fileId)
        }}
        onPress={() => onImagePress(body.fileId)}
        size={size}
        state={state}
      />
    )

    if (!body.caption) return image

    return (
      <YStack maxW="100%" width={size.width}>
        {image}
        <YStack
          pb={flushImage ? "$3" : undefined}
          pt="$2"
          px={flushImage ? "$3" : undefined}
        >
          {body.captionType === "markdown" ? (
            <MarkdownMessage
              content={body.caption}
              currentUserId={currentUserId}
              onMentionPress={onMentionPress}
              resolveMentionLabel={resolveMentionLabel}
              serverUrl={serverUrl}
            />
          ) : (
            <Paragraph selectable>
              <MessageMentionText
                content={body.caption}
                currentUserId={currentUserId}
                onMentionPress={onMentionPress}
                resolveMentionLabel={resolveMentionLabel}
              />
            </Paragraph>
          )}
        </YStack>
      </YStack>
    )
  }

  if (body.type === "voice") {
    const state = resourceStates.get(body.fileId)
    return (
      <VoiceMessagePlayer
        durationMS={body.durationMS}
        fileId={body.fileId}
        onResourceError={onResourceError}
        onResourceRequest={onVoiceResourcePress}
        state={state}
        transcript={body.transcript}
      />
    )
  }

  if (body.type === "forward_bundle") {
    return (
      <ForwardBundleBody
        body={body}
        resolveMentionLabel={resolveMentionLabel}
      />
    )
  }

  if (body.type === "revoked") {
    return <Paragraph color="$gray11">该消息已被撤回</Paragraph>
  }

  if (body.type === "unsupported") {
    return <Paragraph color="$color10">暂不支持查看该消息</Paragraph>
  }

  return (
    <Paragraph text="center">
      {formatClientMessageBodySummary(body, resolveMentionLabel)}
    </Paragraph>
  )
}

function MessageImageThumbnail({
  captioned,
  onError,
  onPress,
  size,
  state,
}: {
  captioned: boolean
  onError: () => void
  onPress: () => void
  size: { height: number; width: number }
  state: ResourceLoadState | undefined
}) {
  const resource = state?.resource

  if (!resource) {
    return (
      <MessageImageStatus
        captioned={captioned}
        error={state?.status === "error"}
        onPress={state?.status === "error" ? onPress : undefined}
        size={size}
      />
    )
  }

  return (
    <LoadedMessageImage
      captioned={captioned}
      onError={onError}
      onPress={onPress}
      size={size}
      uri={resource.uri}
    />
  )
}

function LoadedMessageImage({
  captioned,
  onError,
  onPress,
  size,
  uri,
}: {
  captioned: boolean
  onError: () => void
  onPress: () => void
  size: { height: number; width: number }
  uri: string
}) {
  const [status, setStatus] = useState<"error" | "loading" | "ready">(
    "loading"
  )

  return (
    <Pressable
      accessibilityLabel={status === "ready" ? "查看图片" : undefined}
      disabled={status !== "ready"}
      onPress={onPress}
      style={{
        borderBottomLeftRadius: captioned ? 0 : 7,
        borderBottomRightRadius: captioned ? 0 : 7,
        borderTopLeftRadius: 7,
        borderTopRightRadius: 7,
        height: size.height,
        overflow: "hidden",
        width: size.width,
      }}
    >
      <Image
        height={size.height}
        objectFit="cover"
        onError={() => {
          setStatus("error")
          onError()
        }}
        onLoad={() => setStatus("ready")}
        onLoadStart={() => setStatus("loading")}
        opacity={status === "ready" ? 1 : 0}
        pointerEvents="none"
        src={uri}
        width={size.width}
      />
      {status !== "ready" ? (
        <MessageImageStatus
          absolute
          captioned={captioned}
          error={status === "error"}
          size={size}
        />
      ) : null}
    </Pressable>
  )
}

function MessageImageStatus({
  absolute = false,
  captioned,
  error,
  onPress,
  size,
}: {
  absolute?: boolean
  captioned: boolean
  error: boolean
  onPress?: () => void
  size: { height: number; width: number }
}) {
  return (
    <YStack
      accessibilityLabel={error ? "图片加载失败" : "图片正在加载"}
      bg="$backgroundPress"
      borderBottomLeftRadius={captioned ? 0 : 7}
      borderBottomRightRadius={captioned ? 0 : 7}
      borderTopLeftRadius={7}
      borderTopRightRadius={7}
      height={size.height}
      items="center"
      justify="center"
      l={absolute ? 0 : undefined}
      onPress={onPress}
      overflow="hidden"
      position={absolute ? "absolute" : "relative"}
      t={absolute ? 0 : undefined}
      width={size.width}
    >
      <YStack gap="$2" items="center">
        <YStack
          bg="$background"
          height={40}
          items="center"
          justify="center"
          opacity={0.7}
          rounded="$3"
          width={40}
        >
          {error ? <ThemedIcon icon={ImageOff} size={20} /> : <Spinner />}
        </YStack>
        <SizableText color="$color10" fontWeight="500" size="$2">
          {error ? "图片加载失败" : "图片正在加载"}
        </SizableText>
      </YStack>
    </YStack>
  )
}

function MessageLinkCard({
  description,
  icon,
  onPress,
  title,
}: {
  description: string
  icon: typeof LinkIcon
  onPress?: () => void
  title: string
}) {
  return (
    <Card
      bg="transparent"
      borderWidth={0}
      gap="$2"
      onPress={onPress}
      p={0}
      width="100%"
    >
      <XStack gap="$2" items="center">
        <ThemedIcon icon={icon} size={18} />
        <SizableText flex={1} fontWeight="600" numberOfLines={1}>
          {title}
        </SizableText>
      </XStack>
      {description.trim() ? (
        <>
          <Separator />
          <Paragraph color="$color10" numberOfLines={4} size="$2">
            {description}
          </Paragraph>
        </>
      ) : null}
    </Card>
  )
}

function ForwardBundleBody({
  body,
  resolveMentionLabel,
}: {
  body: Extract<ClientMessageBody, { type: "forward_bundle" }>
  resolveMentionLabel: MessageMentionLabelResolver
}) {
  const [expanded, setExpanded] = useState(false)
  const visibleItems = expanded ? body.items : body.items.slice(0, 3)

  return (
    <YStack gap="$2" width="100%">
      <XStack gap="$2" items="center">
        <ThemedIcon icon={MessagesSquare} size={18} />
        <SizableText fontWeight="600">聊天记录 · {body.itemCount} 条</SizableText>
      </XStack>
      <Separator />
      {visibleItems.map((item, index) => (
        <YStack gap="$1" key={`${item.sentAt}:${index}`}>
          <SizableText fontWeight="600" size="$2">
            {item.senderName}
          </SizableText>
          <Paragraph color="$color10" numberOfLines={2} size="$2">
            {item.summary.trim() ||
              formatClientMessageBodySummary(item.body, resolveMentionLabel)}
          </Paragraph>
        </YStack>
      ))}
      {body.items.length > 3 ? (
        <Button
          chromeless
          iconAfter={
            <ThemedIcon icon={expanded ? ChevronUp : ChevronDown} size={16} />
          }
          onPress={() => setExpanded((current) => !current)}
          size="$2"
        >
          {expanded ? "收起" : `查看全部 ${body.items.length} 条`}
        </Button>
      ) : null}
    </YStack>
  )
}

function getImageDisplaySize(width?: number, height?: number) {
  const displayWidth = 240
  if (!width || !height) return { height: 180, width: displayWidth }
  return {
    height: Math.min(300, Math.max(120, (displayWidth * height) / width)),
    width: displayWidth,
  }
}

async function openExternalUrl(url: string) {
  try {
    await Linking.openURL(url)
  } catch {
    Alert.alert("无法打开", "这个链接暂时无法打开。")
  }
}
