import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ClientMessage } from "@/lib/client-data-api"
import { VoiceInputDialog } from "./voice-input-dialog"

const recording = vi.hoisted(() => ({
  elapsedSeconds: 3,
  error: "",
  level: 0.2,
  recording: {
    blob: new Blob(["voice"], { type: "audio/webm" }),
    durationMS: 3_000,
  },
  resetRecording: vi.fn(),
  startRecording: vi.fn(),
  status: "recorded" as const,
  stopRecording: vi.fn(),
  transcriptionError: "",
}))

vi.mock("@/hooks/use-voice-recording", () => ({
  useVoiceRecording: () => recording,
}))

describe("VoiceInputDialog", () => {
  beforeEach(() => {
    recording.resetRecording.mockReset()
    recording.startRecording.mockReset()
    recording.stopRecording.mockReset()
  })

  it("允许修改识别文字并作为普通文字发送", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSendText = vi.fn()
    render(
      <VoiceInputDialog
        conversationName="研发群"
        onOpenChange={onOpenChange}
        onSendText={onSendText}
        onSendVoice={vi.fn()}
        open
        sending={false}
      />,
    )

    await user.type(screen.getByLabelText("文字内容"), "  明天见  ")
    await user.click(screen.getByRole("button", { name: "发送文本" }))

    expect(onSendText).toHaveBeenCalledWith("明天见")
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(recording.resetRecording).toHaveBeenCalled()
  })

  it("发送语音时携带当前转写", async () => {
    const user = userEvent.setup()
    const onSendVoice = vi.fn().mockResolvedValue({ id: "message-1" } as unknown as ClientMessage)
    render(
      <VoiceInputDialog
        conversationName="研发群"
        onOpenChange={vi.fn()}
        onSendText={vi.fn()}
        onSendVoice={onSendVoice}
        open
        sending={false}
      />,
    )

    await user.type(screen.getByLabelText("文字内容"), "会议结论")
    await user.click(screen.getByRole("button", { name: "发送语音" }))

    expect(onSendVoice).toHaveBeenCalledWith(
      expect.objectContaining({ durationMS: 3_000, transcript: "会议结论" }),
    )
    expect(recording.resetRecording).toHaveBeenCalled()
  })

  it("发送中禁止关闭和重复提交", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSendVoice = vi.fn()
    render(
      <VoiceInputDialog
        conversationName="研发群"
        onOpenChange={onOpenChange}
        onSendText={vi.fn()}
        onSendVoice={onSendVoice}
        open
        sending
      />,
    )

    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "发送语音" })).toBeDisabled()
    await user.keyboard("{Escape}")
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onSendVoice).not.toHaveBeenCalled()
  })

  it("空闲状态只展示开始录音，不提前展示转写和发送选项", () => {
    const previousStatus = recording.status
    const previousRecording = recording.recording
    recording.status = "idle" as typeof recording.status
    recording.recording = null as unknown as typeof recording.recording

    render(
      <VoiceInputDialog
        conversationName="研发群"
        onOpenChange={vi.fn()}
        onSendText={vi.fn()}
        onSendVoice={vi.fn()}
        open
        sending={false}
      />,
    )

    expect(screen.getByRole("button", { name: "开始录音" })).toBeVisible()
    expect(screen.queryByLabelText("文字内容")).toBeNull()
    expect(screen.queryByRole("button", { name: "发送语音" })).toBeNull()
    expect(screen.queryByRole("button", { name: "发送文本" })).toBeNull()

    recording.status = previousStatus
    recording.recording = previousRecording
  })
})
