import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DocumentPage } from "./document-page"

const getClientDocument = vi.fn()
const updateCollaborativeDocumentTitle = vi.fn()
const getClientProject = vi.fn()

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    destroy() {}
  },
  WebSocketStatus: {
    Connected: "connected",
    Connecting: "connecting",
    Disconnected: "disconnected",
  },
}))

vi.mock("@/lib/document-data-api", () => ({
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
  toast: { error: vi.fn(), info: vi.fn() },
}))

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
  getClientDocument.mockReset().mockResolvedValue(document)
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

    fireEvent.change(title, { target: { value: "新版需求" } })
    fireEvent.blur(title)

    await waitFor(() =>
      expect(updateCollaborativeDocumentTitle).toHaveBeenCalledWith(
        document.id,
        "新版需求"
      )
    )
  })

  it("shows the API error for an inaccessible document", async () => {
    getClientDocument.mockRejectedValueOnce(new Error("文档不存在"))
    renderDocumentPage()

    expect(
      await screen.findByText("文档不存在", { selector: "p" })
    ).toBeInTheDocument()
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
      </Routes>
    </MemoryRouter>
  )
}
