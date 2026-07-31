import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConversationAnnouncement } from "./conversation-announcement"

describe("ConversationAnnouncement", () => {
  afterEach(() => vi.restoreAllMocks())

  it("hides an empty announcement", () => {
    render(<ConversationAnnouncement announcement="  " />)
    expect(screen.queryByRole("region", { name: "群公告" })).not.toBeInTheDocument()
  })

  it("only exposes expand and collapse when the content exceeds three lines", async () => {
    const user = userEvent.setup()
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(80)
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60)
    render(<ConversationAnnouncement announcement={"很长的公告\n".repeat(5)} />)

    await user.click(screen.getByRole("button", { name: "展开" }))
    expect(screen.getByRole("button", { name: "收起" })).toBeInTheDocument()
  })
})
