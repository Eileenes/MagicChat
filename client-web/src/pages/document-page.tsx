import * as React from "react"
import { Ellipsis, FileText } from "lucide-react"
import { useParams } from "react-router"
import { toast } from "sonner"

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
import { findPrototypeDocumentNode } from "@/lib/document-prototype-data"

export function DocumentPage() {
  const { documentId } = useParams<{ documentId: string }>()
  const document = documentId ? findPrototypeDocumentNode(documentId) : null

  if (
    !document ||
    document.kind !== "document" ||
    document.type !== "document"
  ) {
    return <DocumentNotFound />
  }

  return (
    <DocumentWorkspace
      documentId={document.id}
      initialTitle={document.name}
      key={document.id}
    />
  )
}

function DocumentWorkspace({
  documentId,
  initialTitle,
}: {
  documentId: string
  initialTitle: string
}) {
  const [title, setTitle] = React.useState(initialTitle)
  const pageTitle = title.trim() || "无标题文档"

  return (
    <main className="flex h-svh min-w-0 gap-3 overflow-hidden bg-muted p-3">
      <ClientDocumentTitle title={pageTitle} disableMessageAlert />
      <DocumentWorkspaceSidebar activeDocumentId={documentId} />
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-teal-50/30 shadow-xs dark:bg-background/30">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 sm:px-6">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300">
            <FileText className="size-5" />
          </span>
          <input
            aria-label="顶部文档标题"
            className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-muted-foreground"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="无标题文档"
            value={title}
          />
          <span className="hidden shrink-0 text-xs text-muted-foreground xl:inline">
            临时编辑 · 关闭后内容将丢失
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
        <DocumentEditor onTitleChange={setTitle} title={title} />
      </section>
    </main>
  )
}

function DocumentNotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <ClientDocumentTitle title="文档不存在" disableMessageAlert />
      <div className="max-w-sm rounded-lg border bg-background p-8 text-center shadow-xs">
        <h1 className="text-lg font-semibold">文档不存在</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          该原型文档不存在，或者暂不支持这种文档类型。
        </p>
      </div>
    </main>
  )
}
