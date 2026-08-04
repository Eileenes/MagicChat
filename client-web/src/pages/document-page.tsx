import * as React from "react"
import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider"
import { Ellipsis, FileText, Loader2 } from "lucide-react"
import { useParams } from "react-router"
import { toast } from "sonner"
import * as Y from "yjs"

import { ClientDocumentTitle } from "@/components/client-document-title"
import { DocumentEditor } from "@/components/documents/document-editor"
import { DocumentWorkspaceSidebar } from "@/components/documents/document-workspace-sidebar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  getClientDocument,
  updateCollaborativeDocumentTitle,
  type ClientDocument,
} from "@/lib/document-data-api"
import {
  getClientProject,
  type ClientProjectDetail,
} from "@/lib/project-data-api"

type BodySyncState = "connecting" | "failed" | "saved" | "saving"

type LoadedDocumentState = {
  document: ClientDocument
  documentId: string
  project: ClientProjectDetail
}

export function DocumentPage() {
  const { documentId } = useParams<{ documentId: string }>()
  const [error, setError] = React.useState<{
    documentId: string
    message: string
  } | null>(null)
  const [loaded, setLoaded] = React.useState<LoadedDocumentState | null>(null)
  const requestedDocumentId = documentId ?? ""

  React.useEffect(() => {
    if (!requestedDocumentId) return
    let cancelled = false
    void getClientDocument(requestedDocumentId)
      .then(async (nextDocument) => {
        if (
          nextDocument.kind !== "document" ||
          nextDocument.documentType !== "document"
        ) {
          throw new Error("该节点不是可编辑文档")
        }
        const nextProject = await getClientProject(nextDocument.projectId)
        if (!cancelled) {
          setLoaded({
            document: nextDocument,
            documentId: requestedDocumentId,
            project: nextProject,
          })
          setError(null)
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError({
            documentId: requestedDocumentId,
            message:
              loadError instanceof Error ? loadError.message : "加载文档失败",
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [requestedDocumentId])

  if (!requestedDocumentId) return <DocumentNotFound message="文档 ID 不存在" />
  if (error?.documentId === requestedDocumentId) {
    return <DocumentNotFound message={error.message} />
  }
  if (!loaded || loaded.documentId !== requestedDocumentId) {
    return <DocumentLoading />
  }

  return (
    <DocumentWorkspace
      documentId={loaded.document.id}
      initialTitle={loaded.document.title}
      key={loaded.document.id}
      projectId={loaded.document.projectId}
      projectName={loaded.project.name}
    />
  )
}

function DocumentWorkspace({
  documentId,
  initialTitle,
  projectId,
  projectName,
}: {
  documentId: string
  initialTitle: string
  projectId: string
  projectName: string
}) {
  const [collaborationDocument] = React.useState(() => new Y.Doc())
  const [bodySyncState, setBodySyncState] =
    React.useState<BodySyncState>("connecting")
  const [title, setTitle] = React.useState(initialTitle)
  const [titleSaveState, setTitleSaveState] = React.useState<
    "failed" | "pending" | "saved" | "saving"
  >("saved")
  const bodyHasSyncedRef = React.useRef(false)
  const bodyUnsyncedChangesRef = React.useRef(0)
  const mountedRef = React.useRef(true)
  const pendingSaveRef = React.useRef(false)
  const saveFailedRef = React.useRef(false)
  const savedTitleRef = React.useRef(initialTitle)
  const savingRef = React.useRef(false)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleRef = React.useRef(initialTitle)
  const pageTitle = title.trim() || "无标题文档"

  async function saveTitle() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (savingRef.current) {
      pendingSaveRef.current = true
      return
    }
    const nextTitle = titleRef.current.trim() || "无标题文档"
    if (nextTitle === savedTitleRef.current) {
      saveFailedRef.current = false
      if (mountedRef.current) setTitleSaveState("saved")
      return
    }

    let saved = false
    savingRef.current = true
    saveFailedRef.current = false
    if (mountedRef.current) setTitleSaveState("saving")
    try {
      const storedTitle = await updateCollaborativeDocumentTitle(
        documentId,
        nextTitle
      )
      saved = true
      savedTitleRef.current = storedTitle
      if (mountedRef.current) {
        setTitleSaveState("saved")
        if ((titleRef.current.trim() || "无标题文档") === nextTitle) {
          titleRef.current = storedTitle
          setTitle(storedTitle)
        }
      }
    } catch (error) {
      saveFailedRef.current = true
      if (mountedRef.current) {
        setTitleSaveState("failed")
        toast.error(error instanceof Error ? error.message : "保存标题失败")
      }
    } finally {
      savingRef.current = false
      if (
        pendingSaveRef.current ||
        (saved &&
          (titleRef.current.trim() || "无标题文档") !== savedTitleRef.current)
      ) {
        pendingSaveRef.current = false
        if (mountedRef.current) void saveTitle()
      }
    }
  }

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [documentId])

  React.useEffect(() => {
    let active = true
    const provider = new HocuspocusProvider({
      document: collaborationDocument,
      name: documentId,
      onAuthenticationFailed: () => {
        if (!active) return
        setBodySyncState("failed")
        toast.error("无权访问文档正文")
      },
      onStatus: ({ status }) => {
        if (!active) return
        if (status === WebSocketStatus.Connecting) {
          bodyHasSyncedRef.current = false
          setBodySyncState("connecting")
        } else if (status === WebSocketStatus.Disconnected) {
          bodyHasSyncedRef.current = false
          setBodySyncState("failed")
        }
      },
      onSynced: ({ state }) => {
        if (!active || !state) return
        bodyHasSyncedRef.current = true
        if (bodyUnsyncedChangesRef.current === 0) setBodySyncState("saved")
      },
      onUnsyncedChanges: ({ number }) => {
        if (!active) return
        bodyUnsyncedChangesRef.current = number
        setBodySyncState(
          number > 0
            ? "saving"
            : bodyHasSyncedRef.current
              ? "saved"
              : "connecting"
        )
      },
      token: "session-cookie",
      url: collaborationWebSocketURL(),
    })

    return () => {
      active = false
      provider.destroy()
    }
  }, [collaborationDocument, documentId])

  React.useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      const dirty =
        savingRef.current ||
        saveFailedRef.current ||
        bodyUnsyncedChangesRef.current > 0 ||
        (titleRef.current.trim() || "无标题文档") !== savedTitleRef.current
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [])

  function confirmLeaveWithUnsavedTitle() {
    const dirty =
      savingRef.current ||
      saveFailedRef.current ||
      bodyUnsyncedChangesRef.current > 0 ||
      (titleRef.current.trim() || "无标题文档") !== savedTitleRef.current
    return !dirty || window.confirm("文档尚未同步完成，确定要离开吗？")
  }

  function handleTitleChange(nextTitle: string) {
    titleRef.current = nextTitle
    saveFailedRef.current = false
    setTitle(nextTitle)
    setTitleSaveState("pending")
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void saveTitle(), 600)
  }

  return (
    <main className="flex h-svh min-w-0 gap-3 overflow-hidden bg-muted p-3">
      <ClientDocumentTitle title={pageTitle} disableMessageAlert />
      <DocumentWorkspaceSidebar
        activeDocumentId={documentId}
        activeTitle={pageTitle}
        onBeforeNavigate={confirmLeaveWithUnsavedTitle}
        projectId={projectId}
        projectName={projectName}
      />
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-teal-50/30 shadow-xs dark:bg-background/30">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 sm:px-6">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300">
            <FileText className="size-5" />
          </span>
          <input
            aria-label="顶部文档标题"
            className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-muted-foreground"
            onBlur={() => void saveTitle()}
            onChange={(event) => handleTitleChange(event.target.value)}
            placeholder="无标题文档"
            value={title}
          />
          <span className="hidden shrink-0 text-xs text-muted-foreground xl:inline">
            {titleSaveState === "saving"
              ? "正在保存标题"
              : titleSaveState === "failed"
                ? "标题保存失败"
                : titleSaveState === "pending"
                  ? "标题尚未保存"
                  : "标题已自动保存"}{" "}
            ·{" "}
            {bodySyncState === "connecting"
              ? "正文连接中"
              : bodySyncState === "saving"
                ? "正文同步中"
                : bodySyncState === "failed"
                  ? "正文同步失败"
                  : "正文已同步"}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="更多文档操作"
                size="icon-sm"
                title="更多文档操作"
                type="button"
                variant="ghost"
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onSelect={() => toast.info("导出功能暂未开放")}>
                导出文档
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => toast.info("文档信息暂未开放")}>
                文档信息
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <DocumentEditor
          collaborationDocument={collaborationDocument}
          onTitleBlur={() => void saveTitle()}
          onTitleChange={handleTitleChange}
          title={title}
        />
      </section>
    </main>
  )
}

function collaborationWebSocketURL() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}/api/client/document/collaboration`
}

function DocumentLoading() {
  return (
    <main className="flex min-h-svh items-center justify-center gap-2 bg-muted/30 text-sm text-muted-foreground">
      <ClientDocumentTitle title="正在加载文档" disableMessageAlert />
      <Loader2 className="size-4 animate-spin" />
      正在加载文档
    </main>
  )
}

function DocumentNotFound({ message }: { message?: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <ClientDocumentTitle title="文档不存在" disableMessageAlert />
      <div className="max-w-sm rounded-lg border bg-background p-8 text-center shadow-xs">
        <h1 className="text-lg font-semibold">文档不存在</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {message || "该文档不存在，或者当前账号无权访问。"}
        </p>
      </div>
    </main>
  )
}
