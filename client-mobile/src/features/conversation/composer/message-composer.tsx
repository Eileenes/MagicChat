import {
  CirclePlus,
  Keyboard as KeyboardIcon,
  Mic,
  Send,
  Smile,
} from "lucide-react-native"
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { Keyboard, Platform, useWindowDimensions } from "react-native"
import {
  type TamaguiElement,
  XStack,
  YStack,
} from "tamagui"

import { CompactIconButton } from "@/components/buttons/compact-icon-button"
import { AppInput } from "@/components/forms/app-input"
import type {
  PreparedClientMessageUpload,
  PreparedClientVoiceMessage,
} from "@/data/messages/message-upload"
import type { ServerTarget } from "@/core/server-target"
import {
  ComposerAccessoryPanel,
  type ComposerAccessoryMode,
} from "@/features/conversation/composer/composer-accessory-panel"
import {
  createDraftMentionTemplate,
  findInsertedMentionTrigger,
  getCursorAfterTextChange,
  insertDraftMention,
  syncDraftMentions,
  type DraftMention,
  type MentionSelection,
  type TextSelection,
} from "@/features/conversation/composer/mention-draft"
import type { MentionCandidate } from "@/features/conversation/composer/mention-model"
import { MentionPickerSheet } from "@/features/conversation/composer/mention-picker-sheet"
import {
  pickCameraImageMessage,
  pickFileMessage,
  pickLibraryImageMessage,
} from "@/features/conversation/composer/message-upload-picker"
import { MessageUploadDialog } from "@/features/conversation/composer/message-upload-dialog"
import { useComposerUpload } from "@/features/conversation/composer/use-composer-upload"
import { MessageVoiceGestureOverlay } from "@/features/conversation/voice/message-voice-gesture-overlay"
import { MessageVoiceDialog } from "@/features/conversation/voice/message-voice-dialog"
import {
  MessageReplyPreview,
  type MessageReplyTarget,
} from "@/features/conversation/composer/message-reply-preview"
import { useComposerVoice } from "@/features/conversation/voice/use-composer-voice"
import { VoiceRecordButton } from "@/features/conversation/voice/voice-record-button"

export type MessageComposerHandle = {
  dismissAccessory: () => void
  focus: () => void
  insertMention: (target: MentionSelection) => void
}

const COMPOSER_CONTROL_HEIGHT = 38
const COMPOSER_INPUT_GAP = 8
const COMPOSER_INPUT_HORIZONTAL_PADDING = "$3"
const COMPOSER_LINE_HEIGHT = 22
const COMPOSER_MAX_LINES = 4
const COMPOSER_MAX_CONTROL_HEIGHT =
  COMPOSER_CONTROL_HEIGHT + COMPOSER_LINE_HEIGHT * (COMPOSER_MAX_LINES - 1)
const COMPOSER_PANEL_HEIGHT = 56
const COMPOSER_EXTRA_BOTTOM_PADDING = 4
const COMPOSER_PANEL_VERTICAL_CHROME =
  COMPOSER_PANEL_HEIGHT - COMPOSER_CONTROL_HEIGHT
const COMPOSER_TEXT_VERTICAL_CHROME =
  COMPOSER_CONTROL_HEIGHT - COMPOSER_LINE_HEIGHT

export const MessageComposer = forwardRef<
  MessageComposerHandle,
  {
    disabled: boolean
    mentionCandidates: MentionCandidate[]
    onClearReply: () => void
    onSend: (content: string) => Promise<boolean>
    onSendUpload: (selection: PreparedClientMessageUpload) => Promise<boolean>
    onSendVoice: (recording: PreparedClientVoiceMessage) => Promise<boolean>
    replyTarget: MessageReplyTarget | null
    server: ServerTarget
  }
