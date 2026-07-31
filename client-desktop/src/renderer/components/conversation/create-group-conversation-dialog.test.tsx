import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { CreateGroupConversationDialog } from "@/components/conversation/create-group-conversation-dialog"
import type { ContactUser } from "@/lib/client-data-api"

const mocks = vi.hoisted(() => ({
  renderAvatar: vi.fn(),
}))

vi.mock("@/components/selection-list-avatar", () => ({
  SelectionListAvatar: ({ name }: { name: string }) => {
    mocks.renderAvatar(name)
    return <span>{name.slice(0, 1)}</span>
  },
}))

describe("CreateGroupConversationDialog", () => {
  it("修改群聊名称时不重新渲染候选成员列表", async () => {
    const user = userEvent.setup()
    mocks.renderAvatar.mockClear()

    render(
      <CreateGroupConversationDialog
        apps={[]}
        contacts={[createContact("user-1", "Alice"), createContact("user-2", "Bob")]}
        currentUserId="user-1"
        onCreate={vi.fn()}
        onOpenChange={vi.fn()}
        open
      />,
    )

    expect(mocks.renderAvatar).toHaveBeenCalledTimes(1)
    mocks.renderAvatar.mockClear()

    const nameInput = screen.getByLabelText("群聊名称")
    await user.clear(nameInput)
    await user.type(nameInput, "研发讨论群")

    expect(nameInput).toHaveValue("研发讨论群")
    expect(mocks.renderAvatar).not.toHaveBeenCalled()
  })
})

function createContact(id: string, name: string): ContactUser {
  return {
    avatar: "",
    email: `${id}@example.com`,
    id,
    lastOnlineAt: null,
    name,
    nickname: "",
    online: false,
    phone: "",
    type: "user",
  }
}
