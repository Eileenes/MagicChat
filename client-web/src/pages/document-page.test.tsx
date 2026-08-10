import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DocumentPage } from "./document-page"

const deleteClientDocument = vi.fn()
const getClientDocument = vi.fn()
const getCurrentClientUser = vi.fn()
const updateCollaborativeDocumentTitle = vi.fn()
const getClientProject = vi.fn()
const { awarenessPeers } = vi.hoisted(() => ({
  awarenessPeers: [] as Record<string, unknown>[],
}))

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    private readonly configuration: {
      onAwarenessChange?: (value: { states: unknown[] }) => void
    }

    constructor(configuration: {
      onAwarenessChange?: (value: { states: unknown[] }) => void
    }) {
      this.configuration = configuration
    }

    destroy() {}
    setAwarenessField(key: string, value: unknown) {
      this.configuration.onAwarenessChange?.({
        states: [{ [key]: value }, ...awarenessPeers],
      })
    }
  },
  WebSocketStatus: {
    Connected: "connected",
    Connecting: "connecting",
    Disconnected: "disconnected",
  },
}))

vi.mock("@/lib/client-data-api", () => ({
  getCurrentClientUser: (...args: unknown[]) => getCurrentClientUser(...args),
}))

vi.mock("@/lib/document-data-api", () => ({
  deleteClientDocument: (...args: unknown[]) => deleteClientDocument(...args),
  getClientDocument: (...args: unknown[]) => getClientDocument(...args),
  updateCollaborativeDocumentTitle: (...args: unknown[]) =>
    updateCollaborativeDocumentTitle(...args),
}))

vi.mock("@/lib/project-data-api", () => ({
  getClientProject: (...args: unknown[]) => getClientProject(...args),
}))

vi.mock("@/components/documents/document-workspace-sidebar", () => ({
  DocumentWorkspaceSidebar: () => <aside>文档侧栏</aside>,
}))

vi.mock("@/components/documents/document-editor", () => ({
  DocumentEditor: () => <div>正文编辑器</div>,
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

const currentUser = {
  avatar: "",
  createdAt: "2026-08-05T09:00:00Z",
  email: "lin@example.com",
  id: "user-1",
  lastOnlineAt: null,
  name: "林晓",
  nickname: "",
  phone: "",
  status: "active",
}

const document = {
  createdAt: "2026-08-05T09:00:00Z",
  creator: { avatar: "", id: "user-1", name: "林晓", nickname: "" },
  documentType: "document",
  id: "550e8400-e29b-41d4-a716-446655440000",
  kind: "document",
  parentId: null,
  projectId: "550e8400-e29b-41d4-a716-446655440001",
  schemaVersion: 1,
  sortOrder: 0,
  title: "产品需求文档",
  updatedAt: "2026-08-05T09:00:00Z",
  updatedBy: { avatar: "", id: "user-1", name: "林晓", nickname: "" },
}

beforeEach(() => {
  awarenessPeers.length = 0
  deleteClientDocument.mockReset().mockResolvedValue({
    deletedCount: 1,
    documentId: document.id,
  })
  getClientDocument.mockReset().mockResolvedValue(document)
  getCurrentClientUser.mockReset().mockResolvedValue(currentUser)
  getClientProject.mockReset().mockResolvedValue({ name: "产品项目" })
  updateCollaborativeDocumentTitle.mockReset().mockResolvedValue("新版需求")
})

describe("DocumentPage", () => {
  it("loads a real document and saves title changes", async () => {
    renderDocumentPage()

    const title = await screen.findByLabelText("顶部文档标题")
    expect(title).toHaveValue("产品需求文档")
    expect(getClientDocument).toHaveBeenCalledWith(document.id)
    expect(getClientProject).toHaveBeenCalledWith(document.projectId)
    expect(getCurrentClientUser).toHaveBeenCalledOnce()
    expect(await screen.findByLabelText("1 人正在查看文档")).toBeInTheDocument()

    fireEvent.change(title, { target: { value: "新版需求" } })
    fireEvent.blur(title)

    await waitFor(() =>
      expect(updateCollaborativeDocumentTitle).toHaveBeenCalledWith(
        document.id,
        "新版需求"
      )
    )
  })

  it("shows every online user in the presence popover", async () => {
    awarenessPeers.push(
      ...Array.from({ length: 5 }, (_, index) => ({
        user: {
          avatar: "",
          color: "#0284c7",
          id: `user-${index + 2}`,
          name: `协作者${index + 2}`,
        },
      }))
    )
    renderDocumentPage()

    const trigger = await screen.findByLabelText("6 人正在查看文档")
    expect(screen.getByText("+1")).toBeInTheDocument()
    fireEvent.click(trigger)

    expect(await screen.findByText("正在查看 · 6 人")).toBeInTheDocument()
    expect(screen.getByText("协作者6")).toBeInTheDocument()
  })

  it("shows the API error for an inaccessible document", async () => {
    getClientDocument.mockRejectedValueOnce(new Error("文档不存在"))
    renderDocumentPage()

    expect(
      await screen.findByText("文档不存在", { selector: "p" })
    ).toBeInTheDocument()
  })

  it("confirms deletion and returns to the project document list", async () => {
    const user = userEvent.setup()
    renderDocumentPage()

    await user.click(await screen.findByLabelText("更多文档操作"))
    await user.click(await screen.findByRole("menuitem", { name: "删除" }))

    const confirmation = await screen.findByRole("alertdialog", {
      name: "删除文档",
    })
    expect(confirmation).toHaveTextContent(
      "确定删除“产品需求文档”吗？此操作无法撤销。"
    )
    await user.click(within(confirmation).getByRole("button", { name: "删除" }))

    await waitFor(() =>
      expect(deleteClientDocument).toHaveBeenCalledWith(document.id)
    )
    expect(await screen.findByText("项目文档列表")).toBeInTheDocument()
  })
})

function renderDocumentPage() {
  return render(
    <MemoryRouter initialEntries={[`/documents/document/${document.id}`]}>
      <Routes>
        <Route
          path="/documents/document/:documentId"
          element={<DocumentPage />}
        />
        <Route
          path="/projects/:projectId/documents"
          element={<div>项目文档列表</div>}
        />
      </Routes>
    </MemoryRouter>
  )
}
