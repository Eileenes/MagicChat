import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { MessageVoice } from "./message-voice"

describe("MessageVoice", () => {
  it("renders a compact player and expands the transcript on demand", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MessageVoice
        voice={{
          contentType: "audio/webm",
          durationMS: 42_800,
          fileId: "voice-file-1",
          sizeBytes: 1024,
          transcript:
            "这是一段默认只显示一行，点击后可以完整展开的语音识别文字。",
          type: "voice",
        }}
      />
    )

    expect(container.firstElementChild).toHaveClass("w-80")
    expect(screen.getByText("语音 00:43")).toBeInTheDocument()

    const transcript = screen.getByRole("button", { name: "展开语音文字" })
    expect(transcript).toHaveClass("truncate")
    expect(transcript).toHaveAttribute("aria-expanded", "false")

    await user.click(transcript)

    expect(
      screen.getByRole("button", { name: "收起语音文字" })
    ).toHaveAttribute("aria-expanded", "true")
    expect(transcript).not.toHaveClass("truncate")
  })
})