>(function MessageComposer(
  {
    disabled,
    mentionCandidates,
    onClearReply,
    onSend,
    onSendUpload,
    onSendVoice,
    replyTarget,
    server,
  },
  ref
) {
  const windowDimensions = useWindowDimensions()
  const inputRef = useRef<TamaguiElement>(null)
  const contentRef = useRef("")
  const mentionsRef = useRef<DraftMention[]>([])
  const mentionTriggerRef = useRef<TextSelection | null>(null)
  const selectionRef = useRef<TextSelection>({ end: 0, start: 0 })
  const shouldFocusAfterPickerCloseRef = useRef(false)
  const [content, setContent] = useState("")
  const [inputHeight, setInputHeight] = useState(COMPOSER_CONTROL_HEIGHT)
  const [accessoryMode, setAccessoryMode] =
    useState<ComposerAccessoryMode>(null)
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false)
  const [pendingSelection, setPendingSelection] =
    useState<TextSelection>()
  const upload = useComposerUpload({ disabled, onSend: onSendUpload })
  const voice = useComposerVoice({
    disabled: disabled || upload.preparing,
    onBeforeModeToggle: () => {
      setAccessoryMode(null)
      setMentionPickerOpen(false)
    },
    onReturnToText: focusInputAfterRender,
    onSendText: onSend,
    onSendVoice,
    serverUrl: server.url,
  })
  const canSend = content.trim().length > 0 && !disabled
  const interactionDisabled = voice.interactionDisabled
  const visibleControlHeight = voice.mode
    ? COMPOSER_CONTROL_HEIGHT
    : inputHeight
  const composerPanelHeight =
    visibleControlHeight + COMPOSER_PANEL_VERTICAL_CHROME
  const inputVerticalPadding =
    Platform.OS === "ios" ? COMPOSER_TEXT_VERTICAL_CHROME / 2 : 0
  // Toggling scrolling changes UITextView.contentSize on iOS, which can feed
  // back into inputHeight through onContentSizeChange and cause oscillation.
  const inputScrollEnabled =
    Platform.OS === "ios" || inputHeight >= COMPOSER_MAX_CONTROL_HEIGHT

  useEffect(() => {
    if (!pendingSelection) return

    const frame = requestAnimationFrame(() => setPendingSelection(undefined))
    return () => cancelAnimationFrame(frame)
  }, [pendingSelection])

  useImperativeHandle(ref, () => ({
    dismissAccessory() {
      setAccessoryMode(null)
    },
    focus() {
      voice.leaveMode()
      setAccessoryMode(null)
      setMentionPickerOpen(false)
      focusInputAfterRender()
    },
    insertMention(target) {
      if (!disabled) insertMentionTarget(target)
    },
  }))

  function updateDraft(value: string, mentions: DraftMention[]) {
    contentRef.current = value
    mentionsRef.current = mentions
    setContent(value)
  }

  function recordSelection(nextSelection: TextSelection) {
    selectionRef.current = nextSelection
  }

  function requestSelection(nextSelection: TextSelection) {
    recordSelection(nextSelection)
    setPendingSelection(nextSelection)
  }

  function handleContentChange(value: string) {
    const previousValue = contentRef.current
    const nextMentions = syncDraftMentions(
      mentionsRef.current,
      previousValue,
      value
    )
    const cursor = getCursorAfterTextChange(previousValue, value)
    const nextSelection = { end: cursor, start: cursor }
    const mentionTrigger = findInsertedMentionTrigger(previousValue, value)

    updateDraft(value, nextMentions)
    recordSelection(nextSelection)

    if (mentionTrigger && mentionCandidates.length > 0) {
      mentionTriggerRef.current = mentionTrigger
      setAccessoryMode(null)
      Keyboard.dismiss()
      setMentionPickerOpen(true)
    }
  }

  function handleSelectionChange(
    event: { nativeEvent: { selection: TextSelection } }
  ) {
    const nextSelection = event.nativeEvent.selection
    recordSelection(nextSelection)
  }

  function handleInputContentSizeChange(
    event: { nativeEvent: { contentSize: { height: number; width: number } } }
  ) {
    // iOS includes the placeholder in an empty UITextView's contentSize.
    // Keep the empty composer at its minimum height regardless of that metric.
    if (contentRef.current.length === 0) {
      setInputHeight((currentHeight) =>
        currentHeight === COMPOSER_CONTROL_HEIGHT
          ? currentHeight
          : COMPOSER_CONTROL_HEIGHT
      )
      return
    }

    const measuredHeight = Math.ceil(event.nativeEvent.contentSize.height)
    // UITextView contentSize includes its vertical padding. Android keeps the
    // existing zero-padding measurement and needs the control chrome added.
    const measuredControlHeight =
      measuredHeight +
      (Platform.OS === "ios" ? 0 : COMPOSER_TEXT_VERTICAL_CHROME)
    const nextHeight = Math.max(
      COMPOSER_CONTROL_HEIGHT,
      Math.min(COMPOSER_MAX_CONTROL_HEIGHT, measuredControlHeight)
    )
    setInputHeight((currentHeight) =>
      currentHeight === nextHeight ? currentHeight : nextHeight
    )
  }

  function insertMentionTarget(
    target: MentionSelection,
    explicitSelection?: TextSelection
  ) {
    const result = insertDraftMention({
      mentions: mentionsRef.current,
      selection: explicitSelection ?? selectionRef.current,
      target,
      value: contentRef.current,
    })
    const nextSelection = { end: result.cursor, start: result.cursor }

    updateDraft(result.value, result.mentions)
    voice.leaveMode()
    requestSelection(nextSelection)
    mentionTriggerRef.current = null
    setAccessoryMode(null)

    if (mentionPickerOpen) {
      shouldFocusAfterPickerCloseRef.current = true
      setMentionPickerOpen(false)
    } else {
      focusInputAfterRender()
    }
  }

  function handleMentionSelect(candidate: MentionCandidate) {
    insertMentionTarget(
      candidate,
      mentionTriggerRef.current ?? selectionRef.current
    )
  }

  function handleMentionPickerOpenChange(open: boolean) {
    setMentionPickerOpen(open)
    if (open) {
      setAccessoryMode(null)
      shouldFocusAfterPickerCloseRef.current = false
      return
    }

    mentionTriggerRef.current = null
    shouldFocusAfterPickerCloseRef.current = true
  }

  function handleMentionPickerAnimationComplete(open: boolean) {
    if (open || !shouldFocusAfterPickerCloseRef.current) return

    shouldFocusAfterPickerCloseRef.current = false
    if (!disabled) inputRef.current?.focus()
  }

  function focusInputAfterRender() {
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  async function handleSend() {
    const message = createDraftMentionTemplate(
      contentRef.current,
      mentionsRef.current
    ).trim()
    if (!message || disabled) return
    if (await onSend(message)) {
      mentionTriggerRef.current = null
      setMentionPickerOpen(false)
      updateDraft("", [])
      setInputHeight(COMPOSER_CONTROL_HEIGHT)
      requestSelection({ end: 0, start: 0 })
    }
  }

  function handleAccessoryToggle(mode: Exclude<ComposerAccessoryMode, null>) {
    if (interactionDisabled) return

    Keyboard.dismiss()
    voice.leaveMode()
    setMentionPickerOpen(false)
    setAccessoryMode((current) => (current === mode ? null : mode))
  }

  function handleEmojiPress(emoji: string) {
    if (interactionDisabled) return

    voice.leaveMode()
    const currentValue = contentRef.current
    const selection = clampSelection(selectionRef.current, currentValue.length)
    const nextValue =
      currentValue.slice(0, selection.start) +
      emoji +
      currentValue.slice(selection.end)
    const nextMentions = syncDraftMentions(
      mentionsRef.current,
      currentValue,
      nextValue
    )
    const cursor = selection.start + emoji.length

    updateDraft(nextValue, nextMentions)
    requestSelection({ end: cursor, start: cursor })
  }

  async function handleUploadPick(
    picker: () => Promise<PreparedClientMessageUpload | null>
  ) {
    if (interactionDisabled) return

    setAccessoryMode(null)
    await upload.pick(picker)
  }

  return (
    <>
      <YStack bg="$background">
        {replyTarget ? (
          <MessageReplyPreview onClear={onClearReply} target={replyTarget} />
        ) : null}
        <XStack
          height={composerPanelHeight}
          items="center"
          pb={COMPOSER_EXTRA_BOTTOM_PADDING}
          px="$2"
        >
          <CompactIconButton
            accessibilityLabel={voice.mode ? "切换到文字输入" : "切换到语音输入"}
            disabled={interactionDisabled}
            icon={voice.mode ? KeyboardIcon : Mic}
            iconSize={26}
            onPress={voice.toggleMode}
            strokeWidth={1.5}
          />
          <YStack
            bg={voice.interactionActive ? "$color5" : "$color1"}
            flex={1}
            height={visibleControlHeight}
            mx={COMPOSER_INPUT_GAP}
            rounded="$4"
          >
            {voice.mode ? (
              <VoiceRecordButton
                disabled={disabled || upload.preparing}
                elapsedMS={voice.elapsedMS}
                onPressIn={voice.pressIn}
                onPressOut={voice.pressOut}
                recording={voice.interactionActive}
                screenHeight={windowDimensions.height}
                screenWidth={windowDimensions.width}
                status={voice.status}
              />
            ) : (
              <AppInput
                autoCapitalize="sentences"
                bg="transparent"
                borderWidth={0}
                color="$gray12"
                disabled={disabled}
                fontFamily="$body"
                fontSize="$4"
                focusStyle={{ borderWidth: 0, outlineWidth: 0 }}
                height={inputHeight}
                includeFontPadding={false}
                minH={0}
                multiline
                onChangeText={handleContentChange}
                onContentSizeChange={handleInputContentSizeChange}
                onFocus={() => setAccessoryMode(null)}
                onSelectionChange={handleSelectionChange}
                placeholder="发消息"
                placeholderTextColor="$gray9"
                px={COMPOSER_INPUT_HORIZONTAL_PADDING}
                py={inputVerticalPadding}
                ref={inputRef}
                returnKeyType="default"
                scrollEnabled={inputScrollEnabled}
                selection={pendingSelection}
                submitBehavior="newline"
                textAlignVertical="center"
                unstyled
                value={content}
                width="100%"
              />
            )}
          </YStack>
          <XStack gap="$1" items="center">
            <CompactIconButton
              accessibilityLabel="选择表情"
              disabled={interactionDisabled}
              icon={Smile}
              iconSize={26}
              onPress={() => handleAccessoryToggle("emoji")}
              strokeWidth={1.5}
            />
            {!voice.mode && content.trim().length > 0 ? (
              <CompactIconButton
                accessibilityLabel="发送消息"
                disabled={!canSend}
                icon={Send}
                iconSize={26}
                loading={disabled}
                onPress={() => void handleSend()}
                strokeWidth={1.5}
              />
            ) : (
              <CompactIconButton
                accessibilityLabel="添加图片或附件"
                disabled={interactionDisabled}
                icon={CirclePlus}
                iconSize={26}
                loading={upload.preparing}
                onPress={() => handleAccessoryToggle("attachments")}
                strokeWidth={1.5}
              />
            )}
          </XStack>
        </XStack>
        <ComposerAccessoryPanel
          disabled={interactionDisabled}
          mode={accessoryMode}
          onCameraPress={() => void handleUploadPick(pickCameraImageMessage)}
          onEmojiPress={handleEmojiPress}
          onFilePress={() => void handleUploadPick(pickFileMessage)}
          onLibraryPress={() =>
            void handleUploadPick(pickLibraryImageMessage)
          }
        />
      </YStack>

      <MentionPickerSheet
        candidates={mentionCandidates}
        onAnimationComplete={handleMentionPickerAnimationComplete}
        onOpenChange={handleMentionPickerOpenChange}
        onSelect={handleMentionSelect}
        open={mentionPickerOpen}
        server={server}
      />
      <MessageUploadDialog
        onCancel={upload.cancel}
        onConfirm={() => void upload.confirm()}
        selection={upload.selected}
        sending={disabled}
      />
      <MessageVoiceGestureOverlay
        active={voice.gestureActive}
        elapsedMS={voice.elapsedMS}
        screenWidth={windowDimensions.width}
        status={voice.status}
        transcript={voice.transcript}
      />
      <MessageVoiceDialog
        elapsedMS={voice.elapsedMS}
        error={voice.error}
        onCancel={voice.cancel}
        onSendText={() => void voice.sendText()}
        onSendVoice={() => void voice.confirm()}
        open={voice.dialogOpen}
        recording={voice.recording}
        sending={disabled}
        status={voice.status}
        transcript={voice.transcript}
        transcriptionError={voice.transcriptionError}
      />
    </>
  )
})

function clampSelection(selection: TextSelection, valueLength: number) {
  const start = Math.max(0, Math.min(selection.start, valueLength))
  const end = Math.max(start, Math.min(selection.end, valueLength))
  return { end, start }
}
