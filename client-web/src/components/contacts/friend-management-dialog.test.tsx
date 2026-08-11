import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { FriendManagementDialog } from "@/components/contacts/friend-management-dialog"
import type { ContactUser, FriendRequest } from "@/lib/client-data-api"

describe("FriendManagementDialog", () => {
  it("accepts, cancels and deletes friend relationships", async () => {
    const user = userEvent.setup()
    const alice = createUser("user-1", "Alice")
    const bob = createUser("user-2", "Bob")
    const carol = createUser("user-3", "Carol")
    const dave = createUser("user-4", "Dave")
    const acceptRequest = vi.fn().mockResolvedValue(undefined)
    const cancelRequest = vi.fn().mockResolvedValue(undefined)
    const deleteFriend = vi.fn().mockResolvedValue(undefined)
    const incoming = createRequest("request-in", carol.id, alice.id)
    const outgoing = createRequest("request-out", alice.id, dave.id)

    render(
      <FriendManagementDialog
        acceptRequest={acceptRequest}
        cancelRequest={cancelRequest}
        contacts={[alice, bob]}
        createRequest={vi.fn()}
        currentUserId={alice.id}
        deleteFriend={deleteFriend}
        ensureUsers={vi.fn().mockResolvedValue(undefined)}
        incomingRequests={[incoming]}
        onOpenChange={vi.fn()}
        open
        outgoingRequests={[outgoing]}
        rejectRequest={vi.fn()}
        usersById={{
          [alice.id]: alice,
          [bob.id]: bob,
          [carol.id]: carol,
          [dave.id]: dave,
        }}
      />
    )

    await user.click(screen.getByRole("button", { name: "删除" }))
    expect(deleteFriend).toHaveBeenCalledWith(bob.id)

    await user.click(screen.getByRole("tab", { name: /收到/ }))
    await user.click(screen.getByRole("button", { name: "接受" }))
    expect(acceptRequest).toHaveBeenCalledWith(incoming.id)

    await user.click(screen.getByRole("tab", { name: /发出/ }))
    await user.click(screen.getByRole("button", { name: "取消申请" }))
    expect(cancelRequest).toHaveBeenCalledWith(outgoing.id)
  })
})

function createUser(id: string, name: string): ContactUser {
  return {
    avatar: "",
    email: `${name.toLowerCase()}@example.com`,
    id,
    lastOnlineAt: null,
    name,
    nickname: "",
    online: false,
    phone: "",
    type: "user",
  }
}

function createRequest(
  id: string,
  requesterUserId: string,
  addresseeUserId: string
): FriendRequest {
  return {
    addresseeUserId,
    createdAt: "2026-08-11T00:00:00Z",
    handledAt: null,
    id,
    requesterUserId,
    status: "pending",
    updatedAt: "2026-08-11T00:00:00Z",
  }
}
