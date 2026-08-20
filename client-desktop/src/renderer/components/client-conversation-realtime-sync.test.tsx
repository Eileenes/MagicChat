import { act, render, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

const callbacks = new Map<string, (payload: unknown) => void>()
const realtimeMock = vi.hoisted(() => ({ ready: true }))
const updateConversationMuted = vi.fn()
const refreshConversations = vi.fn().mockResolvedValue(undefined)
const syncLoadedConversationMessages = vi.fn()

vi.mock("@/lib/realtime-context", () => ({
  useRealtime: () => ({
    ready: realtimeMock.ready,
    subscribeRealtimeEvent: (event: string, callback: (payload: unknown) => void) => {
      callbacks.set(event, callback)
      return () => callbacks.delete(event)
    },
  }),
}))

vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => ({
    foregroundConversationId: "",
    handleIncomingConversationMessage: vi.fn(),
    handleIncomingConversationMessageUpdate: vi.fn(),
    handleIncomingMessageReactionsUpdate: vi.fn(),
    refreshConversations,
    removeConversation: vi.fn(),
    syncLoadedConversationMessages,
    updateConversationLastMentionedSeq: vi.fn(),
    updateConversationMuted,
    updateConversationPinned: vi.fn(),
    updateMessageTopic: vi.fn(),
  }),
}))

import { ClientConversationRealtimeSync } from "@/components/client-conversation-realtime-sync"

describe("ClientConversationRealtimeSync", () => {
  beforeEach(() => {
    callbacks.clear()
    realtimeMock.ready = true
    refreshConversations.mockReset().mockResolvedValue(undefined)
    syncLoadedConversationMessages.mockClear()
    updateConversationMuted.mockClear()
  })

  it("首次以 ready 状态挂载时也会触发已知会话追赶", () => {
    render(
      <MemoryRouter initialEntries={["/chat/conversation-1"]}>
        <ClientConversationRealtimeSync />
      </MemoryRouter>,
    )

    expect(syncLoadedConversationMessages).toHaveBeenCalledOnce()
    expect(syncLoadedConversationMessages).toHaveBeenCalledWith()
    expect(refreshConversations).not.toHaveBeenCalled()
  })

  it("每次 system.ready 均在刷新会话列表后触发消息补偿", async () => {
    render(
      <MemoryRouter initialEntries={["/chat/conversation-1"]}>
        <ClientConversationRealtimeSync />
      </MemoryRouter>,
    )
    refreshConversations.mockClear()
    syncLoadedConversationMessages.mockClear()

    act(() => callbacks.get("system.ready")?.({}))

    await waitFor(() => expect(refreshConversations).toHaveBeenCalledOnce())
    await waitFor(() => expect(syncLoadedConversationMessages).toHaveBeenCalledOnce())
    expect(syncLoadedConversationMessages).toHaveBeenCalledWith({
      includeConversationGapSync: false,
    })
    expect(refreshConversations.mock.invocationCallOrder[0]).toBeLessThan(
      syncLoadedConversationMessages.mock.invocationCallOrder[0],
    )
  })

  it("恢复任务在卸载后不再触发消息补偿", async () => {
    const refresh = createDeferred<void>()
    refreshConversations.mockImplementationOnce(() => refresh.promise)
    const view = render(
      <MemoryRouter initialEntries={["/chat/conversation-1"]}>
        <ClientConversationRealtimeSync />
      </MemoryRouter>,
    )
    syncLoadedConversationMessages.mockClear()

    act(() => callbacks.get("system.ready")?.({}))
    expect(refreshConversations).toHaveBeenCalledOnce()

    view.unmount()
    await act(async () => {
      refresh.resolve()
      await refresh.promise
    })

    expect(syncLoadedConversationMessages).not.toHaveBeenCalled()
  })

  it("system.ready 与 ready 边沿同轮发生时只执行一次恢复", async () => {
    const view = render(
      <MemoryRouter initialEntries={["/chat/conversation-1"]}>
        <ClientConversationRealtimeSync />
      </MemoryRouter>,
    )
    refreshConversations.mockClear()
    syncLoadedConversationMessages.mockClear()

    realtimeMock.ready = false
    view.rerender(
      <MemoryRouter initialEntries={["/chat/conversation-1"]}>
        <ClientConversationRealtimeSync />
      </MemoryRouter>,
    )

    const refresh = createDeferred<void>()
    refreshConversations.mockImplementationOnce(() => refresh.promise)

    act(() => {
      realtimeMock.ready = true
      view.rerender(
        <MemoryRouter initialEntries={["/chat/conversation-1"]}>
          <ClientConversationRealtimeSync />
        </MemoryRouter>,
      )
      callbacks.get("system.ready")?.({})
    })

    expect(refreshConversations).toHaveBeenCalledOnce()
    expect(syncLoadedConversationMessages).not.toHaveBeenCalled()

    await act(async () => {
      refresh.resolve()
      await refresh.promise
    })

    expect(syncLoadedConversationMessages).toHaveBeenCalledOnce()
    expect(syncLoadedConversationMessages).toHaveBeenCalledWith({
      includeConversationGapSync: false,
    })
  })

  it("applies conversation mute realtime events", () => {
    render(
      <MemoryRouter initialEntries={["/chat/conversation-1"]}>
        <ClientConversationRealtimeSync />
      </MemoryRouter>,
    )

    act(() => {
      callbacks.get("conversation.mute_updated")?.({
        conversation_id: "conversation-1",
        muted: true,
      })
    })

    expect(updateConversationMuted).toHaveBeenCalledWith("conversation-1", true)
  })

  it("refreshes conversations for a valid restored event and ignores malformed payloads", async () => {
    render(
      <MemoryRouter initialEntries={["/chat/conversation-1"]}>
        <ClientConversationRealtimeSync />
      </MemoryRouter>,
    )

    act(() => {
      callbacks.get("conversation.restored")?.({ conversation_id: "conversation-2" })
      callbacks.get("conversation.restored")?.({ conversation_id: "" })
    })

    await waitFor(() => expect(refreshConversations).toHaveBeenCalledOnce())
  })
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}
