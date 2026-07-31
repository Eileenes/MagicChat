import * as React from "react"
import {
  BrainCircuit,
  Building2,
  Check,
  ChevronDown,
  File,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  type LucideIcon,
} from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  getPrototypeDocumentPath,
  initialDocumentTree,
  type ProjectDocumentNode,
  type ProjectDocumentType,
} from "@/lib/document-prototype-data"
import { cn } from "@/lib/utils"

const prototypeProjects = ["新版发布", "个人工作区", "客户门户重构"]

const documentIcons = {
  document: { icon: FileText, className: "text-sky-600 dark:text-sky-300" },
  markdown: {
    icon: FileCode2,
    className: "text-violet-600 dark:text-violet-300",
  },
  file: { icon: File, className: "text-zinc-600 dark:text-zinc-300" },
  mindmap: {
    icon: BrainCircuit,
    className: "text-orange-600 dark:text-orange-300",
  },
  spreadsheet: {
    icon: FileSpreadsheet,
    className: "text-emerald-600 dark:text-emerald-300",
  },
} satisfies Record<ProjectDocumentType, { className: string; icon: LucideIcon }>

export function DocumentWorkspaceSidebar({
  activeDocumentId,
}: {
  activeDocumentId: string
}) {
  const [projectName, setProjectName] = React.useState(prototypeProjects[0])
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<Set<string>>(
    () => new Set(["folder-product", "folder-development", "folder-technical"])
  )

  function toggleFolder(folderId: string) {
    setExpandedFolderIds((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  return (
    <aside className="hidden h-full w-72 shrink-0 flex-col overflow-hidden rounded-xl border bg-background text-foreground shadow-xs md:flex">
      <div className="flex h-14 shrink-0 items-center px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="切换项目"
              className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              type="button"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-teal-500/15 text-teal-700 dark:text-teal-300">
                <Building2 className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {projectName}
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>切换项目</DropdownMenuLabel>
            {prototypeProjects.map((name) => (
              <DropdownMenuItem
                key={name}
                onSelect={() => setProjectName(name)}
              >
                <Building2 />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {projectName === name && <Check className="text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="shrink-0 px-3 py-2">
        <Button
          aria-label="新建文档"
          className="h-9 w-full bg-transparent"
          onClick={() => toast.info("新建文档暂未开放")}
          title="新建文档"
          type="button"
          variant="outline"
        >
          <Plus />
          新建
        </Button>
      </div>

      <nav
        aria-label="项目文档"
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
      >
        <DocumentTree
          activeDocumentId={activeDocumentId}
          depth={0}
          expandedFolderIds={expandedFolderIds}
          nodes={initialDocumentTree}
          onToggleFolder={toggleFolder}
        />
      </nav>
    </aside>
  )
}

function DocumentTree({
  activeDocumentId,
  depth,
  expandedFolderIds,
  nodes,
  onToggleFolder,
}: {
  activeDocumentId: string
  depth: number
  expandedFolderIds: Set<string>
  nodes: ProjectDocumentNode[]
  onToggleFolder: (folderId: string) => void
}) {
  return (
    <div role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) => {
        if (node.kind === "folder") {
          const open = expandedFolderIds.has(node.id)
          return (
            <div key={node.id}>
              <button
                aria-expanded={open}
                className="flex h-9 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                onClick={() => onToggleFolder(node.id)}
                role="treeitem"
                style={{ paddingLeft: depth * 16 + 8 }}
                type="button"
              >
                {open ? (
                  <FolderOpen className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                ) : (
                  <Folder className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                )}
                <span className="truncate">{node.name}</span>
              </button>
              {open && (
                <DocumentTree
                  activeDocumentId={activeDocumentId}
                  depth={depth + 1}
                  expandedFolderIds={expandedFolderIds}
                  nodes={node.children}
                  onToggleFolder={onToggleFolder}
                />
              )}
            </div>
          )
        }

        const path = getPrototypeDocumentPath(node)
        const metadata = documentIcons[node.type]
        const DocumentIcon = metadata.icon
        const className = cn(
          "flex h-9 w-full items-center gap-2 rounded-md pr-2 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          activeDocumentId === node.id &&
            "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
        )
        const content = (
          <>
            <DocumentIcon
              className={cn("size-4 shrink-0", metadata.className)}
            />
            <span className="truncate">{node.name}</span>
          </>
        )

        if (path) {
          return (
            <Link
              aria-current={activeDocumentId === node.id ? "page" : undefined}
              className={className}
              key={node.id}
              role="treeitem"
              style={{ paddingLeft: depth * 16 + 26 }}
              to={path}
            >
              {content}
            </Link>
          )
        }

        return (
          <button
            className={className}
            key={node.id}
            onClick={() => toast.info(`${node.name}类型暂未开放`)}
            role="treeitem"
            style={{ paddingLeft: depth * 16 + 26 }}
            type="button"
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}
